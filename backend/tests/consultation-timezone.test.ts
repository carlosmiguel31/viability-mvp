import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { env } from "../src/config/env";
import { isValidIanaTimeZone, nextCalendarDay, zonedMidnightUtc } from "../src/utils/timezone";
import { createTestUser, loginAs, resetAppDatabase } from "./helpers";

const app = createApp();
let adminToken = "";
let adminId = "";

/** Insere uma consulta mínima direto no banco com createdAt controlado. */
async function insertConsultationAt(createdAt: Date, protocolSuffix: string): Promise<void> {
  await prisma.viabilityConsultation.create({
    data: {
      protocol: `VIA-20260723-${protocolSuffix}`,
      userId: adminId,
      status: "OUTSIDE_COVERAGE",
      resultMessage: "teste",
      createdAt,
      street: "Rua TZ",
      number: "1",
      city: "Belo Horizonte",
      state: "MG",
      geocodingProvider: "dev",
      coverageMatches: [],
      networkAlternatives: [],
      networkReferenceStatus: "NOT_CHECKED",
    },
  });
}

beforeAll(async () => {
  await resetAppDatabase();
  const admin = await createTestUser({ role: "ADMIN", email: "tz-admin@teste.local" });
  adminId = admin.id;
  adminToken = (await loginAs(app, admin.email)).accessToken;
});

afterAll(async () => {
  await resetAppDatabase();
  await disconnectAppDatabase();
});

describe("utilitário de fuso", () => {
  it("meia-noite de Brasília vira 03:00 UTC (sem offset fixo no código)", () => {
    // Julho: Brasil sem horário de verão desde 2019 => UTC-3 o ano todo.
    expect(zonedMidnightUtc("2026-07-23", "America/Sao_Paulo").toISOString()).toBe(
      "2026-07-23T03:00:00.000Z"
    );
    // Fuso com DST ativo em julho (Berlim, UTC+2): valida que o offset vem do IANA.
    expect(zonedMidnightUtc("2026-07-23", "Europe/Berlin").toISOString()).toBe(
      "2026-07-22T22:00:00.000Z"
    );
    expect(nextCalendarDay("2026-07-31")).toBe("2026-08-01");
    expect(isValidIanaTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isValidIanaTimeZone("Fuso/Inexistente")).toBe(false);
  });
});

describe("filtros de data no fuso configurado (America/Sao_Paulo)", () => {
  beforeAll(async () => {
    await prisma.viabilityConsultation.deleteMany();
    // 23/07/2026 00:30 em Brasília = 03:30 UTC
    await insertConsultationAt(new Date("2026-07-23T03:30:00.000Z"), "AAAA2222");
    // 23/07/2026 23:30 em Brasília = 24/07 02:30 UTC (dia seguinte em UTC!)
    await insertConsultationAt(new Date("2026-07-24T02:30:00.000Z"), "BBBB3333");
    // 22/07/2026 23:59 em Brasília = 23/07 02:59 UTC (fora do dia 23 local)
    await insertConsultationAt(new Date("2026-07-23T02:59:00.000Z"), "CCCC4444");
    // 24/07/2026 00:10 em Brasília = 24/07 03:10 UTC (fora do dia 23 local)
    await insertConsultationAt(new Date("2026-07-24T03:10:00.000Z"), "DDDD5555");
  });

  it("dateFrom=dateTo=2026-07-23 pega exatamente o dia local, incluindo 00:30 e 23:30", async () => {
    const res = await request(app)
      .get("/api/consultations?dateFrom=2026-07-23&dateTo=2026-07-23&sortOrder=asc")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const protocols = res.body.consultations.map(
      (item: { protocol: string }) => item.protocol
    );
    expect(protocols).toEqual(["VIA-20260723-AAAA2222", "VIA-20260723-BBBB3333"]);
  });

  it("intervalo de mais de um dia inclui as bordas locais corretas", async () => {
    const res = await request(app)
      .get("/api/consultations?dateFrom=2026-07-22&dateTo=2026-07-23")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.total).toBe(3); // 22/07 23:59 local + os dois do dia 23
  });

  it("a exportação CSV usa exatamente a mesma regra de fuso", async () => {
    const res = await request(app)
      .get("/api/consultations/export?dateFrom=2026-07-23&dateTo=2026-07-23")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const lines = res.text.slice(1).split("\r\n");
    expect(lines).toHaveLength(3); // cabeçalho + 2 consultas do dia local
    expect(res.text).toContain("VIA-20260723-AAAA2222");
    expect(res.text).toContain("VIA-20260723-BBBB3333");
    expect(res.text).not.toContain("VIA-20260723-CCCC4444");
  });

  it("intervalo invertido segue respondendo CONSULTATION_INVALID_DATE_RANGE", async () => {
    const res = await request(app)
      .get("/api/consultations?dateFrom=2026-07-24&dateTo=2026-07-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONSULTATION_INVALID_DATE_RANGE");
  });

  it("fuso inválido é rejeitado pela validação (isValidIanaTimeZone) e pelo runtime", () => {
    expect(isValidIanaTimeZone("Brasilia/Errado")).toBe(false);
    expect(() => zonedMidnightUtc("2026-07-23", "Brasilia/Errado")).toThrow();
    // A env atual do processo é válida (senão o app nem subiria):
    expect(isValidIanaTimeZone(env.CONSULTATION_TIME_ZONE)).toBe(true);
  });
});
