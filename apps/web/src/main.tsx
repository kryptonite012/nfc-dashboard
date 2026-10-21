import '@fontsource-variable/inter';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App } from '@/App';
import { TooltipProvider } from '@/components/ui/menu';
import { queryKeys } from '@/hooks/queries';
import { isApiError, onUnauthenticated } from '@/lib/api';
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

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-right" richColors closeButton duration={5000} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
