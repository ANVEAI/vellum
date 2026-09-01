/**
 * Environment-driven configuration, validated once at boot.
 *
 * Fail fast and loudly: a server that starts with a bad base URL or a missing
 * password will otherwise fail later, inside a tool call, as an opaque 401 that
 * an agent cannot act on.
 *
 * Secrets live here and NOWHERE else. Nothing in this object may be echoed into
 * a tool response; `redact.ts` is the enforcement point.
 */
import { z } from "zod";

const bool = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? dflt : /^(1|true|yes|on)$/i.test(v)));

const int = (dflt: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? dflt : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const envSchema = z.object({
  // --- Vellum target -------------------------------------------------------
  VELLUM_BASE_URL: z
    .string()
    .url("VELLUM_BASE_URL must be an absolute URL, e.g. http://localhost:3210")
    .default("http://localhost:3210")
    .transform((u) => u.replace(/\/+$/, "")),
  VELLUM_APP_PASSWORD: z
    .string()
    .min(1, "VELLUM_APP_PASSWORD is required — it is Vellum's shared login password"),

  // --- MCP transport -------------------------------------------------------
  VELLUM_MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  VELLUM_MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  VELLUM_MCP_HTTP_PORT: int(8080, 1, 65535),

  // --- Inbound auth (off by default; see the plan's security note) ---------
  VELLUM_MCP_REQUIRE_AUTH: bool(false),
  /** Comma-separated bearer tokens accepted when REQUIRE_AUTH is on. */
  VELLUM_MCP_AUTH_TOKENS: z.string().default(""),

  // --- Timeouts ------------------------------------------------------------
  /** Ordinary reads/writes. Vellum answers these in milliseconds. */
  VELLUM_MCP_REQUEST_TIMEOUT_MS: int(60_000, 1_000, 600_000),
  /**
   * Whole-pipeline ceiling for a generation. Vellum imposes NO server-side
   * timeout and Ollama has none either, so this is the only thing that will
   * ever end a wedged run — and aborting is what frees Vellum's global lock.
   */
  VELLUM_MCP_GENERATION_TIMEOUT_MS: int(900_000, 30_000, 3_600_000),
  /** Vellum's export route caps itself at maxDuration = 300s. */
  VELLUM_MCP_EXPORT_TIMEOUT_MS: int(300_000, 10_000, 900_000),

  // --- Job registry --------------------------------------------------------
  VELLUM_MCP_JOB_TTL_MS: int(3_600_000, 60_000, 86_400_000),
  VELLUM_MCP_MAX_JOBS: int(200, 1, 10_000),

  // --- Serialization queue (Vellum's generation lock is global) -----------
  VELLUM_MCP_QUEUE_DEPTH: int(8, 1, 256),
  VELLUM_MCP_QUEUE_WAIT_MS: int(600_000, 1_000, 3_600_000),

  // --- Export artifacts ----------------------------------------------------
  /** Must stay in sync with .gitignore — exported decks are 20 MB+ each. */
  VELLUM_MCP_EXPORT_DIR: z.string().default("./.exports"),
  /**
   * Origin the MCP server is reachable at, used to build `resource_link` URIs
   * for exports.
   *
   * This MUST equal the origin the consuming platform registered, because a
   * server-supplied URL is an SSRF vector and hosts refuse to fetch anything
   * off-origin. Defaults to http://{HTTP_HOST}:{HTTP_PORT}, which is exactly
   * the origin of the registered /mcp endpoint, so the default is correct
   * whenever the consumer registered this server's own address.
   */
  VELLUM_MCP_PUBLIC_URL: z.string().optional(),
  /**
   * Files at or below this size are returned as an embedded base64 resource;
   * larger ones as a resource_link. Base64 inflates ~33%, so keep this well
   * under any JSON-RPC message limit in the path.
   */
  VELLUM_MCP_EMBED_MAX_BYTES: int(5_000_000, 0, 25_000_000),
  VELLUM_MCP_ARTIFACT_TTL_MS: int(86_400_000, 60_000, 2_592_000_000),
  VELLUM_MCP_ARTIFACT_MAX_BYTES: int(2_000_000_000, 1_000_000, 100_000_000_000),

  // --- Observability -------------------------------------------------------
  VELLUM_MCP_LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Config = Readonly<{
  vellumBaseUrl: string;
  vellumAppPassword: string;
  transport: "stdio" | "http";
  httpHost: string;
  httpPort: number;
  requireAuth: boolean;
  authTokens: readonly string[];
  requestTimeoutMs: number;
  generationTimeoutMs: number;
  exportTimeoutMs: number;
  jobTtlMs: number;
  maxJobs: number;
  queueDepth: number;
  queueWaitMs: number;
  exportDir: string;
  /** Origin used to build export resource_link URIs. Never has a trailing slash. */
  publicUrl: string;
  embedMaxBytes: number;
  artifactTtlMs: number;
  artifactMaxBytes: number;
  logLevel: "debug" | "info" | "warn" | "error" | "silent";
}>;

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * Parse and validate. `argv` may override the transport so the same binary can
 * be launched either way without touching the environment.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid configuration:\n${detail}`);
  }
  const e = parsed.data;

  const argTransport = argv
    .find((a) => a.startsWith("--transport="))
    ?.split("=")[1];
  if (argTransport && argTransport !== "stdio" && argTransport !== "http") {
    throw new ConfigError(`--transport must be "stdio" or "http", got "${argTransport}"`);
  }

  const tokens = e.VELLUM_MCP_AUTH_TOKENS.split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (e.VELLUM_MCP_REQUIRE_AUTH && tokens.length === 0) {
    throw new ConfigError(
      "VELLUM_MCP_REQUIRE_AUTH is on but VELLUM_MCP_AUTH_TOKENS is empty — " +
        "every request would be rejected.",
    );
  }

  return Object.freeze({
    vellumBaseUrl: e.VELLUM_BASE_URL,
    vellumAppPassword: e.VELLUM_APP_PASSWORD,
    transport: (argTransport as "stdio" | "http") ?? e.VELLUM_MCP_TRANSPORT,
    httpHost: e.VELLUM_MCP_HTTP_HOST,
    httpPort: e.VELLUM_MCP_HTTP_PORT,
    requireAuth: e.VELLUM_MCP_REQUIRE_AUTH,
    authTokens: Object.freeze(tokens),
    requestTimeoutMs: e.VELLUM_MCP_REQUEST_TIMEOUT_MS,
    generationTimeoutMs: e.VELLUM_MCP_GENERATION_TIMEOUT_MS,
    exportTimeoutMs: e.VELLUM_MCP_EXPORT_TIMEOUT_MS,
    jobTtlMs: e.VELLUM_MCP_JOB_TTL_MS,
    maxJobs: e.VELLUM_MCP_MAX_JOBS,
    queueDepth: e.VELLUM_MCP_QUEUE_DEPTH,
    queueWaitMs: e.VELLUM_MCP_QUEUE_WAIT_MS,
    exportDir: e.VELLUM_MCP_EXPORT_DIR,
    publicUrl: (
      e.VELLUM_MCP_PUBLIC_URL ?? `http://${e.VELLUM_MCP_HTTP_HOST}:${e.VELLUM_MCP_HTTP_PORT}`
    ).replace(/\/+$/, ""),
    embedMaxBytes: e.VELLUM_MCP_EMBED_MAX_BYTES,
    artifactTtlMs: e.VELLUM_MCP_ARTIFACT_TTL_MS,
    artifactMaxBytes: e.VELLUM_MCP_ARTIFACT_MAX_BYTES,
    logLevel: e.VELLUM_MCP_LOG_LEVEL,
  });
}

/** Secret values that must never appear in output. Registered at boot. */
const secrets = new Set<string>();

export function registerSecrets(config: Config): void {
  if (config.vellumAppPassword) secrets.add(config.vellumAppPassword);
  for (const t of config.authTokens) secrets.add(t);
}

export function knownSecrets(): readonly string[] {
  return [...secrets];
}
