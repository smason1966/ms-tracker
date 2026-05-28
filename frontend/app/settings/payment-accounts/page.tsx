"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type PaymentAccount = {
  id: number;
  name: string;
  account_type: string;
  institution: string | null;
  last_four: string | null;
  account_identifier: string | null;
  payment_identifier: string | null;
  is_business_account: boolean;
  bank_account_type: string | null;
  notes: string | null;
  active: boolean;
};

type PaymentAccountForm = {
  name: string;
  account_type: string;
  institution: string;
  last_four: string;
  payment_identifier: string;
  is_business_account: boolean;
  bank_account_type: string;
  notes: string;
  active: boolean;
};

const accountTypes = [
  { label: "Bank", value: "bank" },
  { label: "PayPal", value: "PayPal" },
  { label: "Venmo", value: "Venmo" },
  { label: "Zelle", value: "Zelle" },
  { label: "ACH", value: "ACH" },
  { label: "Check", value: "check" },
  { label: "Other", value: "other" },
];
const bankAccountTypes = ["Checking", "Savings", "Other"];

const emptyForm: PaymentAccountForm = {
  name: "",
  account_type: "bank",
  institution: "",
  last_four: "",
  payment_identifier: "",
  is_business_account: false,
  bank_account_type: "Checking",
  notes: "",
  active: true,
};

function accountLabel(account: PaymentAccount) {
  const type = account.account_type.toLowerCase();
  const identifier = account.payment_identifier ?? account.account_identifier;

  if (type === "paypal" || type === "venmo" || type === "zelle") {
    return [account.account_type, identifier].filter(Boolean).join(" · ");
  }

  return [
    account.name,
    account.institution,
    account.bank_account_type,
    account.last_four ? `****${account.last_four}` : null,
    account.is_business_account ? "Business" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function accountTypeLabel(value: string) {
  return accountTypes.find((type) => type.value === value)?.label ?? value;
}

function showsBankAccountType(accountType: string) {
  return ["bank", "ach"].includes(accountType.toLowerCase());
}

function accountToForm(account: PaymentAccount): PaymentAccountForm {
  return {
    name: account.name,
    account_type: account.account_type,
    institution: account.institution ?? "",
    last_four: account.last_four ?? "",
    payment_identifier:
      account.payment_identifier ?? account.account_identifier ?? "",
    is_business_account: account.is_business_account,
    bank_account_type: account.bank_account_type ?? "Checking",
    notes: account.notes ?? "",
    active: account.active,
  };
}

export default function PaymentAccountsSettingsPage() {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [editingAccount, setEditingAccount] = useState<PaymentAccount | null>(null);
  const [form, setForm] = useState<PaymentAccountForm>(emptyForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAccounts() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/payment-accounts/`);

      if (!response.ok) {
        throw new Error(`Failed to load payment accounts (${response.status})`);
      }

      setAccounts((await response.json()) as PaymentAccount[]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load payment accounts.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAccounts();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  function openCreate() {
    setEditingAccount(null);
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function openEdit(account: PaymentAccount) {
    setEditingAccount(account);
    setForm(accountToForm(account));
    setIsModalOpen(true);
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editingAccount
          ? `${API_BASE_URL}/payment-accounts/${editingAccount.id}`
          : `${API_BASE_URL}/payment-accounts/`,
        {
          method: editingAccount ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            account_type: form.account_type,
            institution: form.institution.trim() || null,
            last_four: form.last_four.trim() || null,
            account_identifier: form.payment_identifier.trim() || null,
            payment_identifier: form.payment_identifier.trim() || null,
            is_business_account: form.is_business_account,
            bank_account_type: showsBankAccountType(form.account_type)
              ? form.bank_account_type
              : null,
            notes: form.notes.trim() || null,
            active: form.active,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to save payment account (${response.status})`);
      }

      setIsModalOpen(false);
      await loadAccounts();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save payment account.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              className="mb-3 inline-flex h-8 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200"
              href="/settings"
            >
              Back to Settings
            </Link>
            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Settings / Payment Accounts
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Payment Accounts
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Configure where buyer deposits are expected to arrive.
            </p>
          </div>
          <button
            className="h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 active:bg-slate-900"
            onClick={openCreate}
            type="button"
          >
            Add Account
          </button>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          {isLoading ? (
            <p className="p-8 text-center text-sm text-slate-500">
              Loading payment accounts...
            </p>
          ) : accounts.length === 0 ? (
            <div className="p-8 text-center">
              <h2 className="font-semibold">No payment accounts yet</h2>
              <p className="mt-2 text-sm text-slate-500">
                Add a bank, PayPal, Venmo, Zelle, or other deposit destination.
              </p>
              <button
                className="mt-4 h-11 cursor-pointer rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={openCreate}
                type="button"
              >
                Add Account
              </button>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Payment Identifier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{accountLabel(account)}</p>
                      {account.notes ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {account.notes}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {accountTypeLabel(account.account_type)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {account.payment_identifier ??
                        account.account_identifier ??
                        ""}
                    </td>
                    <td className="px-4 py-3">
                      {account.active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100"
                        onClick={() => openEdit(account)}
                        type="button"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4">
          <form
            className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            id="payment-account-settings-form"
            onSubmit={saveAccount}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">
                {editingAccount ? "Edit Payment Account" : "Add Payment Account"}
              </h2>
              <div className="flex shrink-0 gap-2">
                <button
                  className="h-9 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-semibold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="h-9 cursor-pointer rounded-md bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  form="payment-account-settings-form"
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Name</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  value={form.name}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Account Type</span>
                <select
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      account_type: event.target.value,
                      bank_account_type: showsBankAccountType(
                        event.target.value,
                      )
                        ? form.bank_account_type
                        : "Checking",
                    })
                  }
                  required
                  value={form.account_type}
                >
                  {accountTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Institution / Provider</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({ ...form, institution: event.target.value })
                  }
                  value={form.institution}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span>Last Four</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  maxLength={10}
                  onChange={(event) =>
                    setForm({ ...form, last_four: event.target.value })
                  }
                  value={form.last_four}
                />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Payment Identifier</span>
                <input
                  className="h-11 w-full rounded-md border border-slate-300 px-3"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      payment_identifier: event.target.value,
                    })
                  }
                  value={form.payment_identifier}
                />
                <p className="text-xs text-slate-500">
                  Email, phone number, username, Zelle ID, PayPal/Venmo handle,
                  or other payment reference.
                </p>
              </label>
              {showsBankAccountType(form.account_type) ? (
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  <span>Bank Account Type</span>
                  <select
                    className="h-11 w-full rounded-md border border-slate-300 px-3"
                    onChange={(event) =>
                      setForm({
                        ...form,
                        bank_account_type: event.target.value,
                      })
                    }
                    value={form.bank_account_type}
                  >
                    {bankAccountTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.is_business_account}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      is_business_account: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                Business Account
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Notes</span>
                <textarea
                  className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2"
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  value={form.notes}
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  checked={form.active}
                  className="h-4 w-4"
                  onChange={(event) =>
                    setForm({ ...form, active: event.target.checked })
                  }
                  type="checkbox"
                />
                Active
              </label>
            </div>

          </form>
        </div>
      ) : null}
    </main>
  );
}
