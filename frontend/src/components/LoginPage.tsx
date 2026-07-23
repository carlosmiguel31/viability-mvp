import { FormEvent, useState } from "react";
import { ApiError, login } from "../auth";

/**
 * Tela de login (substitui a antiga tela de chave compartilhada).
 * Mensagem de erro sempre genérica: nunca revela qual campo está incorreto.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(email, password); // sucesso: App reage via onSessionChange
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 401 || err.status === 400)
          ? "E-mail ou senha inválidos."
          : "Não foi possível entrar. Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-ink/10 bg-white p-6 shadow-sm"
      >
        <h1 className="font-display text-lg font-semibold tracking-tight text-ink">
          Viabilidade de fibra · rede neutra
        </h1>
        <p className="mt-1 text-xs text-ink/60">Entre com o seu usuário para consultar.</p>

        <label className="mt-5 block text-xs font-medium text-ink/70" htmlFor="login-email">
          E-mail
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded border border-ink/20 px-3 py-2 text-sm focus:border-petrol-800 focus:outline-none focus:ring-1 focus:ring-petrol-800"
        />

        <label className="mt-4 block text-xs font-medium text-ink/70" htmlFor="login-password">
          Senha
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-ink/20 px-3 py-2 text-sm focus:border-petrol-800 focus:outline-none focus:ring-1 focus:ring-petrol-800"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="whitespace-nowrap rounded border border-ink/20 px-3 text-xs text-ink/70 transition hover:bg-ink/5"
            aria-pressed={showPassword}
          >
            {showPassword ? "Ocultar" : "Mostrar"}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-signal-blocked">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 w-full rounded bg-petrol-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
