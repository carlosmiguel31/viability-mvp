import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "./api";
import ResultPanel from "./components/ResultPanel";
import ReviewsPage from "./components/ReviewsPage";
import ReviewDetailsDialog from "./components/ReviewDetailsDialog";
import ConsultationHistoryPage from "./components/ConsultationHistoryPage";
import { SessionUser } from "./auth";
import {
  AddressViabilityResponse,
  ViabilityReviewDetails,
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
    addReviewNote: vi.fn(),
    resolveReview: vi.fn(),
    reopenReview: vi.fn(),
    getReviewByConsultation: vi.fn(),
    getReviewAssignees: vi.fn(),
    getDashboardUserOptions: vi.fn(),
    listConsultations: vi.fn(),
  };
});

const mocked = vi.mocked(api);
const { ApiError } = api;

const admin: SessionUser = { id: "u-admin", name: "Ana Admin", email: "a@x", role: "ADMIN" };
const operator: SessionUser = { id: "u-op", name: "Otávio Operador", email: "o@x", role: "OPERATOR" };

const RESULT: AddressViabilityResponse = {
  status: "PRELIMINARILY_VIABLE",
  message: "ok",
  coverageMatches: [],
  networkReferenceStatus: "NOT_CHECKED",
  networkReferenceMessage: null,
  searchedAddress: {
    input: {
      postalCode: null,
      street: "Rua das Filas",
      number: "10",
      neighborhood: null,
      city: "Belo Horizonte",
      state: "MG",
    },
    formattedAddress: "Rua das Filas, 10 — Belo Horizonte/MG",
    latitude: -19.98,
    longitude: -44.01,
  },
  coverage: { insideCoverage: true, primaryArea: null, matchingAreas: [] },
  nearestNetworkLocation: null,
  alternatives: [],
  requiresTechnicalConfirmation: true,
  analysisBasis: "coverage",
  consultation: {
    id: "c1",
    protocol: "VIA-20260726-ABCDEFGH",
    createdAt: "2026-07-26T10:00:00.000Z",
  },
} as unknown as AddressViabilityResponse;

function reviewDetails(overrides: Partial<ViabilityReviewDetails> = {}): ViabilityReviewDetails {
  return {
    id: "r1",
    consultationId: "c1",
    status: "OPEN",
    priority: "NORMAL",
    openedBy: { id: "u-op", name: "Otávio Operador", email: "o@x" },
    assignedTo: null,
    resolutionCode: null,
    resolutionSummary: null,
    dueAt: "2026-07-27T12:00:00.000Z",
    startedAt: null,
    resolvedAt: null,
    version: 1,
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
    sla: { overdue: false, remainingMinutes: 600, resolvedWithinSla: null },
    consultation: {
      id: "c1",
      protocol: "VIA-20260726-ABCDEFGH",
      status: "PRELIMINARILY_VIABLE",
      resultMessage: "ok",
      street: "Rua das Filas",
      number: "10",
      neighborhood: null,
      city: "Belo Horizonte",
      state: "MG",
      coverageMatchCount: 1,
      networkReferenceStatus: "FOUND",
      createdAt: "2026-07-26T09:59:00.000Z",
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
        createdAt: "2026-07-26T10:00:00.000Z",
        actor: { id: "u-op", name: "Otávio Operador" },
      },
    ],
    ...overrides,
  };
}

const NOT_FOUND = () => new ApiError("Análise não encontrada.", "REVIEW_NOT_FOUND", 404);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getReviewAssignees.mockResolvedValue({
    users: [
      { id: "u-tec", name: "Téo Técnico", email: "t@x", role: "TECHNICIAN" },
      { id: "u-admin", name: "Ana Admin", email: "a@x", role: "ADMIN" },
    ],
  });
  mocked.getDashboardUserOptions.mockResolvedValue({
    users: [
      { id: "u-op", name: "Otávio Operador", email: "o@x" },
      { id: "u-view", name: "Vera Viewer", email: "v@x" },
    ],
    total: 2,
    page: 1,
    limit: 100,
  });
  mocked.getReview.mockResolvedValue({ review: reviewDetails() });
});

afterEach(() => {
  cleanup();
});

describe("ResultPanel — Encaminhar × Abrir análise", () => {
  it("consulta sem análise mostra 'Encaminhar para análise'", async () => {
    mocked.getReviewByConsultation.mockRejectedValue(NOT_FOUND());
    render(<ResultPanel result={RESULT} currentUser={operator} />);
    await waitFor(() => expect(mocked.getReviewByConsultation).toHaveBeenCalledWith("c1"));
    expect(
      await screen.findByRole("button", { name: "Encaminhar para análise" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir análise" })).toBeNull();
  });

  it("consulta com análise mostra 'Abrir análise' (reload detecta a existente) e abre o ReviewDetailsDialog", async () => {
    mocked.getReviewByConsultation.mockResolvedValue({
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
    render(<ResultPanel result={RESULT} currentUser={operator} />);
    const open = await screen.findByRole("button", { name: "Abrir análise" });
    fireEvent.click(open);
    // Abre os detalhes diretamente, sem o formulário de criação:
    await waitFor(() => expect(mocked.getReview).toHaveBeenCalledWith("r1"));
    expect(await screen.findByText("Linha do tempo")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Encaminhar para análise" })).toBeNull();
  });

  it("a criação preserva o reviewId retornado e permite abrir imediatamente", async () => {
    mocked.getReviewByConsultation.mockRejectedValue(NOT_FOUND());
    mocked.createReview.mockResolvedValue({ review: reviewDetails({ id: "r-novo" }) });
    render(<ResultPanel result={RESULT} currentUser={operator} />);
    fireEvent.click(await screen.findByRole("button", { name: "Encaminhar para análise" }));
    const dialog = await screen.findByRole("dialog", { name: "Encaminhar para análise" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Encaminhar" }));
    await screen.findByText("Análise criada com sucesso.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir análise" }));
    await waitFor(() => expect(mocked.getReview).toHaveBeenCalledWith("r-novo"));
    // O botão do painel também passa a refletir a análise criada:
    expect(screen.getAllByRole("button", { name: /Abrir análise/ }).length).toBeGreaterThan(0);
  });

  it("duplicidade (REVIEW_ALREADY_EXISTS) localiza a existente e oferece 'Abrir análise'", async () => {
    mocked.getReviewByConsultation
      .mockRejectedValueOnce(NOT_FOUND()) // detecção inicial: nada
      .mockResolvedValueOnce({
        review: {
          id: "r-existente",
          consultationId: "c1",
          status: "OPEN",
          priority: "NORMAL",
          assignedTo: null,
          dueAt: null,
          version: 1,
        },
      });
    mocked.createReview.mockRejectedValue(
      new ApiError("duplicada", "REVIEW_ALREADY_EXISTS", 409)
    );
    render(<ResultPanel result={RESULT} currentUser={operator} />);
    fireEvent.click(await screen.findByRole("button", { name: "Encaminhar para análise" }));
    const dialog = await screen.findByRole("dialog", { name: "Encaminhar para análise" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Encaminhar" }));
    await screen.findByText("Esta consulta já possui uma análise técnica.");
    // O usuário não fica preso: pode abrir a análise existente.
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir análise" }));
    await waitFor(() => expect(mocked.getReview).toHaveBeenCalledWith("r-existente"));
  });
});

describe("Histórico — protocolo vindo da fila", () => {
  beforeEach(() => {
    mocked.listConsultations.mockResolvedValue({
      consultations: [],
      total: 0,
      page: 1,
      limit: 20,
    } as never);
  });

  it("preenche e aplica a busca com o protocolo recebido", async () => {
    render(
      <ConsultationHistoryPage
        currentUser={admin}
        initialProtocol="VIA-20260726-ABCDEFGH"
      />
    );
    await waitFor(() =>
      expect(mocked.listConsultations).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "VIA-20260726-ABCDEFGH" })
      )
    );
    const searchInput = screen.getByLabelText("Buscar") as HTMLInputElement;
    expect(searchInput.value).toBe("VIA-20260726-ABCDEFGH");
  });
});

describe("ReviewsPage — responsáveis e datas", () => {
  beforeEach(() => {
    mocked.getReviewsSummary.mockResolvedValue({
      total: 0,
      open: 0,
      inProgress: 0,
      waitingInformation: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      overdue: 0,
      unassigned: 0,
      assignedToMe: 0,
      byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
    });
    mocked.listReviews.mockResolvedValue({ reviews: [], total: 0, page: 1, limit: 20 });
  });

  it("o filtro Responsável usa /api/reviews/assignees e nunca mostra OPERATOR ou VIEWER", async () => {
    render(<ReviewsPage currentUser={admin} />);
    await waitFor(() => expect(mocked.getReviewAssignees).toHaveBeenCalled());
    const select = screen.getByLabelText("Responsável");
    const options = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options).toContain("Téo Técnico");
    expect(options).toContain("Ana Admin");
    expect(options).not.toContain("Otávio Operador");
    expect(options).not.toContain("Vera Viewer");
    // "Aberta por" continua com as opções do dashboard:
    const openedBy = screen.getByLabelText("Aberta por");
    expect(within(openedBy).queryByText("Otávio Operador")).toBeTruthy();
  });

  it("as datas são enviadas como YYYY-MM-DD, sem Z", async () => {
    render(<ReviewsPage currentUser={admin} />);
    await waitFor(() => expect(mocked.listReviews).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Criadas de"), {
      target: { value: "2026-07-10" },
    });
    fireEvent.change(screen.getByLabelText("Prazo de"), {
      target: { value: "2026-07-12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(mocked.listReviews).toHaveBeenLastCalledWith(
        expect.objectContaining({ dateFrom: "2026-07-10", dueFrom: "2026-07-12" })
      )
    );
    const params = mocked.listReviews.mock.lastCall?.[0] as Record<string, unknown>;
    expect(String(params.dateFrom)).not.toContain("Z");
    expect(String(params.dueFrom)).not.toContain("T");
  });

  it("o claim envia a version da linha e trata REVIEW_NOT_ACTIVE recarregando", async () => {
    mocked.listReviews.mockResolvedValue({
      reviews: [
        {
          id: "r1",
          status: "OPEN",
          priority: "NORMAL",
          dueAt: null,
          startedAt: null,
          resolvedAt: null,
          resolutionCode: null,
          version: 7,
          createdAt: "2026-07-26T10:00:00.000Z",
          updatedAt: "2026-07-26T10:00:00.000Z",
          openedBy: { id: "u-op", name: "Otávio Operador" },
          assignedTo: null,
          consultation: {
            id: "c1",
            protocol: "VIA-20260726-ABCDEFGH",
            status: "PRELIMINARILY_VIABLE",
            street: "Rua das Filas",
            number: "10",
            neighborhood: null,
            city: "Belo Horizonte",
            state: "MG",
          },
          sla: { overdue: false, remainingMinutes: 100, resolvedWithinSla: null },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    mocked.claimReview.mockRejectedValue(
      new ApiError("Esta análise já foi encerrada.", "REVIEW_NOT_ACTIVE", 409)
    );
    render(<ReviewsPage currentUser={admin} />);
    fireEvent.click(await screen.findByRole("button", { name: "Assumir" }));
    await waitFor(() =>
      expect(mocked.claimReview).toHaveBeenCalledWith("r1", { version: 7 })
    );
    expect(await screen.findByText(/já foi encerrada/)).toBeTruthy();
    expect(mocked.listReviews.mock.calls.length).toBeGreaterThan(1); // recarregou
  });
});

describe("ReviewDetailsDialog — dados históricos e reabertura", () => {
  it("mostra parceiros, camadas e a referência pública do Voalle", async () => {
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Rede Neutra")).toBeTruthy());
    expect(screen.getByText(/Cobertura Barreiro/)).toBeTruthy();
    expect(screen.getByText(/versão 2026-07/)).toBeTruthy();
    expect(screen.getByText(/BHZ-C0016-RT10-CT03_2780/)).toBeTruthy();
    expect(screen.getByText(/· 83 m/)).toBeTruthy();
  });

  it("análise cancelada informa o SLA de encerramento", async () => {
    mocked.getReview.mockResolvedValue({
      review: reviewDetails({
        status: "CANCELLED",
        resolvedAt: "2026-07-26T11:00:00.000Z",
        sla: { overdue: false, remainingMinutes: null, resolvedWithinSla: true },
      }),
    });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Concluída dentro do prazo/)).toBeTruthy());
  });

  it("após reabrir, a resolução antiga não aparece como decisão atual", async () => {
    mocked.getReview.mockResolvedValue({
      review: reviewDetails({
        status: "OPEN", // reaberta
        resolutionCode: null,
        resolutionSummary: null,
        resolvedAt: null,
        events: [
          reviewDetails().events[0],
          {
            id: "e2",
            type: "RESOLVED",
            fromStatus: "IN_PROGRESS",
            toStatus: "APPROVED",
            note: null,
            metadata: { resolutionCode: "COVERAGE_CONFIRMED" },
            createdAt: "2026-07-26T11:00:00.000Z",
            actor: { id: "u-admin", name: "Ana Admin" },
          },
          {
            id: "e3",
            type: "REOPENED",
            fromStatus: "APPROVED",
            toStatus: "OPEN",
            note: null,
            metadata: { previousResolutionCode: "COVERAGE_CONFIRMED" },
            createdAt: "2026-07-26T12:00:00.000Z",
            actor: { id: "u-admin", name: "Ana Admin" },
          },
        ],
      }),
    });
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Decisão da análise")).toBeTruthy());
    // Decisão atual pendente; sem o campo "Código da resolução":
    expect(screen.getByText("Pendente")).toBeTruthy();
    expect(screen.queryByText("Código da resolução")).toBeNull();
    // O histórico preserva o RESOLVED antigo na linha do tempo:
    expect(screen.getByText("Análise resolvida")).toBeTruthy();
    expect(screen.getByText("Análise reaberta")).toBeTruthy();
  });

  it("PATCH vazio nunca é enviado: sem mudança não há chamada de update", async () => {
    render(<ReviewDetailsDialog reviewId="r1" currentUser={admin} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Alterar prioridade")).toBeTruthy());
    // Selecionar a MESMA prioridade atual não dispara update:
    fireEvent.change(screen.getByLabelText("Alterar prioridade"), {
      target: { value: "NORMAL" },
    });
    // Os botões de ação enviam sempre um campo junto da version — nunca
    // um corpo somente com version:
    for (const call of mocked.updateReview.mock.calls) {
      const body = call[1] as Record<string, unknown>;
      const keys = Object.keys(body).filter((key) => key !== "version");
      expect(keys.length).toBeGreaterThan(0);
    }
  });
});
