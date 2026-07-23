import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoverageAdminPage, { formatFileSize } from "./components/CoverageAdminPage";
import ResultPanel from "./components/ResultPanel";
import { coverageHeaderText } from "./App";
import { resetSessionForTests } from "./auth";
import { AddressViabilityResponse, CoverageLayer, CoveragePartner } from "./types";

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
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "não mapeado" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function makePartner(overrides: Partial<CoveragePartner> = {}): CoveragePartner {
  return {
    id: "p1",
    name: "Rede Neutra",
    code: "REDE_NEUTRA",
    description: null,
    active: true,
    layerCount: 2,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

function makeLayer(overrides: Partial<CoverageLayer> = {}): CoverageLayer {
  return {
    id: "l1",
    partner: { id: "p1", name: "Rede Neutra", code: "REDE_NEUTRA" },
    name: "Cobertura Barreiro",
    description: null,
    version: "2026-07",
    originalFileName: "barreiro.kml",
    fileType: "KML",
    fileSize: 2048,
    sha256: "a".repeat(64),
    active: true,
    processingStatus: "READY",
    polygonCount: 3,
    areaCount: 2,
    ignoredGeometryCount: 0,
    processingError: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

/** Handlers padrão: um parceiro e uma camada; capturam a última query. */
function baseHandlers(state: {
  partners?: CoveragePartner[];
  layers?: CoverageLayer[];
}): FetchHandler[] {
  return [
    (url, init) => {
      if (!url.includes("/api/coverage/partners") || (init?.method && init.method !== "GET")) {
        return null;
      }
      if (/partners\/[^/?]+/.test(url)) return null;
      const partners = state.partners ?? [makePartner()];
      return jsonResponse(200, { partners, total: partners.length, page: 1, limit: 20 });
    },
    (url, init) => {
      if (!url.includes("/api/coverage/layers") || (init?.method && init.method !== "GET")) {
        return null;
      }
      const layers = state.layers ?? [makeLayer()];
      return jsonResponse(200, { layers, total: layers.length, page: 1, limit: 20 });
    },
  ];
}

const noop = () => undefined;

beforeEach(() => resetSessionForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("aba Parceiros", () => {
  it("lista parceiros com nome, código monoespaçado, camadas e status", async () => {
    stubFetch(baseHandlers({}));
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    const row = (await screen.findByText("Rede Neutra")).closest("tr")!;
    expect(within(row).getByText("REDE_NEUTRA").className).toContain("font-mono");
    expect(within(row).getByText("2")).toBeTruthy(); // camadas
    expect(within(row).getByText("Ativo")).toBeTruthy();
  });

  it("cria parceiro pelo modal e recarrega lista + status global", async () => {
    const onCoverageChanged = vi.fn();
    const fetchMock = stubFetch([
      (url, init) =>
        url.endsWith("/api/coverage/partners") && init?.method === "POST"
          ? jsonResponse(201, { partner: makePartner({ id: "p2", name: "Alfa", code: "ALFA" }) })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={onCoverageChanged} />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo parceiro" }));

    const dialog = await screen.findByRole("dialog", { name: "Novo parceiro" });
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Alfa Redes");
    await userEvent.type(within(dialog).getByLabelText("Código"), "alfa");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar parceiro" }));

    await screen.findByText("Parceiro criado.");
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/coverage/partners") && init?.method === "POST"
    )!;
    expect(String(call[1]?.body)).toContain('"code":"alfa"'); // backend normaliza
    expect(onCoverageChanged).toHaveBeenCalled();
  });

  it("edita parceiro preenchendo o formulário com os dados atuais", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/coverage/partners/p1") && init?.method === "PATCH" && !url.includes("status")
          ? jsonResponse(200, { partner: makePartner({ name: "Rede Neutra BH" }) })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: "Editar parceiro" });
    const nameInput = within(dialog).getByLabelText("Nome") as HTMLInputElement;
    expect(nameInput.value).toBe("Rede Neutra");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Rede Neutra BH");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar parceiro" }));
    await screen.findByText("Parceiro atualizado.");
    const call = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/coverage/partners/p1") && init?.method === "PATCH"
    )!;
    expect(String(call[1]?.body)).toContain("Rede Neutra BH");
  });

  it("inativa parceiro somente após a confirmação com o aviso das camadas", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/coverage/partners/p1/status") && init?.method === "PATCH"
          ? jsonResponse(200, { partner: makePartner({ active: false }) })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await userEvent.click(await screen.findByRole("button", { name: "Inativar" }));

    const dialog = await screen.findByRole("dialog", { name: "Inativar parceiro" });
    expect(dialog.textContent).toContain(
      "todas as camadas dele deixarão de participar das consultas de viabilidade"
    );
    // Antes da confirmação, nenhum PATCH foi enviado.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/status"))
    ).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Inativar" }));
    await screen.findByText("Parceiro inativado.");
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/coverage/partners/p1/status")
    )!;
    expect(String(call[1]?.body)).toContain('"active":false');
  });

  it("filtra por status e busca com botão, voltando à página 1", async () => {
    const queries: string[] = [];
    stubFetch([
      (url, init) => {
        if (!url.includes("/api/coverage/partners") || (init?.method && init.method !== "GET")) {
          return null;
        }
        queries.push(url);
        return jsonResponse(200, { partners: [makePartner()], total: 1, page: 1, limit: 20 });
      },
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await screen.findByText("Rede Neutra");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "false");
    await userEvent.type(screen.getByLabelText("Buscar"), "neutra");
    await userEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => {
      const last = queries[queries.length - 1];
      expect(last).toContain("active=false");
      expect(last).toContain("search=neutra");
      expect(last).toContain("page=1");
      expect(last).toContain("limit=20");
    });
  });

  it("pagina parceiros com Math.ceil(total/limit)", async () => {
    const queries: string[] = [];
    const partnersPage = Array.from({ length: 20 }, (_, index) =>
      makePartner({ id: `p${index}`, name: `Parceiro ${index}`, code: `P${index}` })
    );
    stubFetch([
      (url, init) => {
        if (!url.includes("/api/coverage/partners") || (init?.method && init.method !== "GET")) {
          return null;
        }
        queries.push(url);
        return jsonResponse(200, { partners: partnersPage, total: 25, page: 1, limit: 20 });
      },
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await screen.findByText(/página 1 de 2/); // ceil(25/20) = 2
    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => {
      expect(queries[queries.length - 1]).toContain("page=2");
    });
  });
});

describe("aba Camadas", () => {
  async function openLayersTab() {
    await userEvent.click(await screen.findByRole("tab", { name: "Camadas" }));
  }

  it("lista camadas READY com badge, tamanho legível e sem storedFileName", async () => {
    stubFetch(baseHandlers({}));
    const { container } = render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();
    const row = (await screen.findByText("Cobertura Barreiro")).closest("tr")!;
    expect(within(row).getByText("Pronta")).toBeTruthy();
    expect(within(row).getByText(/KML · 2\.0 KB/)).toBeTruthy();
    expect(within(row).getByText("2026-07")).toBeTruthy();
    // Nunca expor nome interno/caminho físico (nem existe no payload).
    expect(container.innerHTML).not.toContain("storedFileName");
    expect(container.innerHTML).not.toContain("storage/coverage");
  });

  it("camada FAILED mostra o motivo em detalhes expansíveis, sem tratar como erro global", async () => {
    stubFetch(
      baseHandlers({
        layers: [
          makeLayer({
            id: "l2",
            name: "Quebrada",
            processingStatus: "FAILED",
            processingError: "nenhum polígono válido encontrado no arquivo",
            active: false,
          }),
        ],
      })
    );
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();
    const row = (await screen.findByText("Quebrada")).closest("tr")!;
    expect(within(row).getByText("Falhou")).toBeTruthy();
    expect(screen.queryByText("nenhum polígono válido encontrado no arquivo")).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Ver motivo" }));
    expect(within(row).getByText("nenhum polígono válido encontrado no arquivo")).toBeTruthy();
    // Não é erro geral da aplicação:
    expect(screen.queryByRole("alert")).toBeNull();
    // FAILED não pode ser ativada visualmente.
    expect(
      (within(row).getByRole("button", { name: "Ativar" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("filtra por parceiro e por processingStatus", async () => {
    const queries: string[] = [];
    stubFetch([
      (url, init) => {
        if (!url.includes("/api/coverage/layers") || (init?.method && init.method !== "GET")) {
          return null;
        }
        queries.push(url);
        return jsonResponse(200, { layers: [makeLayer()], total: 1, page: 1, limit: 20 });
      },
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();
    await screen.findByText("Cobertura Barreiro");
    await userEvent.selectOptions(await screen.findByLabelText("Parceiro"), "p1");
    await waitFor(() => expect(queries[queries.length - 1]).toContain("partnerId=p1"));
    await userEvent.selectOptions(screen.getByLabelText("Processamento"), "FAILED");
    await waitFor(() => {
      expect(queries[queries.length - 1]).toContain("processingStatus=FAILED");
      expect(queries[queries.length - 1]).toContain("page=1"); // filtro volta à página 1
    });
  });

  it("edita nome e versão da camada sem oferecer troca de arquivo ou parceiro", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/coverage/layers/l1") && init?.method === "PATCH" && !url.includes("status")
          ? jsonResponse(200, { layer: makeLayer({ name: "Novo nome", version: "2026-08" }) })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();
    await userEvent.click(await screen.findByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog", { name: /Editar camada/ });
    expect(dialog.textContent).toContain("O arquivo e o parceiro não podem ser alterados");
    expect(within(dialog).queryByLabelText(/Arquivo/)).toBeNull(); // sem campo de arquivo

    const nameInput = within(dialog).getByLabelText("Nome") as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Novo nome");
    const versionInput = within(dialog).getByLabelText("Versão") as HTMLInputElement;
    await userEvent.clear(versionInput);
    await userEvent.type(versionInput, "2026-08");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar camada" }));
    await screen.findByText("Camada atualizada.");
    const call = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/api/coverage/layers/l1") && init?.method === "PATCH"
    )!;
    expect(String(call[1]?.body)).toContain("Novo nome");
    expect(String(call[1]?.body)).toContain("2026-08");
  });

  it("ativa e inativa camada com as confirmações e sem alteração otimista", async () => {
    let active = false;
    const fetchMock = stubFetch([
      (url, init) => {
        if (url.includes("/api/coverage/layers/l1/status") && init?.method === "PATCH") {
          active = JSON.parse(String(init.body)).active;
          return jsonResponse(200, { layer: makeLayer({ active }) });
        }
        return null;
      },
      (url, init) => {
        if (!url.includes("/api/coverage/layers") || (init?.method && init.method !== "GET")) {
          return null;
        }
        return jsonResponse(200, {
          layers: [makeLayer({ active })],
          total: 1,
          page: 1,
          limit: 20,
        });
      },
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();

    // Ativar (camada READY inativa)
    await userEvent.click(await screen.findByRole("button", { name: "Ativar" }));
    const activateDialog = await screen.findByRole("dialog", { name: "Ativar camada" });
    expect(activateDialog.textContent).toContain(
      "voltará a participar das consultas de viabilidade"
    );
    await userEvent.click(within(activateDialog).getByRole("button", { name: "Ativar" }));
    await screen.findByText("Camada ativada.");

    // Inativar
    await userEvent.click(await screen.findByRole("button", { name: "Inativar" }));
    const deactivateDialog = await screen.findByRole("dialog", { name: "Inativar camada" });
    expect(deactivateDialog.textContent).toContain(
      "deixará de participar das consultas de viabilidade"
    );
    await userEvent.click(within(deactivateDialog).getByRole("button", { name: "Inativar" }));
    await screen.findByText("Camada inativada.");

    const statusCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/layers/l1/status")
    );
    expect(statusCalls).toHaveLength(2);
  });

  it("exclui camada somente após confirmação com nome, parceiro e arquivo", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.includes("/api/coverage/layers/l1") && init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();
    await userEvent.click(await screen.findByRole("button", { name: "Excluir" }));

    const dialog = await screen.findByRole("dialog", { name: "Excluir camada" });
    expect(dialog.textContent).toContain("Cobertura Barreiro");
    expect(dialog.textContent).toContain("Rede Neutra");
    expect(dialog.textContent).toContain("barreiro.kml");
    expect(dialog.textContent).toContain("Esta ação não pode ser desfeita");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Excluir camada" }));
    await screen.findByText("Camada excluída.");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("botão Excluir fica desabilitado durante PROCESSING", async () => {
    stubFetch(
      baseHandlers({
        layers: [makeLayer({ processingStatus: "PROCESSING", name: "Em processamento" })],
      })
    );
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await openLayersTab();
    const row = (await screen.findByText("Em processamento")).closest("tr")!;
    expect(
      (within(row).getByRole("button", { name: "Excluir" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("reload manual pede confirmação e mostra o resumo retornado", async () => {
    const onCoverageChanged = vi.fn();
    stubFetch([
      (url, init) =>
        url.includes("/api/coverage/reload") && init?.method === "POST"
          ? jsonResponse(200, {
              reloaded: true,
              totalPartners: 2,
              totalLayers: 4,
              totalAreas: 34,
              totalPolygons: 34,
              durationMs: 120,
            })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={onCoverageChanged} />);
    await userEvent.click(await screen.findByRole("button", { name: "Recarregar coberturas" }));
    const dialog = await screen.findByRole("dialog", { name: "Recarregar coberturas" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Recarregar" }));
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("2 parceiro(s)");
    expect(notice.textContent).toContain("4 camada(s)");
    expect(notice.textContent).toContain("34 área(s)");
    expect(notice.textContent).toContain("120 ms");
    expect(onCoverageChanged).toHaveBeenCalled(); // cabeçalho atualizado (cenário 29)
  });
});

describe("modal de upload", () => {
  async function openUploadModal() {
    await userEvent.click(await screen.findByRole("tab", { name: "Camadas" }));
    await userEvent.click(await screen.findByRole("button", { name: "Enviar KML/KMZ" }));
    return screen.findByRole("dialog", { name: "Enviar camada KML/KMZ" });
  }

  it("impede envio sem parceiro e sem arquivo, com mensagens claras", async () => {
    const fetchMock = stubFetch(baseHandlers({}));
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    const dialog = await openUploadModal();

    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar camada" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Selecione o parceiro.");

    await userEvent.selectOptions(within(dialog).getByLabelText("Parceiro"), "p1");
    await userEvent.type(within(dialog).getByLabelText("Nome da camada"), "Norte");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar camada" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Selecione o arquivo KML ou KMZ."
    );
    // Nenhum POST de camada disparado.
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith("/api/coverage/layers") && init?.method === "POST"
      )
    ).toBe(false);
  });

  it("rejeita extensão inválida no frontend antes de chamar a API", async () => {
    const fetchMock = stubFetch(baseHandlers({}));
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    const dialog = await openUploadModal();
    await userEvent.selectOptions(within(dialog).getByLabelText("Parceiro"), "p1");
    await userEvent.type(within(dialog).getByLabelText("Nome da camada"), "Norte");
    const wrongFile = new File(["conteudo"], "mancha.txt", { type: "text/plain" });
    // applyAccept: false — simula seleção que burla o accept do input.
    await userEvent.upload(within(dialog).getByLabelText("Arquivo KML/KMZ"), wrongFile, {
      applyAccept: false,
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar camada" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      ".kml ou .kmz"
    );
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST")
    ).toBe(false);
  });

  it("envia FormData com file/partnerId/name, sem Content-Type manual, e mostra as estatísticas", async () => {
    const fetchMock = stubFetch([
      (url, init) =>
        url.endsWith("/api/coverage/layers") && init?.method === "POST"
          ? jsonResponse(201, { layer: makeLayer({ areaCount: 5, polygonCount: 7 }) })
          : null,
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    const dialog = await openUploadModal();
    await userEvent.selectOptions(within(dialog).getByLabelText("Parceiro"), "p1");
    await userEvent.type(within(dialog).getByLabelText("Nome da camada"), "Norte");
    const file = new File(["<kml></kml>"], "norte.kml", {
      type: "application/vnd.google-earth.kml+xml",
    });
    await userEvent.upload(within(dialog).getByLabelText("Arquivo KML/KMZ"), file);
    expect(dialog.textContent).toContain("norte.kml"); // nome e tamanho exibidos
    expect(dialog.textContent).toContain("11 B");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar camada" }));

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("5 área(s)");
    expect(notice.textContent).toContain("7 polígono(s)");
    expect(screen.queryByRole("dialog", { name: "Enviar camada KML/KMZ" })).toBeNull();

    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/coverage/layers") && init?.method === "POST"
    )!;
    const body = call[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("partnerId")).toBe("p1");
    expect(body.get("name")).toBe("Norte");
    expect((body.get("file") as File).name).toBe("norte.kml");
    // Content-Type NÃO definido manualmente: o navegador adiciona o boundary.
    const headers = new Headers(call[1]?.headers);
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("exibe COVERAGE_FILE_DUPLICATE e COVERAGE_FILE_TOO_LARGE vindos da API", async () => {
    let attempt = 0;
    stubFetch([
      (url, init) => {
        if (url.endsWith("/api/coverage/layers") && init?.method === "POST") {
          attempt += 1;
          return attempt === 1
            ? jsonResponse(409, {
                error: {
                  code: "COVERAGE_FILE_DUPLICATE",
                  message: "Este arquivo já foi importado (mesmo SHA-256).",
                },
              })
            : jsonResponse(400, {
                error: {
                  code: "COVERAGE_FILE_TOO_LARGE",
                  message: "O arquivo excede o limite de 25 MB.",
                },
              });
        }
        return null;
      },
      ...baseHandlers({}),
    ]);
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    const dialog = await openUploadModal();
    await userEvent.selectOptions(within(dialog).getByLabelText("Parceiro"), "p1");
    await userEvent.type(within(dialog).getByLabelText("Nome da camada"), "Norte");
    const file = new File(["<kml></kml>"], "norte.kml", { type: "text/xml" });
    await userEvent.upload(within(dialog).getByLabelText("Arquivo KML/KMZ"), file);

    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar camada" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Este arquivo já foi importado (mesmo SHA-256)."
    );

    await userEvent.click(within(dialog).getByRole("button", { name: "Enviar camada" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "O arquivo excede o limite de 25 MB."
      );
    });
  });
});

describe("resultado da consulta (coverageMatches)", () => {
  function makeResult(overrides: Partial<AddressViabilityResponse>): AddressViabilityResponse {
    return {
      status: "PRELIMINARILY_VIABLE",
      message: "O endereço está dentro da área de cobertura e possui viabilidade preliminar.",
      coverageMatches: [],
      networkReferenceStatus: "NOT_FOUND",
      networkReferenceMessage:
        "Não foi possível identificar automaticamente um ponto de rede próximo no Voalle.",
      searchedAddress: {
        formattedAddress: "Rua Teste, 100 - Barreiro, Belo Horizonte - MG",
        latitude: -19.98,
        longitude: -44.01,
        geocodingConfidence: "HIGH",
        manuallyAdjusted: false,
        input: {
          postalCode: null,
          street: "Rua Teste",
          number: "100",
          complement: null,
          neighborhood: "Barreiro",
          city: "Belo Horizonte",
          state: "MG",
          country: "Brasil",
        },
      },
      coverage: { insideCoverage: true, primaryArea: null, matchingAreas: [] },
      nearestNetworkLocation: null,
      alternatives: [],
      requiresTechnicalConfirmation: true,
      analysisBasis: "A mancha KML/KMZ é a fonte oficial da cobertura.",
      ...overrides,
    } as AddressViabilityResponse;
  }

  it("mostra múltiplos coverageMatches com parceiro, camada e versão — sem IDs internos", async () => {
    const result = makeResult({
      coverageMatches: [
        {
          partnerId: "11111111-aaaa-bbbb-cccc-222222222222",
          partnerName: "Rede Neutra",
          layerId: "33333333-dddd-eeee-ffff-444444444444",
          layerName: "Cobertura Barreiro",
          version: "2026-07",
        },
        {
          partnerId: "55555555-aaaa-bbbb-cccc-666666666666",
          partnerName: "Parceiro B",
          layerId: "77777777-dddd-eeee-ffff-888888888888",
          layerName: "Sobreposta B",
          version: null,
        },
      ],
    });
    const { container } = render(<ResultPanel result={result} />);
    expect(screen.getByText("Coberturas encontradas")).toBeTruthy();
    expect(screen.getByText("Rede Neutra")).toBeTruthy();
    expect(screen.getByText(/Cobertura Barreiro · versão 2026-07/)).toBeTruthy();
    expect(screen.getByText("Parceiro B")).toBeTruthy();
    expect(screen.getByText("Sobreposta B")).toBeTruthy(); // sem "versão" quando null
    // IDs internos jamais aparecem para o operador.
    expect(container.innerHTML).not.toContain("11111111-aaaa");
    expect(container.innerHTML).not.toContain("77777777-dddd");
    // Ausência de referência do Voalle continua apenas complementar.
    expect(screen.getByText("Viável preliminarmente")).toBeTruthy();
    expect(
      screen.getByText(/Não foi possível identificar automaticamente um ponto de rede/)
    ).toBeTruthy();
  });

  it("exibe COVERAGE_NOT_CONFIGURED com o próprio rótulo e a mensagem do backend", async () => {
    const result = makeResult({
      status: "COVERAGE_NOT_CONFIGURED",
      message:
        "Nenhuma cobertura está configurada no momento. Cadastre e ative pelo menos uma camada de cobertura.",
      coverageMatches: [],
      coverage: { insideCoverage: false, primaryArea: null, matchingAreas: [] },
      requiresTechnicalConfirmation: false,
      networkReferenceStatus: "NOT_CHECKED",
      networkReferenceMessage: null,
    });
    render(<ResultPanel result={result} />);
    expect(screen.getByText("Cobertura não configurada")).toBeTruthy();
    expect(screen.queryByText("Cobertura indisponível")).toBeNull(); // não usa o fallback
    expect(
      screen.getByText(/Nenhuma cobertura está configurada no momento/)
    ).toBeTruthy();
  });
});

describe("cabeçalho e segurança", () => {
  it("monta o texto do cabeçalho para configurado, não configurado e indisponível", () => {
    expect(
      coverageHeaderText({
        configured: true,
        builtAt: "2026-07-23T00:00:00.000Z",
        totalPartners: 2,
        totalLayers: 4,
        totalAreas: 34,
        totalPolygons: 34,
        loaded: true,
        sourceFile: "4 camadas ativas",
      })
    ).toBe("2 parceiro(s) · 4 camada(s) · 34 área(s) · 34 polígono(s)");
    expect(
      coverageHeaderText({
        configured: false,
        builtAt: null,
        totalPartners: 0,
        totalLayers: 0,
        totalAreas: 0,
        totalPolygons: 0,
        loaded: false,
        sourceFile: null,
      })
    ).toBe("Nenhuma cobertura configurada");
    expect(coverageHeaderText(null)).toBe("Status da cobertura indisponível");
  });

  it("não armazena o access token em localStorage/sessionStorage após operações", async () => {
    stubFetch(baseHandlers({}));
    render(<CoverageAdminPage onCoverageChanged={noop} />);
    await screen.findByText("Rede Neutra");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("formatFileSize cobre B, KB e MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
