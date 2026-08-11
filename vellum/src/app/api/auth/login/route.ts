import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createSessionCookieValue,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/session";

export const runtime = "nodejs";

// Simple in-memory throttle: 5 attempts per minute per IP.
const attempts = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordAttempt(ip: string) {
  const list = attempts.get(ip) ?? [];
  list.push(Date.now());
  attempts.set(ip, list);
}

function passwordsMatch(candidate: string, expected: string): boolean {
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not configured on the server." },
      { status: 500 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (throttled(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = body.password ?? "";
  } catch {
    // fall through with empty password
  }

  if (!password || !passwordsMatch(password, expected)) {
    recordAttempt(ip);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionCookieValue(),
    httpOnly: true,
    sameSite: "lax",
    secure: false, // localhost HTTP deployment
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return response;
}
