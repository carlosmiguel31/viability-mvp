import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
// Fontes importados como texto (?raw) para as asserções de segurança.
import reviewsPageSource from "./components/ReviewsPage.tsx?raw";
import reviewDetailsSource from "./components/ReviewDetailsDialog.tsx?raw";
import * as api from "./api";
import ReviewsPage, { ReviewCreateDialog } from "./components/ReviewsPage";
import ReviewDetailsDialog from "./components/ReviewDetailsDialog";
import DashboardPage from "./components/DashboardPage";
import { SessionUser } from "./auth";
import {
  ReviewsSummary,
  ViabilityReviewDetails,
  ViabilityReviewListItem,
} from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listReviews: vi.fn(),
    getReviewsSummary: vi.fn(),
    getReview: vi.fn(),
    createReview: vi.fn(),
    updateReview: vi.fn(),
    assignReview: vi.fn(),
    claimReview: vi.fn(),
    getReviewByConsultation: vi.fn(),
    getReviewAssignees: vi.fn(),
    addReviewNote: vi.fn(),
    resolveReview: vi.fn(),
    reopenReview: vi.fn(),
    getDashboardUserOptions: vi.fn(),
    getDashboardSummary: vi.fn(),
    getDashboardTimeline: vi.fn(),
    getDashboardBreakdowns: vi.fn(),
    getDashboardRankings: vi.fn(),
    getDashboardRecentConsultations: vi.fn(),
  };
});

const mocked = vi.mocked(api);
const { ApiError } = api;

const admin: SessionUser = { id: "u-admin", name: "Ana Admin", email: "a@x", role: "ADMIN" };
const technician: SessionUser = { id: "u-tec", name: "Téo Técnico", email: "t@x", role: "TECHNICIAN" };
const operator: SessionUser = { id: "u-op", name: "Otávio Operador", email: "o@x", role: "OPERATOR" };
const viewer: SessionUser = { id: "u-view", name: "Vera Viewer", email: "v@x", role: "VIEWER" };

const SUMMARY: ReviewsSummary = {
  total: 4,
  open: 2,
  inProgress: 1,
  waitingInformation: 0,
  approved: 1,
  rejected: 0,
  cancelled: 0,
  overdue: 1,
  unassigned: 1,
  assignedToMe: 1,
  byPriority: { low: 0, normal: 2, high: 1, urgent: 1 },
};

function listItem(overrides: Partial<ViabilityReviewListItem> = {}): ViabilityReviewListItem {
  return {
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
    openedBy: { id: "u-op", name: "Otávio Operador" },
    assignedTo: null,
    consultation: {
      id: "c1",
      protocol: "VIA-20260725-ABCDEFGH",
      status: "PRELIMINARILY_VIABLE",
      street: "Rua das Filas",
      number: "10",
      neighborhood: null,
      city: "Belo Horizonte",
      state: "MG",
    },
    sla: { overdue: false, remainingMinutes: 600, resolvedWithinSla: null },
    ...overrides,
  };
}

function details(overrides: Partial<ViabilityReviewDetails> = {}): ViabilityReviewDetails {
  return {
    id: "r1",
    consultationId: "c1",
    status: "OPEN",
    priority: "NORMAL",
    openedBy: { id: "u-op", name: "Otávio Operador", email: "o@x" },
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
      protocol: "VIA-20260725-ABCDEFGH",
      status: "PRELIMINARILY_VIABLE",
      resultMessage: "ok",
      street: "Rua das Filas",
      number: "10",
      neighborhood: null,
      city: "Belo Horizonte",
      state: "MG",
      coverageMatchCount: 1,
      networkReferenceStatus: "NOT_CHECKED",
      createdAt: "2026-07-25T09:59:00.000Z",
      coverage: {
        matches: [
          {
            partnerName: "Rede Neutra",
            partnerCode: "REDE_NEUTRA",
            layerName: "Cobertura Barreiro",
            version: "2026-07",
          },
        ],
        matchCount: 1,
      },
      network: {
        status: "FOUND",
        reference: {
          distanceMeters: 83,
          identificationStatus: "IDENTIFIED",
          identifiers: [{ id: "n1", code: "BHZ-C0016-RT10-CT03_2780" }],
        },
        alternatives: [],
      },
    },
    events: [
      {
        id: "e1",
        type: "CREATED",
        fromStatus: null,
        toStatus: "OPEN",
        note: null,
        metadata: null,
        createdAt: "2026-07-25T10:00:00.000Z",
        actor: { id: "u-op", name: "Otávio Operador" },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocked.getReviewsSummary.mockResolvedValue(SUMMARY);
  mocked.listReviews.mockResolvedValue({ reviews: [listItem()], total: 1, page: 1, limit: 20 });
  mocked.getDashboardUserOptions.mockResolvedValue({
    users: [{ id: "u-tec", name: "Téo Técnico", email: "t@x" }],
    total: 1,
    page: 1,
    limit: 100,
  });
  mocked.getReviewAssignees.mockResolvedValue({
    users: [{ id: "u-tec", name: "Téo Técnico", email: "t@x", role: "TECHNICIAN" }],
  });
  mocked.getReviewByConsultation.mockRejectedValue(
    new ApiError("Análise não encontrada.", "REVIEW_NOT_FOUND", 404)
  );
});

afterEach(() => {
  cleanup();
});

describe("ReviewsPage — resumo, fila e filtros", () => {
  it("carrega os cards de resumo e a fila com badges textuais", async () => {
    render(<ReviewsPage currentUser={admin} />);
    await waitFor(() => expect(screen.getByText("Atribuídas a mim")).toBeTruthy());
    expect(screen.getByText("Sem responsável", { selector: "p" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("VIA-20260725-ABCDEFGH")).toBeTruthy());
    // Resultado automático e status da análise lado a lado (texto explícito):
    expect(screen.getByText("Viável preliminarmente")).toBeTruthy();
    expect(screen.getAllByText("Em aberto").length).toBeGreaterThan(0);
  });

  it("aplica filtros (status, atrasadas, sem responsável) apenas ao clicar em Aplicar", async () => {
    render(<ReviewsPage currentUser={admin} />);
    await waitFor(() => expect(mocked.listReviews).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "IN_PROGRESS" } });
    fireEvent.click(screen.getByLabelText("Atrasadas"));
    fireEvent.click(screen.getByLabelText("Sem responsável"));
    expect(mocked.listReviews).toHaveBeenCalledTimes(1); // draft não dispara
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(mocked.listReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "IN_PROGRESS", overdue: true, unassigned: true })
      )
    );
  });

  it("pagina quando há mais de 20 análises", async () => {
    mocked.listReviews.mockResolvedValue({
      reviews: [listItem()],
      total: 45,
      page: 1,
      limit: 20,
    });
    render(<ReviewsPage currentUser={admin} />);
    await waitFor(() => expect(screen.getByText(/Página 1 de 3/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() =>
      expect(mocked.listReviews).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    );
  });

  it("mostra atraso e ausência de responsável na fila", async () => {
    mocked.listReviews.mockResolvedValue({
      reviews: [
        listItem({ sla: { overdue: true, remainingMinutes: -60, resolvedWithinSla: null } }),
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    render(<ReviewsPage currentUser={admin} />);
    await waitFor(() => expect(screen.getByText("Atrasada")).toBeTruthy());
    expect(screen.getAllByText("Sem responsável").length).toBeGreaterThan(0);
  });

  it("VIEWER não vê filtros de responsável nem ação de assumir", async () => {
    render(<ReviewsPage currentUser={viewer} />);
    await waitFor(() => expect(screen.getByText("VIA-20260725-ABCDEFGH")).toBeTruthy());
    expect(screen.queryByLabelText("Responsável")).toBeNull();
    expect(screen.queryByLabelText("Aberta por")).toBeNull();
    expect(screen.queryByRole("button", { name: "Assumir" })).toBeNull();
    expect(mocked.getDashboardUserOptions).not.toHaveBeenCalled();
  });

  it("TECHNICIAN assume análise sem responsável pela fila", async () => {
    mocked.claimReview.mockResolvedValue({ review: details() });
    render(<ReviewsPage currentUser={technician} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Assumir" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Assumir" }));
    await waitFor(() => expect(mocked.claimReview).toHaveBeenCalledWith("r1", { version: 1 }));
  });

  it("abre a consulta histórica relacionada", async () => {
    const openHistory = vi.fn();
    render(<ReviewsPage currentUser={admin} openConsultationHistory={openHistory} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Abrir consulta histórica" })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir consulta histórica" }));
    expect(openHistory).toHaveBeenCalledWith("VIA-20260725-ABCDEFGH");
  });
});

describe("ReviewDetailsDialog — detalhes e ações", () => {
  it("mostra o resultado automático SEPARADO da decisão e a linha do tempo", async () => {
    mocked.getReview.mockResolvedValue({
      review: details({
        status: "APPROVED",
        resolvedAt: "2026-07-25T12:00:00.000Z",
        resolutionCode: "COVERAGE_CONFIRMED",
        resolutionSummary: "Confirmado em campo.",
        sla: { overdue: false, remainingMinutes: null, resolvedWithinSla: true },
        events: [
          details().events[0],
          {
            id: "e2",
            type: "RESOLVED",
            fromStatus: "IN_PROGRESS",
            toStatus: "APPROVED",
            note: null,
            metadata: null,
            createdAt: "2026-07-25T12:00:00.000Z",
            actor: { id: "u-tec", name: "Téo Técnico" },
          },
        ],
      }),
    });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Resultado automático")).toBeTruthy());
    expect(screen.getByText("Viável preliminarmente")).toBeTruthy();
    expect(screen.getByText("Decisão da análise")).toBeTruthy();
    expect(screen.getAllByText("Aprovada").length).toBeGreaterThan(0);
    expect(screen.getByText("Linha do tempo")).toBeTruthy();
    expect(screen.getByText("Análise resolvida")).toBeTruthy();
    expect(screen.getByText(/Concluída dentro do prazo/)).toBeTruthy();
  });

  it("inicia a análise e coloca em aguardando informações", async () => {
    mocked.getReview.mockResolvedValue({ review: details({ assignedTo: { id: "u-tec", name: "Téo Técnico", email: "t@x" } }) });
    mocked.updateReview.mockResolvedValue({ review: details() });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={technician} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Iniciar análise" })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Iniciar análise" }));
    await waitFor(() =>
      expect(mocked.updateReview).toHaveBeenCalledWith("r1", {
        status: "IN_PROGRESS",
        version: 1,
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Aguardar informações" }));
    await waitFor(() =>
      expect(mocked.updateReview).toHaveBeenCalledWith("r1", {
        status: "WAITING_INFORMATION",
        version: 1,
      })
    );
  });

  it("ADMIN atribui técnico pelo seletor", async () => {
    mocked.getReview.mockResolvedValue({ review: details() });
    mocked.assignReview.mockResolvedValue({ review: details() });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Atribuir técnico")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Atribuir técnico"), { target: { value: "u-tec" } });
    fireEvent.click(screen.getByRole("button", { name: "Atribuir" }));
    await waitFor(() =>
      expect(mocked.assignReview).toHaveBeenCalledWith("r1", {
        assignedToId: "u-tec",
        version: 1,
      })
    );
  });

  it("adiciona observação sem tocar em localStorage", async () => {
    mocked.getReview.mockResolvedValue({ review: details() });
    mocked.addReviewNote.mockResolvedValue({ review: details() });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={operator} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Nova observação")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Nova observação"), {
      target: { value: "Cliente confirmou fachada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(mocked.addReviewNote).toHaveBeenCalledWith("r1", {
        note: "Cliente confirmou fachada",
        version: 1,
      })
    );
    expect(window.localStorage.length).toBe(0); // notas e filtros nunca em localStorage
  });

  it("aprovar exige resolução: o modal avisa que o resultado automático não muda", async () => {
    mocked.getReview.mockResolvedValue({
      review: details({
        status: "IN_PROGRESS",
        assignedTo: { id: "u-tec", name: "Téo Técnico", email: "t@x" },
        startedAt: "2026-07-25T10:30:00.000Z",
      }),
    });
    mocked.resolveReview.mockResolvedValue({ review: details({ status: "APPROVED" }) });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={technician} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Aprovar" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar resolução" });
    expect(
      within(dialog).getByText(/resultado automático da consulta não será alterado/)
    ).toBeTruthy();
    // Resumo vazio: envio bloqueado.
    const confirm = within(dialog).getByRole("button", { name: "Confirmar" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Resumo da resolução/), {
      target: { value: "Confirmado pelo técnico em campo." },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocked.resolveReview).toHaveBeenCalledWith("r1", {
        decision: "APPROVED",
        resolutionCode: "COVERAGE_CONFIRMED",
        resolutionSummary: "Confirmado pelo técnico em campo.",
        version: 1,
      })
    );
  });

  it("rejeitar envia decision REJECTED com código próprio", async () => {
    mocked.getReview.mockResolvedValue({
      review: details({
        status: "IN_PROGRESS",
        assignedTo: { id: "u-tec", name: "Téo Técnico", email: "t@x" },
      }),
    });
    mocked.resolveReview.mockResolvedValue({ review: details({ status: "REJECTED" }) });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={technician} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejeitar" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
    const dialog = await screen.findByRole("dialog", { name: "Registrar resolução" });
    fireEvent.change(within(dialog).getByLabelText(/Resumo da resolução/), {
      target: { value: "Sem viabilidade no poste." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(mocked.resolveReview).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ decision: "REJECTED", resolutionCode: "TECHNICAL_RESTRICTION" })
      )
    );
  });

  it("cancelar e reabrir passam por modal de confirmação próprio (sem window.confirm)", async () => {
    mocked.getReview.mockResolvedValue({ review: details() });
    mocked.updateReview.mockResolvedValue({ review: details({ status: "CANCELLED" }) });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancelar análise" })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar análise" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Confirmar ação" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() =>
      expect(mocked.updateReview).toHaveBeenCalledWith("r1", {
        status: "CANCELLED",
        version: 1,
      })
    );

    // Reabrir (análise concluída):
    cleanup();
    mocked.getReview.mockResolvedValue({ review: details({ status: "CANCELLED" }) });
    mocked.reopenReview.mockResolvedValue({ review: details() });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reabrir" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
    const reopenDialog = await screen.findByRole("dialog", { name: "Confirmar ação" });
    fireEvent.click(within(reopenDialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocked.reopenReview).toHaveBeenCalledWith("r1", { version: 1 }));
  });

  it("REVIEW_CONFLICT recarrega os dados e avisa, sem sobrescrever", async () => {
    mocked.getReview.mockResolvedValue({ review: details() });
    mocked.updateReview.mockRejectedValue(
      new ApiError("A análise foi atualizada.", "REVIEW_CONFLICT", 409)
    );
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Iniciar análise" })).toBeTruthy()
    );
    expect(mocked.getReview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar análise" }));
    await waitFor(() =>
      expect(screen.getByText(/atualizada por outra pessoa/)).toBeTruthy()
    );
    expect(mocked.getReview).toHaveBeenCalledTimes(2); // recarregou
  });

  it("VIEWER não vê ações de mutação nos detalhes", async () => {
    mocked.getReview.mockResolvedValue({ review: details() });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={viewer} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Resultado automático")).toBeTruthy());
    for (const name of ["Assumir análise", "Iniciar análise", "Aprovar", "Rejeitar", "Adicionar"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByLabelText("Nova observação")).toBeNull();
  });

  it("OPERATOR comenta mas não resolve nem cancela", async () => {
    mocked.getReview.mockResolvedValue({ review: details({ status: "IN_PROGRESS" }) });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={operator} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Nova observação")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Aprovar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rejeitar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar análise" })).toBeNull();
  });
});

describe("ReviewCreateDialog — encaminhar para análise", () => {
  it("cria a análise com prioridade e observação (técnico só para ADMIN)", async () => {
    mocked.createReview.mockResolvedValue({ review: details() });
    render(
      <ReviewCreateDialog
        consultationId="c1"
        protocol="VIA-20260725-ABCDEFGH"
        addressText="Rua das Filas, 10 — Belo Horizonte/MG"
        currentUser={admin}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("VIA-20260725-ABCDEFGH")).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/Técnico responsável/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Prioridade"), { target: { value: "HIGH" } });
    fireEvent.change(screen.getByLabelText(/Observação inicial/), {
      target: { value: "Encaminhado após contato" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    await waitFor(() =>
      expect(mocked.createReview).toHaveBeenCalledWith({
        consultationId: "c1",
        priority: "HIGH",
        assignedToId: null,
        note: "Encaminhado após contato",
      })
    );
    expect(await screen.findByText("Análise criada com sucesso.")).toBeTruthy();
  });

  it("OPERATOR não vê seletor de técnico; duplicidade mostra mensagem clara", async () => {
    mocked.createReview.mockRejectedValue(
      new ApiError("duplicada", "REVIEW_ALREADY_EXISTS", 409)
    );
    render(
      <ReviewCreateDialog
        consultationId="c1"
        protocol="VIA-20260725-ABCDEFGH"
        addressText="Rua das Filas, 10"
        currentUser={operator}
        onClose={() => {}}
      />
    );
    expect(screen.queryByLabelText(/Técnico responsável/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Encaminhar" }));
    expect(
      await screen.findByText("Esta consulta já possui uma análise técnica.")
    ).toBeTruthy();
  });
});

describe("Dashboard — resumo de análises isolado", () => {
  beforeEach(() => {
    mocked.getDashboardSummary.mockResolvedValue({
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
        consultationsChangePercent: null,
        coverageRateChangePercentagePoints: null,
        averageDurationChangePercent: null,
      },
    } as never);
    mocked.getDashboardTimeline.mockResolvedValue({ granularity: "DAY", points: [] } as never);
    mocked.getDashboardBreakdowns.mockResolvedValue({
      byStatus: [],
      byNetworkReferenceStatus: [],
      byGeocodingConfidence: [],
      byGeocodingLocationType: [],
    } as never);
    mocked.getDashboardRankings.mockResolvedValue({
      partners: [],
      layers: [],
      users: [],
      cities: [],
    } as never);
    mocked.getDashboardRecentConsultations.mockResolvedValue({ consultations: [] } as never);
  });

  it("mostra os cards de análises abertas/atrasadas/sem responsável/atribuídas a mim", async () => {
    render(<DashboardPage currentUser={admin} />);
    await waitFor(() => expect(screen.getByText("Análises abertas")).toBeTruthy());
    expect(screen.getByText("Análises atrasadas")).toBeTruthy();
    expect(screen.getByText("Sem responsável")).toBeTruthy();
    expect(screen.getByText("Atribuídas a mim")).toBeTruthy();
  });

  it("uma falha no resumo de análises NÃO derruba o dashboard principal", async () => {
    mocked.getReviewsSummary.mockRejectedValue(new ApiError("boom", "REVIEW_QUERY_FAILED", 500));
    render(<DashboardPage currentUser={admin} />);
    await waitFor(() =>
      expect(screen.getByText("Não foi possível carregar o resumo das análises.")).toBeTruthy()
    );
    // Os indicadores principais continuam:
    await waitFor(() => expect(screen.getByLabelText("Indicadores principais")).toBeTruthy());
  });
});

describe("segurança do código", () => {
  it("componentes de análises não usam dangerouslySetInnerHTML nem localStorage", () => {
    for (const source of [reviewsPageSource, reviewDetailsSource]) {
      expect(source.includes("dangerouslySetInnerHTML")).toBe(false);
      expect(source.includes("localStorage")).toBe(false);
    }
  });
});
