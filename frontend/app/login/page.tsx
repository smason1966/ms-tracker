"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    authEnabled,
    login,
    logout,
    mfaChallengeExpiresAt,
    status,
    verifyMfaChallenge,
  } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nextPath = useMemo(() => {
    const requested = searchParams.get("next");
    if (!requested || !requested.startsWith("/") || requested.startsWith("//")) {
      return "/";
    }
    return requested;
  }, [searchParams]);

  useEffect(() => {
    if (!authEnabled || status === "authenticated") {
      router.replace(nextPath);
    }
  }, [authEnabled, nextPath, router, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (status === "mfa_required") {
        await verifyMfaChallenge(
          useRecoveryCode
            ? { recovery_code: recoveryCode }
            : { code: mfaCode },
        );
        router.replace(nextPath);
      } else {
        const result = await login(username, password);
        setPassword("");
        if (!result.mfaRequired) {
          router.replace(nextPath);
        }
      }
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Unable to sign in. Check your credentials and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancelMfaChallenge() {
    setError(null);
    setMfaCode("");
    setRecoveryCode("");
    setUseRecoveryCode(false);
    await logout();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_30rem),linear-gradient(135deg,#050712_0%,#0a1020_52%,#101827_100%)] px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">
            MS Tracker
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Use your admin account to access the operations console.
          </p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {status === "mfa_required" ? (
            <>
              <div className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50">
                Password accepted. Enter your authenticator code to finish
                signing in.
                {mfaChallengeExpiresAt ? (
                  <span className="mt-1 block text-xs text-cyan-100/70">
                    Challenge expires {new Date(mfaChallengeExpiresAt).toLocaleTimeString()}.
                  </span>
                ) : null}
              </div>

              {useRecoveryCode ? (
                <label className="block text-sm font-medium text-slate-200">
                  Recovery code
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm uppercase text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15"
                    onChange={(event) => setRecoveryCode(event.target.value)}
                    required
                    type="text"
                    value={recoveryCode}
                  />
                </label>
              ) : (
                <label className="block text-sm font-medium text-slate-200">
                  Authenticator code
                  <input
                    autoComplete="one-time-code"
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15"
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => setMfaCode(event.target.value)}
                    pattern="[0-9 ]*"
                    required
                    type="text"
                    value={mfaCode}
                  />
                </label>
              )}

              <button
                className="text-sm font-semibold text-cyan-200 transition hover:text-cyan-100"
                onClick={() => {
                  setError(null);
                  setUseRecoveryCode((current) => !current);
                }}
                type="button"
              >
                {useRecoveryCode
                  ? "Use authenticator code"
                  : "Use recovery code"}
              </button>
            </>
          ) : (
            <>
              <label className="block text-sm font-medium text-slate-200">
                Username
                <input
                  autoComplete="username"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15"
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  type="text"
                  value={username}
                />
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Password
                <input
                  autoComplete="current-password"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
            </>
          )}

          {error ? (
            <div className="rounded-lg border border-red-300/30 bg-red-950/35 px-3 py-2 text-sm font-medium text-red-100">
              {error}
            </div>
          ) : null}

          <button
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || status === "loading"}
            type="submit"
          >
            {isSubmitting
              ? "Signing in..."
              : status === "mfa_required"
                ? "Verify and sign in"
                : "Sign in"}
          </button>

          {status === "mfa_required" ? (
            <button
              className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-white/10 px-4 text-sm font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
              onClick={() => void cancelMfaChallenge()}
              type="button"
            >
              Cancel sign in
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}
