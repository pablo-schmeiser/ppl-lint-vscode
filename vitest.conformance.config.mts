import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/opensearch-3.5-conformance.test.ts'],
  },
});
