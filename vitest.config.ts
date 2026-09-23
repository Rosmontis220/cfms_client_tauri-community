import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    // Community plugin sources are tested alongside the app: a plugin's own
    // rules — what it keeps, for whom, and when it drops it — are exactly the
    // part that can be wrong, and they are pure enough to test without a host.
    include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'],
    // Tests that drive a plugin's built page need that artifact to exist. It is
    // deliberately not committed, so the suite builds it rather than skipping —
    // a skipped test that matters reads as green.
    globalSetup: ['./vitest.global-setup.ts'],
    clearMocks: true,
  },
});
