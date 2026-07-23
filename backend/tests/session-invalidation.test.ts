import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { rotationTestHooks } from "../src/services/auth.service";
import { signAccessToken } from "../src/utils/jwt";
import { createTestUser, loginAs, resetAppDatabase, TEST_PASSWORD } from "./helpers";

const app = createApp();

function decodePayload(token: string): Record<string, unknown> {
  return jwt.decode(token) as Record<string, unknown>;
}

describe("familyId no access token", () => {
  beforeEach(resetAppDatabase);

  it("o access token contém familyId, igual ao do refresh emitido no login", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    const access = decodePayload(res.body.accessToken);
    expect(access.familyId).toBeTruthy();

    const refreshCookie = String(res.headers["set-cookie"])
      .split(";")[0]
      .split("=")
      .slice(1)
      .join("=");
    const refresh = decodePayload(decodeURIComponent(refreshCookie));
    expect(refresh.familyId).toBe(access.familyId);
  });

  it("o refresh preserva o familyId no novo access token", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const session = await loginAs(app, user.email);
    const original = decodePayload(session.accessToken).familyId;

    const res = await request(app).post("/api/auth/refresh").set("Cookie", session.refreshCookie);
    expect(res.status).toBe(200);
    expect(decodePayload(res.body.accessToken).familyId).toBe(original);
  });
});

describe("invalidação imediata de access tokens", () => {
  beforeEach(resetAppDatabase);

  it("logout invalida imediatamente o access token daquela sessão", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const session = await loginAs(app, user.email);

    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(before.status).toBe(200);

    await request(app).post("/api/auth/logout").set("Cookie", session.refreshCookie);

    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${session.accessToken}`);
    expect(after.status).toBe(401);
  });

  it("logout em um computador NÃO derruba a família de outro computador", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const desktop = await loginAs(app, user.email);
    const notebook = await loginAs(app, user.email);

    await request(app).post("/api/auth/logout").set("Cookie", desktop.refreshCookie);

    const desktopAccess = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${desktop.accessToken}`);
    expect(desktopAccess.status).toBe(401);

    const notebookAccess = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${notebook.accessToken}`);
    expect(notebookAccess.status).toBe(200);
    const notebookRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", notebook.refreshCookie);
    expect(notebookRefresh.status).toBe(200);
  });

  it("alteração da própria senha invalida access tokens de TODAS as famílias", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const first = await loginAs(app, user.email);
    const second = await loginAs(app, user.email);

    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: "NovaSenha456",
        confirmPassword: "NovaSenha456",
      });
    expect(change.status).toBe(204);

    for (const token of [first.accessToken, second.accessToken]) {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it("reset administrativo invalida access tokens de todas as famílias do alvo", async () => {
    const admin = await createTestUser({ role: "ADMIN", email: "admin@teste.local" });
    const adminSession = await loginAs(app, admin.email);
    const target = await createTestUser({ role: "VIEWER", email: "alvo@teste.local" });
    const targetA = await loginAs(app, target.email);
    const targetB = await loginAs(app, target.email);

    const reset = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set("Authorization", `Bearer ${adminSession.accessToken}`)
      .send({ newPassword: "NovaSenha456" });
    expect(reset.status).toBe(204);

    for (const token of [targetA.accessToken, targetB.accessToken]) {
      const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
    // O admin (outro usuário) permanece autenticado.
    const adminStill = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${adminSession.accessToken}`);
    expect(adminStill.status).toBe(200);
  });

  it("access token assinado para sessão inexistente ou revogada retorna 401", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    // Assinatura válida, mas família que nunca existiu:
    const ghost = signAccessToken({
      sub: user.id,
      familyId: randomUUID(),
      role: "VIEWER",
      name: "Fantasma",
      email: user.email,
    });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${ghost}`);
    expect(res.status).toBe(401);
  });
});

describe("rotação atômica do refresh", () => {
  beforeEach(resetAppDatabase);
  afterEach(() => {
    delete rotationTestHooks.beforeCreateSuccessor;
  });
  afterAll(async () => {
    await resetAppDatabase();
    await disconnectAppDatabase();
  });

  it("consumo do antigo e criação do sucessor acontecem juntos", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);
    const res = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(res.status).toBe(200);
    const tokens = await prisma.refreshToken.findMany({ orderBy: { createdAt: "asc" } });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].revokedReason).toBe("ROTATED");
    expect(tokens[1].revokedAt).toBeNull();
    expect(tokens[1].familyId).toBe(tokens[0].familyId);
  });

  it("falha na criação do sucessor faz rollback e o token antigo permanece utilizável", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);

    rotationTestHooks.beforeCreateSuccessor = () => {
      throw new Error("falha simulada ao criar o sucessor");
    };
    const failed = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(failed.status).toBeGreaterThanOrEqual(500);

    // Rollback: o token antigo NÃO foi revogado e a família não ficou órfã.
    const stored = await prisma.refreshToken.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0].revokedAt).toBeNull();

    delete rotationTestHooks.beforeCreateSuccessor;
    const retry = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(retry.status).toBe(200); // mesma sessão segue funcionando
  });

  it("corrida legítima segue respondendo REFRESH_RACE_LOST sem limpar o cookie", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);
    const winner = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(winner.status).toBe(200);

    const raceLost = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(raceLost.status).toBe(409);
    expect(raceLost.body.error.code).toBe("REFRESH_RACE_LOST");
    expect(raceLost.headers["set-cookie"]).toBeUndefined();
  });
});
