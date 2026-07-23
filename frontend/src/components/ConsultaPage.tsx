import { useEffect, useState } from "react";
import MapView from "./MapView";
import ResultPanel from "./ResultPanel";
import AddressForm from "./AddressForm";
import { checkViabilityByAddress, fetchCoverageAreas } from "../api";
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [coverageAreas, setCoverageAreas] = useState<CoverageAreaWithPolygons[] | null>(null);
  const [markerPosition, setMarkerPosition] = useState<GeographicCoordinate | null>(null);
  const [markerAdjusted, setMarkerAdjusted] = useState(false);

  useEffect(() => {
    fetchCoverageAreas()
      .then((data) => setCoverageAreas(data.areas))
      .catch(() => setCoverageAreas(null));
  }, []);

  async function runCheck(adjusted?: GeographicCoordinate) {
    setError(null);
    setLoading(true);
    try {
      const response = await checkViabilityByAddress(address, adjusted);
      setResult(response);
      const { latitude, longitude } = response.searchedAddress;
      if (latitude !== null && longitude !== null) {
        setMarkerPosition({ latitude, longitude });
      }
      setMarkerAdjusted(Boolean(adjusted));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Falha ao consultar viabilidade.");
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
          onChange={setAddress}
          onPatch={setAddress}
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
