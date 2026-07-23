import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConsultaPage from "./components/ConsultaPage";
import ConsultationHistoryPage from "./components/ConsultationHistoryPage";
import { resetSessionForTests, SessionUser } from "./auth";

vi.mock("./components/MapView", () => ({
  default: ({ onMarkerAdjusted }: { onMarkerAdjusted?: (p: unknown) => void }) => (
    <button
      type="button"
      data-testid="map-adjust"
      onClick={() => onMarkerAdjusted?.({ latitude: -19.988, longitude: -44.018 })}
    >
      map
    </button>
  ),
}));

const ADMIN = {
  id: "u1",
  name: "Alice Admin",
  email: "alice@teste.local",
  role: "ADMIN",
} as SessionUser;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FetchHandler = (url: string, init?: RequestInit) => Response | null;

function stubFetch(handlers: FetchHandler[]) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const handler of handlers) {
      const response = handler(url, init);
      if (response) return response;
    }
    if (url.includes("/api/coverage/areas")) return jsonResponse(200, { areas: [] });
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "não mapeado" } });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function ambiguousResponse(token: string) {
  return {
    status: "ADDRESS_AMBIGUOUS",
    message: "Confirme a localização no mapa.",
    coverageMatches: [],
    networkReferenceStatus: "NOT_CHECKED",
    networkReferenceMessage: null,
    locationConfirmationToken: token,
    searchedAddress: {
      formattedAddress: "Rua Exemplo, 100",
      latitude: -19.988,
      longitude: -44.018,
      geocodingConfidence: "LOW",
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
    geocoding: {
      formattedAddress: "Rua Exemplo, 100",
      confidence: "LOW",
      partialMatch: true,
      locationType: "APPROXIMATE",
    },
    coverage: { insideCoverage: false, primaryArea: null, matchingAreas: [] },
    nearestNetworkLocation: null,
    alternatives: [],
    requiresTechnicalConfirmation: true,
    analysisBasis: "Base.",
  };
}

function viableConfirmedResponse(protocol: string) {
  return {
    ...ambiguousResponse(""),
    status: "PRELIMINARILY_VIABLE",
    message: "Dentro da cobertura.",
    locationConfirmationToken: undefined,
    searchedAddress: {
      ...ambiguousResponse("").searchedAddress,
      manuallyAdjusted: true,
      geocodingConfidence: null,
    },
    geocoding: undefined,
    consultation: { id: "c1", protocol, createdAt: "2026-07-23T12:00:00.000Z" },
  };
}

async function fillAddress() {
  await userEvent.type(screen.getByLabelText(/Rua \/ logradouro/), "Rua Exemplo");
  await userEvent.type(screen.getByLabelText(/Número/), "100");
  await userEvent.type(screen.getByLabelText(/Cidade/), "Belo Horizonte");
  await userEvent.type(screen.getByLabelText(/UF/), "MG");
}

beforeEach(() => resetSessionForTests());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("token de confirmação de localização", () => {
  it("envia locationConfirmationToken ao confirmar o marcador e limpa tudo em nova consulta", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let checkCount = 0;
    stubFetch([
      (url, init) => {
        if (url.includes("/api/viabilities/check") && init?.method === "POST") {
          checkCount += 1;
          bodies.push(JSON.parse(String(init.body)));
          return jsonResponse(200, ambiguousResponse(`token-${checkCount}`));
        }
        return null;
      },
      (url, init) => {
        if (url.includes("/api/viabilities/confirm-location") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return jsonResponse(200, viableConfirmedResponse("VIA-20260723-NOVO2222"));
        }
        return null;
      },
    ]);
    render(<ConsultaPage />);
    await fillAddress();
    await userEvent.click(screen.getByRole("button", { name: "Buscar endereço" }));
    await screen.findByText("Confirme a localização no mapa.");

    // Confirma o marcador: o corpo leva o token da geocodificação anterior.
    await userEvent.click(
      await screen.findByRole("button", { name: "Confirmar localização e consultar" })
    );
    await screen.findByText("VIA-20260723-NOVO2222");
    const confirmBody = bodies.find((body) => body.adjustedLocation)!;
    expect(confirmBody.locationConfirmationToken).toBe("token-1");

    // Token nunca vai para storage do navegador.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    // Nova consulta (sem ajuste): o protocolo some da tela e o corpo NÃO
    // reutiliza o token anterior.
    await userEvent.click(screen.getByRole("button", { name: "Buscar endereço" }));
    await waitFor(() => {
      expect(screen.queryByText("VIA-20260723-NOVO2222")).toBeNull();
    });
    const newCheckBody = bodies[bodies.length - 1];
    expect(newCheckBody.adjustedLocation).toBeUndefined();
    expect(newCheckBody.locationConfirmationToken).toBeUndefined();
  });

  it("alterar qualquer campo do endereço invalida o token (confirmação seguinte vai sem ele)", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    stubFetch([
      (url, init) => {
        if (url.includes("/api/viabilities/check") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return jsonResponse(200, ambiguousResponse("token-A"));
        }
        return null;
      },
      (url, init) => {
        if (url.includes("/api/viabilities/confirm-location") && init?.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return jsonResponse(400, {
            error: {
              code: "LOCATION_CONFIRMATION_INVALID",
              message: "A confirmação da localização expirou ou é inválida.",
            },
          });
        }
        return null;
      },
    ]);
    render(<ConsultaPage />);
    await fillAddress();
    await userEvent.click(screen.getByRole("button", { name: "Buscar endereço" }));
    await screen.findByText("Confirme a localização no mapa.");

    // Edita o número DEPOIS da geocodificação: token deixa de valer.
    await userEvent.type(screen.getByLabelText(/Número/), "9");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirmar localização e consultar" })
    );

    await waitFor(() => {
      const confirmBody = bodies.find((body) => body.adjustedLocation);
      expect(confirmBody).toBeTruthy();
      expect(confirmBody!.locationConfirmationToken).toBeUndefined();
    });
    // Backend recusa e o frontend orienta a refazer a consulta:
    expect((await screen.findByText(/Refaça a consulta do endereço/)).textContent).toContain(
      "Refaça a consulta"
    );
  });
});

describe("locationType nos detalhes do histórico", () => {
  it("mostra o rótulo pt-BR do tipo de localização", async () => {
    stubFetch([
      (url) =>
        url.includes("/api/consultations/c1")
          ? jsonResponse(200, {
              consultation: {
                id: "c1",
                protocol: "VIA-20260723-ABCD2345",
                status: "PRELIMINARILY_VIABLE",
                resultMessage: "ok",
                createdAt: "2026-07-23T12:00:00.000Z",
                completedAt: null,
                durationMs: 100,
                user: { id: "u2", name: "Otto", email: "otto@teste.local" },
                address: {
                  postalCode: null,
                  street: "Rua Exemplo",
                  number: "100",
                  complement: null,
                  neighborhood: null,
                  city: "Belo Horizonte",
                  state: "MG",
                },
                geocoding: {
                  provider: "google",
                  geocodedAddress: "Rua Exemplo, 100",
                  confidence: "MEDIUM",
                  locationType: "RANGE_INTERPOLATED",
                  partialMatch: false,
                  latitude: -19.98,
                  longitude: -44.01,
                },
                confirmation: {
                  latitude: null,
                  longitude: null,
                  confirmedManually: false,
                  confirmationRequired: false,
                },
                coverage: { matches: [], matchCount: 0, configured: true, snapshotBuiltAt: null },
                network: {
                  status: "NOT_CHECKED",
                  reference: null,
                  alternatives: [],
                  searchRadiusMeters: 300,
                },
                source: "ADDRESS_CHECK",
              },
            })
          : null,
      (url) =>
        url.includes("/api/consultations?")
          ? jsonResponse(200, {
              consultations: [
                {
                  id: "c1",
                  protocol: "VIA-20260723-ABCD2345",
                  status: "PRELIMINARILY_VIABLE",
                  address: {
                    postalCode: null,
                    street: "Rua Exemplo",
                    number: "100",
                    neighborhood: null,
                    city: "Belo Horizonte",
                    state: "MG",
                  },
                  user: { id: "u2", name: "Otto" },
                  coverageMatchCount: 0,
                  networkReferenceStatus: "NOT_CHECKED",
                  createdAt: "2026-07-23T12:00:00.000Z",
                  durationMs: 100,
                },
              ],
              total: 1,
              page: 1,
              limit: 20,
            })
          : null,
    ]);
    render(<ConsultationHistoryPage currentUser={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver detalhes" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Localização aproximada entre números");
  });
});
