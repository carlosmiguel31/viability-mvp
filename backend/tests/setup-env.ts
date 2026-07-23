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
process.env.COVERAGE_STORAGE_PATH =
  process.env.COVERAGE_STORAGE_PATH ?? "/tmp/viability-test-storage";
// Geocodificacao DEV nos testes HTTP: LOW + partialMatch => primeira chamada
// sem adjustedLocation resulta em ADDRESS_AMBIGUOUS (sem rede externa).
process.env.GEOCODING_PROVIDER = process.env.GEOCODING_PROVIDER ?? "dev";
process.env.DEV_GEOCODING_FIXED_LAT = process.env.DEV_GEOCODING_FIXED_LAT ?? "-19.988";
process.env.DEV_GEOCODING_FIXED_LNG = process.env.DEV_GEOCODING_FIXED_LNG ?? "-44.018";
process.env.LOCATION_CONFIRMATION_SECRET =
  process.env.LOCATION_CONFIRMATION_SECRET ?? "test-location-confirmation-secret-0123456789";
