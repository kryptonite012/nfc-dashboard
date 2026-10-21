import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// `vite build --mode claude` builds the claude.ai edition (see src/lib/edition.ts and scripts/make-artifact.mjs).
export default defineConfig(({ mode }) => ({
  base: mode === 'claude' ? './' : '/',
  define: {
    'import.meta.env.VITE_EDITION': JSON.stringify(mode === 'claude' ? 'claude' : 'server'),
  },
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The API is proxied so the browser sees a single origin, exactly as in production.
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    outDir: mode === 'claude' ? 'dist-claude' : 'dist',
    sourcemap: mode !== 'claude',
    // The password-strength dictionaries (~1.2 MB) are a lazily loaded chunk used only on password forms.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        // Long-lived vendor chunks so application releases do not invalidate cached libraries.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](@tanstack|zod|react-hook-form|@hookform)[\\/]/.test(id)) return 'vendor-data';
          if (/[\\/](react|react-dom|scheduler|react-router|react-router-dom|@radix-ui|radix-ui|@floating-ui|sonner|lucide-react)[\\/]/.test(id)) {
            return 'vendor-ui';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}));
