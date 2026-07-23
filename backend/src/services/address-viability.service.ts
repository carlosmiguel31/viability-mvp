import { NormalizedAddress } from "../types/address.types";
import {
  AddressViabilityResponse,
  SearchedAddress,
  ViabilityStatus,
} from "../types/viability.types";
import { GeocodingProvider } from "../types/address.types";
import { geocodingProvider } from "./geocoding";
import { AddressNotFoundError, GeocodingUnavailableError } from "./geocoding/geocoding.errors";
import { checkViability } from "./viability.service";
import { toPublicNetworkLocation } from "./public-network.mapper";
import { formatAddressFromInput } from "./address.service";
import { VoalleRepository, voalleRepository } from "../repositories/voalle.repository";
import { logger } from "../utils/logger";

const ANALYSIS_BASIS =
  "A mancha KML/KMZ é a fonte oficial da cobertura. Os dados do Voalle são utilizados somente para localizar referências de rede próximas. A viabilidade final depende de validação técnica.";

const ADDRESS_MESSAGES: Record<string, string> = {
  ADDRESS_NOT_FOUND:
    "O endereço informado não foi localizado. Revise os dados e tente novamente.",
  ADDRESS_AMBIGUOUS:
    "Não foi possível determinar com precisão o local informado. Confirme o ponto no mapa.",
  GEOCODING_UNAVAILABLE:
    "O serviço de localização de endereços está indisponível no momento. Tente novamente em instantes.",
};

function toSearchedInput(address: NormalizedAddress): SearchedAddress["input"] {
  return {
    postalCode: address.postalCode,
    street: address.street,
    number: address.number,
    complement: address.complement,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
  };
}

function emptyCoverage(): AddressViabilityResponse["coverage"] {
  return { insideCoverage: false, primaryArea: null, matchingAreas: [] };
}

/**
 * Fluxo por endereco (fluxo principal do operador):
 * 1. endereco ja validado/normalizado pelo schema + address.service;
 * 2. geocodificacao pelo backend (chave nunca vai ao navegador);
 * 3. falhas de geocodificacao viram status proprios e o Voalle NAO e
 *    consultado; nenhuma coordenada e estimada silenciosamente;
 * 4. partialMatch (qualquer confianca) OU confianca LOW exigem confirmacao
 *    no mapa (ADDRESS_AMBIGUOUS); as coordenadas retornam apenas para
 *    posicionar o marcador e o Voalle nao e consultado antes da confirmacao;
 * 5. com coordenadas confirmadas, reutiliza o MESMO servico geografico de
 *    coordenadas — a viabilidade e definida exclusivamente pela mancha
 *    KML/KMZ, com o Voalle como referencia complementar;
 * 6. ajuste manual do marcador usa as coordenadas informadas SOMENTE naquela
 *    consulta (nada persistido) e dispensa nova geocodificacao.
 */
export async function checkViabilityByAddress(
  input: {
    address: NormalizedAddress;
    adjustedLocation?: { latitude: number; longitude: number };
  },
  deps: {
    geocoder?: GeocodingProvider;
    repository?: VoalleRepository;
  } = {}
): Promise<AddressViabilityResponse> {
  const geocoder = deps.geocoder ?? geocodingProvider;
  const repository = deps.repository ?? voalleRepository;
  const { address, adjustedLocation } = input;

  const baseSearched: SearchedAddress = {
    input: toSearchedInput(address),
    formattedAddress: formatAddressFromInput(address),
    latitude: null,
    longitude: null,
    geocodingConfidence: null,
    manuallyAdjusted: false,
  };

  let latitude: number;
  let longitude: number;
  let searchedAddress: SearchedAddress;

  if (adjustedLocation) {
    // Marcador ajustado/confirmado manualmente pelo operador.
    latitude = adjustedLocation.latitude;
    longitude = adjustedLocation.longitude;
    searchedAddress = {
      ...baseSearched,
      latitude,
      longitude,
      geocodingConfidence: null,
      manuallyAdjusted: true,
    };
  } else {
    let geocoding;
    try {
      geocoding = await geocoder.geocodeAddress(address);
    } catch (err) {
      const status: ViabilityStatus =
        err instanceof AddressNotFoundError
          ? "ADDRESS_NOT_FOUND"
          : err instanceof GeocodingUnavailableError
            ? "GEOCODING_UNAVAILABLE"
            : "GEOCODING_UNAVAILABLE";
      if (!(err instanceof AddressNotFoundError) && !(err instanceof GeocodingUnavailableError)) {
        logger.error("Falha inesperada na geocodificacao");
      }
      return {
        status,
        message: ADDRESS_MESSAGES[status],
        networkReferenceStatus: "NOT_CHECKED",
        networkReferenceMessage: null,
        searchedAddress: baseSearched,
        coverage: emptyCoverage(),
        nearestNetworkLocation: null,
        alternatives: [],
        requiresTechnicalConfirmation: false,
        analysisBasis: ANALYSIS_BASIS,
      };
    }

    // Ambiguidade: correspondencia parcial (qualquer confianca) OU confianca
    // LOW exigem confirmacao/ajuste do marcador no mapa. O Voalle NAO e
    // consultado antes da confirmacao; as coordenadas retornam apenas para
    // posicionar o marcador.
    if (geocoding.partialMatch || geocoding.confidence === "LOW") {
      return {
        status: "ADDRESS_AMBIGUOUS",
        message: ADDRESS_MESSAGES.ADDRESS_AMBIGUOUS,
        networkReferenceStatus: "NOT_CHECKED",
        networkReferenceMessage: null,
        searchedAddress: {
          ...baseSearched,
          formattedAddress: geocoding.formattedAddress,
          latitude: geocoding.latitude,
          longitude: geocoding.longitude,
          geocodingConfidence: geocoding.confidence,
        },
        geocoding: {
          formattedAddress: geocoding.formattedAddress,
          confidence: geocoding.confidence,
          partialMatch: geocoding.partialMatch,
        },
        coverage: emptyCoverage(),
        nearestNetworkLocation: null,
        alternatives: [],
        requiresTechnicalConfirmation: true,
        analysisBasis: ANALYSIS_BASIS,
      };
    }

    latitude = geocoding.latitude;
    longitude = geocoding.longitude;
    searchedAddress = {
      ...baseSearched,
      formattedAddress: geocoding.formattedAddress,
      latitude,
      longitude,
      geocodingConfidence: geocoding.confidence,
    };
  }

  const geographic = await checkViability({ latitude, longitude }, repository);

  return {
    status: geographic.status,
    message: geographic.message,
    networkReferenceStatus: geographic.networkReferenceStatus,
    networkReferenceMessage: geographic.networkReferenceMessage,
    searchedAddress,
    coverage: geographic.coverage,
    nearestNetworkLocation: geographic.nearestNetworkLocation
      ? toPublicNetworkLocation(geographic.nearestNetworkLocation)
      : null,
    alternatives: geographic.alternatives.map(toPublicNetworkLocation),
    requiresTechnicalConfirmation: geographic.requiresTechnicalConfirmation,
    analysisBasis: ANALYSIS_BASIS,
  };
}
