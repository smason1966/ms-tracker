"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL } from "@/lib/api";

type FuelAccount = {
  id: number;
  retailer: string;
  email: string | null;
  alt_id: string | null;
  status: string;
  target_points: number | null;
  barcode_image_url: string | null;
  barcode_value: string | null;
  current_points: number;
  expiration_cycle: string | null;
};

const code128Patterns = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

function formatNumber(value: number | null) {
  if (value === null) {
    return "-";
  }

  return value.toLocaleString();
}

function formatDate(value: string | null) {
  if (!value) {
    return "No cycle yet";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getUploadUrl(path: string | null) {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return `${API_BASE_URL}/${path.replace(/^\/+/, "")}`;
}

function getCode128Values(value: string) {
  const sanitizedValue = value
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);

      return code >= 32 && code <= 127;
    })
    .join("");

  if (!sanitizedValue) {
    return null;
  }

  const values = [104];

  for (const character of sanitizedValue) {
    values.push(character.charCodeAt(0) - 32);
  }

  const checksum =
    values.reduce(
      (total, currentValue, index) =>
        index === 0 ? total + currentValue : total + currentValue * index,
      0,
    ) % 103;

  return [...values, checksum, 106];
}

function GeneratedBarcode({ value }: { value: string }) {
  const encodedValues = getCode128Values(value);

  if (!encodedValues) {
    return null;
  }

  const bars: Array<{ x: number; width: number }> = [];
  let cursor = 10;

  for (const encodedValue of encodedValues) {
    const pattern = code128Patterns[encodedValue];

    pattern.split("").forEach((widthText, index) => {
      const width = Number(widthText);

      if (index % 2 === 0) {
        bars.push({ x: cursor, width });
      }

      cursor += width;
    });
  }

  const width = cursor + 10;

  return (
    <svg
      aria-label={`Barcode for ${value}`}
      className="h-[35svh] min-h-60 w-full max-h-[21rem] sm:h-[39svh] sm:max-h-96"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} 100`}
    >
      <rect fill="#ffffff" height="100" width={width} x="0" y="0" />
      {bars.map((bar, index) => (
        <rect
          fill="#020617"
          height="82"
          key={`${bar.x}-${bar.width}-${index}`}
          width={bar.width}
          x={bar.x}
          y="4"
        />
      ))}
    </svg>
  );
}

export default function FuelAccountBarcodePage() {
  const params = useParams<{ id: string | string[] }>();
  const accountId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [account, setAccount] = useState<FuelAccount | null>(null);
  const [accounts, setAccounts] = useState<FuelAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!accountId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const [accountResponse, dashboardResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/fuel-accounts/${accountId}`),
        fetch(`${API_BASE_URL}/fuel-accounts/dashboard`),
      ]);

      if (!accountResponse.ok) {
        throw new Error(`Failed to load account (${accountResponse.status})`);
      }

      if (!dashboardResponse.ok) {
        throw new Error(
          `Failed to load account list (${dashboardResponse.status})`,
        );
      }

      const accountData = (await accountResponse.json()) as FuelAccount;
      const accountList = (await dashboardResponse.json()) as FuelAccount[];

      setAccount(accountData);
      setAccounts(
        accountList
          .filter((currentAccount) => currentAccount.status === "ACTIVE")
          .sort((first, second) =>
            first.retailer.localeCompare(second.retailer),
          ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load barcode.");
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const navigation = useMemo(() => {
    const currentIndex = accounts.findIndex(
      (currentAccount) => String(currentAccount.id) === accountId,
    );

    if (currentIndex === -1 || accounts.length === 0) {
      return {
        previous: null,
        next: null,
      };
    }

    return {
      previous: accounts[(currentIndex - 1 + accounts.length) % accounts.length],
      next: accounts[(currentIndex + 1) % accounts.length],
    };
  }, [accountId, accounts]);

  const barcodeImageUrl = account
    ? getUploadUrl(account.barcode_image_url)
    : null;
  const barcodeValue = account?.barcode_value?.trim() || "";
  const loyaltyId = account?.alt_id || account?.email || barcodeValue || "No ID";

  return (
    <main className="min-h-screen bg-white px-3 py-1.5 text-slate-950 sm:py-3">
      <div className="mx-auto flex min-h-[calc(100svh-0.75rem)] max-w-md flex-col sm:min-h-[calc(100svh-1.5rem)]">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-lg font-semibold text-slate-600">
            Loading barcode...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold text-red-800">
            {error}
          </div>
        ) : account ? (
          <>
            <header className="text-center">
              <h1 className="text-[1.65rem] font-bold leading-tight tracking-tight">
                {account.retailer}
              </h1>
              <p className="break-all text-xl font-semibold leading-tight">
                {loyaltyId}
              </p>
            </header>

            <section className="mt-1.5 flex flex-col items-center">
              {barcodeValue ? (
                <div className="w-full rounded-lg bg-white px-0.5 py-0.5">
                  <GeneratedBarcode value={barcodeValue} />
                </div>
              ) : barcodeImageUrl ? (
                <div className="w-full rounded-lg border border-slate-200 bg-white p-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`${account.retailer} barcode`}
                    className="mx-auto max-h-[45svh] min-h-60 w-full object-contain sm:max-h-[52svh]"
                    src={barcodeImageUrl}
                  />
                </div>
              ) : (
                <div className="flex min-h-60 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 text-center text-xl font-semibold text-slate-500">
                  No barcode image uploaded.
                </div>
              )}

              {barcodeValue ? (
                <p className="mt-0.5 break-all text-center text-base font-semibold leading-tight text-slate-700">
                  {barcodeValue}
                </p>
              ) : null}
            </section>

            <section className="mt-1 grid grid-cols-3 gap-1.5 text-center sm:gap-2">
              <div className="rounded-md bg-slate-50 px-1.5 py-2">
                <p className="text-xs font-semibold text-slate-500">Cycle</p>
                <p className="mt-0.5 text-base font-bold leading-tight">
                  {formatDate(account.expiration_cycle)}
                </p>
              </div>
              <div className="rounded-md bg-slate-50 px-1.5 py-2">
                <p className="text-xs font-semibold text-slate-500">Current</p>
                <p className="mt-0.5 text-base font-bold leading-tight">
                  {formatNumber(account.current_points)}
                </p>
              </div>
              <div className="rounded-md bg-slate-50 px-1.5 py-2">
                <p className="text-xs font-semibold text-slate-500">Target</p>
                <p className="mt-0.5 text-base font-bold leading-tight">
                  {formatNumber(account.target_points)}
                </p>
              </div>
            </section>

            <nav className="sticky bottom-0 mt-1.5 grid grid-cols-2 gap-2 bg-white pb-[env(safe-area-inset-bottom)] pt-1">
              <Link
                className="flex h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-base font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200"
                href={
                  navigation.previous
                    ? `/fuel-accounts/${navigation.previous.id}/barcode`
                    : `/fuel-accounts/${account.id}/barcode`
                }
              >
                Previous Account
              </Link>
              <Link
                className="flex h-12 items-center justify-center rounded-md bg-slate-900 px-3 text-base font-bold text-white transition hover:bg-slate-700 active:bg-slate-800"
                href={
                  navigation.next
                    ? `/fuel-accounts/${navigation.next.id}/barcode`
                    : `/fuel-accounts/${account.id}/barcode`
                }
              >
                Next Account
              </Link>
            </nav>

            <Link
              className="flex h-8 items-center justify-center rounded-md text-base font-semibold text-slate-600 transition hover:bg-slate-50 active:bg-slate-100"
              href={`/fuel-accounts/${account.id}`}
            >
              Account Details
            </Link>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-lg font-semibold text-slate-600">
            Fuel account not found.
          </div>
        )}
      </div>
    </main>
  );
}
