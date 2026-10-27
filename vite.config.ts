/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { bookmarklet } from './plugins/bookmarklet.ts';

export default defineConfig({
  plugins: [bookmarklet()],
  // IPv4 so the dev server also answers on 127.0.0.1, where the demo supplier runs (src/providers/demo).
  server: { host: '127.0.0.1' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
