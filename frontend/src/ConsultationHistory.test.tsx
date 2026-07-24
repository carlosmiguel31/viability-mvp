import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import ConsultationHistoryPage from "./components/ConsultationHistoryPage";
import ResultPanel, { copyTextToClipboard } from "./components/ResultPanel";
import { resetSessionForTests, SessionUser } from "./auth";
import {
  AddressViabilityResponse,
  ConsultationDetail,
  ConsultationSummary,
} from "./types";

vi.mock("./components/MapView", () => ({
  default: () => <div data-testid="map" />,
}));

const ADMIN = {
  id: "u1",
  name: "Alice Admin",
  email: "alice@teste.local",
  role: "ADMIN",
} as SessionUser;
const VIEWER = {
  id: "u3",
  name: "Vera Viewer",
  email: "vera@teste.local",
  role: "VIEWER",
} as SessionUser;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | null;
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
    if (url.includes("/api/users")) {
      return jsonResponse(200, { users: [], total: 0, page: 1, pageSize: 20 });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "não mapeado" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function makeSummary(overrides: Partial<ConsultationSummary> = {}): ConsultationSummary {
  return {
    id: "c1",
    protocol: "VIA-20260723-ABCD2345",
    status: "PRELIMINARILY_VIABLE",
    address: {
      postalCode: "30640-000",
      street: "Rua Exemplo",
      number: "100",
      neighborhood: "Barreiro",
      city: "Belo Horizonte",
      state: "MG",
    },
    user: { id: "u2", name: "Otto Operador" },
    coverageMatchCount: 2,
    networkReferenceStatus: "VOALLE_UNAVAILABLE",
    createdAt: "2026-07-23T12:00:00.000Z",
    durationMs: 250,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<ConsultationDetail> = {}): ConsultationDetail {
  return {
    id: "c1",
    protocol: "VIA-20260723-ABCD2345",
    status: "PRELIMINARILY_VIABLE",
    resultMessage: "O endereço está dentro da área de cobertura.",
    createdAt: "2026-07-23T12:00:00.000Z",
    completedAt: "2026-07-23T12:00:01.000Z",
    durationMs: 250,
    user: { id: "u2", name: "Otto Operador", email: "otto@teste.local" },
    address: {
      postalCode: "30640-000",
      street: "Rua Exemplo",
      number: "100",
      complement: null,
      neighborhood: "Barreiro",
      city: "Belo Horizonte",
      state: "MG",
    },
    geocoding: {
      provider: "google",
      geocodedAddress: "Rua Exemplo, 100 - Barreiro, Belo Horizonte - MG",
      confidence: "HIGH",
      locationType: null,
      partialMatch: false,
      latitude: -19.98801,
      longitude: -44.01802,
    },
    confirmation: {
      latitude: -19.988,
      longitude: -44.018,
      confirmedManually: true,
      confirmationRequired: false,
    },
    coverage: {
      matches: [
        {
          partnerId: "p-int-1",
          partnerName: "Rede Neutra",
          partnerCode: "REDE_NEUTRA",
          layerId: "l-int-1",
          layerName: "Cobertura Barreiro",
          version: "2026-07",
        },
      ],
      matchCount: 1,
      configured: true,
      snapshotBuiltAt: "2026-07-23T11:00:00.000Z",
    },
    network: {
      status: "FOUND",
      reference: {
        latitude: -19.9881,
        longitude: -44.0181,
        distanceMeters: 42,
        identificationStatus: "IDENTIFIED",
        identifiers: [{ id: "n1", code: "CTO-BAR-001" }],
      },
      alternatives: [{ distanceMeters: 90 }],
      searchRadiusMeters: 300,
    },
    source: "LOCATION_CONFIRMED",
    ...overrides,
  };
}

const noopPage = { consultations: [makeSummary()], total: 1, page: 1, limit: 20 };

beforeEach(() => resetSessionForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("menu Histórico", () => {
  it("aparece para qualquer usuário autenticado e VIEWER só vê o permitido", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/auth/refresh")
          ? jsonResponse(200, { accessToken: "token", user: VIEWER })
          : null,
      (url) => (url.includes("/api/coverage/status") ? jsonResponse(200, {}) : null),
      (url) => (url.includes("/api/consultations") ? jsonResponse(200, noopPage) : null),
    ]);
    render(<App />);
    await screen.findByText("Vera Viewer");
    expect(screen.getByRole("button", { name: "Histórico" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nova consulta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alterar minha senha" })).toBeTruthy();
    // Nada de administração para VIEWER:
    expect(screen.queryByRole("button", { name: "Coberturas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Usuários" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Auditoria" })).toBeNull();
  });
});

describe("listagem do histórico", () => {
  it("lista consultas com protocolo, endereço, resultado e responsável; sem token em storage", async () => {
    stubFetch([
      (url) => (url.includes("/api/consultations?") ? jsonResponse(200, noopPage) : null),
    ]);
    render(<ConsultationHistoryPage currentUser={VIEWER} />);
    const row = (await screen.findByText("VIA-20260723-ABCD2345")).closest("tr")!;
    expect(row.textContent).toContain("Rua Exemplo, 100 — Belo Horizonte/MG");
    expect(row.textContent).toContain("Viável preliminarmente");
    expect(row.textContent).toContain("Otto Operador");
    expect(row.textContent).toContain("Voalle indisponível"); // complementar
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("pagina com Math.ceil e busca por protocolo ao clicar em Buscar", async () => {
    const queries: string[] = [];
    stubFetch([
      (url) => {
        if (!url.includes("/api/consultations?")) return null;
        queries.push(url);
        return jsonResponse(200, {
          consultations: [makeSummary()],
          total: 45,
          page: 1,
          limit: 20,
        });
      },
    ]);
    render(<ConsultationHistoryPage currentUser={VIEWER} />);
    await screen.findByText(/página 1 de 3/); // ceil(45/20)

    await userEvent.type(screen.getByLabelText("Buscar"), "VIA-20260723-ABCD2345");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => {
      const last = queries[queries.length - 1];
      expect(last).toContain("search=VIA-20260723-ABCD2345");
      expect(last).toContain("page=1");
      expect(last).toContain("limit=20");
    });

    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(queries[queries.length - 1]).toContain("page=2"));
  });

  it("filtros são enviados apenas quando preenchidos e Limpar filtros zera tudo", async () => {
    const queries: string[] = [];
    stubFetch([
      (url) => {
        if (!url.includes("/api/consultations?")) return null;
        queries.push(url);
        return jsonResponse(200, noopPage);
      },
    ]);
    render(<ConsultationHistoryPage currentUser={VIEWER} />);
    await screen.findByText("VIA-20260723-ABCD2345");
    expect(queries[0]).not.toContain("status="); // filtros vazios não vão

    await userEvent.selectOptions(screen.getByLabelText("Resultado"), "OUTSIDE_COVERAGE");
    await userEvent.selectOptions(screen.getByLabelText("Cobertura"), "false");
    await userEvent.type(screen.getByLabelText("Cidade"), "Belo Horizonte");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => {
      const last = queries[queries.length - 1];
      expect(last).toContain("status=OUTSIDE_COVERAGE");
      expect(last).toContain("hasCoverage=false");
      expect(last).toContain("city=Belo+Horizonte");
    });

    await userEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => {
      const last = queries[queries.length - 1];
      expect(last).not.toContain("status=");
      expect(last).not.toContain("hasCoverage=");
      expect(last).not.toContain("city=");
    });
  });
});

describe("detalhes da consulta", () => {
  it("abre os detalhes com endereços, cobertura histórica, referência pública e ajuste manual", async () => {
    stubFetch([
      (url) => (url.includes("/api/consultations/c1") ? jsonResponse(200, { consultation: makeDetail() }) : null),
      (url) => (url.includes("/api/consultations?") ? jsonResponse(200, noopPage) : null),
    ]);
    const { container } = render(<ConsultationHistoryPage currentUser={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalhes" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Rua Exemplo, 100");
    expect(dialog.textContent).toContain("CEP 30640-000"); // endereço informado
    expect(dialog.textContent).toContain(
      "Rua Exemplo, 100 - Barreiro, Belo Horizonte - MG"
    ); // endereço localizado
    expect(dialog.textContent).toContain("Rede Neutra");
    expect(dialog.textContent).toContain("Cobertura Barreiro");
    expect(dialog.textContent).toContain("versão 2026-07"); // cobertura histórica
    expect(dialog.textContent).toContain("CTO-BAR-001"); // referência pública
    expect(dialog.textContent).toContain("42 m");
    expect(dialog.textContent).toContain("Ponto ajustado manualmente no mapa");
    // IDs internos não aparecem como informação:
    expect(container.innerHTML).not.toContain("p-int-1");
    expect(container.innerHTML).not.toContain("l-int-1");
    expect(container.innerHTML).not.toContain("storedFileName");
  });

  it("trata CONSULTATION_NOT_FOUND e CONSULTATION_ACCESS_DENIED com mensagens claras", async () => {
    let call = 0;
    stubFetch([
      (url) => {
        if (!url.includes("/api/consultations/c1")) return null;
        call += 1;
        return call === 1
          ? jsonResponse(404, {
              error: { code: "CONSULTATION_NOT_FOUND", message: "Consulta não encontrada." },
            })
          : jsonResponse(403, {
              error: { code: "CONSULTATION_ACCESS_DENIED", message: "Sem permissão." },
            });
      },
      (url) => (url.includes("/api/consultations?") ? jsonResponse(200, noopPage) : null),
    ]);
    render(<ConsultationHistoryPage currentUser={VIEWER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalhes" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Consulta não encontrada ou sem permissão"
    );
    await userEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Você não tem permissão para abrir esta consulta."
      );
    });
  });
});

describe("exportação CSV", () => {
  it("botão aparece somente para ADMIN e envia os filtros aplicados", async () => {
    const exportCalls: string[] = [];
    stubFetch([
      (url) => {
        if (!url.includes("/api/consultations/export")) return null;
        exportCalls.push(url);
        return new Response("\uFEFFProtocolo;Data", {
          status: 200,
          headers: { "Content-Type": "text/csv; charset=utf-8" },
        });
      },
      (url) => (url.includes("/api/consultations?") ? jsonResponse(200, noopPage) : null),
    ]);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });

    const viewerRender = render(<ConsultationHistoryPage currentUser={VIEWER} />);
    await screen.findByText("VIA-20260723-ABCD2345");
    expect(screen.queryByRole("button", { name: "Exportar CSV" })).toBeNull();
    viewerRender.unmount();

    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    await screen.findByText("VIA-20260723-ABCD2345");
    await userEvent.selectOptions(screen.getByLabelText("Resultado"), "OUTSIDE_COVERAGE");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await screen.findByText(/Exportação iniciada/);
    expect(exportCalls[0]).toContain("status=OUTSIDE_COVERAGE");
  });

  it("mostra a mensagem do limite quando CONSULTATION_EXPORT_LIMIT_EXCEEDED", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/consultations/export")
          ? jsonResponse(400, {
              error: {
                code: "CONSULTATION_EXPORT_LIMIT_EXCEEDED",
                message: "A exportação está limitada a 10000 registros; refine os filtros.",
              },
            })
          : null,
      (url) => (url.includes("/api/consultations?") ? jsonResponse(200, noopPage) : null),
    ]);
    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    await screen.findByText("VIA-20260723-ABCD2345");
    await userEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "limitada a 10000 registros"
    );
  });
});

describe("protocolo no resultado da consulta", () => {
  function makeResult(): AddressViabilityResponse {
    return {
      status: "PRELIMINARILY_VIABLE",
      message: "Dentro da cobertura.",
      coverageMatches: [
        {
          partnerId: "p1",
          partnerName: "Rede Neutra",
          layerId: "l1",
          layerName: "Cobertura Barreiro",
          version: "2026-07",
        },
      ],
      networkReferenceStatus: "NOT_FOUND",
      networkReferenceMessage: "Sem ponto de rede próximo identificado automaticamente.",
      searchedAddress: {
        formattedAddress: "Rua Exemplo, 100",
        latitude: -19.988,
        longitude: -44.018,
        geocodingConfidence: "HIGH",
        manuallyAdjusted: false,
        input: {
          postalCode: null,
          street: "Rua Exemplo",
          number: "100",
          complement: null,
          neighborhood: null,
          city: "Belo Horizonte",
          state: "MG",
        },
      },
      coverage: { insideCoverage: true, primaryArea: null, matchingAreas: [] },
      nearestNetworkLocation: null,
      alternatives: [],
      requiresTechnicalConfirmation: true,
      analysisBasis: "Base: mancha KML.",
      consultation: {
        id: "c9",
        protocol: "VIA-20260723-XYZW2345",
        createdAt: "2026-07-23T12:00:00.000Z",
      },
    } as AddressViabilityResponse;
  }

  it("mostra o protocolo, copia com navigator.clipboard e mantém matches + aviso Voalle", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<ResultPanel result={makeResult()} />);
    expect(screen.getByText("VIA-20260723-XYZW2345")).toBeTruthy();
    expect(screen.getByText("Coberturas encontradas")).toBeTruthy(); // matches mantidos
    expect(
      screen.getByText(/Sem ponto de rede próximo identificado automaticamente/)
    ).toBeTruthy(); // Voalle segue complementar
    await userEvent.click(screen.getByRole("button", { name: "Copiar protocolo" }));
    expect(writeText).toHaveBeenCalledWith("VIA-20260723-XYZW2345");
    await screen.findByText("Copiado!");
  });

  it("copyTextToClipboard tem fallback quando clipboard não existe", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });
    const copied = await copyTextToClipboard("VIA-20260723-AAAA2222");
    expect(copied).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("resultado sem consultation (consulta anterior limpa) não mostra protocolo", () => {
    const result = { ...makeResult(), consultation: undefined };
    render(<ResultPanel result={result} />);
    expect(screen.queryByText(/Protocolo:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copiar protocolo" })).toBeNull();
  });
});

describe("diálogos de análise técnica no Histórico", () => {
  const REVIEW_DETAILS = {
    id: "r1",
    consultationId: "c1",
    status: "OPEN",
    priority: "NORMAL",
    openedBy: { id: "u1", name: "Alice Admin", email: "alice@teste.local" },
    assignedTo: null,
    resolutionCode: null,
    resolutionSummary: null,
    dueAt: "2026-07-26T12:00:00.000Z",
    startedAt: null,
    resolvedAt: null,
    version: 1,
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
    sla: { overdue: false, remainingMinutes: 600, resolvedWithinSla: null },
    consultation: {
      id: "c1",
      protocol: "VIA-20260723-ABCD2345",
      status: "PRELIMINARILY_VIABLE",
      resultMessage: "ok",
      street: "Rua Exemplo",
      number: "100",
      neighborhood: "Barreiro",
      city: "Belo Horizonte",
      state: "MG",
      coverageMatchCount: 1,
      networkReferenceStatus: "NOT_CHECKED",
      createdAt: "2026-07-23T12:00:00.000Z",
      coverage: { matches: [], matchCount: 0 },
      network: { status: "NOT_CHECKED", reference: null, alternatives: [] },
    },
    events: [],
  };

  function historyHandlers(options: {
    existingReviewId?: string | null;
    createStatus?: number;
  }): FetchHandler[] {
    return [
      (url) =>
        url.includes("/api/consultations?") || url.endsWith("/api/consultations")
          ? jsonResponse(200, { consultations: [makeSummary()], total: 1, page: 1, limit: 20 })
          : null,
      (url) =>
        url.includes("/api/reviews/by-consultation/c1")
          ? options.existingReviewId
            ? jsonResponse(200, {
                review: {
                  id: options.existingReviewId,
                  consultationId: "c1",
                  status: "OPEN",
                  priority: "NORMAL",
                  assignedTo: null,
                  dueAt: "2026-07-26T12:00:00.000Z",
                  version: 1,
                },
              })
            : jsonResponse(404, { error: { code: "REVIEW_NOT_FOUND", message: "não há" } })
          : null,
      (url, init) =>
        url.endsWith("/api/reviews") && init?.method === "POST"
          ? options.createStatus === 409
            ? jsonResponse(409, {
                error: { code: "REVIEW_ALREADY_EXISTS", message: "duplicada" },
              })
            : jsonResponse(201, { review: REVIEW_DETAILS })
          : null,
      (url) =>
        url.includes("/api/reviews/assignees")
          ? jsonResponse(200, { users: [] })
          : null,
      (url) =>
        url.includes("/api/reviews/r1")
          ? jsonResponse(200, { review: REVIEW_DETAILS })
          : null,
      (url) =>
        url.includes("/api/dashboard/users")
          ? jsonResponse(200, { users: [], total: 0, page: 1, limit: 100 })
          : null,
    ];
  }

  it("Encaminhar para análise abre o ReviewCreateDialog; criar preserva o reviewId e permite abrir os detalhes", async () => {
    stubFetch(historyHandlers({ existingReviewId: null }));
    const user = userEvent.setup();
    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    const forward = await screen.findByRole("button", { name: "Encaminhar para análise" });
    await user.click(forward);

    // 1) o formulário abre:
    const createDialog = await screen.findByRole("dialog", { name: "Encaminhar para análise" });
    await user.click(within(createDialog).getByRole("button", { name: "Encaminhar" }));
    expect(await within(createDialog).findByText("Análise criada com sucesso.")).toBeTruthy();

    // 2) reviewId preservado: o botão da linha vira "Abrir análise"
    // (há também o botão do próprio diálogo de sucesso):
    expect(
      (await screen.findAllByRole("button", { name: "Abrir análise" })).length
    ).toBeGreaterThanOrEqual(2);

    // abrir imediatamente pelos detalhes a partir do próprio formulário:
    await user.click(within(createDialog).getByRole("button", { name: "Abrir análise" }));
    // 3) formulário fechado, detalhes abertos:
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Encaminhar para análise" })).toBeNull()
    );
    expect(
      await screen.findByRole("dialog", { name: /Detalhes da análise|Análise/i })
    ).toBeTruthy();
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
  });

  it("análise já existente NÃO abre o formulário: vai direto aos detalhes", async () => {
    stubFetch(historyHandlers({ existingReviewId: "r1" }));
    const user = userEvent.setup();
    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    // O rótulo inicial é Encaminhar (mapa vazio); o clique detecta e abre direto.
    await user.click(await screen.findByRole("button", { name: "Encaminhar para análise" }));
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Encaminhar para análise" })).toBeNull();
    // A linha agora reflete a análise existente:
    expect(await screen.findByRole("button", { name: "Abrir análise" })).toBeTruthy();
  });

  it("duplicidade (REVIEW_ALREADY_EXISTS) oferece abrir a análise existente", async () => {
    // by-consultation responde 404 na primeira checagem (corrida), mas o POST
    // devolve duplicidade; o diálogo então oferece "Abrir análise".
    const handlers = historyHandlers({ existingReviewId: null, createStatus: 409 });
    // Depois do 409 o diálogo consulta by-consultation de novo — aí encontra:
    let firstLookup = true;
    handlers[1] = (url) => {
      if (!url.includes("/api/reviews/by-consultation/c1")) return null;
      if (firstLookup) {
        firstLookup = false;
        return jsonResponse(404, { error: { code: "REVIEW_NOT_FOUND", message: "não há" } });
      }
      return jsonResponse(200, {
        review: {
          id: "r1",
          consultationId: "c1",
          status: "OPEN",
          priority: "NORMAL",
          assignedTo: null,
          dueAt: null,
          version: 1,
        },
      });
    };
    stubFetch(handlers);
    const user = userEvent.setup();
    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    await user.click(await screen.findByRole("button", { name: "Encaminhar para análise" }));
    const createDialog = await screen.findByRole("dialog", { name: "Encaminhar para análise" });
    await user.click(within(createDialog).getByRole("button", { name: "Encaminhar" }));
    expect(
      await within(createDialog).findByText("Esta consulta já possui uma análise técnica.")
    ).toBeTruthy();
    // Não fica preso: dá para abrir a existente.
    await user.click(await within(createDialog).findByRole("button", { name: "Abrir análise" }));
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
  });

  it("fechar os diálogos limpa os estados correspondentes", async () => {
    stubFetch(historyHandlers({ existingReviewId: null }));
    const user = userEvent.setup();
    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    await user.click(await screen.findByRole("button", { name: "Encaminhar para análise" }));
    const createDialog = await screen.findByRole("dialog", { name: "Encaminhar para análise" });
    await user.click(within(createDialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Encaminhar para análise" })).toBeNull()
    );
    // Reabrir funciona normalmente (estado limpo):
    await user.click(screen.getByRole("button", { name: "Encaminhar para análise" }));
    expect(
      await screen.findByRole("dialog", { name: "Encaminhar para análise" })
    ).toBeTruthy();
  });
});
