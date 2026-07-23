import { env } from "../config/env";

/**
 * Classificacao dos titulos de erp.authentication_splitters.
 *
 * A interface NAO deve exibir titulos tecnicos como "SPLITTER 1_48",
 * "ROTA 01_1942" ou "COLETOR ...". Somente identificadores padronizados de
 * rede (ex.: BHZ-C0016-RT10-CT03_2780) sao apresentados ao operador.
 *
 * O padrao e centralizado aqui e configuravel via NETWORK_IDENTIFIER_PATTERN
 * (nao presume prefixo fixo como "BHZ"). A comparacao ignora maiusculas/
 * minusculas, mas o valor ORIGINAL do titulo e preservado na resposta.
 */

export type NetworkElementTitleType =
  | "NETWORK_IDENTIFIER"
  | "SPLITTER"
  | "ROUTE"
  | "COLLECTOR"
  | "OTHER";

const TECHNICAL_PREFIXES: Array<{ prefix: string; type: NetworkElementTitleType }> = [
  { prefix: "SPLITTER", type: "SPLITTER" },
  { prefix: "ROTA", type: "ROUTE" },
  { prefix: "COLETOR", type: "COLLECTOR" },
];

let cachedPattern: { source: string; regex: RegExp } | null = null;

export function getNetworkIdentifierRegex(): RegExp {
  const source = env.NETWORK_IDENTIFIER_PATTERN;
  if (!cachedPattern || cachedPattern.source !== source) {
    cachedPattern = { source, regex: new RegExp(source, "i") };
  }
  return cachedPattern.regex;
}

export function classifyNetworkElementTitle(title: string): NetworkElementTitleType {
  const trimmed = title.trim();
  if (getNetworkIdentifierRegex().test(trimmed)) {
    return "NETWORK_IDENTIFIER";
  }
  const upper = trimmed.toUpperCase();
  for (const { prefix, type } of TECHNICAL_PREFIXES) {
    if (upper.startsWith(prefix)) return type;
  }
  return "OTHER";
}
