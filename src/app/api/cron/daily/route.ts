import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runWatchChecks } from "@/lib/notifications/checks";
import { sendDigests } from "@/lib/notifications/digest";

/**
 * The daily job, run by Vercel Cron (vercel.json) every morning: check for low
 * stock and late orders, then send the morning summaries.
 *
 * Vercel calls it with `Authorization: Bearer <CRON_SECRET>`. Without that
 * exact secret — or with no CRON_SECRET set at all — it refuses, so nobody can
 * trigger mails to everyone by visiting the address.
 */
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  await runWatchChecks({ force: true });
  const digests = await sendDigests();
  return NextResponse.json({ ok: true, ...digests });
}
