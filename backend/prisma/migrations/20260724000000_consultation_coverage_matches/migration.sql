-- CreateTable
CREATE TABLE "viability_consultation_coverage_matches" (
    "id" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "partnerIdSnapshot" TEXT,
    "partnerNameSnapshot" TEXT NOT NULL,
    "partnerCodeSnapshot" TEXT,
    "layerIdSnapshot" TEXT,
    "layerNameSnapshot" TEXT NOT NULL,
    "versionSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "viability_consultation_coverage_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- NULLS NOT DISTINCT (PostgreSQL 15+): impede duplicar o mesmo match mesmo
-- quando layerIdSnapshot e NULL (itens legados sem layerId).
CREATE UNIQUE INDEX "viability_consultation_coverage_matches_consultationId_lay_key"
  ON "viability_consultation_coverage_matches"("consultationId", "layerIdSnapshot")
  NULLS NOT DISTINCT;
CREATE INDEX "viability_consultation_coverage_matches_consultationId_idx"
  ON "viability_consultation_coverage_matches"("consultationId");
CREATE INDEX "viability_consultation_coverage_matches_partnerCodeSnapsho_idx"
  ON "viability_consultation_coverage_matches"("partnerCodeSnapshot");
CREATE INDEX "viability_consultation_coverage_matches_layerIdSnapshot_idx"
  ON "viability_consultation_coverage_matches"("layerIdSnapshot");
CREATE INDEX "viability_consultation_coverage_matches_createdAt_idx"
  ON "viability_consultation_coverage_matches"("createdAt");

-- AddForeignKey (somente para a propria consulta; NUNCA para parceiros/camadas)
ALTER TABLE "viability_consultation_coverage_matches"
  ADD CONSTRAINT "viability_consultation_coverage_matches_consultationId_fkey"
  FOREIGN KEY ("consultationId") REFERENCES "viability_consultations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: projeta os coverageMatches Json ja existentes.
-- - arrays vazios/invalidos sao ignorados (jsonb_typeof);
-- - itens sem objeto valido ou sem layerName/partnerName sao pulados;
-- - ON CONFLICT DO NOTHING evita duplicacao em reexecucao;
-- - o Json original NAO e alterado.
INSERT INTO "viability_consultation_coverage_matches" (
  "id",
  "consultationId",
  "partnerIdSnapshot",
  "partnerNameSnapshot",
  "partnerCodeSnapshot",
  "layerIdSnapshot",
  "layerNameSnapshot",
  "versionSnapshot",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  c."id",
  NULLIF(m.value->>'partnerId', ''),
  COALESCE(NULLIF(m.value->>'partnerName', ''), 'Desconhecido'),
  NULLIF(m.value->>'partnerCode', ''),
  NULLIF(m.value->>'layerId', ''),
  COALESCE(NULLIF(m.value->>'layerName', ''), 'Desconhecida'),
  NULLIF(m.value->>'version', ''),
  c."createdAt"
FROM "viability_consultations" c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(c."coverageMatches") = 'array' THEN c."coverageMatches"
    ELSE '[]'::jsonb
  END
) AS m(value)
WHERE jsonb_typeof(m.value) = 'object'
ON CONFLICT ("consultationId", "layerIdSnapshot") DO NOTHING;
