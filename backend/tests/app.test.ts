import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, isOriginAllowed } from "../src/app";
import { env } from "../src/config/env";

describe("rotas e seguranca basica", () => {
  it("rota inexistente retorna JSON com ROUTE_NOT_FOUND", async () => {
    const app = createApp();
    const res = await request(app).get("/api/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rota antiga /api/network/* nao existe mais", async () => {
    const app = createApp();
    const res = await request(app).get("/api/network/status");
    expect(res.status).toBe(404);
  });

  it("GET /api/coverage/areas exige autenticacao JWT", async () => {
    const app = createApp();
    const res = await request(app).get("/api/coverage/areas");
    expect(res.status).toBe(401);
  });

  it("POST /api/viabilities/check exige autenticacao JWT", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/viabilities/check")
      .send({ address: { street: "Rua X", number: "1", city: "BH", state: "MG" } });
    expect(res.status).toBe(401);
  });

  it("GET /api/addresses/postal-code/:cep exige autenticacao JWT", async () => {
    const app = createApp();
    const res = await request(app).get("/api/addresses/postal-code/30640000");
    expect(res.status).toBe(401);
  });

  it("POST /api/coverage/reload exige ADMIN (401 sem token)", async () => {
    const app = createApp();
    const res = await request(app).post("/api/coverage/reload");
    expect(res.status).toBe(401);
  });

  it("CORS: origem nao autorizada em producao recebe 403 e nao chega ao controller", async () => {
    const previousEnv = env.NODE_ENV;
    (env as { NODE_ENV: string }).NODE_ENV = "production";
    try {
      const app = createApp();
      const res = await request(app)
        .get("/api/coverage/status")
        .set("Origin", "https://malicioso.com");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CORS_ORIGIN_DENIED");
      expect(res.body).not.toHaveProperty("loaded"); // controller nao respondeu
    } finally {
      (env as { NODE_ENV: string }).NODE_ENV = previousEnv;
    }
  });

  it("POST /api/coverage/reload e protegido", async () => {
    const app = createApp();
    const res = await request(app).post("/api/coverage/reload");
    expect([401, 503]).toContain(res.status);
  });

  it("GET /api/coverage/status agora exige autenticacao", async () => {
    const app = createApp();
    const res = await request(app).get("/api/coverage/status");
    expect(res.status).toBe(401);
  });

  it("aplica rate limit no endpoint de viabilidade", async () => {
    const app = createApp({ viabilityMaxPerMinute: 3, reloadMaxPerFifteenMinutes: 5 });
    for (let i = 0; i < 3; i++) {
      await request(app).post("/api/viabilities/check").send({});
    }
    const res = await request(app).post("/api/viabilities/check").send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("aplica rate limit mais restritivo na recarga", async () => {
    const app = createApp({ viabilityMaxPerMinute: 60, reloadMaxPerFifteenMinutes: 2 });
    for (let i = 0; i < 2; i++) {
      await request(app).post("/api/coverage/reload");
    }
    const res = await request(app).post("/api/coverage/reload");
    expect(res.status).toBe(429);
  });

  it("inclui headers de seguranca do helmet", async () => {
    const app = createApp();
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://app.exemplo.com"];

  it("aceita requisicoes sem Origin", () => {
    expect(isOriginAllowed(undefined, allowed, "production")).toBe(true);
  });

  it("aceita origem local em desenvolvimento", () => {
    expect(isOriginAllowed("http://localhost:5173", allowed, "development")).toBe(true);
  });

  it("rejeita origem nao autorizada em producao", () => {
    expect(isOriginAllowed("http://localhost:5173", allowed, "production")).toBe(false);
    expect(isOriginAllowed("https://malicioso.com", allowed, "production")).toBe(false);
  });

  it("aceita origem listada em producao", () => {
    expect(isOriginAllowed("https://app.exemplo.com", allowed, "production")).toBe(true);
  });
});
