import { Prisma } from '@prisma/client';
import { CATEGORIES_PER_USER_MAX, categoryInputSchema, type CategoryColor, type CategoryDTO } from '@vaultledger/shared';
import { Router } from 'express';
import { prisma } from '../db';
import { AppError, notFound } from '../lib/errors';
import { idParam, parseBody, sendData } from '../lib/http';
import { auth, requireAuth } from '../middleware/auth';
import { logActivity } from '../services/activity';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

const duplicateName = () =>
  new AppError('CONFLICT', 'You already have a category with this name.', { name: 'You already have a category with this name' });

function toCategoryDTO(category: {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { items: number };
}): CategoryDTO {
  return {
    id: category.id,
    name: category.name,
    color: category.color as CategoryColor,
    itemCount: category._count.items,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

const withCount = { _count: { select: { items: { where: { deletedAt: null } } } } } as const;

categoriesRouter.get('/', async (req, res) => {
  const { user } = auth(req);
  const categories = await prisma.category.findMany({
    where: { userId: user.id },
    include: withCount,
    orderBy: { nameKey: 'asc' },
  });
  sendData(res, categories.map(toCategoryDTO));
});

categoriesRouter.post('/', async (req, res) => {
  const { user } = auth(req);
  const input = parseBody(categoryInputSchema, req);
  const count = await prisma.category.count({ where: { userId: user.id } });
  if (count >= CATEGORIES_PER_USER_MAX) {
    throw new AppError('CONFLICT', `You can create up to ${CATEGORIES_PER_USER_MAX} categories.`);
  }
  try {
    const category = await prisma.category.create({
      data: { userId: user.id, name: input.name, nameKey: input.name.toLowerCase(), color: input.color },
      include: withCount,
    });
    await logActivity({ userId: user.id, type: 'category.created', summary: `Created category "${category.name}"`, entityId: category.id }, req);
    sendData(res, toCategoryDTO(category), 201);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateName();
    throw error;
  }
});

categoriesRouter.patch('/:id', async (req, res) => {
  const { user } = auth(req);
  const id = idParam(req);
  const input = parseBody(categoryInputSchema, req);
  const existing = await prisma.category.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound('Category');
  try {
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: { name: input.name, nameKey: input.name.toLowerCase(), color: input.color },
      include: withCount,
    });
    await logActivity({ userId: user.id, type: 'category.updated', summary: `Updated category "${category.name}"`, entityId: id }, req);
    sendData(res, toCategoryDTO(category));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicateName();
    throw error;
  }
});

/** Deleting a category keeps its items; they simply become uncategorised. */
categoriesRouter.delete('/:id', async (req, res) => {
  const { user } = auth(req);
  const id = idParam(req);
  const existing = await prisma.category.findFirst({ where: { id, userId: user.id } });
  if (!existing) throw notFound('Category');
  await prisma.$transaction(async (tx) => {
    await tx.category.delete({ where: { id: existing.id } });
    await logActivity({ userId: user.id, type: 'category.deleted', summary: `Deleted category "${existing.name}"`, entityId: id }, req, tx);
  });
  sendData(res, { ok: true });
});
