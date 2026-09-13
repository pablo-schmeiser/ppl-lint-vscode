import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/extension.ts', 'src/vscode/**']
    }
  },
  resolve: {
    alias: {
      '@core': path.resolve(import.meta.dirname, './src/core'),
      '@extractors': path.resolve(import.meta.dirname, './src/extractors'),
      '@vscode-integration': path.resolve(import.meta.dirname, './src/vscode')
    }
  }
});
