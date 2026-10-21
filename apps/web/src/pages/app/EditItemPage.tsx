import { PackageX } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ItemForm } from '@/components/items/ItemForm';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/feedback';
import { Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { useCurrentUser, useItem } from '@/hooks/queries';
import { errorMessage, isApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export default function EditItemPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const item = useItem(id);

  if (item.isPending) return <Skeleton className="mx-auto h-96 max-w-3xl" />;
  if (item.isError) {
    return isApiError(item.error, 'NOT_FOUND') ? (
      <EmptyState icon={PackageX} title="Record not found" action={<Button asChild variant="outline"><Link to="/app/records">Back to all records</Link></Button>} />
    ) : (
      <ErrorState message={errorMessage(item.error)} onRetry={() => void item.refetch()} />
    );
  }
  if (item.data.deletedAt) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="warning" title="This record is in the trash" action={<Button asChild size="sm" variant="outline"><Link to={`/app/records/${item.data.id}`}>View record</Link></Button>}>
          Restore it before editing.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Edit “${item.data.name}”`} description={`Last updated ${formatDateTime(item.data.updatedAt, user.settings.locale)}`} />
      <Card>
        <CardContent className="pt-6">
          {/* Remount when the server version changes so the form never edits stale values. */}
          <ItemForm
            key={`${item.data.id}-${item.data.version}`}
            mode="edit"
            item={item.data}
            onCancel={() => navigate(`/app/records/${item.data.id}`)}
            onSaved={(saved) => navigate(`/app/records/${saved.id}`)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
