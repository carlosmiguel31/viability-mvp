import { useEffect, useState } from "react";
import { AddressViabilityResponse, PublicNetworkLocation } from "../types";
import { SessionUser } from "../auth";
import { ApiError, getReviewByConsultation } from "../api";
import { ReviewCreateDialog } from "./ReviewsPage";
import ReviewDetailsDialog from "./ReviewDetailsDialog";

interface Props {
  result: AddressViabilityResponse;
  /** Usuário da sessão: habilita "Encaminhar para análise" (ADMIN/OPERATOR). */
  currentUser?: SessionUser;
}

/**
 * Card vermelho (signal-blocked) SOMENTE para OUTSIDE_COVERAGE.
 * Dentro da mancha o card é sempre verde: a referência de rede nunca
 * rebaixa o resultado principal.
 */
const STATUS_META: Record<string, { label: string; badge: string; panel: string }> = {
  PRELIMINARILY_VIABLE: {
    label: "Viável preliminarmente",
    badge: "bg-signal-viable text-white",
    panel: "border-signal-viable/40",
  },
  OUTSIDE_COVERAGE: {
    label: "Fora da cobertura",
    badge: "bg-signal-blocked text-white",
    panel: "border-signal-blocked/40",
  },
  COVERAGE_NOT_LOADED: {
    label: "Cobertura indisponível",
    badge: "bg-signal-offline text-white",
    panel: "border-signal-offline/40",
  },
  COVERAGE_NOT_CONFIGURED: {
    label: "Cobertura não configurada",
    badge: "bg-signal-offline text-white",
    panel: "border-signal-offline/40",
  },
  ADDRESS_NOT_FOUND: {
    label: "Endereço não localizado",
    badge: "bg-signal-analysis text-white",
    panel: "border-signal-analysis/40",
  },
  ADDRESS_AMBIGUOUS: {
    label: "Confirme a localização",
    badge: "bg-signal-analysis text-white",
    panel: "border-signal-analysis/40",
  },
  GEOCODING_UNAVAILABLE: {
    label: "Localização indisponível",
    badge: "bg-signal-offline text-white",
    panel: "border-signal-offline/40",
  },
};

const CONFIDENCE_LABEL: Record<string, string> = {
  HIGH: "Localização precisa",
  MEDIUM: "Localização aproximada",
  LOW: "Localização com baixa precisão",
};

function NetworkLocationDetails({ location }: { location: PublicNetworkLocation }) {
  return (
    <div>
      <p className="text-sm">
        <span className="text-xs uppercase tracking-wide text-ink/50">Distância até a rede: </span>
        <span className="font-mono">{location.distanceMeters} m</span>
      </p>

      {location.identificationStatus === "IDENTIFIED" ? (
        <div className="mt-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-ink/50">
            Identificações neste ponto
          </p>
          <ul className="space-y-1 rounded border border-ink/10 bg-ink/[0.02] p-2">
            {location.identifiers.map((identifier) => (
              <li key={identifier.id} className="font-mono text-xs text-ink/80">
                {identifier.code}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded bg-ink/5 px-3 py-2 text-xs text-ink/70">
          Ponto de rede localizado, porém sem identificação padronizada no cadastro.
        </p>
      )}
    </div>
  );
}

/** Copia com clipboard API e fallback seguro (textarea temporário). */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // segue para o fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}

export default function ResultPanel({ result, currentUser }: Props) {
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  // reviewId REAL da análise (existente ou recém-criada); null = sem análise.
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [openReviewId, setOpenReviewId] = useState<string | null>(null);
  const canForward =
    currentUser && (currentUser.role === "ADMIN" || currentUser.role === "OPERATOR");
  const consultationId = result.consultation?.id ?? null;

  useEffect(() => {
    // Detecta análise existente para decidir entre "Encaminhar" e "Abrir".
    setReviewId(null);
    if (!consultationId || !currentUser) return;
    let cancelled = false;
    getReviewByConsultation(consultationId)
      .then((data) => {
        if (!cancelled) setReviewId(data.review.id);
      })
      .catch((err) => {
        // 404 = sem análise; outros erros mantêm o fluxo de criação.
        if (!cancelled && !(err instanceof ApiError && err.status === 404)) {
          setReviewId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [consultationId, currentUser]);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [protocolCopied, setProtocolCopied] = useState(false);
  const meta = STATUS_META[result.status] ?? STATUS_META.COVERAGE_NOT_LOADED;
  const location = result.nearestNetworkLocation;
  const { coverage, searchedAddress } = result;

  return (
    <section className={`rounded-lg border bg-white p-4 shadow-sm ${meta.panel}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${meta.badge}`}
        >
          {meta.label}
        </span>
        {coverage.primaryArea && (
          <span className="rounded bg-ink/5 px-2 py-1 font-mono text-[11px] text-ink/60">
            Área de cobertura: {coverage.primaryArea.name ?? "sem nome"}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm">{result.message}</p>

      {result.consultation && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-ink/[0.03] px-3 py-2">
          <p className="text-xs text-ink/70">
            <span className="font-semibold">Protocolo:</span>{" "}
            <span className="font-mono">{result.consultation.protocol}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              void copyTextToClipboard(result.consultation!.protocol).then((copied) => {
                setProtocolCopied(copied);
                if (copied) window.setTimeout(() => setProtocolCopied(false), 2500);
              });
            }}
            className="rounded border border-ink/20 px-2 py-1 text-[11px] text-ink/70 transition hover:bg-ink/5"
          >
            {protocolCopied ? "Copiado!" : "Copiar protocolo"}
          </button>
          {canForward && (
            <button
              type="button"
              onClick={() => {
                if (reviewId) {
                  setOpenReviewId(reviewId); // abre direto os detalhes
                } else {
                  setReviewDialogOpen(true);
                }
              }}
              className="rounded border border-petrol-800/40 px-2 py-1 text-[11px] font-medium text-petrol-800 transition hover:bg-petrol-800/5"
            >
              {reviewId ? "Abrir análise" : "Encaminhar para análise"}
            </button>
          )}
        </div>
      )}
      {reviewDialogOpen && result.consultation && currentUser && (
        <ReviewCreateDialog
          consultationId={result.consultation.id}
          protocol={result.consultation.protocol}
          addressText={searchedAddress.formattedAddress}
          currentUser={currentUser}
          onClose={() => setReviewDialogOpen(false)}
          onCreated={(createdReviewId) => setReviewId(createdReviewId)}
          onOpenReview={(id) => {
            setReviewDialogOpen(false);
            setOpenReviewId(id);
          }}
        />
      )}
      {openReviewId && currentUser && (
        <ReviewDetailsDialog
          reviewId={openReviewId}
          currentUser={currentUser}
          onClose={() => setOpenReviewId(null)}
        />
      )}

      <p className="mt-2 text-xs text-ink/60">
        <span className="font-semibold">Endereço consultado:</span>{" "}
        {searchedAddress.formattedAddress}
      </p>
      {searchedAddress.manuallyAdjusted ? (
        <p className="mt-1 text-[11px] text-ink/50">Ponto ajustado manualmente no mapa.</p>
      ) : (
        searchedAddress.geocodingConfidence && (
          <p className="mt-1 text-[11px] text-ink/50">
            {CONFIDENCE_LABEL[searchedAddress.geocodingConfidence]}
          </p>
        )
      )}

      {result.status === "PRELIMINARILY_VIABLE" && result.coverageMatches.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
            Coberturas encontradas
          </p>
          <ul className="space-y-1 rounded border border-ink/10 bg-ink/[0.02] p-2">
            {result.coverageMatches.map((match) => (
              <li key={match.layerId} className="text-xs text-ink/80">
                <span className="font-semibold">{match.partnerName}</span>
                <span className="block text-ink/60">
                  {match.layerName}
                  {match.version ? ` · versão ${match.version}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {coverage.matchingAreas.length > 0 && (
        <p className="mt-2 text-xs text-ink/60">
          O ponto também está em:{" "}
          {coverage.matchingAreas.map((a) => a.name ?? "sem nome").join(", ")}
        </p>
      )}

      {location && (
        <div className="mt-4 border-t border-ink/10 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Referência de rede mais próxima</h3>
          <NetworkLocationDetails location={location} />
        </div>
      )}

      {result.status === "PRELIMINARILY_VIABLE" &&
        result.networkReferenceStatus !== "FOUND" &&
        result.networkReferenceMessage && (
          <p className="mt-4 rounded border border-signal-analysis/30 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {result.networkReferenceMessage}
          </p>
        )}

      {result.alternatives.length > 0 && (
        <p className="mt-3 text-xs text-ink/60">
          {result.alternatives.length} outro(s) ponto(s) no raio de referência — veja no mapa.
        </p>
      )}

      {result.requiresTechnicalConfirmation && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Resultado preliminar: a viabilidade final depende de validação técnica em campo.
        </p>
      )}

      {location && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails((v) => !v)}
            className="text-[11px] text-ink/50 underline decoration-dotted"
          >
            {showTechnicalDetails ? "Ocultar detalhes técnicos" : "Detalhes técnicos"}
          </button>
          {showTechnicalDetails && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded bg-ink/[0.03] p-2 font-mono text-[11px] text-ink/60">
              <dt>Endereço (lat, lng)</dt>
              <dd>
                {searchedAddress.latitude?.toFixed(6)}, {searchedAddress.longitude?.toFixed(6)}
              </dd>
              <dt>Ponto de rede (lat, lng)</dt>
              <dd>
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </dd>
            </dl>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-snug text-ink/45">{result.analysisBasis}</p>
    </section>
  );
}
