import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  login,
  logout,
  onSessionChange,
  resetSessionForTests,
  restoreSession,
} from "./auth";

const USER = { id: "u1", name: "Maria", email: "maria@teste.local", role: "OPERATOR" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sessão do frontend (access em memória + refresh via cookie)", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login envia credenciais com cookies e emite o usuário da sessão", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: "token-1", user: USER }));
    const seen: unknown[] = [];
    onSessionChange((user) => seen.push(user));

    const user = await login("maria@teste.local", "SenhaForte123");
    expect(user).toEqual(USER);
    expect(seen).toEqual([USER]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/auth/login");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toContain("maria@teste.local");
  });

  it("restaura a sessão existente em nova aba via /api/auth/refresh", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: "token-2", user: USER }));
    const user = await restoreSession();
    expect(user).toEqual(USER);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/auth/refresh");
  });

  it("logout chama o backend e encerra a sessão local", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const seen: unknown[] = [];
    onSessionChange((user) => seen.push(user));
    await logout();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/auth/logout");
    expect(seen).toEqual([null]);
  });

  it("em 401 tenta UM refresh, repete a requisição e não entra em loop", async () => {
    const fetchMock = vi.mocked(fetch);
    // 1) requisição original: 401; 2) refresh: ok; 3) repetição: 200.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "token-3", user: USER }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await apiFetch("/api/coverage/status");
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // A repetição já usa o novo access token.
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(retryHeaders.get("Authorization")).toBe("Bearer token-3");
  });

  it("quando o refresh também falha, encerra a sessão sem repetir indefinidamente", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }));
    const seen: unknown[] = [];
    onSessionChange((user) => seen.push(user));

    const response = await apiFetch("/api/coverage/status");
    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + refresh; sem loop
    expect(seen).toEqual([null]); // sessão encerrada → volta ao login
  });
});

describe("concorrência de renovação (single-flight)", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("múltiplos 401 simultâneos disparam UM único refresh", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) {
        return jsonResponse(200, { accessToken: "token-novo", user: USER });
      }
      const headers = new Headers();
      // Antes do refresh: 401; depois: 200.
      return jsonResponse(200, { ok: true });
    });
    // Três requisições que retornam 401 na primeira tentativa:
    let firstRound = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) {
        await new Promise((resolve) => setTimeout(resolve, 20)); // refresh "lento"
        return jsonResponse(200, { accessToken: "token-novo", user: USER });
      }
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth !== "Bearer token-novo") {
        firstRound += 1;
        return jsonResponse(401, { error: { code: "UNAUTHORIZED" } });
      }
      return jsonResponse(200, { ok: true });
    });

    const results = await Promise.all([
      apiFetch("/api/coverage/status"),
      apiFetch("/api/coverage/areas"),
      apiFetch("/api/users"),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/auth/refresh")
    );
    expect(refreshCalls).toHaveLength(1); // promessa compartilhada: um único refresh
    expect(firstRound).toBe(3);
  });

  it("usa navigator.locks quando disponível para coordenar entre abas", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(200, { accessToken: "t", user: USER }));
    const lockRequest = vi.fn(async (_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal("navigator", { locks: { request: lockRequest } });

    await restoreSession();
    expect(lockRequest).toHaveBeenCalledWith("viability-auth-refresh", expect.any(Function));
  });

  it("refresh bem-sucedido emite o usuário ATUALIZADO para a interface", async () => {
    const fetchMock = vi.mocked(fetch);
    const updated = { ...USER, name: "Maria Promovida", role: "TECHNICIAN" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHORIZED" } }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "token-2", user: updated }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const seen: unknown[] = [];
    onSessionChange((user) => seen.push(user));

    await apiFetch("/api/coverage/status");
    expect(seen).toEqual([updated]); // mudanças de nome/perfil chegam sem reload
  });
});

describe("fallback e corrida entre abas", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sem navigator.locks o refresh funciona pelo fallback direto", async () => {
    vi.stubGlobal("navigator", {}); // ambiente sem Web Locks API
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { accessToken: "t", user: USER }));
    const user = await restoreSession();
    expect(user).toEqual(USER);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/auth/refresh");
  });

  it("REFRESH_RACE_LOST dispara UMA nova tentativa com o cookie atualizado, sem loop", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(409, { error: { code: "REFRESH_RACE_LOST" } })
      )
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: "token-vencedor", user: USER }));
    const user = await restoreSession();
    expect(user).toEqual(USER);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/auth/refresh")
    );
    expect(refreshCalls).toHaveLength(2); // original + 1 retry controlado
  });

  it("REFRESH_RACE_LOST seguido de nova derrota NÃO tenta uma terceira vez", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(jsonResponse(409, { error: { code: "REFRESH_RACE_LOST" } }));
    const user = await restoreSession();
    expect(user).toBeNull();
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/auth/refresh")
    );
    expect(refreshCalls).toHaveLength(2); // nunca entra em loop
  });
});
