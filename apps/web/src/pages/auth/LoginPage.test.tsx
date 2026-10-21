import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/menu';
import { LoginPage } from '@/pages/auth/LoginPage';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/login']}>
          <LoginPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('LoginPage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/config')) {
        return json(200, {
          data: {
            appName: 'VaultLedger',
            features: { phoneAuth: false, emailDelivery: 'smtp', smsDelivery: 'disabled', pdfExport: true, breachedPasswordCheck: false },
            requirePhoneOnSignup: false,
            passwordMinLength: 10,
          },
        });
      }
      if (url.endsWith('/api/auth/csrf')) return json(200, { data: { csrfToken: 'token-123' } });
      if (url.endsWith('/api/auth/login')) {
        return json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect sign-in details.' } });
      }
      return json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('validates required fields before calling the API', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or phone number is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/auth/login'), expect.anything());
  });

  it('sends the CSRF token and shows a generic error for bad credentials', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText('Email address'), 'someone@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect sign-in details.')).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/auth/login'));
    expect(loginCall?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'token-123' });
    expect(loginCall?.[1]?.credentials).toBe('include');
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ identifier: 'someone@example.com', password: 'wrong-password', remember: false });
  });

  it('toggles password visibility', async () => {
    renderLogin();
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    await waitFor(() => expect(input).toHaveAttribute('type', 'text'));
  });
});
