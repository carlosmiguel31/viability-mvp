import { createApp } from "./app";
import { env } from "./config/env";
import { initializeCoverageSnapshot } from "./services/coverage-snapshot.service";
import { coverageSnapshotStore } from "./stores/coverage-snapshot.store";
import { setupGracefulShutdown } from "./shutdown";
import { logger } from "./utils/logger";

async function bootstrap(): Promise<void> {
  const app = createApp();

  // v0.3.0: carrega TODAS as camadas ativas e READY (parceiro ativo) para o
  // snapshot em memoria. Em falha, o servidor sobe mesmo assim e as
  // consultas respondem COVERAGE_NOT_CONFIGURED ate uma reconstrucao valida.
  await initializeCoverageSnapshot();

  // Aviso de migracao do modelo legado de arquivo unico (NAO importa
  // automaticamente a cada inicializacao — a importacao e um comando
  // explicito e unico).
  if (!coverageSnapshotStore.isConfigured() && env.NETWORK_COVERAGE_PATH) {
    logger.warn(
      "NETWORK_COVERAGE_PATH está definido, mas o modelo de arquivo único é LEGADO. Importe o arquivo como camada: npm run coverage:import -- --file \"" +
        env.NETWORK_COVERAGE_PATH +
        '" --partner "Rede Neutra" --code "REDE_NEUTRA" --layer "Cobertura inicial"'
    );
  }

  const server = app.listen(env.PORT, () => {
    logger.info("Backend iniciado", { port: env.PORT });
  });
  setupGracefulShutdown(server);
}

void bootstrap();
