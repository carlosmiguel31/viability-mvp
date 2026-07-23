import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createCoverageLayer,
  createCoveragePartner,
  deleteCoverageLayer,
  listCoverageLayers,
  listCoveragePartners,
  reloadCoverageSnapshot,
  setCoverageLayerStatus,
  setCoveragePartnerStatus,
  updateCoverageLayer,
  updateCoveragePartner,
} from "../api";
import {
  CoverageFileType,
  CoverageLayer,
  CoveragePartner,
  CoverageProcessingStatus,
} from "../types";

const LIMIT = 20;
const MAX_UPLOAD_MB = 25; // limite documentado (COVERAGE_MAX_FILE_SIZE_MB)

const PROCESSING_META: Record<
  CoverageProcessingStatus,
  { label: string; badge: string }
> = {
  PENDING: { label: "Aguardando processamento", badge: "bg-ink/10 text-ink/70" },
  PROCESSING: { label: "Processando", badge: "bg-signal-analysis/15 text-amber-900" },
  READY: { label: "Pronta", badge: "bg-signal-viable/15 text-emerald-900" },
  FAILED: { label: "Falhou", badge: "bg-signal-blocked/15 text-red-900" },
};

/** Mensagens amigáveis por código; a mensagem segura da API prevalece. */
function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "COVERAGE_LAYER_PROCESSING") {
      return "Não é possível excluir uma camada enquanto ela está sendo processada.";
    }
    return err.message || fallback;
  }
  return fallback;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface PartnerFormState {
  id: string | null; // null = novo parceiro
  name: string;
  code: string;
  description: string;
  active: boolean;
  error: string | null;
  saving: boolean;
}

interface UploadFormState {
  partnerId: string;
  name: string;
  description: string;
  version: string;
  active: boolean;
  file: File | null;
  error: string | null;
  uploading: boolean;
}

interface LayerEditState {
  layer: CoverageLayer;
  name: string;
  description: string;
  version: string;
  error: string | null;
  saving: boolean;
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
  running: boolean;
  error: string | null;
}

interface Props {
  /** Chamado após qualquer operação que altere a cobertura (atualiza o cabeçalho). */
  onCoverageChanged: () => Promise<void> | void;
}

/** Administração de parceiros e camadas de cobertura — apenas ADMIN. */
export default function CoverageAdminPage({ onCoverageChanged }: Props) {
  const [tab, setTab] = useState<"parceiros" | "camadas">("parceiros");

  // ── Parceiros ──────────────────────────────────────────────
  const [partners, setPartners] = useState<CoveragePartner[]>([]);
  const [partnersTotal, setPartnersTotal] = useState(0);
  const [partnersPage, setPartnersPage] = useState(1);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerSearchInput, setPartnerSearchInput] = useState("");
  const [partnerActiveFilter, setPartnerActiveFilter] = useState<"" | "true" | "false">("");
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnersError, setPartnersError] = useState<string | null>(null);
  const [partnerForm, setPartnerForm] = useState<PartnerFormState | null>(null);

  // Opções do filtro por parceiro na aba de camadas (todas as páginas, limite seguro).
  const [partnerOptions, setPartnerOptions] = useState<CoveragePartner[]>([]);

  // ── Camadas ────────────────────────────────────────────────
  const [layers, setLayers] = useState<CoverageLayer[]>([]);
  const [layersTotal, setLayersTotal] = useState(0);
  const [layersPage, setLayersPage] = useState(1);
  const [layerSearch, setLayerSearch] = useState("");
  const [layerSearchInput, setLayerSearchInput] = useState("");
  const [layerPartnerFilter, setLayerPartnerFilter] = useState("");
  const [layerActiveFilter, setLayerActiveFilter] = useState<"" | "true" | "false">("");
  const [layerProcessingFilter, setLayerProcessingFilter] = useState<
    "" | CoverageProcessingStatus
  >("");
  const [layerTypeFilter, setLayerTypeFilter] = useState<"" | CoverageFileType>("");
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string | null>(null);
  const [expandedErrorLayerId, setExpandedErrorLayerId] = useState<string | null>(null);

  const [upload, setUpload] = useState<UploadFormState | null>(null);
  const [layerEdit, setLayerEdit] = useState<LayerEditState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadPartners = useCallback(async () => {
    setPartnersLoading(true);
    setPartnersError(null);
    try {
      const data = await listCoveragePartners({
        search: partnerSearch,
        active: partnerActiveFilter,
        page: partnersPage,
      });
      setPartners(data.partners);
      setPartnersTotal(data.total);
    } catch (err) {
      setPartners([]);
      setPartnersTotal(0);
      setPartnersError(apiErrorMessage(err, "Falha ao carregar os parceiros."));
    } finally {
      setPartnersLoading(false);
    }
  }, [partnerSearch, partnerActiveFilter, partnersPage]);

  const loadPartnerOptions = useCallback(async () => {
    try {
      const MAX_PAGES = 25;
      const collected: CoveragePartner[] = [];
      let current = 1;
      for (;;) {
        const data = await listCoveragePartners({ page: current });
        collected.push(...data.partners);
        const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
        if (current >= totalPages || current >= MAX_PAGES) break;
        current += 1;
      }
      setPartnerOptions(collected);
    } catch {
      setPartnerOptions([]);
    }
  }, []);

  const loadLayers = useCallback(async () => {
    setLayersLoading(true);
    setLayersError(null);
    try {
      const data = await listCoverageLayers({
        search: layerSearch,
        partnerId: layerPartnerFilter,
        active: layerActiveFilter,
        processingStatus: layerProcessingFilter,
        fileType: layerTypeFilter,
        page: layersPage,
      });
      setLayers(data.layers);
      setLayersTotal(data.total);
    } catch (err) {
      setLayers([]);
      setLayersTotal(0);
      setLayersError(apiErrorMessage(err, "Falha ao carregar as camadas."));
    } finally {
      setLayersLoading(false);
    }
  }, [
    layerSearch,
    layerPartnerFilter,
    layerActiveFilter,
    layerProcessingFilter,
    layerTypeFilter,
    layersPage,
  ]);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);
  useEffect(() => {
    void loadLayers();
  }, [loadLayers]);
  useEffect(() => {
    void loadPartnerOptions();
  }, [loadPartnerOptions]);

  /** Recarrega listas + status global após operações que mudam a cobertura. */
  async function afterCoverageMutation(message: string): Promise<void> {
    setNotice(message);
    await Promise.all([loadPartners(), loadLayers(), loadPartnerOptions()]);
    await onCoverageChanged();
  }

  // ── Parceiros: ações ───────────────────────────────────────
  function openNewPartner() {
    setNotice(null);
    setPartnerForm({
      id: null,
      name: "",
      code: "",
      description: "",
      active: true,
      error: null,
      saving: false,
    });
  }

  function openEditPartner(partner: CoveragePartner) {
    setNotice(null);
    setPartnerForm({
      id: partner.id,
      name: partner.name,
      code: partner.code,
      description: partner.description ?? "",
      active: partner.active,
      error: null,
      saving: false,
    });
  }

  async function handlePartnerSubmit(event: FormEvent) {
    event.preventDefault();
    if (!partnerForm || partnerForm.saving) return;
    setPartnerForm({ ...partnerForm, saving: true, error: null });
    try {
      if (partnerForm.id === null) {
        await createCoveragePartner({
          name: partnerForm.name,
          code: partnerForm.code,
          description: partnerForm.description || undefined,
          active: partnerForm.active,
        });
      } else {
        await updateCoveragePartner(partnerForm.id, {
          name: partnerForm.name,
          code: partnerForm.code,
          description: partnerForm.description || null,
        });
      }
      const created = partnerForm.id === null;
      setPartnerForm(null);
      await afterCoverageMutation(created ? "Parceiro criado." : "Parceiro atualizado.");
    } catch (err) {
      setPartnerForm({
        ...partnerForm,
        saving: false,
        error: apiErrorMessage(err, "Falha ao salvar o parceiro."),
      });
    }
  }

  function askPartnerStatus(partner: CoveragePartner) {
    setNotice(null);
    const activating = !partner.active;
    setConfirm({
      title: activating ? "Reativar parceiro" : "Inativar parceiro",
      body: activating
        ? `As camadas ativas de ${partner.name} voltarão a participar das consultas de viabilidade. Deseja continuar?`
        : "Ao inativar este parceiro, todas as camadas dele deixarão de participar das consultas de viabilidade. Deseja continuar?",
      confirmLabel: activating ? "Reativar" : "Inativar",
      danger: !activating,
      running: false,
      error: null,
      run: async () => {
        await setCoveragePartnerStatus(partner.id, activating);
        setConfirm(null);
        await afterCoverageMutation(activating ? "Parceiro reativado." : "Parceiro inativado.");
      },
    });
  }

  // ── Camadas: ações ─────────────────────────────────────────
  function openUpload() {
    setNotice(null);
    setUpload({
      partnerId: "",
      name: "",
      description: "",
      version: "",
      active: true,
      file: null,
      error: null,
      uploading: false,
    });
  }

  function validateUpload(state: UploadFormState): string | null {
    if (!state.partnerId) return "Selecione o parceiro.";
    if (!state.name.trim()) return "Informe o nome da camada.";
    if (!state.file) return "Selecione o arquivo KML ou KMZ.";
    const lower = state.file.name.toLowerCase();
    if (!lower.endsWith(".kml") && !lower.endsWith(".kmz")) {
      return "Extensão não suportada: envie um arquivo .kml ou .kmz.";
    }
    if (state.file.size === 0) return "O arquivo selecionado está vazio.";
    if (state.file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      return `O arquivo excede o limite de ${MAX_UPLOAD_MB} MB.`;
    }
    return null;
  }

  async function handleUploadSubmit(event: FormEvent) {
    event.preventDefault();
    if (!upload || upload.uploading) return;
    const validationError = validateUpload(upload);
    if (validationError) {
      setUpload({ ...upload, error: validationError });
      return;
    }
    setUpload({ ...upload, error: null, uploading: true });
    try {
      const { layer } = await createCoverageLayer({
        file: upload.file!,
        partnerId: upload.partnerId,
        name: upload.name.trim(),
        description: upload.description.trim() || undefined,
        version: upload.version.trim() || undefined,
        active: upload.active,
      });
      setUpload(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await afterCoverageMutation(
        `Camada importada: ${layer.areaCount} área(s) e ${layer.polygonCount} polígono(s) carregados.`
      );
    } catch (err) {
      setUpload((current) =>
        current
          ? {
              ...current,
              uploading: false,
              error: apiErrorMessage(err, "Falha ao enviar o arquivo."),
            }
          : current
      );
    }
  }

  function openLayerEdit(layer: CoverageLayer) {
    setNotice(null);
    setLayerEdit({
      layer,
      name: layer.name,
      description: layer.description ?? "",
      version: layer.version ?? "",
      error: null,
      saving: false,
    });
  }

  async function handleLayerEditSubmit(event: FormEvent) {
    event.preventDefault();
    if (!layerEdit || layerEdit.saving) return;
    setLayerEdit({ ...layerEdit, saving: true, error: null });
    try {
      await updateCoverageLayer(layerEdit.layer.id, {
        name: layerEdit.name,
        description: layerEdit.description || null,
        version: layerEdit.version || null,
      });
      setLayerEdit(null);
      await afterCoverageMutation("Camada atualizada.");
    } catch (err) {
      setLayerEdit({
        ...layerEdit,
        saving: false,
        error: apiErrorMessage(err, "Falha ao atualizar a camada."),
      });
    }
  }

  function askLayerStatus(layer: CoverageLayer) {
    setNotice(null);
    const activating = !layer.active;
    setConfirm({
      title: activating ? "Ativar camada" : "Inativar camada",
      body: activating
        ? "Esta camada voltará a participar das consultas de viabilidade. Deseja continuar?"
        : "Esta camada deixará de participar das consultas de viabilidade. Deseja continuar?",
      confirmLabel: activating ? "Ativar" : "Inativar",
      danger: !activating,
      running: false,
      error: null,
      run: async () => {
        await setCoverageLayerStatus(layer.id, activating);
        setConfirm(null);
        await afterCoverageMutation(activating ? "Camada ativada." : "Camada inativada.");
      },
    });
  }

  function askLayerDelete(layer: CoverageLayer) {
    setNotice(null);
    setConfirm({
      title: "Excluir camada",
      body:
        `Camada: ${layer.name} · Parceiro: ${layer.partner.name} · Arquivo: ${layer.originalFileName}. ` +
        "A camada será removida do sistema e o arquivo armazenado será excluído. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir camada",
      danger: true,
      running: false,
      error: null,
      run: async () => {
        await deleteCoverageLayer(layer.id);
        setConfirm(null);
        await afterCoverageMutation("Camada excluída.");
      },
    });
  }

  function askReload() {
    setNotice(null);
    setConfirm({
      title: "Recarregar coberturas",
      body: "O índice de cobertura será reconstruído a partir das camadas ativas cadastradas. Deseja continuar?",
      confirmLabel: "Recarregar",
      running: false,
      error: null,
      run: async () => {
        setReloading(true);
        try {
          const summary = await reloadCoverageSnapshot();
          setConfirm(null);
          const duration =
            summary.durationMs !== undefined ? ` em ${summary.durationMs} ms` : "";
          await afterCoverageMutation(
            `Coberturas recarregadas${duration}: ${summary.totalPartners} parceiro(s), ` +
              `${summary.totalLayers} camada(s), ${summary.totalAreas} área(s), ` +
              `${summary.totalPolygons} polígono(s).`
          );
        } finally {
          setReloading(false);
        }
      },
    });
  }

  async function runConfirm() {
    if (!confirm || confirm.running) return;
    setConfirm({ ...confirm, running: true, error: null });
    try {
      await confirm.run();
    } catch (err) {
      setConfirm((current) =>
        current
          ? {
              ...current,
              running: false,
              error: apiErrorMessage(err, "Falha ao executar a operação."),
            }
          : current
      );
    }
  }

  const partnersTotalPages = Math.max(1, Math.ceil(partnersTotal / LIMIT));
  const layersTotalPages = Math.max(1, Math.ceil(layersTotal / LIMIT));

  const inputClass = "rounded border border-ink/20 px-3 py-2 text-sm";
  const primaryButton =
    "rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60";
  const secondaryButton =
    "rounded border border-ink/20 px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5 disabled:opacity-60";
  const linkButton = "text-xs font-medium text-petrol-800 hover:underline disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Administração de coberturas" className="flex gap-1">
          {(["parceiros", "camadas"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
              className={
                tab === key
                  ? "rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white"
                  : "rounded px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5"
              }
            >
              {key === "parceiros" ? "Parceiros" : "Camadas"}
            </button>
          ))}
        </div>
        <button type="button" onClick={askReload} disabled={reloading} className={secondaryButton}>
          {reloading ? "Recarregando…" : "Recarregar coberturas"}
        </button>
      </div>

      {notice && (
        <p role="status" className="rounded bg-signal-viable/10 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {tab === "parceiros" && (
        <section className="space-y-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Parceiros de cobertura</h2>
            <button type="button" onClick={openNewPartner} className={primaryButton}>
              Novo parceiro
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label htmlFor="partner-search" className="text-xs font-medium text-ink/60">
                Buscar
              </label>
              <input
                id="partner-search"
                value={partnerSearchInput}
                onChange={(event) => setPartnerSearchInput(event.target.value)}
                placeholder="Nome ou código"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setPartnersPage(1);
                setPartnerSearch(partnerSearchInput);
              }}
              className={secondaryButton}
            >
              Buscar
            </button>
            <div className="flex flex-col">
              <label htmlFor="partner-active" className="text-xs font-medium text-ink/60">
                Status
              </label>
              <select
                id="partner-active"
                value={partnerActiveFilter}
                onChange={(event) => {
                  setPartnersPage(1);
                  setPartnerActiveFilter(event.target.value as "" | "true" | "false");
                }}
                className={inputClass}
              >
                <option value="">Todos</option>
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </div>
          </div>

          {partnersError && (
            <p role="alert" className="text-sm text-signal-blocked">
              {partnersError}
            </p>
          )}
          {partnersLoading ? (
            <p className="text-sm text-ink/60">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                    <th className="py-2 pr-3">Nome</th>
                    <th className="py-2 pr-3">Código</th>
                    <th className="py-2 pr-3">Camadas</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Atualizado em</th>
                    <th className="py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((partner) => (
                    <tr key={partner.id} className="border-b border-ink/5">
                      <td className="py-2 pr-3 font-medium">{partner.name}</td>
                      <td className="py-2 pr-3 font-mono text-xs uppercase">{partner.code}</td>
                      <td className="py-2 pr-3">{partner.layerCount ?? 0}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            partner.active
                              ? "rounded bg-signal-viable/15 px-2 py-0.5 text-xs text-emerald-900"
                              : "rounded bg-ink/10 px-2 py-0.5 text-xs text-ink/60"
                          }
                        >
                          {partner.active ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink/60">
                        {formatDate(partner.updatedAt)}
                      </td>
                      <td className="py-2">
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => openEditPartner(partner)}
                            className={linkButton}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => askPartnerStatus(partner)}
                            className={linkButton}
                          >
                            {partner.active ? "Inativar" : "Reativar"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {partners.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-sm text-ink/50">
                        Nenhum parceiro encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-ink/60">
            <span>
              {partnersTotal} parceiro(s) · página {partnersPage} de {partnersTotalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={partnersPage <= 1}
                onClick={() => setPartnersPage((value) => Math.max(1, value - 1))}
                className={linkButton}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={partnersPage >= partnersTotalPages}
                onClick={() => setPartnersPage((value) => Math.min(partnersTotalPages, value + 1))}
                className={linkButton}
              >
                Próxima
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === "camadas" && (
        <section className="space-y-3 rounded-lg border border-ink/10 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Camadas de cobertura</h2>
            <button type="button" onClick={openUpload} className={primaryButton}>
              Enviar KML/KMZ
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col">
              <label htmlFor="layer-search" className="text-xs font-medium text-ink/60">
                Buscar
              </label>
              <input
                id="layer-search"
                value={layerSearchInput}
                onChange={(event) => setLayerSearchInput(event.target.value)}
                placeholder="Nome ou versão"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setLayersPage(1);
                setLayerSearch(layerSearchInput);
              }}
              className={secondaryButton}
            >
              Buscar
            </button>
            <div className="flex flex-col">
              <label htmlFor="layer-partner" className="text-xs font-medium text-ink/60">
                Parceiro
              </label>
              <select
                id="layer-partner"
                value={layerPartnerFilter}
                onChange={(event) => {
                  setLayersPage(1);
                  setLayerPartnerFilter(event.target.value);
                }}
                className={inputClass}
              >
                <option value="">Todos</option>
                {partnerOptions.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col">
              <label htmlFor="layer-active" className="text-xs font-medium text-ink/60">
                Status
              </label>
              <select
                id="layer-active"
                value={layerActiveFilter}
                onChange={(event) => {
                  setLayersPage(1);
                  setLayerActiveFilter(event.target.value as "" | "true" | "false");
                }}
                className={inputClass}
              >
                <option value="">Todos</option>
                <option value="true">Ativas</option>
                <option value="false">Inativas</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label htmlFor="layer-processing" className="text-xs font-medium text-ink/60">
                Processamento
              </label>
              <select
                id="layer-processing"
                value={layerProcessingFilter}
                onChange={(event) => {
                  setLayersPage(1);
                  setLayerProcessingFilter(
                    event.target.value as "" | CoverageProcessingStatus
                  );
                }}
                className={inputClass}
              >
                <option value="">Todos</option>
                <option value="PENDING">Aguardando</option>
                <option value="PROCESSING">Processando</option>
                <option value="READY">Prontas</option>
                <option value="FAILED">Falharam</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label htmlFor="layer-type" className="text-xs font-medium text-ink/60">
                Tipo
              </label>
              <select
                id="layer-type"
                value={layerTypeFilter}
                onChange={(event) => {
                  setLayersPage(1);
                  setLayerTypeFilter(event.target.value as "" | CoverageFileType);
                }}
                className={inputClass}
              >
                <option value="">Todos</option>
                <option value="KML">KML</option>
                <option value="KMZ">KMZ</option>
              </select>
            </div>
          </div>

          {layersError && (
            <p role="alert" className="text-sm text-signal-blocked">
              {layersError}
            </p>
          )}
          {layersLoading ? (
            <p className="text-sm text-ink/60">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                    <th className="py-2 pr-3">Camada</th>
                    <th className="py-2 pr-3">Parceiro</th>
                    <th className="py-2 pr-3">Arquivo</th>
                    <th className="py-2 pr-3">Versão</th>
                    <th className="py-2 pr-3">Processamento</th>
                    <th className="py-2 pr-3">Áreas</th>
                    <th className="py-2 pr-3">Polígonos</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {layers.map((layer) => {
                    const processing = PROCESSING_META[layer.processingStatus];
                    return (
                      <tr key={layer.id} className="border-b border-ink/5 align-top">
                        <td className="py-2 pr-3 font-medium">{layer.name}</td>
                        <td className="py-2 pr-3">{layer.partner.name}</td>
                        <td className="py-2 pr-3 text-xs text-ink/70">
                          {layer.originalFileName}
                          <span className="block text-[11px] text-ink/50">
                            {layer.fileType} · {formatFileSize(layer.fileSize)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs">{layer.version ?? "—"}</td>
                        <td className="py-2 pr-3">
                          <span className={`rounded px-2 py-0.5 text-xs ${processing.badge}`}>
                            {processing.label}
                          </span>
                          {layer.processingStatus === "FAILED" && layer.processingError && (
                            <div className="mt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedErrorLayerId((current) =>
                                    current === layer.id ? null : layer.id
                                  )
                                }
                                className="text-[11px] text-ink/50 underline decoration-dotted"
                              >
                                {expandedErrorLayerId === layer.id
                                  ? "Ocultar motivo"
                                  : "Ver motivo"}
                              </button>
                              {expandedErrorLayerId === layer.id && (
                                <p className="mt-1 max-w-xs rounded bg-ink/5 px-2 py-1 text-[11px] text-ink/70">
                                  {layer.processingError}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3">{layer.areaCount}</td>
                        <td className="py-2 pr-3">{layer.polygonCount}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={
                              layer.active
                                ? "rounded bg-signal-viable/15 px-2 py-0.5 text-xs text-emerald-900"
                                : "rounded bg-ink/10 px-2 py-0.5 text-xs text-ink/60"
                            }
                          >
                            {layer.active ? "Ativa" : "Inativa"}
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => openLayerEdit(layer)}
                              className={linkButton}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => askLayerStatus(layer)}
                              disabled={!layer.active && layer.processingStatus !== "READY"}
                              title={
                                !layer.active && layer.processingStatus !== "READY"
                                  ? "Somente camadas prontas podem ser ativadas."
                                  : undefined
                              }
                              className={linkButton}
                            >
                              {layer.active ? "Inativar" : "Ativar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => askLayerDelete(layer)}
                              disabled={layer.processingStatus === "PROCESSING"}
                              title={
                                layer.processingStatus === "PROCESSING"
                                  ? "Não é possível excluir uma camada enquanto ela está sendo processada."
                                  : undefined
                              }
                              className="text-xs font-medium text-signal-blocked hover:underline disabled:opacity-50"
                            >
                              Excluir
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {layers.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-sm text-ink/50">
                        Nenhuma camada encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-ink/60">
            <span>
              {layersTotal} camada(s) · página {layersPage} de {layersTotalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={layersPage <= 1}
                onClick={() => setLayersPage((value) => Math.max(1, value - 1))}
                className={linkButton}
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={layersPage >= layersTotalPages}
                onClick={() => setLayersPage((value) => Math.min(layersTotalPages, value + 1))}
                className={linkButton}
              >
                Próxima
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Modal de parceiro (criar/editar) ─────────────────── */}
      {partnerForm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={partnerForm.id === null ? "Novo parceiro" : "Editar parceiro"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !partnerForm.saving) setPartnerForm(null);
          }}
        >
          <form
            onSubmit={handlePartnerSubmit}
            className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-ink/10 bg-white p-5 shadow-lg"
          >
            <h3 className="text-sm font-semibold text-ink">
              {partnerForm.id === null ? "Novo parceiro" : "Editar parceiro"}
            </h3>

            <label className="mt-4 block text-xs font-medium text-ink/70" htmlFor="pf-name">
              Nome
            </label>
            <input
              id="pf-name"
              required
              value={partnerForm.name}
              onChange={(event) => setPartnerForm({ ...partnerForm, name: event.target.value })}
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />

            <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="pf-code">
              Código
            </label>
            <input
              id="pf-code"
              required
              value={partnerForm.code}
              onChange={(event) => setPartnerForm({ ...partnerForm, code: event.target.value })}
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 font-mono text-sm uppercase"
            />
            <p className="mt-1 text-[11px] text-ink/50">
              Letras, números, hífen e sublinhado. Será gravado em maiúsculas.
            </p>

            <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="pf-description">
              Descrição
            </label>
            <textarea
              id="pf-description"
              rows={2}
              value={partnerForm.description}
              onChange={(event) =>
                setPartnerForm({ ...partnerForm, description: event.target.value })
              }
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />

            {partnerForm.id === null && (
              <label className="mt-3 flex items-center gap-2 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={partnerForm.active}
                  onChange={(event) =>
                    setPartnerForm({ ...partnerForm, active: event.target.checked })
                  }
                  className="h-4 w-4 rounded border-ink/30"
                />
                Ativo
              </label>
            )}

            {partnerForm.error && (
              <p role="alert" className="mt-3 text-sm text-signal-blocked">
                {partnerForm.error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={partnerForm.saving} className={primaryButton}>
                {partnerForm.saving ? "Salvando…" : "Salvar parceiro"}
              </button>
              <button
                type="button"
                onClick={() => setPartnerForm(null)}
                disabled={partnerForm.saving}
                className={secondaryButton}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal de upload ──────────────────────────────────── */}
      {upload && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enviar camada KML/KMZ"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !upload.uploading) setUpload(null);
          }}
        >
          <form
            onSubmit={handleUploadSubmit}
            className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-ink/10 bg-white p-5 shadow-lg"
          >
            <h3 className="text-sm font-semibold text-ink">Enviar camada KML/KMZ</h3>

            <fieldset disabled={upload.uploading} className="contents">
              <label className="mt-4 block text-xs font-medium text-ink/70" htmlFor="up-partner">
                Parceiro
              </label>
              <select
                id="up-partner"
                value={upload.partnerId}
                onChange={(event) => setUpload({ ...upload, partnerId: event.target.value })}
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
              >
                <option value="">Selecione…</option>
                {partnerOptions
                  .filter((partner) => partner.active)
                  .map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
              </select>

              <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="up-name">
                Nome da camada
              </label>
              <input
                id="up-name"
                value={upload.name}
                onChange={(event) => setUpload({ ...upload, name: event.target.value })}
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
              />

              <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="up-description">
                Descrição (opcional)
              </label>
              <input
                id="up-description"
                value={upload.description}
                onChange={(event) => setUpload({ ...upload, description: event.target.value })}
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
              />

              <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="up-version">
                Versão (opcional)
              </label>
              <input
                id="up-version"
                value={upload.version}
                onChange={(event) => setUpload({ ...upload, version: event.target.value })}
                placeholder="ex.: 2026-07"
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
              />

              <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="up-file">
                Arquivo KML/KMZ
              </label>
              <input
                id="up-file"
                ref={fileInputRef}
                type="file"
                accept=".kml,.kmz"
                onChange={(event) =>
                  setUpload({ ...upload, file: event.target.files?.[0] ?? null })
                }
                className="mt-1 w-full text-sm"
              />
              <p className="mt-1 text-[11px] text-ink/50">
                Somente .kml ou .kmz, até {MAX_UPLOAD_MB} MB.
              </p>
              {upload.file && (
                <p className="mt-1 text-xs text-ink/70">
                  Selecionado: {upload.file.name} ({formatFileSize(upload.file.size)})
                </p>
              )}

              <label className="mt-3 flex items-center gap-2 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={upload.active}
                  onChange={(event) => setUpload({ ...upload, active: event.target.checked })}
                  className="h-4 w-4 rounded border-ink/30"
                />
                Ativa após importação
              </label>
            </fieldset>

            {upload.error && (
              <p role="alert" className="mt-3 text-sm text-signal-blocked">
                {upload.error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={upload.uploading} className={primaryButton}>
                {upload.uploading ? "Enviando e processando…" : "Enviar camada"}
              </button>
              <button
                type="button"
                onClick={() => setUpload(null)}
                disabled={upload.uploading}
                className={secondaryButton}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal de edição de camada (arquivo/parceiro imutáveis) ── */}
      {layerEdit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Editar camada ${layerEdit.layer.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !layerEdit.saving) setLayerEdit(null);
          }}
        >
          <form
            onSubmit={handleLayerEditSubmit}
            className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-ink/10 bg-white p-5 shadow-lg"
          >
            <h3 className="text-sm font-semibold text-ink">Editar camada</h3>
            <p className="mt-1 text-xs text-ink/60">
              Parceiro: <span className="font-medium text-ink">{layerEdit.layer.partner.name}</span>{" "}
              · Arquivo: {layerEdit.layer.originalFileName}
            </p>
            <p className="mt-1 text-[11px] text-ink/50">
              O arquivo e o parceiro não podem ser alterados. Para trocar o arquivo, envie uma
              nova camada.
            </p>

            <label className="mt-4 block text-xs font-medium text-ink/70" htmlFor="le-name">
              Nome
            </label>
            <input
              id="le-name"
              required
              value={layerEdit.name}
              onChange={(event) => setLayerEdit({ ...layerEdit, name: event.target.value })}
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />

            <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="le-description">
              Descrição
            </label>
            <input
              id="le-description"
              value={layerEdit.description}
              onChange={(event) =>
                setLayerEdit({ ...layerEdit, description: event.target.value })
              }
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />

            <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="le-version">
              Versão
            </label>
            <input
              id="le-version"
              value={layerEdit.version}
              onChange={(event) => setLayerEdit({ ...layerEdit, version: event.target.value })}
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />

            {layerEdit.error && (
              <p role="alert" className="mt-3 text-sm text-signal-blocked">
                {layerEdit.error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={layerEdit.saving} className={primaryButton}>
                {layerEdit.saving ? "Salvando…" : "Salvar camada"}
              </button>
              <button
                type="button"
                onClick={() => setLayerEdit(null)}
                disabled={layerEdit.saving}
                className={secondaryButton}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal de confirmação genérico ────────────────────── */}
      {confirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={confirm.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !confirm.running) setConfirm(null);
          }}
        >
          <div className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-ink/10 bg-white p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-ink">{confirm.title}</h3>
            <p className="mt-2 text-sm text-ink/70">{confirm.body}</p>
            {confirm.error && (
              <p role="alert" className="mt-3 text-sm text-signal-blocked">
                {confirm.error}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void runConfirm()}
                disabled={confirm.running}
                className={
                  confirm.danger
                    ? "rounded bg-signal-blocked px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    : primaryButton
                }
              >
                {confirm.running ? "Executando…" : confirm.confirmLabel}
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                disabled={confirm.running}
                className={secondaryButton}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
