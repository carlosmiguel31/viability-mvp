import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import DashboardPage from "./components/DashboardPage";
import * as api from "./api";
import * as auth from "./auth";
import type {
  DashboardBreakdowns,
  DashboardRankings,
  DashboardRecentConsultation,
  DashboardSummary,
  DashboardTimeline,
} from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const mockedModule: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mockedModule[key] =
      typeof (actual as Record<string, unknown>)[key] === "function" && key !== "ApiError"
        ? vi.fn()
        : (actual as Record<string, unknown>)[key];
  }
  return mockedModule;
});
vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  const mockedModule: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mockedModule[key] =
      typeof (actual as Record<string, unknown>)[key] === "function" && key !== "ApiError"
        ? vi.fn()
        : (actual as Record<string, unknown>)[key];
  }
  mockedModule.ApiError = actual.ApiError;
  return mockedModule;
});

const mocked = vi.mocked(api);
const mockedAuth = vi.mocked(auth);

const ADMIN = { id: "u-admin", name: "Admin", email: "admin@x", role: "ADMIN" as const };
const VIEWER = { id: "u-view", name: "Viewer", email: "view@x", role: "VIEWER" as const };

const SUMMARY: DashboardSummary = {
  period: { dateFrom: "2026-06-24", dateTo: "2026-07-23", timeZone: "America/Sao_Paulo" },
  totals: {
    consultations: 42,
    preliminarilyViable: 30,
    outsideCoverage: 10,
    addressAmbiguous: 1,
    coverageNotConfigured: 1,
    geocodingFailed: 0,
    otherStatuses: 0,
  },
  rates: {
    coverageRate: 0.75,
    networkReferenceFoundRate: 0.5,
    manualConfirmationRate: 0.1,
    geocodingHighConfidenceRate: 0.9,
  },
  performance: { averageDurationMs: 350, medianDurationMs: 300, p95DurationMs: 900 },
  comparison: {
    previousPeriod: { dateFrom: "2026-05-25", dateTo: "2026-06-23" },
    consultationsChangePercent: 20,
    coverageRateChangePercentagePoints: -5,
    averageDurationChangePercent: null,
  },
};

const TIMELINE: DashboardTimeline = {
  granularity: "DAY",
  points: [
    { period: "2026-07-21", total: 3, preliminarilyViable: 2, outsideCoverage: 1, addressAmbiguous: 0 },
    { period: "2026-07-22", total: 0, preliminarilyViable: 0, outsideCoverage: 0, addressAmbiguous: 0 },
    { period: "2026-07-23", total: 5, preliminarilyViable: 4, outsideCoverage: 1, addressAmbiguous: 0 },
  ],
};

const BREAKDOWNS: DashboardBreakdowns = {
  byStatus: [{ status: "PRELIMINARILY_VIABLE", count: 30, percentage: 71.4 }],
  byNetworkReferenceStatus: [{ status: "FOUND", count: 10, percentage: 50 }],
  byGeocodingConfidence: [{ confidence: "HIGH", count: 38, percentage: 90.5 }],
  byGeocodingLocationType: [{ locationType: "ROOFTOP", count: 35, percentage: 83.3 }],
};

const RANKINGS: DashboardRankings = {
  partners: [
    { partnerCode: "REDE_NEUTRA", partnerName: "Rede Neutra", matchCount: 40, consultationCount: 30 },
  ],
  layers: [
    {
      layerId: "layer-1",
      layerName: "Cobertura Barreiro",
      partnerName: "Rede Neutra",
      version: "2026-07",
      matchCount: 40,
      consultationCount: 30,
    },
  ],
  users: [{ userId: "u-op", name: "Operadora", email: "op@x", consultationCount: 25 }],
  cities: [
    {
      city: "Belo Horizonte",
      state: "MG",
      consultationCount: 40,
      preliminarilyViableCount: 30,
      coverageRate: 0.75,
    },
  ],
};

const RECENT: DashboardRecentConsultation[] = [
  {
    id: "c-1",
    protocol: "VIA-20260723-ABCD2345",
    status: "PRELIMINARILY_VIABLE",
    address: { street: "Rua X", number: "10", neighborhood: "Barreiro", city: "Belo Horizonte", state: "MG" },
    user: { id: "u-op", name: "Operadora" },
    coverageMatchCount: 2,
    networkReferenceStatus: "FOUND",
    createdAt: "2026-07-23T12:00:00.000Z",
    durationMs: 200,
  },
];

function mockHappyPath() {
  mocked.getDashboardSummary.mockResolvedValue(structuredClone(SUMMARY));
  mocked.getDashboardTimeline.mockResolvedValue(structuredClone(TIMELINE));
  mocked.getDashboardBreakdowns.mockResolvedValue(structuredClone(BREAKDOWNS));
  mocked.getDashboardRankings.mockResolvedValue(structuredClone(RANKINGS));
  mocked.getDashboardRecentConsultations.mockResolvedValue({
    consultations: structuredClone(RECENT),
  });
  mocked.getDashboardUserOptions.mockResolvedValue({
    users: [{ id: "u-op", name: "Operadora", email: "op@x" }],
    total: 1,
    page: 1,
    limit: 100,
  });
  mocked.getConsultation.mockResolvedValue({
    consultation: {
      id: "c-1",
      protocol: "VIA-20260723-ABCD2345",
      status: "PRELIMINARILY_VIABLE",
      resultMessage: "ok",
      createdAt: "2026-07-23T12:00:00.000Z",
      durationMs: 200,
      address: { postalCode: "30000-000", street: "Rua X", number: "10", complement: null, neighborhood: "Barreiro", city: "Belo Horizonte", state: "MG" },
      user: { id: "u-op", name: "Operadora", email: "op@x" },
      geocoding: { provider: "google", geocodedAddress: "Rua X, 10", confidence: "HIGH", locationType: "ROOFTOP", partialMatch: false, latitude: null, longitude: null },
      confirmation: { latitude: null, longitude: null, confirmedManually: false, confirmationRequired: false },
      coverage: { matches: [], matchCount: 0, configured: true, snapshotBuiltAt: null },
      network: { status: "FOUND", reference: null, alternatives: [], searchRadiusMeters: null },
      source: "WEB",
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHappyPath();
});

afterEach(() => {
  cleanup();
});

describe("DashboardPage", () => {
  it("carrega cards principais com formatos pt-BR e taxa de cobertura", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    const cardsSection = await screen.findByLabelText("Indicadores principais");
    expect(within(cardsSection).getByText("Consultas")).toBeTruthy();
    expect(within(cardsSection).getByText("42")).toBeTruthy();
    expect(within(cardsSection).getByText("Taxa de cobertura")).toBeTruthy();
    expect(within(cardsSection).getByText("75%")).toBeTruthy();
    expect(within(cardsSection).getByText("Tempo médio")).toBeTruthy();
    expect(within(cardsSection).getByText("350 ms")).toBeTruthy();
  });

  it("exibe comparação com o período anterior em texto explícito", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText(/aumento de 20 %/)).toBeTruthy();
    expect(screen.getByText(/queda de 5 ponto\(s\) percentual\(is\)/)).toBeTruthy();
  });

  it("mostra o período efetivamente utilizado", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    expect(
      await screen.findByText(/Período: 2026-06-24 a 2026-07-23 \(America\/Sao_Paulo\)/)
    ).toBeTruthy();
  });

  it("aplica preset somente ao clicar em Aplicar (não a cada alteração)", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    await screen.findByText("42");
    expect(mocked.getDashboardSummary).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "LAST_7_DAYS" } });
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Contagem" } });
    expect(mocked.getDashboardSummary).toHaveBeenCalledTimes(1); // nada por tecla
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(mocked.getDashboardSummary).toHaveBeenCalledTimes(2));
    expect(mocked.getDashboardSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ preset: "LAST_7_DAYS", city: "Contagem" }),
      expect.anything()
    );
  });

  it("período customizado envia datas; incompleto ou invertido é rejeitado sem requisição", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    await screen.findByText("42");
    fireEvent.change(screen.getByLabelText("Período"), { target: { value: "CUSTOM" } });
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText(/exige data inicial e data final/)).toBeTruthy();
    expect(mocked.getDashboardSummary).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(await screen.findByText(/anterior ou igual à data final/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-07-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(mocked.getDashboardSummary).toHaveBeenLastCalledWith(
        expect.objectContaining({ preset: "CUSTOM", dateFrom: "2026-07-01", dateTo: "2026-07-10" }),
        expect.anything()
      )
    );
  });

  it("limpar filtros volta ao padrão LAST_30_DAYS", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    await screen.findByText("42");
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Contagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(mocked.getDashboardSummary).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() =>
      expect(mocked.getDashboardSummary).toHaveBeenLastCalledWith(
        expect.objectContaining({ preset: "LAST_30_DAYS", city: undefined }),
        expect.anything()
      )
    );
    expect(screen.getByLabelText("Cidade")).toHaveProperty("value", "");
  });

  it("ADMIN, OPERATOR e TECHNICIAN veem o filtro de usuário (via /api/dashboard/users); VIEWER não", async () => {
    for (const role of ["ADMIN", "OPERATOR", "TECHNICIAN"] as const) {
      const { unmount } = render(
        <DashboardPage currentUser={{ ...ADMIN, role } as never} />
      );
      await screen.findByText("42");
      const select = await screen.findByLabelText("Usuário");
      fireEvent.change(select, { target: { value: "u-op" } });
      fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
      await waitFor(() =>
        expect(mocked.getDashboardSummary).toHaveBeenLastCalledWith(
          expect.objectContaining({ userId: "u-op" }),
          expect.anything()
        )
      );
      unmount();
      cleanup();
      vi.clearAllMocks();
      mockHappyPath();
    }

    render(<DashboardPage currentUser={VIEWER} />);
    await screen.findByText("42");
    expect(screen.queryByLabelText("Usuário")).toBeNull();
    expect(mocked.getDashboardUserOptions).not.toHaveBeenCalled();
    // O DashboardPage NUNCA usa o /api/users administrativo:
    expect(mocked.listUsers).not.toHaveBeenCalled();
  });

  it("mostra a timeline com períodos sem dados e alternativa tabular acessível", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    const chart = await screen.findByRole("img", { name: /Evolução das consultas/ });
    expect(chart.getAttribute("aria-label")).toContain("2026-07-22: 0 consulta(s)");
    fireEvent.click(screen.getByText("Ver dados do gráfico em tabela"));
    const table = screen.getByText("Ver dados do gráfico em tabela").closest("details")!;
    expect(within(table).getByText("2026-07-22")).toBeTruthy();
  });

  it("mostra distribuições de status, Voalle, confiança e locationType", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("Resultados")).toBeTruthy();
    const statusCard = screen.getByText("Resultados").closest("div")!;
    expect(within(statusCard).getByText("Viável preliminarmente")).toBeTruthy();
    const voalle = screen.getByText("Referência de rede (Voalle)").closest("div")!;
    expect(within(voalle).getByText("Encontrada")).toBeTruthy();
    const confidence = screen.getByText("Confiança da geocodificação").closest("div")!;
    expect(within(confidence).getByText("Alta")).toBeTruthy();
    const locationType = screen.getByText("Tipo de localização").closest("div")!;
    expect(within(locationType).getByText("Localização exata")).toBeTruthy();
  });

  it("mostra rankings de parceiros, camadas e cidades sem IDs internos nem coordenadas", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("Parceiros mais encontrados")).toBeTruthy();
    expect(screen.getAllByText("Rede Neutra").length).toBeGreaterThan(0);
    expect(screen.getByText("Cobertura Barreiro")).toBeTruthy();
    expect(screen.getByText("Belo Horizonte/MG")).toBeTruthy();
    // IDs internos e coordenadas nunca aparecem:
    expect(screen.queryByText("layer-1")).toBeNull();
    expect(screen.queryByText(/-19\./)).toBeNull();
    expect(screen.queryByText("u-op")).toBeNull();
  });

  it("ranking de usuários aparece para ADMIN e é ocultado para VIEWER", async () => {
    const { unmount } = render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("Usuários")).toBeTruthy();
    expect(screen.getByText("op@x")).toBeTruthy();
    unmount();

    mocked.getDashboardRankings.mockResolvedValue({ ...structuredClone(RANKINGS), users: [] });
    render(<DashboardPage currentUser={VIEWER} />);
    await screen.findByText("Parceiros mais encontrados");
    expect(screen.queryByText("Usuários")).toBeNull();
    expect(screen.queryByText("op@x")).toBeNull();
  });

  it("mostra consultas recentes e abre os detalhes reutilizando o componente compartilhado", async () => {
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("VIA-20260723-ABCD2345")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver detalhes" }));
    await waitFor(() => expect(mocked.getConsultation).toHaveBeenCalledWith("c-1"));
    // Modal compartilhado (mesmo título usado no histórico):
    expect(await screen.findByRole("dialog", { name: /Detalhes da consulta/ })).toBeTruthy();
  });

  it("erro nos rankings não esconde os cards principais e oferece tentar novamente", async () => {
    mocked.getDashboardRankings.mockRejectedValue(new api.ApiError("Falha rankings", "DASHBOARD_QUERY_FAILED", 500));
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("42")).toBeTruthy(); // cards seguem visíveis
    expect(await screen.findByText("Falha rankings")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Tentar novamente" }).length).toBeGreaterThan(0);
  });

  it("erro do resumo mostra Tentar novamente e o clique recarrega", async () => {
    mocked.getDashboardSummary.mockRejectedValueOnce(new api.ApiError("Resumo falhou", "DASHBOARD_QUERY_FAILED", 500));
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("Resumo falhou")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Tentar novamente" })[0]);
    expect(await screen.findByText("42")).toBeTruthy();
  });

  it("ausência de dados mostra mensagens vazias adequadas", async () => {
    mocked.getDashboardTimeline.mockResolvedValue({ granularity: "DAY", points: [] });
    mocked.getDashboardRankings.mockResolvedValue({ partners: [], layers: [], users: [], cities: [] });
    mocked.getDashboardRecentConsultations.mockResolvedValue({ consultations: [] });
    render(<DashboardPage currentUser={ADMIN} />);
    expect(await screen.findByText("Sem consultas no período selecionado.")).toBeTruthy();
    expect(screen.getAllByText("Sem dados no período.").length).toBeGreaterThan(0);
    expect(screen.getByText("Nenhuma consulta no período.")).toBeTruthy();
  });

  it("não armazena filtros nem token em localStorage", async () => {
    localStorage.clear();
    render(<DashboardPage currentUser={ADMIN} />);
    await screen.findByText("42");
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Contagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(mocked.getDashboardSummary).toHaveBeenCalledTimes(2));
    expect(localStorage.length).toBe(0);
  });
});

describe("visualização lógica (recordView) e StrictMode", () => {
  it("StrictMode não provoca duas visualizações: só a primeira chamada usa recordView=true", async () => {
    const { StrictMode } = await import("react");
    render(
      <StrictMode>
        <DashboardPage currentUser={ADMIN} />
      </StrictMode>
    );
    await screen.findByText("42");
    // StrictMode monta o efeito duas vezes; ainda assim, exatamente UMA
    // chamada com recordView=true.
    const recordedCalls = mocked.getDashboardSummary.mock.calls.filter(
      ([, options]) => options?.recordView === true
    );
    expect(recordedCalls).toHaveLength(1);
  });

  it("Tentar novamente não registra nova visualização; aplicar novos filtros registra exatamente mais uma", async () => {
    mocked.getDashboardSummary.mockRejectedValueOnce(
      new api.ApiError("Não foi possível carregar os indicadores do dashboard.", "DASHBOARD_QUERY_FAILED", 500)
    );
    render(<DashboardPage currentUser={ADMIN} />);
    // 1ª abertura (falhou, mas a visualização lógica foi solicitada):
    expect(
      await screen.findByText("Não foi possível carregar os indicadores do dashboard.")
    ).toBeTruthy();
    const recordedSoFar = () =>
      mocked.getDashboardSummary.mock.calls.filter(
        ([, options]) => options?.recordView === true
      ).length;
    expect(recordedSoFar()).toBe(1);

    // Tentar novamente: mesma chave de filtros => recordView=false.
    fireEvent.click(screen.getAllByRole("button", { name: "Tentar novamente" })[0]);
    await screen.findByText("42");
    expect(recordedSoFar()).toBe(1);

    // Aplicar com filtros NOVOS: exatamente mais uma visualização.
    fireEvent.change(screen.getByLabelText("Cidade"), { target: { value: "Contagem" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(recordedSoFar()).toBe(2));
  });

  it("trata DASHBOARD_QUERY_FAILED com a mensagem neutra do backend", async () => {
    mocked.getDashboardRankings.mockRejectedValue(
      new api.ApiError("Não foi possível carregar os indicadores do dashboard.", "DASHBOARD_QUERY_FAILED", 500)
    );
    render(<DashboardPage currentUser={ADMIN} />);
    await screen.findByText("42"); // cards seguem visíveis
    expect(
      await screen.findByText("Não foi possível carregar os indicadores do dashboard.")
    ).toBeTruthy();
  });
});

describe("Dashboard no App", () => {
  it("aparece no menu e é a tela inicial após o login", async () => {
    let notify: (user: typeof ADMIN | null) => void = () => {};
    mockedAuth.onSessionChange.mockImplementation((listener) => {
      notify = listener as never;
      return () => {};
    });
    mockedAuth.restoreSession.mockImplementation(async () => {
      notify(ADMIN);
      return ADMIN as never;
    });
    mocked.fetchCoverageStatus.mockResolvedValue({ configured: true, layers: [] } as never);
    render(<App />);
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByRole("button", { name: "Dashboard" })).toBeTruthy();
    // Tela inicial: conteúdo do dashboard carregado sem navegação manual.
    const cards = await screen.findByLabelText("Indicadores principais");
    expect(within(cards).getByText("Taxa de cobertura")).toBeTruthy();
  });
});
