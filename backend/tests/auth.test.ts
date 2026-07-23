import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { seedFirstAdmin } from "../prisma/seed";
import { env } from "../src/config/env";
import { createTestUser, loginAs, resetAppDatabase, TEST_PASSWORD } from "./helpers";

const app = createApp();

describe("seed do primeiro administrador", () => {
  beforeEach(resetAppDatabase);
  afterAll(resetAppDatabase);

  it("cria o primeiro ADMIN quando não existe", async () => {
    env.SEED_ADMIN_NAME = "Admin Inicial";
    env.SEED_ADMIN_EMAIL = "Admin@Empresa.com";
    env.SEED_ADMIN_PASSWORD = "SenhaForte123";
    expect(await seedFirstAdmin()).toBe("created");
    const user = await prisma.user.findUnique({ where: { email: "admin@empresa.com" } });
    expect(user?.role).toBe("ADMIN");
    expect(user?.active).toBe(true);
  });

  it("não duplica nem sobrescreve o administrador existente", async () => {
    env.SEED_ADMIN_NAME = "Admin Inicial";
    env.SEED_ADMIN_EMAIL = "admin@empresa.com";
    env.SEED_ADMIN_PASSWORD = "SenhaForte123";
    await seedFirstAdmin();
    const before = await prisma.user.findUnique({ where: { email: "admin@empresa.com" } });
    env.SEED_ADMIN_PASSWORD = "OutraSenha456";
    expect(await seedFirstAdmin()).toBe("exists");
    const after = await prisma.user.findUnique({ where: { email: "admin@empresa.com" } });
    expect(after?.passwordHash).toBe(before?.passwordHash); // senha intocada
    expect(await prisma.user.count()).toBe(1);
  });

  it("falha quando a senha inicial não respeita a política", async () => {
    env.SEED_ADMIN_NAME = "Admin";
    env.SEED_ADMIN_EMAIL = "admin@empresa.com";
    env.SEED_ADMIN_PASSWORD = "fraca";
    await expect(seedFirstAdmin()).rejects.toThrow(/mínimo 8 caracteres/);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(resetAppDatabase);

  it("login válido devolve access token, usuário e cookie HttpOnly de refresh", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: user.email, role: "OPERATOR" });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("viability.refresh=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/auth");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("login inválido usa mensagem genérica (senha errada e e-mail inexistente)", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "Errada123" });
    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nao-existe@teste.local", password: TEST_PASSWORD });
    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("E-mail ou senha inválidos.");
    }
  });

  it("usuário inativo não entra (mesma mensagem genérica)", async () => {
    const user = await createTestUser({ role: "OPERATOR", active: false });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("E-mail ou senha inválidos.");
  });

  it("registra auditoria de LOGIN_SUCCESS e LOGIN_FAILED sem dados sensíveis", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    await request(app).post("/api/auth/login").send({ email: user.email, password: user.password });
    await request(app).post("/api/auth/login").send({ email: user.email, password: "Errada123" });
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["LOGIN_SUCCESS", "LOGIN_FAILED"]);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(TEST_PASSWORD);
    expect(serialized).not.toContain("Errada123");
    expect(serialized.toLowerCase()).not.toContain("passwordhash");
  });
});

describe("refresh, logout e /auth/me", () => {
  beforeEach(resetAppDatabase);
  afterAll(async () => {
    await resetAppDatabase();
    await disconnectAppDatabase();
  });

  it("refresh válido rotaciona o token e devolve novo access", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);
    const res = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const newCookie = String(res.headers["set-cookie"]).split(";")[0];
    expect(newCookie).toContain("viability.refresh=");
    expect(newCookie).not.toBe(refreshCookie); // rotacionado: token diferente
  });

  it("rotação: o refresh token usado é invalidado e o reuso revoga a família", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);

    const first = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(first.status).toBe(200);
    const rotatedCookie = String(first.headers["set-cookie"]).split(";")[0];

    // Fora da janela de graça de corrida, o reuso é tratado como roubo:
    // envelhece a revogação para simular um reuso tardio real.
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null }, revokedReason: "ROTATED" },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const reuse = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(reuse.status).toBe(401);

    const afterReuse = await request(app).post("/api/auth/refresh").set("Cookie", rotatedCookie);
    expect(afterReuse.status).toBe(401); // detecção de reuso invalidou a cadeia
  });

  it("refresh expirado retorna 401", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);
    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(res.status).toBe(401);
  });

  it("logout invalida a sessão atual", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const { refreshCookie } = await loginAs(app, user.email);
    const logout = await request(app).post("/api/auth/logout").set("Cookie", refreshCookie);
    expect(logout.status).toBe(204);
    const res = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(res.status).toBe(401);
    const logs = await prisma.auditLog.findMany({ where: { action: "LOGOUT" } });
    expect(logs).toHaveLength(1);
  });

  it("um novo login em outro dispositivo NÃO encerra a sessão anterior", async () => {
    const user = await createTestUser({ role: "VIEWER" });
    const first = await loginAs(app, user.email);
    const second = await loginAs(app, user.email);
    const res1 = await request(app).post("/api/auth/refresh").set("Cookie", first.refreshCookie);
    const res2 = await request(app).post("/api/auth/refresh").set("Cookie", second.refreshCookie);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("usuário inativado não renova token", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const { refreshCookie } = await loginAs(app, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const res = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(res.status).toBe(401);
  });

  it("alteração de perfil vale no próximo token emitido", async () => {
    const user = await createTestUser({ role: "OPERATOR" });
    const { refreshCookie } = await loginAs(app, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { role: "TECHNICIAN" } });
    const res = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("TECHNICIAN");
  });

  it("GET /api/auth/me autenticado devolve o usuário; sem token retorna 401", async () => {
    const user = await createTestUser({ role: "TECHNICIAN" });
    const { accessToken } = await loginAs(app, user.email);
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: user.email, role: "TECHNICIAN" });
    const anonymous = await request(app).get("/api/auth/me");
    expect(anonymous.status).toBe(401);
  });
});
