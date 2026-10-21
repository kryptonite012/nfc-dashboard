import type { ItemDTO } from '@vaultledger/shared';
import { toast } from 'sonner';
import { useBulkAction } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';

/** Soft delete with a real undo (restore from trash), restore and permanent deletion. */
export function useItemActions() {
  const bulk = useBulkAction();

  const moveToTrash = async (items: Pick<ItemDTO, 'id' | 'name'>[]) => {
    const ids = items.map((item) => item.id);
    try {
      const { affected } = await bulk.mutateAsync({ action: 'delete', ids });
      toast.success(affected === 1 ? `“${items[0]!.name}” moved to trash` : `${affected} records moved to trash`, {
        description: 'You can restore them from the trash at any time.',
        action: {
          label: 'Undo',
          onClick: () => {
            bulk
              .mutateAsync({ action: 'restore', ids })
              .then(({ affected: restored }) => toast.success(restored === 1 ? 'Record restored' : `${restored} records restored`))
              .catch((error: unknown) => toast.error(errorMessage(error)));
          },
        },
      });
      return affected;
    } catch (error) {
      toast.error(errorMessage(error));
      return 0;
    }
  };

  const restore = async (ids: string[]) => {
    try {
      const { affected } = await bulk.mutateAsync({ action: 'restore', ids });
      toast.success(affected === 1 ? 'Record restored' : `${affected} records restored`);
      return affected;
    } catch (error) {
      toast.error(errorMessage(error));
      return 0;
    }
  };

  const purge = async (ids: string[]) => {
    try {
      const { affected } = await bulk.mutateAsync({ action: 'purge', ids });
      toast.success(affected === 1 ? 'Record permanently deleted' : `${affected} records permanently deleted`);
      return affected;
    } catch (error) {
      toast.error(errorMessage(error));
      return 0;
    }
  };

  const setCategory = async (ids: string[], categoryId: string | null) => {
    try {
      const { affected } = await bulk.mutateAsync({ action: 'setCategory', ids, categoryId });
      toast.success(`Category updated for ${affected} record${affected === 1 ? '' : 's'}`);
      return affected;
    } catch (error) {
      toast.error(errorMessage(error));
      return 0;
    }
  };

  return { moveToTrash, restore, purge, setCategory, pending: bulk.isPending };
}
