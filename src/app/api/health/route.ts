import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Liveness check for the container, and a check on the settings a deployment
 * cannot run without.
 *
 * Called by: the Dockerfile HEALTHCHECK, any uptime monitor you point here, and
 * a person trying to work out why a fresh deployment misbehaves.
 *
 * It touches the database on purpose — a process that is up but cannot reach
 * Postgres is not serving anybody, and that is exactly the failure a plain
 * "is the port open" check misses.
 *
 * The `config` block exists because the errors these settings produce say
 * nothing useful. A missing session secret shows up as "There was a problem
 * with the server configuration. Check the server logs" — and on Vercel's free
 * plan those logs are gone in minutes. Only booleans are reported: whether a
 * value is present, never what it is. Nothing here identifies the system or its
 * version, and a deployment answering `false` is already failing openly for
 * everyone, so this tells an outsider nothing they could not see anyway.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let database = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "unreachable";
  }

  // Auth.js checks these two, in this order, before anything else runs, and
  // fails the whole request if either is wrong (@auth/core/lib/utils/assert.js).
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  // Mirrors @auth/core: hosting on Vercel is trusted automatically.
  const trustHost = !!(
    process.env.AUTH_URL ??
    process.env.AUTH_TRUST_HOST ??
    process.env.VERCEL ??
    process.env.CF_PAGES ??
    (process.env.NODE_ENV !== "production" ? "1" : undefined)
  );

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const blobParts = blobToken.split("_");

  const config = {
    // Sign-in returns 500 unless both of these are true.
    sessionSecretSet: secret.length > 0,
    hostTrusted: trustHost,
    // Set on Vercel it does more harm than good: next-auth rewrites every
    // request's origin to it, so a leftover localhost value sends everyone who
    // signs in to their own machine.
    nextAuthUrlSet: !!(process.env.NEXTAUTH_URL ?? process.env.AUTH_URL),
    // Only uploads depend on this one.
    blobTokenSet: blobToken.length > 0,
    blobTokenLooksValid:
      blobToken.startsWith("vercel_blob_rw_") &&
      blobParts.length >= 5 &&
      blobParts[3].length > 0,
  };

  const healthy = database === "ok" && config.sessionSecretSet && config.hostTrusted;

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", database, config },
    { status: healthy ? 200 : 503 }
  );
}
