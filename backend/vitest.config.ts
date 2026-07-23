import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    clearMocks: true,
    setupFiles: ["tests/setup-env.ts"],
    // Testes compartilham o banco de teste da aplicacao: executar em serie.
    fileParallelism: false,
  },
});
