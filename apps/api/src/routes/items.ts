import {
  bulkActionSchema,
  createItemSchema,
  itemListQuerySchema,
  updateItemSchema,
  type PaginationMeta,
} from '@vaultledger/shared';
import { Router } from 'express';
import { AppError } from '../lib/errors';
import { idParam, parseBody, parseQuery, sendData } from '../lib/http';
import { toItemDTO, toPriceHistoryDTO } from '../lib/serialize';
import { auth, requireAuth } from '../middleware/auth';
import {
  createItem,
  getItem,
  listItems,
  purgeItems,
  restoreItems,
  runBulkAction,
  softDeleteItems,
  updateItem,
} from '../services/items';

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

itemsRouter.get('/', async (req, res) => {
  const { user } = auth(req);
  const query = parseQuery(itemListQuerySchema, req);
  const { items, total } = await listItems(user.id, query);
  const meta: PaginationMeta = {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
  sendData(res, items.map(toItemDTO), 200, meta);
});

itemsRouter.post('/', async (req, res) => {
  const { user } = auth(req);
  const key = req.get('idempotency-key') ?? null;
  if (key !== null && !IDEMPOTENCY_KEY.test(key)) throw new AppError('BAD_REQUEST', 'Invalid Idempotency-Key header.');
  const data = parseBody(createItemSchema, req);
  const { item, replayed } = await createItem(user.id, data, key, req);
  if (replayed) res.setHeader('Idempotent-Replayed', 'true');
  sendData(res, toItemDTO(item), replayed ? 200 : 201);
});

itemsRouter.post('/bulk', async (req, res) => {
  const { user } = auth(req);
  const input = parseBody(bulkActionSchema, req);
  const affected = await runBulkAction(user.id, input, req);
  sendData(res, { affected });
});

itemsRouter.get('/:id', async (req, res) => {
  const { user } = auth(req);
  const item = await getItem(user.id, idParam(req));
  sendData(res, { ...toItemDTO(item), priceHistory: item.priceHistory.map(toPriceHistoryDTO) });
});

itemsRouter.patch('/:id', async (req, res) => {
  const { user } = auth(req);
  const id = idParam(req);
  const input = parseBody(updateItemSchema, req);
  const updated = await updateItem(
    user.id,
    id,
    {
      ...input,
      purchaseDate: input.purchaseDate === '' ? null : input.purchaseDate,
    },
    req,
  );
  sendData(res, toItemDTO(updated));
});

itemsRouter.delete('/:id', async (req, res) => {
  const { user } = auth(req);
  const affected = await softDeleteItems(user.id, [idParam(req)], req);
  if (affected === 0) throw new AppError('NOT_FOUND', 'Item not found');
  sendData(res, { affected });
});

itemsRouter.post('/:id/restore', async (req, res) => {
  const { user } = auth(req);
  const affected = await restoreItems(user.id, [idParam(req)], req);
  if (affected === 0) throw new AppError('NOT_FOUND', 'Item not found in trash');
  sendData(res, { affected });
});

itemsRouter.delete('/:id/permanent', async (req, res) => {
  const { user } = auth(req);
  const affected = await purgeItems(user.id, [idParam(req)], req);
  if (affected === 0) throw new AppError('NOT_FOUND', 'Item not found in trash');
  sendData(res, { affected });
});
