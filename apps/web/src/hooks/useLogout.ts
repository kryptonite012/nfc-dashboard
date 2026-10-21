import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { queryKeys } from '@/hooks/queries';
import { api, resetCsrfToken } from '@/lib/api';

export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api('/api/auth/logout', { method: 'POST' }),
    onSettled: (_data, error) => {
      // Clear every cached record so nothing from this account lingers in memory.
      resetCsrfToken();
      client.clear();
      client.setQueryData(queryKeys.session, null);
      navigate('/login', { replace: true });
      if (error) toast.error('We could not reach the server, but you have been signed out on this device.');
      else toast.success('You have been signed out.');
    },
  });
}
