import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemForm } from '@/components/items/ItemForm';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const QuickAddContext = createContext<{ open: () => void } | null>(null);

export function useQuickAdd() {
  const context = useContext(QuickAddContext);
  if (!context) throw new Error('useQuickAdd must be used inside QuickAddProvider');
  return context;
}

/** Provides a quick-add modal that can be opened from anywhere in the app shell. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const navigate = useNavigate();
  const value = useMemo(() => ({ open: () => setOpen(true) }), []);

  return (
    <QuickAddContext.Provider value={value}>
      {children}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Quick add</DialogTitle>
            <DialogDescription>
              Record an item and its price. Use{' '}
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  setOpen(false);
                  navigate('/app/items/new');
                }}
              >
                the full form
              </button>{' '}
              for SKU, supplier, dates and notes.
            </DialogDescription>
          </DialogHeader>
          {isOpen && (
            <ItemForm
              mode="create"
              compact
              onCancel={() => setOpen(false)}
              onSaved={(_item, { addAnother }) => {
                if (!addAnother) setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </QuickAddContext.Provider>
  );
}
