// The end-to-end smoke test: the built server against a running Recollect API (npm run test:smoke).
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/smoke/**/*.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 60_000,
        fileParallelism: false,
    },
});
