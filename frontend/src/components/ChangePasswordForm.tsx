import { FormEvent, useState } from "react";
import { ApiError, changeOwnPassword } from "../auth";

/**
 * Alteração da própria senha. Sucesso revoga todas as sessões no backend e
 * exige novo login — o próprio cliente encerra a sessão local em seguida.
 */
export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("A confirmação deve ser igual à nova senha.");
      return;
    }
    setSaving(true);
    try {
      await changeOwnPassword({ currentPassword, newPassword, confirmPassword });
      // Sucesso: a sessão já foi encerrada e o App volta à tela de login.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível alterar a senha.");
      setSaving(false);
    }
  }

  const inputType = showPasswords ? "text" : "password";

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-sm rounded-lg border border-ink/10 bg-white p-5 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-ink">Alterar minha senha</h2>
      <p className="mt-1 text-xs text-ink/60">
        Após a alteração, todas as suas sessões serão encerradas e será
        necessário entrar novamente.
      </p>

      <label className="mt-4 block text-xs font-medium text-ink/70" htmlFor="current-password">
        Senha atual
      </label>
      <input
        id="current-password"
        type={inputType}
        autoComplete="current-password"
        required
        value={currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
      />

      <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="new-password">
        Nova senha
      </label>
      <input
        id="new-password"
        type={inputType}
        autoComplete="new-password"
        required
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
      />
      <p className="mt-1 text-[11px] text-ink/50">
        Mínimo de 8 caracteres, com letra maiúscula, minúscula e número.
      </p>

      <label className="mt-3 block text-xs font-medium text-ink/70" htmlFor="confirm-password">
        Confirmar nova senha
      </label>
      <input
        id="confirm-password"
        type={inputType}
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm"
      />

      <label className="mt-3 flex items-center gap-2 text-xs text-ink/60">
        <input
          type="checkbox"
          checked={showPasswords}
          onChange={(event) => setShowPasswords(event.target.checked)}
          className="h-4 w-4 rounded border-ink/30"
        />
        Mostrar senhas
      </label>

      {error && (
        <p role="alert" className="mt-3 text-sm text-signal-blocked">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="mt-4 w-full rounded bg-petrol-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {saving ? "Alterando…" : "Alterar senha"}
      </button>
    </form>
  );
}
