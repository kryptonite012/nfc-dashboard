import type { CategoryColor } from '@vaultledger/shared';
import { cn } from '@/lib/utils';

/** Static class names so Tailwind can see them at build time. */
const DOT: Record<CategoryColor, string> = {
  slate: 'bg-slate-500',
  blue: 'bg-blue-600',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  teal: 'bg-teal-600',
  emerald: 'bg-emerald-600',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  rose: 'bg-rose-500',
  cyan: 'bg-cyan-600',
};

export function CategoryDot({ color, className }: { color: CategoryColor | null; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', color ? DOT[color] : 'bg-muted-foreground/40', className)} />;
}

export function CategoryBadge({ category }: { category: { name: string; color: CategoryColor } | null }) {
  if (!category) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs font-medium">
      <CategoryDot color={category.color} />
      <span className="truncate">{category.name}</span>
    </span>
  );
}
