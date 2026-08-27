import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Liveness check for the container and for whatever is watching the host.
 *
 * Called by: the Dockerfile HEALTHCHECK, and any uptime monitor you point here.
 *
 * It touches the database on purpose — a process that is up but cannot reach
 * Postgres is not serving anybody, and that is exactly the failure a plain
 * "is the port open" check misses. Nothing about the response identifies the
 * system or its version, since this endpoint answers without a session.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
