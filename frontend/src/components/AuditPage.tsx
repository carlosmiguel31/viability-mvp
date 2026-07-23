import { useCallback, useEffect, useState } from "react";
import { listAuditLogs, listUsers } from "../api";
import { AuditLogEntry, PublicUser } from "../types";

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Login realizado",
  LOGIN_FAILED: "Falha de login",
  LOGOUT: "Logout",
  USER_CREATED: "Usuário criado",
  USER_UPDATED: "Usuário atualizado",
  USER_ACTIVATED: "Usuário reativado",
  USER_DEACTIVATED: "Usuário inativado",
  USER_ROLE_CHANGED: "Perfil alterado",
  USER_PASSWORD_RESET: "Senha redefinida",
  COVERAGE_RELOADED: "Manchas recarregadas",
};

/** Trilha de auditoria — acessível apenas para ADMIN. */
export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAuditLogs({
        page,
        action: action || undefined,
        userId: userId || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a auditoria.");
    } finally {
      setLoading(false);
    }
  }, [page, action, userId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opções do filtro de usuário: carrega TODAS as páginas (não assume que
  // existem só 20 usuários), com limite seguro de páginas.
  useEffect(() => {
    const MAX_FILTER_PAGES = 25; // 25 × 20 = até 500 usuários no filtro
    let cancelled = false;
    (async () => {
      try {
        const collected: PublicUser[] = [];
        let currentPage = 1;
        for (;;) {
          const data = await listUsers({ page: currentPage });
          collected.push(...data.users);
          const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
          if (currentPage >= totalPages || currentPage >= MAX_FILTER_PAGES) break;
          currentPage += 1;
        }
        if (!cancelled) setUsers(collected);
      } catch {
        if (!cancelled) setUsers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="audit-action">
            Ação
          </label>
          <select
            id="audit-action"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className="mt-1 rounded border border-ink/20 px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="audit-user">
            Usuário
          </label>
          <select
            id="audit-user"
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setPage(1);
            }}
            className="mt-1 max-w-56 rounded border border-ink/20 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="audit-from">
            Data inicial
          </label>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className="mt-1 rounded border border-ink/20 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="audit-to">
            Data final
          </label>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className="mt-1 rounded border border-ink/20 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded border border-signal-blocked/40 bg-white px-3 py-2 text-sm text-signal-blocked">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase text-ink/50">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Ação</th>
              <th className="px-4 py-3">Usuário</th>
              <th className="px-4 py-3">Entidade</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink/50">
                  Carregando…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink/50">
                  Nenhum registro encontrado.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="border-b border-ink/5">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink/70">
                    {new Date(log.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">{ACTION_LABELS[log.action] ?? log.action}</td>
                  <td className="px-4 py-3 text-ink/70">
                    {log.user ? `${log.user.name} (${log.user.email})` : "—"}
                  </td>
                  <td className="px-4 py-3 text-ink/60">
                    {log.entity}
                    {log.entityId ? ` · ${log.entityId.slice(0, 8)}…` : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-ink/60">
        <span>
          {total} registro(s) · página {page} de {totalPages}
        </span>
        <div className="space-x-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            className="rounded border border-ink/20 px-3 py-1.5 transition hover:bg-ink/5 disabled:opacity-40"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="rounded border border-ink/20 px-3 py-1.5 transition hover:bg-ink/5 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
