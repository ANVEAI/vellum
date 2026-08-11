import { NextRequest, NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // Static assets and Next internals are excluded via the matcher, but keep a
  // safety net for anything that slips through.
  if (pathname.startsWith("/_next/") || pathname.startsWith("/static/")) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // /print/* and /api/export/* accept a short-lived HMAC token instead of a
  // session so headless export (Playwright hitting localhost) works. The token
  // implementation lands with the export phase; until then these routes still
  // accept a normal session below.

  const session = await readSession(
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Everything except Next internals, static files with extensions, favicon.
    "/((?!_next/static|_next/image|favicon\\.ico|static/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)",
  ],
};
