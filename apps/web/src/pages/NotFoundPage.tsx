import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';

export function NotFoundPage({ inApp = false }: { inApp?: boolean }) {
  return (
    <div className={inApp ? 'py-10' : 'flex min-h-dvh items-center justify-center'}>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you’re looking for doesn’t exist or has moved."
        action={
          <Button asChild>
            <Link to="/app">Go to overview</Link>
          </Button>
        }
      />
    </div>
  );
}
