import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import UsersPage from "./components/UsersPage";
import { resetSessionForTests } from "./auth";

// O mapa (Leaflet) não é o alvo destes testes.
vi.mock("./components/MapView", () => ({
  default: () => <div data-testid="map" />,
}));

const ADMIN = { id: "u1", name: "Alice Admin", email: "alice@teste.local", role: "ADMIN" };
const OPERATOR = { id: "u2", name: "Otto Operador", email: "otto@teste.local", role: "OPERATOR" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | null;

/** fetch fake por rota; refresh falho por padrão (sem sessão prévia). */
type FetchMock = ReturnType<
  typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>
>;

function stubFetch(handlers: FetchHandler[]): FetchMock {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const response = handler(url, init);
      if (response) return response;
    }
    if (url.includes("/api/auth/refresh")) {
      return jsonResponse(401, { error: { code: "UNAUTHORIZED" } });
    }
    if (url.includes("/api/coverage/status")) {
      return jsonResponse(200, { loaded: false });
    }
    if (url.includes("/api/coverage/areas")) {
      return jsonResponse(200, { areas: [] });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => resetSessionForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("tela de login", () => {
  it("exibe e-mail, senha com mostrar/ocultar e botão Entrar", async () => {
    stubFetch([]);
    render(<App />);
    await screen.findByLabelText("E-mail");
    const password = screen.getByLabelText("Senha");
    expect(password).toHaveProperty("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(password).toHaveProperty("type", "text");
    expect(screen.getByRole("button", { name: "Entrar" })).toBeTruthy();
  });

  it("credenciais inválidas mostram a mensagem genérica", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/auth/login")
          ? jsonResponse(401, {
              error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." },
            })
          : null,
    ]);
    render(<App />);
    await userEvent.type(await screen.findByLabelText("E-mail"), "x@teste.local");
    await userEvent.type(screen.getByLabelText("Senha"), "Errada123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "E-mail ou senha inválidos."
    );
  });

  it("sessão existente é restaurada sem novo login (nova aba)", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: OPERATOR })
          : null,
    ]);
    render(<App />);
    expect(await screen.findByText("Otto Operador")).toBeTruthy();
  });

  it("logout encerra a sessão e volta ao login", async () => {
    const fetchMock = stubFetch([
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: OPERATOR })
          : null,
      (url) => (url.includes("/api/auth/logout") ? new Response(null, { status: 204 }) : null),
    ]);
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Sair" }));
    await screen.findByLabelText("E-mail"); // voltou ao login
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/logout"))
    ).toBe(true);
  });
});

describe("menu por perfil", () => {
  it("ADMIN vê Nova consulta, Usuários e Auditoria", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: ADMIN })
          : null,
    ]);
    render(<App />);
    await screen.findByText("Alice Admin");
    expect(screen.getByRole("button", { name: "Nova consulta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Coberturas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Usuários" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Auditoria" })).toBeTruthy();
  });

  it("perfis comuns não veem os menus de administração", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: OPERATOR })
          : null,
    ]);
    render(<App />);
    await screen.findByText("Otto Operador");
    expect(screen.getByRole("button", { name: "Nova consulta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Coberturas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usuários" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Auditoria" })).toBeNull();
  });
});

describe("tela de usuários (ADMIN)", () => {
  const LISTED = {
    users: [
      {
        id: "u9",
        name: "Pedro Viewer",
        email: "pedro@teste.local",
        role: "VIEWER",
        active: true,
        lastLoginAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  };

  it("lista usuários com perfil traduzido e status", async () => {
    stubFetch([
      (url, init) =>
        url.includes("/api/users") && (!init?.method || init.method === "GET")
          ? jsonResponse(200, LISTED)
          : null,
    ]);
    render(<UsersPage currentUser={ADMIN as never} />);
    expect(await screen.findByText("Pedro Viewer")).toBeTruthy();
    const row = screen.getByText("Pedro Viewer").closest("tr")!;
    expect(row.textContent).toContain("Visualizador");
    expect(row.textContent).toContain("Ativo");
  });

  it("cria usuário pelo formulário", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/users") && init?.method === "POST"
          ? jsonResponse(201, { user: LISTED.users[0] })
          : null,
      (url) => (url.includes("/api/users") ? jsonResponse(200, LISTED) : null),
    ]);
    render(<UsersPage currentUser={ADMIN as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo usuário" }));
    await userEvent.type(screen.getByLabelText(/Nome/), "Novo Usuário");
    await userEvent.type(screen.getByLabelText(/E-mail/), "novo@teste.local");
    await userEvent.type(screen.getByLabelText(/Senha inicial/), "SenhaForte123");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      const createCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith("/api/users") && init?.method === "POST"
      );
      expect(createCall).toBeTruthy();
      expect(String(createCall?.[1]?.body)).toContain("novo@teste.local");
    });
  });

  it("inativação pede confirmação e chama o endpoint de status", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/status") && init?.method === "PATCH"
          ? jsonResponse(200, { user: { ...LISTED.users[0], active: false } })
          : null,
      (url) => (url.includes("/api/users") ? jsonResponse(200, LISTED) : null),
    ]);
    render(<UsersPage currentUser={ADMIN as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "Inativar" }));
    await waitFor(() => {
      const statusCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/users/u9/status")
      );
      expect(statusCall?.[1]?.method).toBe("PATCH");
      expect(String(statusCall?.[1]?.body)).toContain('"active":false');
    });
    expect(vi.mocked(window.confirm)).toHaveBeenCalled();
  });
});

describe("sessão atualizada pelo refresh automático", () => {
  it("alteração de perfil retornada pelo refresh atualiza o cabeçalho sem reload", async () => {
    let coverageCalls = 0;
    stubFetch([
      (url) => {
        // 1º refresh (restauração): OPERATOR; 2º refresh: perfil novo.
        if (url.includes("/api/auth/refresh")) return null; // tratado abaixo
        return null;
      },
      (url) => {
        if (url.includes("/api/coverage/status")) {
          coverageCalls += 1;
          // A primeira consulta de status falha com 401 para forçar o refresh.
          return coverageCalls === 1
            ? jsonResponse(401, { error: { code: "UNAUTHORIZED" } })
            : jsonResponse(200, { loaded: false });
        }
        return null;
      },
    ]);
    // refresh: primeira chamada devolve OPERATOR, a seguinte devolve promovido
    const fetchMock = vi.mocked(fetch);
    const base = fetchMock.getMockImplementation()!;
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) {
        refreshCalls += 1;
        const user =
          refreshCalls === 1
            ? OPERATOR
            : { ...OPERATOR, name: "Otto Promovido", role: "TECHNICIAN" };
        return jsonResponse(200, { accessToken: `token-${refreshCalls}`, user });
      }
      return base(input, init);
    });

    render(<App />);
    // Restauração inicial mostra o nome atual…
    await screen.findByText("Otto Operador");
    // …o 401 do status dispara o refresh, que devolve o usuário atualizado.
    expect(await screen.findByText("Otto Promovido")).toBeTruthy();
    expect(screen.getByText("Técnico")).toBeTruthy();
  });
});

describe("auto-inativação do administrador", () => {
  it("confirma com aviso específico, envia confirmSelfDeactivation e faz logout", async () => {
    const confirmMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirmMock);
    const SELF = {
      id: "u1",
      name: "Alice Admin",
      email: "alice@teste.local",
      role: "ADMIN",
      active: true,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/users/u1/status") && init?.method === "PATCH"
          ? jsonResponse(200, { user: { ...SELF, active: false } })
          : null,
      (url) => (url.includes("/api/auth/logout") ? new Response(null, { status: 204 }) : null),
      (url, init) =>
        url.includes("/api/users") && (!init?.method || init.method === "GET")
          ? jsonResponse(200, { users: [SELF], total: 1, page: 1, pageSize: 20 })
          : null,
    ]);
    render(<UsersPage currentUser={ADMIN as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "Inativar" }));

    expect(String(confirmMock.mock.calls[0][0])).toContain("PRÓPRIA conta");
    await waitFor(() => {
      const statusCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/users/u1/status")
      );
      expect(String(statusCall?.[1]?.body)).toContain('"confirmSelfDeactivation":true');
      const logoutCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/auth/logout")
      );
      expect(logoutCall).toBeTruthy();
    });
  });
});

describe("alterar minha senha", () => {
  it("o menu tem a opção e o formulário envia os três campos sem window.prompt", async () => {
    const fetchMock = stubFetch([
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: OPERATOR })
          : null,
      (url, init) =>
        url.includes("/api/auth/change-password") && init?.method === "POST"
          ? new Response(null, { status: 204 })
          : null,
    ]);
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Alterar minha senha" }));
    await userEvent.type(screen.getByLabelText("Senha atual"), "SenhaAntiga1");
    await userEvent.type(screen.getByLabelText("Nova senha"), "SenhaNova22");
    await userEvent.type(screen.getByLabelText("Confirmar nova senha"), "SenhaNova22");
    await userEvent.click(screen.getByRole("button", { name: "Alterar senha" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/auth/change-password")
      );
      expect(call).toBeTruthy();
      const body = String(call?.[1]?.body);
      expect(body).toContain("SenhaAntiga1");
      expect(body).toContain("SenhaNova22");
    });
    // Sessão encerrada localmente: volta ao login.
    await screen.findByLabelText("E-mail");
  });
});

describe("modal de redefinição administrativa de senha", () => {
  const TARGET = {
    id: "u9",
    name: "Pedro Viewer",
    email: "pedro@teste.local",
    role: "VIEWER",
    active: true,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const PAGE = { users: [TARGET], total: 1, page: 1, pageSize: 20 };

  it("abre um formulário próprio (sem window.prompt) e envia a nova senha", async () => {
    const promptSpy = vi.fn();
    vi.stubGlobal("prompt", promptSpy);
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/reset-password") && init?.method === "POST"
          ? new Response(null, { status: 204 })
          : null,
      (url, init) =>
        url.includes("/api/users") && (!init?.method || init.method === "GET")
          ? jsonResponse(200, PAGE)
          : null,
    ]);
    render(<UsersPage currentUser={ADMIN as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "Redefinir senha" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Pedro Viewer");
    expect(dialog.textContent).toContain("Mínimo de 8 caracteres");

    await userEvent.type(screen.getByLabelText("Nova senha"), "SenhaNova22");
    await userEvent.type(screen.getByLabelText("Confirmar nova senha"), "SenhaNova22");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar redefinição" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/api/users/u9/reset-password")
      );
      expect(call).toBeTruthy();
      expect(String(call?.[1]?.body)).toContain("SenhaNova22");
    });
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("confirmação diferente é rejeitada sem enviar requisição", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/users") && (!init?.method || init.method === "GET")
          ? jsonResponse(200, PAGE)
          : null,
    ]);
    render(<UsersPage currentUser={ADMIN as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "Redefinir senha" }));
    await userEvent.type(await screen.findByLabelText("Nova senha"), "SenhaNova22");
    await userEvent.type(screen.getByLabelText("Confirmar nova senha"), "Diferente33");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar redefinição" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "A confirmação deve ser igual à nova senha."
    );
    const resetCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/reset-password")
    );
    expect(resetCall).toBeUndefined();
  });
});

describe("filtro de usuários da auditoria", () => {
  it("carrega todas as páginas: um usuário da segunda página aparece no filtro", async () => {
    const makeUser = (index: number) => ({
      id: `u${index}`,
      name: `Usuário ${String(index).padStart(2, "0")}`,
      email: `user${index}@teste.local`,
      role: "VIEWER",
      active: true,
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const page1 = Array.from({ length: 20 }, (_, i) => makeUser(i + 1));
    const page2 = [makeUser(21), makeUser(22)]; // total 22 usuários

    stubFetch([
      (url) => {
        if (!url.includes("/api/users")) return null;
        const page = new URL(url, "http://local").searchParams.get("page");
        return jsonResponse(200, {
          users: page === "2" ? page2 : page1,
          total: 22,
          page: Number(page ?? 1),
          pageSize: 20,
        });
      },
      (url) =>
        url.includes("/api/audit-logs")
          ? jsonResponse(200, { logs: [], total: 0, page: 1, pageSize: 20 })
          : null,
    ]);
    const { default: AuditPage } = await import("./components/AuditPage");
    render(<AuditPage />);

    const select = await screen.findByLabelText("Usuário");
    await waitFor(() => {
      expect(select.textContent).toContain("Usuário 21"); // veio da página 2
    });
    expect(select.textContent).toContain("Usuário 01");
  });
});

describe("protocolo selecionado ao abrir o Histórico", () => {
  const LIST_ITEM = {
    id: "r1",
    status: "OPEN",
    priority: "NORMAL",
    dueAt: "2026-07-26T12:00:00.000Z",
    startedAt: null,
    resolvedAt: null,
    resolutionCode: null,
    version: 1,
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
    openedBy: { id: "u2", name: "Otto Operador" },
    assignedTo: null,
    consultation: {
      id: "c1",
      protocol: "VIA-20260725-PROTOA11",
      status: "PRELIMINARILY_VIABLE",
      street: "Rua A",
      number: "1",
      neighborhood: null,
      city: "Belo Horizonte",
      state: "MG",
    },
    sla: { overdue: false, remainingMinutes: 600, resolvedWithinSla: null },
  };
  const SUMMARY = {
    total: 1,
    open: 1,
    inProgress: 0,
    waitingInformation: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    overdue: 0,
    unassigned: 1,
    assignedToMe: 0,
    byPriority: { low: 0, normal: 1, high: 0, urgent: 0 },
  };
  const DASH = {
    period: { dateFrom: "2026-06-24", dateTo: "2026-07-23", timeZone: "America/Sao_Paulo" },
    totals: {
      consultations: 0,
      preliminarilyViable: 0,
      outsideCoverage: 0,
      addressAmbiguous: 0,
      coverageNotConfigured: 0,
      geocodingFailed: 0,
      otherStatuses: 0,
    },
    rates: {
      coverageRate: 0,
      networkReferenceFoundRate: 0,
      manualConfirmationRate: 0,
      geocodingHighConfidenceRate: 0,
    },
    performance: { averageDurationMs: 0, medianDurationMs: 0, p95DurationMs: 0 },
    comparison: {
      previousPeriod: { dateFrom: "2026-05-25", dateTo: "2026-06-23" },
      consultationsChangePercent: null,
      coverageRateChangePercentagePoints: null,
      averageDurationChangePercent: null,
    },
  };

  function protocolHandlers(secondProtocol?: string): FetchHandler[] {
    let reviewsCall = 0;
    return [
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: ADMIN })
          : null,
      (url) =>
        url.includes("/api/reviews/summary") ? jsonResponse(200, SUMMARY) : null,
      (url) =>
        url.includes("/api/reviews/assignees") ? jsonResponse(200, { users: [] }) : null,
      (url) => {
        if (!url.includes("/api/reviews?") && !url.endsWith("/api/reviews")) return null;
        reviewsCall += 1;
        const protocol =
          secondProtocol && reviewsCall > 1 ? secondProtocol : LIST_ITEM.consultation.protocol;
        return jsonResponse(200, {
          reviews: [
            { ...LIST_ITEM, consultation: { ...LIST_ITEM.consultation, protocol } },
          ],
          total: 1,
          page: 1,
          limit: 20,
        });
      },
      (url) =>
        url.includes("/api/dashboard/users")
          ? jsonResponse(200, { users: [], total: 0, page: 1, limit: 100 })
          : null,
      (url) =>
        url.includes("/api/dashboard/summary") ? jsonResponse(200, DASH) : null,
      (url) =>
        url.includes("/api/dashboard/timeline")
          ? jsonResponse(200, { granularity: "DAY", points: [] })
          : null,
      (url) =>
        url.includes("/api/dashboard/breakdowns")
          ? jsonResponse(200, {
              byStatus: [],
              byNetworkReferenceStatus: [],
              byGeocodingConfidence: [],
              byGeocodingLocationType: [],
            })
          : null,
      (url) =>
        url.includes("/api/dashboard/rankings")
          ? jsonResponse(200, { partners: [], layers: [], users: [], cities: [] })
          : null,
      (url) =>
        url.includes("/api/dashboard/recent-consultations")
          ? jsonResponse(200, { consultations: [] })
          : null,
      (url) =>
        url.includes("/api/consultations")
          ? jsonResponse(200, { consultations: [], total: 0, page: 1, limit: 20 })
          : null,
    ];
  }

  it("fila → Histórico aplica o protocolo; menu manual NÃO reaplica; outro protocolo substitui", async () => {
    const fetchMock = stubFetch(protocolHandlers("VIA-20260725-PROTOB22"));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("Alice Admin")).toBeTruthy();

    // 1) Abrir protocolo A pela fila:
    await user.click(screen.getByRole("button", { name: "Análises" }));
    await user.click(
      await screen.findByRole("button", { name: "Abrir consulta histórica" })
    );
    // 2) O Histórico recebe o protocolo A na busca aplicada:
    const search = await screen.findByLabelText("Buscar");
    expect((search as HTMLInputElement).value).toBe("VIA-20260725-PROTOA11");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("search=VIA-20260725-PROTOA11")
        )
      ).toBe(true)
    );

    // 3) Navegar ao Dashboard:
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await screen.findByLabelText("Indicadores principais");

    // 4-5) Clicar manualmente em Histórico: o protocolo A NÃO é reaplicado.
    await user.click(screen.getByRole("button", { name: "Histórico" }));
    const cleanSearch = await screen.findByLabelText("Buscar");
    expect((cleanSearch as HTMLInputElement).value).toBe("");

    // 6) Abrir o protocolo B pela fila substitui A:
    await user.click(screen.getByRole("button", { name: "Análises" }));
    await user.click(
      await screen.findByRole("button", { name: "Abrir consulta histórica" })
    );
    const replaced = await screen.findByLabelText("Buscar");
    expect((replaced as HTMLInputElement).value).toBe("VIA-20260725-PROTOB22");
  });
});
