// Unit tests only (mocked fetch). The live smoke test has its own config: vitest.smoke.config.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/unit/**/*.test.ts'],
    },
});
