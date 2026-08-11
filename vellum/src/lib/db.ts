import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// SQLite: background asset jobs write concurrently with editor PATCHes.
let walReady: Promise<unknown> | null = null;
export function ensureWal() {
  walReady ??= db.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => null);
  return walReady;
}
