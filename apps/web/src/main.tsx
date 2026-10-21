import '@fontsource-variable/inter';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from '@/App';
import { TooltipProvider } from '@/components/ui/menu';
import { invalidateItemData, queryKeys } from '@/hooks/queries';
import { isApiError, onUnauthenticated } from '@/lib/api';
import { IS_CLAUDE_EDITION } from '@/lib/edition';
import { ThemeProvider, useTheme } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Retry only transient failures (network errors and 5xx), never 4xx.
      retry: (failureCount, error) => failureCount < 2 && (!isApiError(error) || error.status === 0 || error.status >= 500),
    },
  },
});

// When any request reports an expired session, drop the cached user so guards redirect to sign-in.
onUnauthenticated(() => {
  if (queryClient.getQueryData(queryKeys.session)) queryClient.setQueryData(queryKeys.session, null);
});

// Claude edition: records changed on another device or tab arrive through the live store; refresh the views.
if (IS_CLAUDE_EDITION) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('vaultledger:data-changed', () => {
    clearTimeout(pending);
    pending = setTimeout(() => void invalidateItemData(queryClient), 300);
  });
}

// Inside claude.ai the page is framed and its address bar never changes, so routes live in memory.
const Router = IS_CLAUDE_EDITION
  ? ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/app']}>{children}</MemoryRouter>
  : BrowserRouter;

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="bottom-right" richColors closeButton duration={5000} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Router>
            <App />
          </Router>
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
