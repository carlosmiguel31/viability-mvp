import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserStatus,
  updateUser,
} from "../api";
import { ApiError, logout, SessionUser } from "../auth";
import { PublicUser, ROLE_LABELS, UserRole } from "../types";

const ROLES: UserRole[] = ["ADMIN", "OPERATOR", "TECHNICIAN", "VIEWER"];

interface FormState {
  id: string | null; // null = novo usuário
  name: string;
  email: string;
  role: UserRole;
  password: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  email: "",
  role: "OPERATOR",
  password: "",
  active: true,
};

interface ResetState {
  user: PublicUser;
  newPassword: string;
  confirmPassword: string;
  showPasswords: boolean;
  error: string | null;
  saving: boolean;
}

/** Administração de usuários — visível e acessível apenas para ADMIN. */
export default function UsersPage({ currentUser }: { currentUser: SessionUser }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [reset, setReset] = useState<ResetState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listUsers({ search, role: roleFilter, active: activeFilter, page });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, activeFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setNotice(null);
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(user: PublicUser) {
    setNotice(null);
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      password: "",
      active: user.active,
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (form.id === null) {
        await createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          active: form.active,
        });
        setNotice("Usuário criado.");
      } else {
        const original = users.find((user) => user.id === form.id);
        if (
          original &&
          original.role !== form.role &&
          !window.confirm(
            `Alterar o perfil de ${original.name} de ${ROLE_LABELS[original.role]} para ${ROLE_LABELS[form.role]}?`
          )
        ) {
          setSaving(false);
          return;
        }
        await updateUser(form.id, { name: form.name, email: form.email, role: form.role });
        setNotice("Usuário atualizado.");
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao salvar usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(user: PublicUser) {
    const isSelfDeactivation = user.active && user.id === currentUser.id;
    const confirmed = isSelfDeactivation
      ? window.confirm(
          "Você está prestes a inativar a PRÓPRIA conta.\n" +
            "Sua sessão será encerrada imediatamente e você voltará à tela de login.\n\n" +
            "Deseja continuar?"
        )
      : window.confirm(`${user.active ? "Inativar" : "Reativar"} ${user.name}?`);
    if (!confirmed) return;
    setError(null);
    try {
      await setUserStatus(user.id, !user.active, isSelfDeactivation ? true : undefined);
      if (isSelfDeactivation) {
        await logout(); // desconecta e volta ao login
        return;
      }
      setNotice(user.active ? "Usuário inativado." : "Usuário reativado.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao alterar o status.");
    }
  }

  function openReset(user: PublicUser) {
    setNotice(null);
    setReset({
      user,
      newPassword: "",
      confirmPassword: "",
      showPasswords: false,
      error: null,
      saving: false,
    });
  }

  async function handleResetSubmit(event: FormEvent) {
    event.preventDefault();
    if (!reset || reset.saving) return;
    if (reset.newPassword !== reset.confirmPassword) {
      setReset({ ...reset, error: "A confirmação deve ser igual à nova senha." });
      return;
    }
    setReset({ ...reset, error: null, saving: true });
    try {
      await resetUserPassword(reset.user.id, reset.newPassword);
      setReset(null);
      setNotice("Senha redefinida. As sessões anteriores do usuário foram encerradas.");
    } catch (err) {
      setReset({
        ...reset,
        saving: false,
        error: err instanceof ApiError ? err.message : "Falha ao redefinir a senha.",
      });
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="users-search">
            Buscar por nome ou e-mail
          </label>
          <input
            id="users-search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="mt-1 w-56 rounded border border-ink/20 px-3 py-2 text-sm"
            placeholder="ex.: maria"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="users-role">
            Perfil
          </label>
          <select
            id="users-role"
            value={roleFilter}
            onChange={(event) => {
              setRoleFilter(event.target.value as UserRole | "");
              setPage(1);
            }}
            className="mt-1 rounded border border-ink/20 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink/70" htmlFor="users-active">
            Status
          </label>
          <select
            id="users-active"
            value={activeFilter}
            onChange={(event) => {
              setActiveFilter(event.target.value as "" | "true" | "false");
              setPage(1);
            }}
            className="mt-1 rounded border border-ink/20 px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="ml-auto rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Novo usuário
        </button>
      </div>

      {notice && (
        <p className="rounded border border-signal-viable/40 bg-signal-viable/10 px-3 py-2 text-sm text-ink">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-signal-blocked/40 bg-white px-3 py-2 text-sm text-signal-blocked">
          {error}
        </p>
      )}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm"
        >
          <h3 className="text-sm font-semibold text-ink">
            {form.id === null ? "Novo usuário" : "Editar usuário"}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-ink/70">
              Nome
              <input
                required
                minLength={2}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="block text-xs font-medium text-ink/70">
              E-mail
              <input
                required
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="block text-xs font-medium text-ink/70">
              Perfil
              <select
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}
                className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm font-normal"
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            {form.id === null && (
              <label className="block text-xs font-medium text-ink/70">
                Senha inicial
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm font-normal"
                />
              </label>
            )}
            {form.id === null && (
              <label className="flex items-center gap-2 text-xs font-medium text-ink/70">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                  className="h-4 w-4 rounded border-ink/30"
                />
                Ativo
              </label>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded border border-ink/20 px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/10 text-xs uppercase text-ink/50">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink/50">
                  Carregando…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink/50">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="border-b border-ink/5">
                  <td className="px-4 py-3 font-medium text-ink">{user.name}</td>
                  <td className="px-4 py-3 text-ink/70">{user.email}</td>
                  <td className="px-4 py-3">{ROLE_LABELS[user.role]}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        user.active
                          ? "rounded bg-signal-viable/15 px-2 py-0.5 text-xs font-medium text-ink"
                          : "rounded bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60"
                      }
                    >
                      {user.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="space-x-2 whitespace-nowrap px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openEdit(user)}
                      className="text-xs font-medium text-petrol-800 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleActive(user)}
                      className="text-xs font-medium text-petrol-800 hover:underline"
                    >
                      {user.active ? "Inativar" : "Reativar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openReset(user)}
                      className="text-xs font-medium text-petrol-800 hover:underline"
                    >
                      Redefinir senha
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {reset && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Redefinir senha de ${reset.user.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
        >
          <form
            onSubmit={handleResetSubmit}
            className="w-full max-w-sm rounded-lg border border-ink/10 bg-white p-5 shadow-lg"
          >
            <h3 className="text-sm font-semibold text-ink">Redefinir senha</h3>
            <p className="mt-1 text-xs text-ink/60">
              Usuário: <span className="font-medium text-ink">{reset.user.name}</span> (
              {reset.user.email})
            </p>

            <label className="mt-4 block text-xs font-medium text-ink/70" htmlFor="reset-new">
              Nova senha
            </label>
            <input
              id="reset-new"
              type={reset.showPasswords ? "text" : "password"}
              autoComplete="new-password"
              required
              value={reset.newPassword}
              onChange={(event) => setReset({ ...reset, newPassword: event.target.value })}
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-[11px] text-ink/50">
              Mínimo de 8 caracteres, com letra maiúscula, minúscula e número.
            </p>

            <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="reset-confirm">
              Confirmar nova senha
            </label>
            <input
              id="reset-confirm"
              type={reset.showPasswords ? "text" : "password"}
              autoComplete="new-password"
              required
              value={reset.confirmPassword}
              onChange={(event) => setReset({ ...reset, confirmPassword: event.target.value })}
              className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
            />

            <label className="mt-3 flex items-center gap-2 text-xs text-ink/60">
              <input
                type="checkbox"
                checked={reset.showPasswords}
                onChange={(event) => setReset({ ...reset, showPasswords: event.target.checked })}
                className="h-4 w-4 rounded border-ink/30"
              />
              Mostrar senhas
            </label>

            {reset.error && (
              <p role="alert" className="mt-3 text-sm text-signal-blocked">
                {reset.error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="submit"
                disabled={reset.saving}
                className="rounded bg-petrol-800 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {reset.saving ? "Redefinindo…" : "Confirmar redefinição"}
              </button>
              <button
                type="button"
                onClick={() => setReset(null)}
                className="rounded border border-ink/20 px-4 py-2 text-sm text-ink/70 transition hover:bg-ink/5"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink/60">
        <span>
          {total} usuário(s) · página {page} de {totalPages}
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
