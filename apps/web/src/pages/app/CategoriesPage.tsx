import type { CategoryDTO } from '@vaultledger/shared';
import { MoreHorizontal, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CategoryDialog } from '@/components/items/CategoryDialog';
import { CategoryDot } from '@/components/items/CategoryBadge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { Card, Skeleton } from '@/components/ui/primitives';
import { useCategories, useCurrentUser, useDeleteCategory } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/format';

export default function CategoriesPage() {
  const user = useCurrentUser();
  const categories = useCategories();
  const remove = useDeleteCategory();
  const [editing, setEditing] = useState<CategoryDTO | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<CategoryDTO | null>(null);

  const openEditor = (category?: CategoryDTO) => {
    setEditing(category);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Group related items. Deleting a category keeps its items; they become uncategorised."
        actions={
          <Button size="sm" onClick={() => openEditor()}>
            <Plus /> New category
          </Button>
        }
      />
      <Card>
        {categories.isError ? (
          <ErrorState message={errorMessage(categories.error)} onRetry={() => void categories.refetch()} />
        ) : categories.isPending ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : categories.data.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Create categories such as Electronics, Kitchen or Office to organise your records."
            action={
              <Button onClick={() => openEditor()}>
                <Plus /> Create a category
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {categories.data.map((category) => (
              <li key={category.id} className="flex items-center gap-3 px-4 py-3">
                <CategoryDot color={category.color} className="size-3" />
                <div className="min-w-0 flex-1">
                  <Link to={`/app/records?categoryId=${category.id}`} className="block truncate font-medium hover:underline">
                    {category.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">Created {formatDate(category.createdAt, user.settings.locale)}</p>
                </div>
                <span className="tabular text-sm text-muted-foreground">
                  {formatNumber(category.itemCount, user.settings.locale)} {category.itemCount === 1 ? 'item' : 'items'}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${category.name}`}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => openEditor(category)}>
                      <Pencil /> Rename or recolour
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => setDeleting(category)}>
                      <Trash2 /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} category={editing} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        destructive
        loading={remove.isPending}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description={
          deleting?.itemCount
            ? `${deleting.itemCount} item(s) use this category. They will be kept and marked as uncategorised.`
            : 'No items use this category.'
        }
        confirmLabel="Delete category"
        onConfirm={() => {
          if (!deleting) return;
          remove
            .mutateAsync(deleting.id)
            .then(() => {
              toast.success(`Category “${deleting.name}” deleted`);
              setDeleting(null);
            })
            .catch((error: unknown) => toast.error(errorMessage(error)));
        }}
      />
    </div>
  );
}
