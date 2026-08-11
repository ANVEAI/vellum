import { sealData, unsealData } from "iron-session";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "vellum_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface SessionData {
  authed: boolean;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET env var is required (32+ chars). See .env.example.",
    );
  }
  return secret;
}

export async function createSessionCookieValue(): Promise<string> {
  return sealData({ authed: true } satisfies SessionData, {
    password: sessionSecret(),
    ttl: SESSION_TTL_SECONDS,
  });
}

export async function readSession(
  cookieValue: string | undefined,
): Promise<SessionData | null> {
  if (!cookieValue) return null;
  try {
    const data = await unsealData<SessionData>(cookieValue, {
      password: sessionSecret(),
      ttl: SESSION_TTL_SECONDS,
    });
    return data?.authed ? data : null;
  } catch {
    return null;
  }
}

export async function isAuthed(): Promise<boolean> {
  const store = await cookies();
  return (await readSession(store.get(SESSION_COOKIE)?.value)) !== null;
}
