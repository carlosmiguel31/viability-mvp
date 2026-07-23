import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Client } from "pg";

/**
 * Aplica TODAS as migrations, em ordem, num banco recem-criado — o
 * equivalente local do `prisma migrate deploy` em banco limpo.
 */
const MIGRATIONS_DIR = path.join(__dirname, "..", "prisma", "migrations");
const CHECK_DB = `viability_migration_check_${Date.now()}`;

function adminUrl(): string {
  // Conecta no banco de TESTE apenas para emitir CREATE/DROP DATABASE.
  return process.env.APP_DATABASE_URL!;
}

describe("migrations em banco limpo", () => {
  afterAll(async () => {
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${CHECK_DB}`);
    await admin.end();
  });

  it("todas as migrations aplicam sem erro e criam as tabelas esperadas", async () => {
    const admin = new Client({ connectionString: adminUrl() });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${CHECK_DB}`);
    await admin.end();

    const freshUrl = adminUrl().replace(/\/[^/?]+(\?|$)/, `/${CHECK_DB}$1`);
    const fresh = new Client({ connectionString: freshUrl });
    await fresh.connect();
    try {
      const folders = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      expect(folders.length).toBeGreaterThanOrEqual(4);
      for (const folder of folders) {
        const sql = readFileSync(path.join(MIGRATIONS_DIR, folder, "migration.sql"), "utf-8");
        await fresh.query(sql); // qualquer erro derruba o teste
      }
      const tables = await fresh.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      );
      const names = tables.rows.map((row) => row.table_name);
      for (const expected of [
        "users",
        "refresh_tokens",
        "audit_logs",
        "coverage_partners",
        "coverage_layers",
        "viability_consultations",
      ]) {
        expect(names).toContain(expected);
      }
    } finally {
      await fresh.end();
    }
  });
});
