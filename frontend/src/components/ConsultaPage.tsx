import { useEffect, useState } from "react";
import MapView from "./MapView";
import ResultPanel from "./ResultPanel";
import AddressForm from "./AddressForm";
import { ApiError, checkViabilityByAddress, fetchCoverageAreas } from "../api";
import {
  AddressFormValues,
  AddressViabilityResponse,
  CoverageAreaWithPolygons,
  GeographicCoordinate,
} from "../types";

const EMPTY_ADDRESS: AddressFormValues = {
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};

/** Fluxo de consulta de viabilidade (inalterado na v0.2.0, agora autenticado). */
export default function ConsultaPage() {
  const [address, setAddress] = useState<AddressFormValues>(EMPTY_ADDRESS);
  const [result, setResult] = useState<AddressViabilityResponse | null>(null);
  // Token opaco da confirmacao de localizacao: SOMENTE em memoria (nunca em
  // localStorage/sessionStorage) e invalidado ao editar o endereco.
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [coverageAreas, setCoverageAreas] = useState<CoverageAreaWithPolygons[] | null>(null);
  const [markerPosition, setMarkerPosition] = useState<GeographicCoordinate | null>(null);

  function handleAddressChange(next: AddressFormValues) {
    // Qualquer alteração no endereço invalida o token de confirmação: ele é
    // vinculado (por hash) ao endereço geocodificado originalmente.
    setConfirmationToken(null);
    setAddress(next);
  }

  function handleAddressPatch(patch: (previous: AddressFormValues) => AddressFormValues) {
    setConfirmationToken(null);
    setAddress(patch);
  }
  const [markerAdjusted, setMarkerAdjusted] = useState(false);

  useEffect(() => {
    fetchCoverageAreas()
      .then((data) => setCoverageAreas(data.areas))
      .catch(() => setCoverageAreas(null));
  }, []);

  async function runCheck(adjusted?: GeographicCoordinate) {
    setError(null);
    // Nova consulta: o resultado (e o protocolo) anterior deixa a tela já
    // no início — nunca se reutiliza protocolo entre consultas.
    setResult(null);
    if (!adjusted) setConfirmationToken(null); // consulta nova = token novo
    setLoading(true);
    try {
      const response = await checkViabilityByAddress(
        address,
        adjusted,
        adjusted ? (confirmationToken ?? undefined) : undefined
      );
      setResult(response);
      setConfirmationToken(response.locationConfirmationToken ?? null);
      const { latitude, longitude } = response.searchedAddress;
      if (latitude !== null && longitude !== null) {
        setMarkerPosition({ latitude, longitude });
      }
      setMarkerAdjusted(Boolean(adjusted));
    } catch (err) {
      setResult(null);
      if (err instanceof ApiError && err.code === "LOCATION_CONFIRMATION_INVALID") {
        setConfirmationToken(null);
        setError(
          "A confirmação da localização expirou ou é inválida. Refaça a consulta do endereço para gerar uma nova."
        );
      } else {
        setError(err instanceof Error ? err.message : "Falha ao consultar viabilidade.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    setMarkerAdjusted(false);
    void runCheck();
  }

  function handleMarkerAdjusted(position: GeographicCoordinate) {
    setMarkerPosition(position);
    setMarkerAdjusted(true);
  }

  function handleConfirmLocation() {
    if (markerPosition) void runCheck(markerPosition);
  }

  const needsConfirmation = result?.status === "ADDRESS_AMBIGUOUS";
  const showConfirmButton = markerPosition !== null && (needsConfirmation || markerAdjusted);

  return (
    <div className="grid w-full gap-4 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <AddressForm
          values={address}
          onChange={handleAddressChange}
          onPatch={handleAddressPatch}
          onSearch={handleSearch}
          loading={loading}
        />

        {markerPosition && (
          <div className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
            <p className="text-xs text-ink/60">
              {markerAdjusted
                ? "O marcador foi ajustado manualmente. Confirme para consultar com a nova posição."
                : needsConfirmation
                  ? "Confira o marcador no mapa e ajuste se necessário."
                  : "Endereço localizado no mapa. Arraste o marcador caso a posição não esteja correta."}
            </p>
            {showConfirmButton && (
              <button
                type="button"
                onClick={handleConfirmLocation}
                disabled={loading}
                className="mt-3 w-full rounded bg-signal-viable px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-signal-viable focus:ring-offset-2 disabled:opacity-60"
              >
                Confirmar localização e consultar
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-signal-blocked/40 bg-white p-4 text-sm text-signal-blocked shadow-sm">
            {error}
          </div>
        )}

        {result && <ResultPanel result={result} />}
      </div>

      <div className="overflow-hidden rounded-lg border border-ink/10 bg-white shadow-sm">
        <MapView
          result={result}
          coverageAreas={coverageAreas}
          markerPosition={markerPosition}
          onMarkerAdjusted={handleMarkerAdjusted}
        />
      </div>
    </div>
  );
}
