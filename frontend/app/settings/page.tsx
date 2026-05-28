"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Component, ErrorInfo, ReactNode, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import { API_BASE_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type AppSettings = {
  multi_player_mode_enabled: boolean;
  voided_sale_sensitive_export_retention: string;
};

type MfaSetupResponse = {
  issuer: string;
  username: string;
  manual_secret: string;
  provisioning_uri: string;
};

const settingsCards = [
  {
    id: "card-brands",
    title: "Card Brands",
    description:
      "Manage card types, barcode/magstripe metadata, and verification rules.",
    href: "/card-brands",
  },
  {
    id: "buyers",
    title: "Buyers",
    description:
      "Manage buyers, payout timelines, export formats, and delivery requirements.",
    href: "/buyers",
  },
  {
    id: "stores",
    title: "Stores",
    description:
      "Manage stores, fuel eligibility, and spending category mapping.",
    href: "/settings/stores",
  },
  {
    id: "spending-categories",
    title: "Spending Categories",
    description:
      "Manage categories like grocery, wholesale, office_supply, dining, and gas.",
    href: "/settings/spending-categories",
  },
  {
    id: "card-issuers",
    title: "Card Issuers",
    description:
      "Normalize banks, fintechs, and retail issuers for funding card reporting.",
    href: "/settings/card-issuers",
  },
  {
    id: "card-networks",
    title: "Card Networks",
    description:
      "Manage controlled network values like Visa, Mastercard, Amex, and Discover.",
    href: "/settings/card-networks",
  },
  {
    id: "payment-accounts",
    title: "Payment Accounts",
    description:
      "Manage expected deposit destinations for buyer payments and reconciliation.",
    href: "/settings/payment-accounts",
  },
  {
    id: "players",
    title: "Players",
    description:
      "Manage P1/P2/P3 ownership for multi-player credit card tracking.",
    href: "/settings/players",
  },
  {
    id: "reward-programs",
    title: "Reward Programs",
    description:
      "Manage rewards currencies like UR, MR, cashback, airline miles, and fuel points.",
    href: "/settings/reward-programs",
  },
  {
    id: "reward-program-categories",
    title: "Reward Program Categories",
    description:
      "Manage reward currency families, including cashback, miles, points, fuel, and crypto.",
    href: "/settings/reward-program-categories",
  },
  {
    id: "data-import",
    title: "Data Import",
    description:
      "Preview and import curated transfer ZIPs from test into production.",
    href: "/settings/data-import",
  },
  {
    id: "retention",
    title: "Retention",
    description:
      "Preview and purge old card images, receipts, and digital PDFs after retention expires.",
    href: "/settings/retention",
  },
  {
    id: "upload-health",
    title: "Upload Health",
    description:
      "Audit upload storage, missing file references, orphaned files, and OCR debug size.",
    href: "/settings/upload-health",
  },
];

class SettingsRenderBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Settings] caught render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
          <section className="mx-auto max-w-4xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
            <p>Settings failed to render: {this.state.error.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                className="inline-flex h-9 items-center rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700"
                href="/"
              >
                Back Home
              </Link>
              <button
                className="h-9 rounded-md bg-red-700 px-3 text-xs font-semibold text-white"
                onClick={() => window.location.reload()}
                type="button"
              >
                Reload
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function useRenderLoopDiagnostics(name: string, extra?: Record<string, unknown>) {
  const countRef = useRef(0);
  const windowStartRef = useRef<number | null>(null);

  useEffect(() => {
    const now = Date.now();
    if (windowStartRef.current === null || now - windowStartRef.current > 2000) {
      windowStartRef.current = now;
      countRef.current = 1;
      return;
    }

    countRef.current += 1;
    if (countRef.current > 25) {
      console.warn(`[${name}] high render count`, {
        renders: countRef.current,
        windowMs: now - windowStartRef.current,
        ...extra,
      });
    }
  });
}

async function authErrorMessage(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") {
      return body.detail;
    }
  } catch {
    // Keep the generic fallback below.
  }
  return `Request failed (${response.status})`;
}

function MfaSettingsPanel() {
  const { admin, authEnabled, refreshSession } = useAuth();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!setup?.provisioning_uri) {
      return;
    }

    QRCode.toDataURL(setup.provisioning_uri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 192,
    })
      .then((dataUrl) => {
        if (!isCancelled) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setQrDataUrl(null);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [setup]);

  async function startSetup() {
    setIsBusy(true);
    setError(null);
    setMessage(null);
    setRecoveryCodes([]);
    setQrDataUrl(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/mfa/setup/start`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await authErrorMessage(response));
      }
      setSetup((await response.json()) as MfaSetupResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start MFA setup.");
    } finally {
      setIsBusy(false);
    }
  }

  async function verifySetup() {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/mfa/setup/verify`, {
        body: JSON.stringify({ code: totpCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await authErrorMessage(response));
      }
      const body = await response.json();
      setRecoveryCodes(body.recovery_codes ?? []);
      setSetup(null);
      setQrDataUrl(null);
      setTotpCode("");
      setMessage("MFA is enabled. Save the recovery codes now.");
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify MFA setup.");
    } finally {
      setIsBusy(false);
    }
  }

  async function regenerateRecoveryCodes() {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/mfa/recovery-codes/regenerate`,
        {
          body: JSON.stringify({ code: adminCode }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error(await authErrorMessage(response));
      }
      const body = await response.json();
      setRecoveryCodes(body.recovery_codes ?? []);
      setAdminCode("");
      setMessage("Recovery codes regenerated. Save them now.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to regenerate recovery codes.",
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function disableMfa() {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/mfa/disable`, {
        body: JSON.stringify({ code: adminCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await authErrorMessage(response));
      }
      setAdminCode("");
      setRecoveryCodes([]);
      setSetup(null);
      setQrDataUrl(null);
      setMessage("MFA disabled.");
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable MFA.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!authEnabled) {
    return null;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Multi-factor Authentication</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                admin?.mfa_enabled
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {admin?.mfa_enabled ? "Enabled" : "Optional"}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Add a TOTP authenticator app before using real production card data.
            Recovery codes are shown once and are not stored in plaintext.
          </p>
          {message ? (
            <p className="mt-2 text-sm font-medium text-emerald-700">{message}</p>
          ) : null}
          {error ? (
            <p className="mt-2 text-sm font-medium text-red-700">{error}</p>
          ) : null}
        </div>

        {!admin?.mfa_enabled && !setup ? (
          <button
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={() => void startSetup()}
            type="button"
          >
            Set Up MFA
          </button>
        ) : null}
      </div>

      {setup ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[14rem_1fr]">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt="MFA setup QR code"
                className="mx-auto h-48 w-48"
                src={qrDataUrl}
              />
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded-md bg-white text-sm text-slate-500">
                QR unavailable
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">
                Scan the QR code, or enter this manual secret:
              </p>
              <code className="mt-2 block break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                {setup.manual_secret}
              </code>
            </div>
            <label className="block text-sm font-semibold text-slate-700">
              Verification code
              <input
                className="mt-2 h-10 w-full max-w-xs rounded-md border border-slate-300 px-3 text-sm"
                inputMode="numeric"
                onChange={(event) => setTotpCode(event.target.value)}
                placeholder="123456"
                type="text"
                value={totpCode}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-10 items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy || !totpCode.trim()}
                onClick={() => void verifySetup()}
                type="button"
              >
                Verify and Enable
              </button>
              <button
                className="inline-flex h-10 items-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => {
                  setSetup(null);
                  setQrDataUrl(null);
                  setTotpCode("");
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {admin?.mfa_enabled ? (
        <div className="mt-5 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="block text-sm font-semibold text-slate-700">
            Current authenticator code
            <input
              className="mt-2 h-10 w-full max-w-xs rounded-md border border-slate-300 bg-white px-3 text-sm"
              inputMode="numeric"
              onChange={(event) => setAdminCode(event.target.value)}
              placeholder="123456"
              type="text"
              value={adminCode}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy || !adminCode.trim()}
              onClick={() => void regenerateRecoveryCodes()}
              type="button"
            >
              Regenerate Recovery Codes
            </button>
            <button
              className="inline-flex h-10 items-center rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy || !adminCode.trim()}
              onClick={() => void disableMfa()}
              type="button"
            >
              Disable MFA
            </button>
          </div>
        </div>
      ) : null}

      {recoveryCodes.length > 0 ? (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Save these recovery codes now. They will not be shown again.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {recoveryCodes.map((code) => (
              <code
                className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                key={code}
              >
                {code}
              </code>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SettingsContent() {
  const pathname = usePathname();
  const [settings, setSettings] = useState<AppSettings>({
    multi_player_mode_enabled: false,
    voided_sale_sensitive_export_retention: "never",
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);
  useRenderLoopDiagnostics("Settings", {
    isLoadingSettings,
    hasError: Boolean(settingsError),
  });

  useEffect(() => {
    async function loadSettings() {
      setIsLoadingSettings(true);
      setSettingsError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/app-settings`);

        if (!response.ok) {
          throw new Error(`Failed to load settings (${response.status})`);
        }

        setSettings((await response.json()) as AppSettings);
      } catch (err) {
        setSettingsError(
          err instanceof Error ? err.message : "Failed to load settings.",
        );
      } finally {
        setIsLoadingSettings(false);
      }
    }

    console.log("SettingsPage mount", { pathname });
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void loadSettings();
    }
    return () => {
      console.log("SettingsPage unmount", { pathname });
    };
  }, []);

  async function toggleMultiPlayerMode(enabled: boolean) {
    setSettings((current) => ({
      ...current,
      multi_player_mode_enabled: enabled,
    }));
    setSettingsError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/app-settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ multi_player_mode_enabled: enabled }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update settings (${response.status})`);
      }

      setSettings((await response.json()) as AppSettings);
    } catch (err) {
      setSettings((current) => ({
        ...current,
        multi_player_mode_enabled: !enabled,
      }));
      setSettingsError(
        err instanceof Error ? err.message : "Failed to update settings.",
      );
    }
  }

  async function updateVoidedSaleRetention(retention: string) {
    setSettings((current) => ({
      ...current,
      voided_sale_sensitive_export_retention: retention,
    }));
    setSettingsError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/app-settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voided_sale_sensitive_export_retention: retention,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update settings (${response.status})`);
      }

      setSettings((await response.json()) as AppSettings);
    } catch (err) {
      setSettings((current) => ({
        ...current,
        voided_sale_sensitive_export_retention: "never",
      }));
      setSettingsError(
        err instanceof Error ? err.message : "Failed to update settings.",
      );
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Admin
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Settings
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Setup and configuration items that support daily purchase,
            inventory, sales, and rewards workflows.
          </p>
        </header>

        <MfaSettingsPanel />

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Multi-player Mode</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Enable P1/P2/P3 ownership for credit cards and future reporting.
              </p>
              {settingsError ? (
                <p className="mt-2 text-sm font-medium text-red-700">
                  {settingsError}
                </p>
              ) : null}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              <input
                checked={settings.multi_player_mode_enabled}
                className="h-4 w-4"
                disabled={isLoadingSettings}
                onChange={(event) =>
                  void toggleMultiPlayerMode(event.target.checked)
                }
                type="checkbox"
              />
              Enabled
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Voided Sale Export Retention</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Controls how long sensitive seller exports remain available after
                a sale is voided. Never is the recommended default.
              </p>
            </div>
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
              disabled={isLoadingSettings}
              onChange={(event) =>
                void updateVoidedSaleRetention(event.target.value)
              }
              value={settings.voided_sale_sensitive_export_retention}
            >
              <option value="never">Never</option>
              <option value="24_hours">24 hours</option>
              <option value="7_days">7 days</option>
              <option value="forever">Forever</option>
            </select>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {settingsCards.map((card) => (
            <Link
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md active:translate-y-0"
              href={card.href}
              key={card.id}
            >
              <h2 className="text-lg font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {card.description}
              </p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <SettingsRenderBoundary>
      <SettingsContent />
    </SettingsRenderBoundary>
  );
}
