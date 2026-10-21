import { Loader2 } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ErrorState } from '@/components/ui/feedback';
import { CurrentUserContext, useSession } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { safeNextPath } from '@/lib/utils';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';
import { PrivacyPage, TermsPage } from '@/pages/legal/LegalPages';
import { NotFoundPage } from '@/pages/NotFoundPage';

const OverviewPage = lazy(() => import('@/pages/app/OverviewPage'));
const RecordsPage = lazy(() => import('@/pages/app/RecordsPage'));
const ItemDetailPage = lazy(() => import('@/pages/app/ItemDetailPage'));
const AddItemPage = lazy(() => import('@/pages/app/AddItemPage'));
const EditItemPage = lazy(() => import('@/pages/app/EditItemPage'));
const CategoriesPage = lazy(() => import('@/pages/app/CategoriesPage'));
const AnalyticsPage = lazy(() => import('@/pages/app/AnalyticsPage'));
const DataPage = lazy(() => import('@/pages/app/DataPage'));
const ActivityPage = lazy(() => import('@/pages/app/ActivityPage'));
const SecurityPage = lazy(() => import('@/pages/app/SecurityPage'));
const SettingsPage = lazy(() => import('@/pages/app/SettingsPage'));

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

/** Applies the account's saved theme once per sign-in, so it follows the user across devices. */
function ThemeSync({ theme }: { theme: 'system' | 'light' | 'dark' }) {
  const { setTheme } = useTheme();
  const applied = useRef(false);
  useEffect(() => {
    if (!applied.current) {
      applied.current = true;
      setTheme(theme);
    }
  }, [theme, setTheme]);
  return null;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useSession();
  if (session.isPending) return <FullPageLoader label="Checking your session…" />;
  if (session.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ErrorState message={errorMessage(session.error)} onRetry={() => void session.refetch()} />
      </div>
    );
  }
  if (!session.data) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return (
    <CurrentUserContext.Provider value={session.data}>
      <ThemeSync theme={session.data.settings.theme} />
      {children}
    </CurrentUserContext.Provider>
  );
}

function GuestOnly({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <FullPageLoader />;
  // Signed-in visitors (including right after signing in) continue to the page they originally asked for.
  if (session.data) return <Navigate to={safeNextPath(new URLSearchParams(location.search).get('next'))} replace />;
  return <>{children}</>;
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullPageLoader />}>{children}</Suspense>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Lazy><OverviewPage /></Lazy>} />
        <Route path="records" element={<Lazy><RecordsPage /></Lazy>} />
        <Route path="records/:id" element={<Lazy><ItemDetailPage /></Lazy>} />
        <Route path="records/:id/edit" element={<Lazy><EditItemPage /></Lazy>} />
        <Route path="items/new" element={<Lazy><AddItemPage /></Lazy>} />
        <Route path="categories" element={<Lazy><CategoriesPage /></Lazy>} />
        <Route path="analytics" element={<Lazy><AnalyticsPage /></Lazy>} />
        <Route path="data" element={<Lazy><DataPage /></Lazy>} />
        <Route path="activity" element={<Lazy><ActivityPage /></Lazy>} />
        <Route path="security" element={<Lazy><SecurityPage /></Lazy>} />
        <Route path="settings" element={<Lazy><SettingsPage /></Lazy>} />
        <Route path="*" element={<NotFoundPage inApp />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
