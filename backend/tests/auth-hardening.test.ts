import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { cleanupRefreshTokens } from "../src/scripts/auth-cleanup";
import {
  assertTestDatabase,
  createTestUser,
  loginAs,
  resetAppDatabase,
  TEST_DATABASE_GUARD_MESSAGE,
  TEST_PASSWORD,
} from "./helpers";

const app = createApp();

describe("concorrência de refresh (consumo atômico)", () => {
  beforeEach(resetAppDatabase);

  it("duas renovações simultâneas: exatamente uma vence e a sessão vencedora segue válida", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const { refreshCookie } = await loginAs(app, user.email);

    const [first, second] = await Promise.all([
      request(app).post("/api/auth/refresh").set("Cookie", refreshCookie),
      request(app).post("/api/auth/refresh").set("Cookie", refreshCookie),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]); // uma rotaciona, a outra perde a corrida

    const winner = first.status === 200 ? first : second;
    const loser = first.status === 200 ? second : first;
    expect(loser.body.error.code).toBe("REFRESH_RACE_LOST");

    // A perdedora NÃO envia Set-Cookie: um cookie de limpeza apagaria a
    // sessão nova que a vencedora acabou de gravar no navegador.
    expect(loser.headers["set-cookie"]).toBeUndefined();

    // A corrida legítima NÃO revoga a família: o cookie rotacionado continua válido.
    const rotatedCookie = String(winner.headers["set-cookie"]).split(";")[0];
    const next = await request(app).post("/api/auth/refresh").set("Cookie", rotatedCookie);
    expect(next.status).toBe(200);
  });

  it("reuso dentro da janela de graça responde 409 REFRESH_RACE_LOST sem limpar cookie; sequência não entra em loop", async () => {
    const user = await createTestUser({ role: "VIEWER", email: "graca@teste.local" });
    const { refreshCookie } = await loginAs(app, user.email);
    const winner = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(winner.status).toBe(200);

    // Mesmo cookie antigo logo em seguida (dentro da graça): corrida, não roubo.
    const raceLost = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(raceLost.status).toBe(409);
    expect(raceLost.body.error.code).toBe("REFRESH_RACE_LOST");
    expect(raceLost.headers["set-cookie"]).toBeUndefined();

    // A sessão vencedora permanece renovável (família intacta).
    const rotatedCookie = String(winner.headers["set-cookie"]).split(";")[0];
    const next = await request(app).post("/api/auth/refresh").set("Cookie", rotatedCookie);
    expect(next.status).toBe(200);
  });

  it("token inválido e expirado seguem 401 COM limpeza de cookie", async () => {
    const invalid = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", "viability.refresh=token-invalido");
    expect(invalid.status).toBe(401);
    expect(String(invalid.headers["set-cookie"])).toContain("viability.refresh=;");

    const user = await createTestUser({ role: "VIEWER", email: "expira@teste.local" });
    const { refreshCookie } = await loginAs(app, user.email);
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(expired.status).toBe(401);
    expect(String(expired.headers["set-cookie"])).toContain("viability.refresh=;");
  });

  it("token com conteúdo divergente do registro é rejeitado", async () => {
    const userA = await createTestUser({ role: "OPERATOR", email: "a@teste.local" });
    const userB = await createTestUser({ role: "OPERATOR", email: "b@teste.local" });
    const sessionA = await loginAs(app, userA.email);
    await loginAs(app, userB.email);

    // Troca o vínculo do registro no banco: o payload assinado deixa de bater.
    const tokenValue = sessionA.refreshCookie.split("=").slice(1).join("=");
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(tokenValue).digest("hex");
    const userBId = (await prisma.user.findUnique({ where: { email: "b@teste.local" } }))!.id;
    await prisma.refreshToken.update({ where: { tokenHash: hash }, data: { userId: userBId } });

    const res = await request(app).post("/api/auth/refresh").set("Cookie", sessionA.refreshCookie);
    expect(res.status).toBe(401);
  });

  it("cookie de refresh recebe Max-Age compatível com JWT_REFRESH_EXPIRES_IN", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    const cookie = String(res.headers["set-cookie"]);
    const match = /Max-Age=(\d+)/.exec(cookie);
    expect(match).not.toBeNull();
    const days = Number(match![1]) / 86_400;
    expect(days).toBeCloseTo(7, 1); // JWT_REFRESH_EXPIRES_IN=7d
  });
});

describe("POST /api/auth/change-password", () => {
  beforeEach(resetAppDatabase);

  async function loggedUser() {
    const user = await createTestUser({ role: "OPERATOR" });
    const session = await loginAs(app, user.email);
    return { user, ...session };
  }

  it("senha atual incorreta retorna 400 sem alterar nada", async () => {
    const { user, accessToken } = await loggedUser();
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        currentPassword: "Errada123",
        newPassword: "NovaSenha456",
        confirmPassword: "NovaSenha456",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200); // senha antiga intacta
  });

  it("nova senha fraca e confirmação diferente são rejeitadas", async () => {
    const { accessToken } = await loggedUser();
    const weak = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: "fraca", confirmPassword: "fraca" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("WEAK_PASSWORD");

    const mismatch = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: "NovaSenha456",
        confirmPassword: "Diferente789",
      });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("nova senha igual à atual é rejeitada", async () => {
    const { accessToken } = await loggedUser();
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: TEST_PASSWORD,
        confirmPassword: TEST_PASSWORD,
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PASSWORD_UNCHANGED");
  });

  it("sucesso: revoga todas as sessões, limpa o cookie, exige novo login e audita sem senhas", async () => {
    const { user, accessToken, refreshCookie } = await loggedUser();
    const otherSession = await loginAs(app, user.email);

    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: "NovaSenha456",
        confirmPassword: "NovaSenha456",
      });
    expect(res.status).toBe(204);
    expect(String(res.headers["set-cookie"])).toContain("viability.refresh=;"); // cookie limpo

    // TODAS as sessões (inclusive de outros dispositivos) foram revogadas.
    for (const cookie of [refreshCookie, otherSession.refreshCookie]) {
      const refresh = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
      expect(refresh.status).toBe(401);
    }

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "NovaSenha456" });
    expect(newLogin.status).toBe(200);

    const audit = await prisma.auditLog.findMany({ where: { action: "USER_PASSWORD_CHANGED" } });
    expect(audit).toHaveLength(1);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain("NovaSenha456");
  });
});

describe("inativação bloqueia o access token imediatamente", () => {
  beforeEach(resetAppDatabase);

  it("access token emitido antes da inativação passa a receber 401", async () => {
    const admin = await createTestUser({ role: "ADMIN", email: "admin@teste.local" });
    const adminSession = await loginAs(app, admin.email);
    const target = await createTestUser({ role: "OPERATOR", email: "alvo@teste.local" });
    const targetSession = await loginAs(app, target.email);

    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${targetSession.accessToken}`);
    expect(before.status).toBe(200);

    const off = await request(app)
      .patch(`/api/users/${target.id}/status`)
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({ active: false });
    expect(off.status).toBe(200);

    // Mesmo access token, ainda dentro da validade: 401 imediato.
    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${targetSession.accessToken}`);
    expect(after.status).toBe(401);
  });
});

describe("proteção do banco de teste", () => {
  it("aceita apenas NODE_ENV=test com banco identificado como de teste", () => {
    expect(() =>
      assertTestDatabase("test", "postgresql://u:p@host:5432/viability_app_test")
    ).not.toThrow();
    expect(() =>
      assertTestDatabase("production", "postgresql://u:p@host:5432/viability_app_test")
    ).toThrow(TEST_DATABASE_GUARD_MESSAGE);
    expect(() =>
      assertTestDatabase("test", "postgresql://u:p@host:5432/viability_app")
    ).toThrow(TEST_DATABASE_GUARD_MESSAGE);
    expect(() => assertTestDatabase("test", "")).toThrow(TEST_DATABASE_GUARD_MESSAGE);
    expect(() =>
      assertTestDatabase("test", "postgresql://u:p@host:5432/producao?sslmode=require")
    ).toThrow(TEST_DATABASE_GUARD_MESSAGE);
  });
});

describe("limpeza de refresh tokens (auth:cleanup)", () => {
  beforeEach(resetAppDatabase);
  afterAll(async () => {
    await resetAppDatabase();
    await disconnectAppDatabase();
  });

  it("remove expirados/revogados antigos e preserva sessões recentes", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    await loginAs(app, user.email); // sessão ativa recente
    const old = new Date(Date.now() - 60 * 86_400_000);
    await prisma.refreshToken.createMany({
      data: [
        {
          id: crypto.randomUUID(),
          userId: user.id,
          tokenHash: "hash-expirado-antigo",
          familyId: crypto.randomUUID(),
          expiresAt: old,
        },
        {
          id: crypto.randomUUID(),
          userId: user.id,
          tokenHash: "hash-revogado-antigo",
          familyId: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: old,
        },
      ],
    });

    const removed = await cleanupRefreshTokens(30);
    expect(removed).toBe(2);
    expect(await prisma.refreshToken.count()).toBe(1); // só a sessão recente
  });

  it("rejeita retenção inválida", async () => {
    await expect(cleanupRefreshTokens(Number.NaN)).rejects.toThrow(/dias/);
  });
});
