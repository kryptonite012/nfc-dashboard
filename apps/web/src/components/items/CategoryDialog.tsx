import { zodResolver } from '@hookform/resolvers/zod';
import { CATEGORY_COLORS, categoryInputSchema, type CategoryColor, type CategoryDTO, type CategoryInput } from '@vaultledger/shared';
import { useEffect } from 'react';
import { useForm, type Path } from 'react-hook-form';
import { toast } from 'sonner';
import { CategoryDot } from '@/components/items/CategoryBadge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useSaveCategory } from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: CategoryDTO;
  onSaved?: (category: CategoryDTO) => void;
}

export function CategoryDialog({ open, onOpenChange, category, onSaved }: CategoryDialogProps) {
  const save = useSaveCategory();
  const form = useForm<CategoryInput>({
    resolver: zodResolver(categoryInputSchema),
    defaultValues: { name: category?.name ?? '', color: category?.color ?? 'blue' },
  });
  const { register, handleSubmit, formState, reset, setError, watch, setValue } = form;

  useEffect(() => {
    if (open) reset({ name: category?.name ?? '', color: category?.color ?? 'blue' });
  }, [open, category, reset]);

  const selected = watch('color') as CategoryColor;

  const submit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync({ id: category?.id, input: values });
      toast.success(category ? `Category “${saved.name}” updated` : `Category “${saved.name}” created`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error) && Object.keys(error.fields).length) {
        for (const [key, message] of Object.entries(error.fields)) setError(key as Path<CategoryInput>, { message });
      } else {
        setError('name', { message: errorMessage(error) });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form
          onSubmit={(event) => {
            event.stopPropagation(); // never submit an enclosing item form
            void submit(event);
          }}
          className="space-y-5"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{category ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>Categories group related items and power the category breakdown in Analytics.</DialogDescription>
          </DialogHeader>
          <Field id="category-name" label="Name" required error={formState.errors.name?.message}>
            {(aria) => <Input {...aria} autoFocus maxLength={50} placeholder="e.g. Electronics" {...register('name')} />}
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Label colour</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Label colour">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={selected === color}
                  aria-label={color}
                  onClick={() => setValue('color', color, { shouldDirty: true })}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border transition-colors hover:bg-accent',
                    selected === color ? 'border-primary ring-2 ring-primary/30' : 'border-border',
                  )}
                >
                  <CategoryDot color={color} className="size-4" />
                </button>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {category ? 'Save category' : 'Create category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
