"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function VerificationDetailRedirectPage() {
  const params = useParams<{ id: string | string[] }>();
  const router = useRouter();
  const giftCardId = Array.isArray(params.id) ? params.id[0] : params.id;
  const confirmDetailsHref = `/gift-cards/${giftCardId}/verify?returnTo=/verification`;

  useEffect(() => {
    if (giftCardId) {
      router.replace(confirmDetailsHref);
    }
  }, [confirmDetailsHref, giftCardId, router]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          Opening card details confirmation...
        </p>
        <Link
          className="mt-4 inline-flex h-11 cursor-pointer items-center rounded-md bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 active:bg-slate-900"
          href={confirmDetailsHref}
        >
          Confirm Card Details
        </Link>
      </div>
    </main>
  );
}
