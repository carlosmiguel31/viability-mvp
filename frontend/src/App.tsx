import { useCallback, useEffect, useState } from "react";
import LoginPage from "./components/LoginPage";
import ConsultaPage from "./components/ConsultaPage";
import UsersPage from "./components/UsersPage";
import ChangePasswordForm from "./components/ChangePasswordForm";
import AuditPage from "./components/AuditPage";
import CoverageAdminPage from "./components/CoverageAdminPage";
import ConsultationHistoryPage from "./components/ConsultationHistoryPage";
import { logout, onSessionChange, restoreSession, SessionUser } from "./auth";
import { fetchCoverageStatus } from "./api";
import { CoverageStatus, ROLE_LABELS } from "./types";

type View = "consulta" | "historico" | "coberturas" | "usuarios" | "auditoria" | "senha";

const MENU: Array<{ view: View; label: string; adminOnly: boolean }> = [
  { view: "consulta", label: "Nova consulta", adminOnly: false },
  { view: "historico", label: "Histórico", adminOnly: false },
  { view: "coberturas", label: "Coberturas", adminOnly: true },
  { view: "usuarios", label: "Usuários", adminOnly: true },
  { view: "auditoria", label: "Auditoria", adminOnly: true },
  { view: "senha", label: "Alterar minha senha", adminOnly: false },
];

/** Texto do cabeçalho a partir do status v0.3.0 (múltiplas camadas). */
export function coverageHeaderText(coverage: CoverageStatus | null): string {
  if (coverage === null) return "Status da cobertura indisponível";
  if (!coverage.configured) return "Nenhuma cobertura configurada";
  return (
    `${coverage.totalPartners} parceiro(s) · ${coverage.totalLayers} camada(s) · ` +
    `${coverage.totalAreas} área(s) · ${coverage.totalPolygons} polígono(s)`
  );
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [view, setView] = useState<View>("consulta");
  const [coverage, setCoverage] = useState<CoverageStatus | null>(null);

  // Sessão reativa: login/logout/expiração em qualquer ponto refletem aqui.
  useEffect(() => onSessionChange(setUser), []);

  // Nova aba/recarga: restaura a sessão pelo cookie HttpOnly de refresh.
  useEffect(() => {
    restoreSession().finally(() => setRestoring(false));
  }, []);

  const refreshCoverageStatus = useCallback(async () => {
    try {
      setCoverage(await fetchCoverageStatus());
    } catch {
      setCoverage(null);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setView("consulta");
      setCoverage(null);
      return;
    }
    void refreshCoverageStatus();
  }, [user, refreshCoverageStatus]);

  if (restoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mist text-sm text-ink/60">
        Carregando…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const menuItems = MENU.filter((item) => !item.adminOnly || user.role === "ADMIN");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-ink/10 bg-petrol-800 text-white">
        <div className="mx-auto flex max-w-6xl items-baseline justify-between px-4 py-4">
          <div>
            <h1 className="font-display text-lg font-semibold tracking-tight">
              Viabilidade de fibra · rede neutra
            </h1>
            <p className="text-xs text-white/60">
              Consulta por endereço · manchas de cobertura + pontos de rede
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right font-mono text-[11px] text-white/70">
              {coverageHeaderText(coverage)}
            </div>
            <div className="text-right text-xs">
              <p className="font-medium text-white">{user.name}</p>
              <p className="text-white/60">{ROLE_LABELS[user.role]}</p>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded border border-white/25 px-3 py-1.5 text-xs font-medium text-white/85 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
              title="Encerra a sessão e volta à tela de login"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-4 px-4 py-5">
        <nav aria-label="Menu principal" className="w-44 shrink-0">
          <ul className="space-y-1">
            {menuItems.map((item) => (
              <li key={item.view}>
                <button
                  type="button"
                  onClick={() => setView(item.view)}
                  aria-current={view === item.view ? "page" : undefined}
                  className={
                    view === item.view
                      ? "w-full rounded bg-petrol-800 px-3 py-2 text-left text-sm font-semibold text-white"
                      : "w-full rounded px-3 py-2 text-left text-sm text-ink/70 transition hover:bg-ink/5"
                  }
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          {view === "consulta" && <ConsultaPage />}
          {view === "historico" && <ConsultationHistoryPage currentUser={user} />}
          {view === "senha" && <ChangePasswordForm />}
          {view === "coberturas" && user.role === "ADMIN" && (
            <CoverageAdminPage onCoverageChanged={refreshCoverageStatus} />
          )}
          {view === "usuarios" && user.role === "ADMIN" && <UsersPage currentUser={user} />}
          {view === "auditoria" && user.role === "ADMIN" && <AuditPage />}
        </main>
      </div>
    </div>
  );
}
