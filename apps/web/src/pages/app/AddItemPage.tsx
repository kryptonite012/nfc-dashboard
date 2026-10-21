import { useNavigate } from 'react-router-dom';
import { ItemForm } from '@/components/items/ItemForm';
import { PageHeader } from '@/components/ui/feedback';
import { Card, CardContent } from '@/components/ui/primitives';

export default function AddItemPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Add New Item" description="Record an item and its price. Fields marked * are required." />
      <Card>
        <CardContent className="pt-6">
          <ItemForm
            mode="create"
            onCancel={() => navigate(-1)}
            onSaved={(item, { addAnother }) => {
              if (!addAnother) navigate(`/app/records/${item.id}`);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
