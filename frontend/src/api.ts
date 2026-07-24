import { apiFetch, apiJson, ApiError } from "./auth";

export { ApiError } from "./auth";
import {
  AddressFormValues,
  AddressViabilityResponse,
  AuditLogPage,
  CoverageAreaWithPolygons,
  CoverageFileType,
  CoverageLayer,
  CoverageLayersPage,
  CoveragePartner,
  CoveragePartnersPage,
  CoverageProcessingStatus,
  CoverageReloadSummary,
  CoverageStatus,
  ConsultationDetail,
  DashboardBreakdowns,
  DashboardFilters,
  DashboardRankings,
  DashboardRecentConsultation,
  DashboardSummary,
  DashboardTimeline,
  DashboardUserOption,
  ReviewListParams,
  ReviewPriority,
  ReviewAssigneeOption,
  ReviewByConsultation,
  ReviewsPageResponse,
  ReviewsSummary,
  ReviewStatus,
  ViabilityReviewDetails,
  ConsultationListParams,
  ConsultationsPage,
  GeographicCoordinate,
  PostalCodeAddress,
  PublicUser,
  UserRole,
  UsersPage,
} from "./types";

function toAddressPayload(values: AddressFormValues) {
  return {
    postalCode: values.postalCode || null,
    street: values.street,
    number: values.number,
    complement: values.complement || null,
    neighborhood: values.neighborhood || null,
    city: values.city,
    state: values.state,
    country: "Brasil",
  };
}

export function checkViabilityByAddress(
  values: AddressFormValues,
  adjustedLocation?: GeographicCoordinate,
  locationConfirmationToken?: string
): Promise<AddressViabilityResponse> {
  // Ajuste/confirmacao do marcador usa o endpoint dedicado e envia o token
  // opaco emitido na geocodificacao (o backend valida assinatura/expiracao/
  // usuario/endereco; nunca confiamos em campos soltos de geocodificacao).
  const path = adjustedLocation ? "/api/viabilities/confirm-location" : "/api/viabilities/check";
  return apiJson<AddressViabilityResponse>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: toAddressPayload(values),
      ...(adjustedLocation ? { adjustedLocation } : {}),
      ...(adjustedLocation && locationConfirmationToken ? { locationConfirmationToken } : {}),
    }),
  });
}

export function lookupPostalCode(cep: string): Promise<PostalCodeAddress> {
  return apiJson<PostalCodeAddress>(`/api/addresses/postal-code/${cep.replace(/\D/g, "")}`);
}

export function fetchCoverageStatus(): Promise<CoverageStatus> {
  return apiJson<CoverageStatus>("/api/coverage/status");
}

export function fetchCoverageAreas(): Promise<{ areas: CoverageAreaWithPolygons[] }> {
  return apiJson<{ areas: CoverageAreaWithPolygons[] }>("/api/coverage/areas");
}

// ── Administração (ADMIN) ─────────────────────────────────────
export function listUsers(params: {
  search?: string;
  role?: UserRole | "";
  active?: "" | "true" | "false";
  page?: number;
}): Promise<UsersPage> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.role) query.set("role", params.role);
  if (params.active) query.set("active", params.active);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", "20");
  return apiJson<UsersPage>(`/api/users?${query.toString()}`);
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
}): Promise<{ user: PublicUser }> {
  return apiJson("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateUser(
  id: string,
  input: { name?: string; email?: string; role?: UserRole }
): Promise<{ user: PublicUser }> {
  return apiJson(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function setUserStatus(
  id: string,
  active: boolean,
  confirmSelfDeactivation?: boolean
): Promise<{ user: PublicUser }> {
  return apiJson(`/api/users/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active, confirmSelfDeactivation }),
  });
}

export function resetUserPassword(id: string, newPassword: string): Promise<void> {
  return apiJson(`/api/users/${id}/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword }),
  });
}

export function listAuditLogs(params: {
  page?: number;
  action?: string;
  userId?: string;
  from?: string; // AAAA-MM-DD
  to?: string; // AAAA-MM-DD (inclusivo)
}): Promise<AuditLogPage> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", "20");
  if (params.action) query.set("action", params.action);
  if (params.userId) query.set("userId", params.userId);
  if (params.from) query.set("from", `${params.from}T00:00:00`);
  if (params.to) query.set("to", `${params.to}T23:59:59.999`);
  return apiJson<AuditLogPage>(`/api/audit-logs?${query.toString()}`);
}

// ── Administração de coberturas (v0.3.0, ADMIN) ───────────────
export function listCoveragePartners(params: {
  search?: string;
  active?: "" | "true" | "false";
  page?: number;
}): Promise<CoveragePartnersPage> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.active) query.set("active", params.active);
  query.set("page", String(params.page ?? 1));
  query.set("limit", "20");
  return apiJson<CoveragePartnersPage>(`/api/coverage/partners?${query.toString()}`);
}

export function createCoveragePartner(input: {
  name: string;
  code: string;
  description?: string;
  active?: boolean;
}): Promise<{ partner: CoveragePartner }> {
  return apiJson("/api/coverage/partners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCoveragePartner(
  id: string,
  input: { name?: string; code?: string; description?: string | null }
): Promise<{ partner: CoveragePartner }> {
  return apiJson(`/api/coverage/partners/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function setCoveragePartnerStatus(
  id: string,
  active: boolean
): Promise<{ partner: CoveragePartner }> {
  return apiJson(`/api/coverage/partners/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
}

export function listCoverageLayers(params: {
  search?: string;
  partnerId?: string;
  active?: "" | "true" | "false";
  processingStatus?: "" | CoverageProcessingStatus;
  fileType?: "" | CoverageFileType;
  page?: number;
}): Promise<CoverageLayersPage> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.partnerId) query.set("partnerId", params.partnerId);
  if (params.active) query.set("active", params.active);
  if (params.processingStatus) query.set("processingStatus", params.processingStatus);
  if (params.fileType) query.set("fileType", params.fileType);
  query.set("page", String(params.page ?? 1));
  query.set("limit", "20");
  return apiJson<CoverageLayersPage>(`/api/coverage/layers?${query.toString()}`);
}

/**
 * Upload multipart/form-data. O Content-Type NÃO é definido manualmente:
 * o navegador precisa acrescentar o boundary do FormData.
 */
export function createCoverageLayer(input: {
  file: File;
  partnerId: string;
  name: string;
  description?: string;
  version?: string;
  active?: boolean;
}): Promise<{ layer: CoverageLayer }> {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("partnerId", input.partnerId);
  formData.append("name", input.name);
  if (input.description) formData.append("description", input.description);
  if (input.version) formData.append("version", input.version);
  if (input.active !== undefined) formData.append("active", String(input.active));
  return apiJson("/api/coverage/layers", { method: "POST", body: formData });
}

export function updateCoverageLayer(
  id: string,
  input: { name?: string; description?: string | null; version?: string | null }
): Promise<{ layer: CoverageLayer }> {
  return apiJson(`/api/coverage/layers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function setCoverageLayerStatus(
  id: string,
  active: boolean
): Promise<{ layer: CoverageLayer }> {
  return apiJson(`/api/coverage/layers/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
}

export function deleteCoverageLayer(id: string): Promise<void> {
  return apiJson(`/api/coverage/layers/${id}`, { method: "DELETE" });
}

export function reloadCoverageSnapshot(): Promise<CoverageReloadSummary> {
  return apiJson<CoverageReloadSummary>("/api/coverage/reload", { method: "POST" });
}

// ── Histórico de consultas (v0.4.0) ───────────────────────────
function consultationQuery(params: ConsultationListParams): URLSearchParams {
  const query = new URLSearchParams();
  // Filtros vazios não são enviados.
  if (params.search) query.set("search", params.search);
  if (params.protocol) query.set("protocol", params.protocol);
  if (params.status) query.set("status", params.status);
  if (params.userId) query.set("userId", params.userId);
  if (params.postalCode) query.set("postalCode", params.postalCode);
  if (params.city) query.set("city", params.city);
  if (params.state) query.set("state", params.state);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.hasCoverage) query.set("hasCoverage", params.hasCoverage);
  if (params.networkReferenceStatus) {
    query.set("networkReferenceStatus", params.networkReferenceStatus);
  }
  query.set("page", String(params.page ?? 1));
  query.set("limit", "20");
  if (params.sortOrder) query.set("sortOrder", params.sortOrder);
  return query;
}

export function listConsultations(params: ConsultationListParams): Promise<ConsultationsPage> {
  return apiJson<ConsultationsPage>(`/api/consultations?${consultationQuery(params).toString()}`);
}

export function getConsultation(id: string): Promise<{ consultation: ConsultationDetail }> {
  return apiJson(`/api/consultations/${id}`);
}

export function getConsultationByProtocol(
  protocol: string
): Promise<{ consultation: ConsultationDetail }> {
  return apiJson(`/api/consultations/protocol/${encodeURIComponent(protocol)}`);
}

/**
 * Exportação CSV (somente ADMIN): recebe o Blob autenticado, cria uma URL
 * temporária, dispara o download e revoga a URL em seguida.
 */
export async function exportConsultations(params: ConsultationListParams): Promise<void> {
  const response = await apiFetch(
    `/api/consultations/export?${consultationQuery(params).toString()}`
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      body?.error?.message ?? "Falha ao exportar as consultas.",
      body?.error?.code ?? "EXPORT_FAILED",
      response.status
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `consultas-viabilidade-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Dashboard (v0.5.0) ────────────────────────────────────────
function dashboardQuery(filters: DashboardFilters & { limit?: number }): string {
  const query = new URLSearchParams();
  // Parametros vazios nao sao enviados.
  if (filters.preset) query.set("preset", filters.preset);
  if (filters.dateFrom) query.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) query.set("dateTo", filters.dateTo);
  if (filters.userId) query.set("userId", filters.userId);
  if (filters.status) query.set("status", filters.status);
  if (filters.city) query.set("city", filters.city);
  if (filters.state) query.set("state", filters.state);
  if (filters.partnerCode) query.set("partnerCode", filters.partnerCode);
  if (filters.layerId) query.set("layerId", filters.layerId);
  if (filters.limit) query.set("limit", String(filters.limit));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function getDashboardSummary(
  filters: DashboardFilters,
  options?: { recordView?: boolean }
): Promise<DashboardSummary> {
  // recordView=true SOMENTE na primeira abertura e a cada Aplicar explícito;
  // retries/StrictMode/Tentar novamente não registram visualização.
  const query = dashboardQuery(filters);
  const suffix = options?.recordView
    ? `${query ? `${query}&` : "?"}recordView=true`
    : query;
  return apiJson<DashboardSummary>(`/api/dashboard/summary${suffix}`);
}

/** Opções mínimas de usuários (ativos) para o filtro — ADMIN/OPERATOR/TECHNICIAN. */
export function getDashboardUserOptions(params?: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<{ users: DashboardUserOption[]; total: number; page: number; limit: number }> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));
  const text = query.toString();
  return apiJson(`/api/dashboard/users${text ? `?${text}` : ""}`);
}

export function getDashboardTimeline(filters: DashboardFilters): Promise<DashboardTimeline> {
  return apiJson<DashboardTimeline>(`/api/dashboard/timeline${dashboardQuery(filters)}`);
}

export function getDashboardBreakdowns(filters: DashboardFilters): Promise<DashboardBreakdowns> {
  return apiJson<DashboardBreakdowns>(`/api/dashboard/breakdowns${dashboardQuery(filters)}`);
}

export function getDashboardRankings(filters: DashboardFilters): Promise<DashboardRankings> {
  return apiJson<DashboardRankings>(`/api/dashboard/rankings${dashboardQuery(filters)}`);
}

export function getDashboardRecentConsultations(
  filters: DashboardFilters & { limit?: number }
): Promise<{ consultations: DashboardRecentConsultation[] }> {
  return apiJson(`/api/dashboard/recent-consultations${dashboardQuery(filters)}`);
}

// ── Fila de análises técnicas (v0.6.0) ────────────────────────
function reviewQuery(params: ReviewListParams): string {
  const query = new URLSearchParams();
  const entries: Array<[string, string | undefined]> = [
    ["search", params.search],
    ["protocol", params.protocol],
    ["status", params.status],
    ["priority", params.priority],
    ["assignedToId", params.assignedToId],
    ["openedById", params.openedById],
    ["city", params.city],
    ["state", params.state],
    ["overdue", params.overdue ? "true" : undefined],
    ["unassigned", params.unassigned ? "true" : undefined],
    ["dateFrom", params.dateFrom],
    ["dateTo", params.dateTo],
    ["dueFrom", params.dueFrom],
    ["dueTo", params.dueTo],
    ["page", params.page ? String(params.page) : undefined],
    ["limit", params.limit ? String(params.limit) : undefined],
    ["sortBy", params.sortBy],
    ["sortOrder", params.sortOrder],
  ];
  for (const [key, value] of entries) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function listReviews(params: ReviewListParams = {}): Promise<ReviewsPageResponse> {
  return apiJson<ReviewsPageResponse>(`/api/reviews${reviewQuery(params)}`);
}

export function getReviewsSummary(): Promise<ReviewsSummary> {
  return apiJson<ReviewsSummary>("/api/reviews/summary");
}

export function getReview(id: string): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}`);
}

export function createReview(input: {
  consultationId: string;
  priority?: ReviewPriority;
  assignedToId?: string | null;
  note?: string;
}): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson("/api/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateReview(
  id: string,
  input: { status?: ReviewStatus; priority?: ReviewPriority; dueAt?: string | null; version: number }
): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function assignReview(
  id: string,
  input: { assignedToId: string | null; version: number }
): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}/assignment`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function claimReview(
  id: string,
  input: { version: number }
): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getReviewByConsultation(
  consultationId: string
): Promise<{ review: ReviewByConsultation }> {
  return apiJson(`/api/reviews/by-consultation/${consultationId}`);
}

export function getReviewAssignees(params: { search?: string; limit?: number } = {}): Promise<{
  users: ReviewAssigneeOption[];
}> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.limit) query.set("limit", String(params.limit));
  const text = query.toString();
  return apiJson(`/api/reviews/assignees${text ? `?${text}` : ""}`);
}

export function addReviewNote(
  id: string,
  input: { note: string; version: number }
): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function resolveReview(
  id: string,
  input: {
    decision: "APPROVED" | "REJECTED";
    resolutionCode: string;
    resolutionSummary: string;
    version: number;
  }
): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function reopenReview(
  id: string,
  input: { version: number; note?: string }
): Promise<{ review: ViabilityReviewDetails }> {
  return apiJson(`/api/reviews/${id}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
