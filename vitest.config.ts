import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup}.config.*',
      '**/playwright/**',
    ],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 35,
        branches: 30,
        functions: 33,
        statements: 35,
      },
    },
  },
});
