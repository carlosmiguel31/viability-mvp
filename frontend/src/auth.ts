/**
 * Sessão do frontend (v0.2.0):
 * - access token SOMENTE em memória (variável de módulo) — nunca em
 *   localStorage/sessionStorage;
 * - refresh token em cookie HttpOnly gerenciado pelo backend;
 * - renovação automática: em 401, tenta UM refresh e repete a requisição;
 *   se o refresh falhar, a sessão é encerrada (sem loop infinito);
 * - a antiga chave compartilhada (x-api-key) foi totalmente removida.
 */
import { UserRole } from "./types";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

let accessToken: string | null = null;
let sessionListeners: Array<(user: SessionUser | null) => void> = [];

export function onSessionChange(listener: (user: SessionUser | null) => void): () => void {
  sessionListeners.push(listener);
  return () => {
    sessionListeners = sessionListeners.filter((l) => l !== listener);
  };
}

function emit(user: SessionUser | null): void {
  for (const listener of sessionListeners) listener(user);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function parseError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);
  return new ApiError(
    body?.error?.message ?? "Não foi possível completar a operação.",
    body?.error?.code ?? "UNKNOWN",
    response.status
  );
}

async function doRefresh(isRaceRetry = false): Promise<SessionUser | null> {
  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    // Corrida legítima: outra renovação (outra aba/requisição) venceu e o
    // cookie do navegador JÁ é o novo. UMA nova tentativa controlada — a
    // flag impede loop.
    if (!isRaceRetry) {
      const body = await response.clone().json().catch(() => null);
      if (body?.error?.code === "REFRESH_RACE_LOST") {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return doRefresh(true);
      }
    }
    return null;
  }
  const body = await response.json();
  accessToken = body.accessToken;
  // Sessão atualizada: mudanças de nome/e-mail/perfil aparecem sem recarregar.
  emit(body.user as SessionUser);
  return body.user as SessionUser;
}

/**
 * Coordenação ENTRE ABAS: Web Locks serializa as renovações (apenas uma aba
 * rotaciona por vez; o backend ainda tem uma janela de graça para corridas).
 * Fallback: executa direto quando a API não existe.
 */
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request("viability-auth-refresh", task);
  }
  return task();
}

/** Promessa compartilhada NA ABA: chamadas simultâneas reutilizam o mesmo refresh. */
let refreshPromise: Promise<SessionUser | null> | null = null;

function tryRefresh(): Promise<SessionUser | null> {
  if (!refreshPromise) {
    refreshPromise = withRefreshLock(doRefresh).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Restaura a sessão em nova aba/recarga usando o cookie de refresh. */
export async function restoreSession(): Promise<SessionUser | null> {
  const user = await tryRefresh().catch(() => null);
  if (user === null) emit(null); // sucesso já emitido pelo próprio refresh
  return user;
}

export async function login(email: string, password: string): Promise<SessionUser> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await parseError(response);
  const body = await response.json();
  accessToken = body.accessToken;
  emit(body.user);
  return body.user as SessionUser;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  }).catch(() => undefined);
  accessToken = null;
  emit(null);
}

/**
 * fetch autenticado com renovação automática: no máximo UMA tentativa de
 * refresh por requisição (isRetry impede loop).
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  isRetry = false
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (response.status !== 401 || isRetry) return response;

  const refreshed = await tryRefresh().catch(() => null);
  if (!refreshed) {
    accessToken = null;
    emit(null); // volta ao login
    return response;
  }
  return apiFetch(path, init, true);
}

/** Uso exclusivo em testes: zera o estado de sessão em memória. */
export function resetSessionForTests(): void {
  accessToken = null;
  sessionListeners = [];
  refreshPromise = null;
}

/** Alteração da própria senha; sucesso revoga todas as sessões no backend. */
export async function changeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  const response = await apiFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  // Sessões revogadas: encerra localmente e volta ao login.
  accessToken = null;
  emit(null);
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
