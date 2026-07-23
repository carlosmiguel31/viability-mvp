import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma, disconnectAppDatabase } from "../src/db/prisma";
import { createTestUser, loginAs, resetAppDatabase, TEST_PASSWORD } from "./helpers";

const app = createApp();

async function adminToken(): Promise<{ token: string; adminId: string }> {
  const admin = await createTestUser({ role: "ADMIN", email: "admin@teste.local" });
  const { accessToken } = await loginAs(app, admin.email);
  return { token: accessToken, adminId: admin.id };
}

describe("rotas de usuários (exclusivas de ADMIN)", () => {
  beforeEach(resetAppDatabase);
  afterAll(async () => {
    await resetAppDatabase();
    await disconnectAppDatabase();
  });

  it("ADMIN cria usuário (auditado) e passwordHash nunca aparece", async () => {
    const { token } = await adminToken();
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Nova Operadora",
        email: "Operadora@Teste.Local",
        password: "SenhaForte123",
        role: "OPERATOR",
      });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("operadora@teste.local"); // normalizado
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
    const audit = await prisma.auditLog.findMany({ where: { action: "USER_CREATED" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("SenhaForte123");
  });

  it("OPERATOR não cria usuário (403) e sem token retorna 401", async () => {
    const operator = await createTestUser({ role: "OPERATOR" });
    const { accessToken } = await loginAs(app, operator.email);
    const forbidden = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: "X", email: "x@teste.local", password: "SenhaForte123", role: "VIEWER" });
    expect(forbidden.status).toBe(403);
    const anonymous = await request(app).get("/api/users");
    expect(anonymous.status).toBe(401);
  });

  it("e-mail duplicado é rejeitado ignorando maiúsculas/minúsculas", async () => {
    const { token } = await adminToken();
    await createTestUser({ role: "VIEWER", email: "repetido@teste.local" });
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ana Y", email: "REPETIDO@teste.local", password: "SenhaForte123", role: "VIEWER" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("senha fraca é rejeitada na criação e no reset", async () => {
    const { token } = await adminToken();
    const weak = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ana Z", email: "z@teste.local", password: "fraca", role: "VIEWER" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("WEAK_PASSWORD");
  });

  it("ADMIN lista usuários com busca, filtros e paginação", async () => {
    const { token } = await adminToken();
    await createTestUser({ role: "OPERATOR", email: "maria@teste.local", name: "Maria Silva" });
    await createTestUser({ role: "VIEWER", email: "joao@teste.local", name: "João Souza", active: false });

    const byName = await request(app)
      .get("/api/users?search=maria")
      .set("Authorization", `Bearer ${token}`);
    expect(byName.status).toBe(200);
    expect(byName.body.total).toBe(1);
    expect(byName.body.users[0].email).toBe("maria@teste.local");

    const byRole = await request(app)
      .get("/api/users?role=VIEWER&active=false")
      .set("Authorization", `Bearer ${token}`);
    expect(byRole.body.users).toHaveLength(1);
    expect(byRole.body.users[0].active).toBe(false);

    const paged = await request(app)
      .get("/api/users?page=1&pageSize=2")
      .set("Authorization", `Bearer ${token}`);
    expect(paged.body.users.length).toBeLessThanOrEqual(2);
    expect(paged.body.total).toBe(3);
  });

  it("atualização de perfil é auditada como USER_ROLE_CHANGED", async () => {
    const { token } = await adminToken();
    const target = await createTestUser({ role: "VIEWER", email: "muda@teste.local" });
    const res = await request(app)
      .patch(`/api/users/${target.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "TECHNICIAN" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("TECHNICIAN");
    const audit = await prisma.auditLog.findFirst({ where: { action: "USER_ROLE_CHANGED" } });
    expect(audit?.entityId).toBe(target.id);
  });

  it("ativação e inativação funcionam, com sessões encerradas ao inativar", async () => {
    const { token } = await adminToken();
    const target = await createTestUser({ role: "OPERATOR", email: "alvo@teste.local" });
    const { refreshCookie } = await loginAs(app, target.email);

    const off = await request(app)
      .patch(`/api/users/${target.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.user.active).toBe(false);

    // Sessão do usuário inativado não renova mais.
    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(refresh.status).toBe(401);

    const on = await request(app)
      .patch(`/api/users/${target.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: true });
    expect(on.status).toBe(200);
    const actions = (await prisma.auditLog.findMany()).map((l) => l.action);
    expect(actions).toContain("USER_DEACTIVATED");
    expect(actions).toContain("USER_ACTIVATED");
  });

  it("proteção do último ADMIN: não pode ser rebaixado nem inativado", async () => {
    const { token, adminId } = await adminToken();
    const demote = await request(app)
      .patch(`/api/users/${adminId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "OPERATOR" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("LAST_ADMIN");

    const deactivate = await request(app)
      .patch(`/api/users/${adminId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false, confirmSelfDeactivation: true });
    expect(deactivate.status).toBe(409);
  });

  it("auto-inativação exige confirmação explícita (com outro ADMIN ativo)", async () => {
    const { token, adminId } = await adminToken();
    await createTestUser({ role: "ADMIN", email: "admin2@teste.local" });
    const withoutConfirmation = await request(app)
      .patch(`/api/users/${adminId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false });
    expect(withoutConfirmation.status).toBe(400);
    expect(withoutConfirmation.body.error.code).toBe("SELF_DEACTIVATION_CONFIRMATION_REQUIRED");

    const confirmed = await request(app)
      .patch(`/api/users/${adminId}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ active: false, confirmSelfDeactivation: true });
    expect(confirmed.status).toBe(200);
  });

  it("reset de senha: nova senha passa a valer e sessões antigas caem", async () => {
    const { token } = await adminToken();
    const target = await createTestUser({ role: "VIEWER", email: "senha@teste.local" });
    const { refreshCookie } = await loginAs(app, target.email);

    const reset = await request(app)
      .post(`/api/users/${target.id}/reset-password`)
      .set("Authorization", `Bearer ${token}`)
      .send({ newPassword: "NovaSenha456" });
    expect(reset.status).toBe(204);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: target.email, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: target.email, password: "NovaSenha456" });
    expect(newLogin.status).toBe(200);
    const refresh = await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie);
    expect(refresh.status).toBe(401);
    const audit = await prisma.auditLog.findFirst({ where: { action: "USER_PASSWORD_RESET" } });
    expect(audit?.entityId).toBe(target.id);
    expect(JSON.stringify(audit)).not.toContain("NovaSenha456");
  });

  it("GET /api/audit-logs: apenas ADMIN, com paginação e filtros", async () => {
    const { token, adminId } = await adminToken();
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ana A", email: "a@teste.local", password: "SenhaForte123", role: "VIEWER" });

    const viewer = await createTestUser({ role: "VIEWER", email: "v@teste.local" });
    const viewerAuth = await loginAs(app, viewer.email);
    const forbidden = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(forbidden.status).toBe(403);

    const list = await request(app)
      .get(`/api/audit-logs?action=USER_CREATED&userId=${adminId}&page=1&pageSize=10`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.logs[0].action).toBe("USER_CREATED");

    const byDate = await request(app)
      .get(`/api/audit-logs?from=2000-01-01&to=2000-01-02`)
      .set("Authorization", `Bearer ${token}`);
    expect(byDate.body.total).toBe(0);
  });
});
