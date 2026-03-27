import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import swc from 'unplugin-swc';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    swc.vite({ // Use SWC for TypeScript/JSX instead of esbuild
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        transform: { react: { runtime: 'automatic' } }
      }
    })
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
