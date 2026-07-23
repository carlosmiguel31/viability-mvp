/**
 * Limpeza do histórico de consultas conforme a retenção configurada:
 *
 *   npm run consultations:cleanup              (remove de fato, por lotes)
 *   npm run consultations:cleanup -- --dry-run (apenas mostra o que removeria)
 *
 * Nunca é executada automaticamente na inicialização e não há agendador.
 */
import "dotenv/config";
import { disconnectAppDatabase } from "../db/prisma";
import { cleanupConsultations } from "../services/consultation.service";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await cleanupConsultations({ dryRun });
  console.log(dryRun ? "Simulação (--dry-run):" : "Limpeza executada:");
  console.log(`  Retenção:   ${result.retentionDays} dia(s)`);
  console.log(`  Corte:      registros anteriores a ${result.cutoff}`);
  console.log(`  Expirados:  ${result.expiredCount}`);
  console.log(`  Removidos:  ${result.removedCount}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => disconnectAppDatabase());
