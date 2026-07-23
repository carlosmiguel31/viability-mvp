import { createApp } from "./app";
import { env } from "./config/env";
import { loadCoverageIntoMemory } from "./services/coverage-loader.service";
import { setupGracefulShutdown } from "./shutdown";
import { logger } from "./utils/logger";

async function bootstrap(): Promise<void> {
  const app = createApp();

  // Processa as manchas na inicializacao. Se falhar, o servidor sobe mesmo
  // assim e as consultas retornam COVERAGE_NOT_LOADED ate uma recarga valida.
  try {
    await loadCoverageIntoMemory(env.NETWORK_COVERAGE_PATH);
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    logger.error("Falha na carga inicial das manchas de cobertura", { message });
  }

  const server = app.listen(env.PORT, () => {
    logger.info("Backend iniciado", { port: env.PORT });
  });
  setupGracefulShutdown(server);
}

void bootstrap();
