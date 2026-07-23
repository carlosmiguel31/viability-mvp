/**
 * Importação explícita de um arquivo KML/KMZ como camada de cobertura:
 *
 *   npm run coverage:import -- --file "./data/rede.kml" \
 *     --partner "Rede Neutra" --code "REDE_NEUTRA" \
 *     --layer "Cobertura inicial" [--version "2026-07"]
 *
 * - cria ou localiza o parceiro pelo code;
 * - importa o arquivo (mesmas validações do upload);
 * - NÃO duplica o mesmo SHA-256 (erro claro em duplicidade);
 * - mostra as estatísticas ao final;
 * - nunca roda automaticamente na inicialização.
 */
import "dotenv/config";
import { promises as fs } from "fs";
import path from "path";
import { prisma, disconnectAppDatabase } from "../db/prisma";
import { createLayer } from "../services/coverage-layer.service";
import { AppError } from "../utils/errors";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args[key.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

export async function runCoverageImport(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const filePath = args.file;
  const partnerName = args.partner;
  const partnerCode = args.code;
  const layerName = args.layer;

  if (!filePath || !partnerName || !partnerCode || !layerName) {
    throw new Error(
      'Uso: npm run coverage:import -- --file "./arquivo.kml" --partner "Nome" --code "CODIGO" --layer "Nome da camada" [--version "v1"]'
    );
  }

  const buffer = await fs.readFile(filePath).catch(() => {
    throw new Error(`Arquivo não encontrado: ${filePath}`);
  });

  // Cria ou localiza o parceiro pelo code (normalizado em maiúsculas).
  const code = partnerCode.trim().toUpperCase();
  let partner = await prisma.coveragePartner.findUnique({ where: { code } });
  if (!partner) {
    partner = await prisma.coveragePartner.create({
      data: { name: partnerName.trim(), code, active: true },
    });
    console.log(`Parceiro criado: ${partner.name} (${partner.code})`);
  } else {
    console.log(`Parceiro existente: ${partner.name} (${partner.code})`);
  }

  const layer = await createLayer(
    {
      partnerId: partner.id,
      name: layerName,
      version: args.version,
      fileBuffer: buffer,
      originalFileName: path.basename(filePath),
    },
    null, // execução por CLI: sem usuário autenticado responsável
    null
  );

  console.log("Importação concluída:");
  console.log(`  Camada:     ${layer.name} (${layer.id})`);
  console.log(`  Versão:     ${layer.version ?? "—"}`);
  console.log(`  Arquivo:    ${layer.originalFileName} (${layer.fileType}, ${layer.fileSize} bytes)`);
  console.log(`  SHA-256:    ${layer.sha256}`);
  console.log(`  Áreas:      ${layer.areaCount}`);
  console.log(`  Polígonos:  ${layer.polygonCount}`);
  console.log(`  Ignoradas:  ${layer.ignoredGeometryCount} geometria(s)`);
}

if (process.argv[1]?.endsWith("coverage-import.ts")) {
  runCoverageImport(process.argv.slice(2))
    .catch((err) => {
      const message =
        err instanceof AppError && err.code === "COVERAGE_FILE_DUPLICATE"
          ? `Duplicidade: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(message);
      process.exitCode = 1;
    })
    .finally(() => disconnectAppDatabase());
}
