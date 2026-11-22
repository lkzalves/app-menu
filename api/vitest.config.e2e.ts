import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Chaves da fila separadas das do dev (o .env não sobrescreve variáveis já definidas)
    env: { REDIS_PREFIX: 'bull-e2e' },
  },
});
