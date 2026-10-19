/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { securityHeaders } from '../infra/lib/headers.ts';

// Local dev: the API runs on :3001 (`npm run dev` at the repo root); the end-to-end tests use API_PORT.
const api = `http://localhost:${process.env.API_PORT ?? 3001}`;
const proxy = { '/api': { target: api, rewrite: (p: string) => p.replace(/^\/api/, '') } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // `vite preview` serves the production build for the end-to-end tests, with the production
  // security headers (the API is reached through the proxy, so 'self' is all it connects to).
  preview: { proxy, headers: securityHeaders([]) },
  build: {
    rolldownOptions: {
      output: {
        // React and the router change less often than the app: their own file stays cached across deploys.
        codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ }] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
