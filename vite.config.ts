/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site at https://<user>.github.io/shift/
  base: '/shift/',
  publicDir: false,
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
