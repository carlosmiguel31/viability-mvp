import { readFileSync } from "fs";
import path from "path";
import { zipSync, strToU8 } from "fflate";
import { promises as fs } from "fs";
import os from "os";

export const FIXTURE_KML_PATH = path.join(__dirname, "fixtures", "coverage.kml");

export function readFixtureKml(): string {
  return readFileSync(FIXTURE_KML_PATH, "utf-8");
}

/** Copia o KML de teste para um diretorio temporario. */
export async function createTestKmlFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coverage-kml-"));
  const filePath = path.join(dir, "manchas.kml");
  await fs.writeFile(filePath, readFixtureKml());
  return filePath;
}

/** Gera um KMZ valido contendo o KML de teste. */
export async function createTestKmzFile(): Promise<string> {
  const zipped = zipSync({ "doc.kml": strToU8(readFixtureKml()) });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coverage-kmz-"));
  const filePath = path.join(dir, "manchas.kmz");
  await fs.writeFile(filePath, Buffer.from(zipped));
  return filePath;
}

/** Gera um arquivo .kmz que NAO e um ZIP valido. */
export async function createInvalidKmzFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "coverage-invalid-"));
  const filePath = path.join(dir, "invalido.kmz");
  await fs.writeFile(filePath, Buffer.from("isto nao e um zip"));
  return filePath;
}

// Pontos de referencia do fixture:
export const POINT_INSIDE_BARREIRO = { latitude: -19.988, longitude: -44.018 };
export const POINT_INSIDE_HOLE = { latitude: -19.985, longitude: -44.015 };
export const POINT_IN_OVERLAP = { latitude: -19.981, longitude: -44.011 };
export const POINT_OUTSIDE = { latitude: -19.95, longitude: -44.0 };
export const POINT_IN_ISLAND_2 = { latitude: -19.957, longitude: -44.037 };

// ── Autenticacao (v0.2.0) ─────────────────────────────────────
import type { Express } from "express";
import request from "supertest";
import { prisma } from "../src/db/prisma";
import { hashPassword } from "../src/utils/password";
import type { UserRole } from "../src/generated/prisma/enums";

export const TEST_PASSWORD = "SenhaForte123";

export const TEST_DATABASE_GUARD_MESSAGE =
  "Os testes só podem limpar um banco explicitamente identificado como banco de teste.";

/**
 * Trava de seguranca: deleteMany so roda quando NODE_ENV=test E o nome do
 * banco em APP_DATABASE_URL esta explicitamente identificado como de teste.
 * Uma URL de producao nunca e aceita silenciosamente.
 */
export function assertTestDatabase(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  databaseUrl: string | undefined = process.env.APP_DATABASE_URL
): void {
  const databaseName =
    (databaseUrl ?? "").split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";
  const isTestDatabase =
    databaseName.endsWith("_test") || databaseName.includes("test");
  if (nodeEnv !== "test" || !databaseName || !isTestDatabase) {
    throw new Error(TEST_DATABASE_GUARD_MESSAGE);
  }
}

export async function resetAppDatabase(): Promise<void> {
  assertTestDatabase();
  await prisma.auditLog.deleteMany();
  await prisma.viabilityConsultation.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

export async function createTestUser(options: {
  role: UserRole;
  email?: string;
  name?: string;
  active?: boolean;
  password?: string;
}): Promise<{ id: string; email: string; password: string }> {
  const email = (options.email ?? `${options.role.toLowerCase()}@teste.local`).toLowerCase();
  const password = options.password ?? TEST_PASSWORD;
  const user = await prisma.user.create({
    data: {
      name: options.name ?? `Usuário ${options.role}`,
      email,
      passwordHash: await hashPassword(password),
      role: options.role,
      active: options.active ?? true,
    },
  });
  return { id: user.id, email, password };
}

export async function loginAs(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD
): Promise<{ accessToken: string; refreshCookie: string }> {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login de teste falhou (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const cookies = res.headers["set-cookie"] ?? [];
  const refreshCookie = (Array.isArray(cookies) ? cookies : [cookies])
    .map((c: string) => c.split(";")[0])
    .find((c: string) => c.startsWith("viability.refresh="));
  return { accessToken: res.body.accessToken, refreshCookie: refreshCookie ?? "" };
}

/**
 * Fluxo completo da confirmacao do marcador (v0.4.0 revisao): primeiro o
 * /check geocodifica (provider dev => ADDRESS_AMBIGUOUS) e devolve o
 * locationConfirmationToken; em seguida o /confirm-location envia o token
 * junto do adjustedLocation.
 */
export async function confirmLocationAs(
  app: import("express").Express,
  accessToken: string,
  address: Record<string, unknown>,
  adjustedLocation: { latitude: number; longitude: number }
): Promise<import("supertest").Response> {
  const request = (await import("supertest")).default;
  const first = await request(app)
    .post("/api/viabilities/check")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ address });
  const token = first.body.locationConfirmationToken as string | undefined;
  return request(app)
    .post("/api/viabilities/confirm-location")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ address, adjustedLocation, locationConfirmationToken: token });
}
