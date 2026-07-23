/**
 * Ambiente dos testes: banco DE TESTE da aplicacao + segredos JWT de teste.
 * Carregado antes de qualquer import de src/config/env.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ??
  "postgresql://viability:viability_local@127.0.0.1:5432/viability_app_test";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? "test-access-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-fedcba9876543210fedcba9876543210";
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS ?? "4"; // rapido nos testes
