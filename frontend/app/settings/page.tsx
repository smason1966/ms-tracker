"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type AppSettings = {
  multi_player_mode_enabled: boolean;
  voided_sale_sensitive_export_retention: string;
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
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    multi_player_mode_enabled: false,
    voided_sale_sensitive_export_retention: "never",
  });
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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

    void loadSettings();
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
