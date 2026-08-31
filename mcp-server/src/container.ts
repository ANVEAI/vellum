/**
 * Composition root. The only place concrete classes are constructed.
 *
 * ## The one thing that will break this server if you get it wrong
 *
 * In HTTP mode a NEW MCP Server + transport is created per POST (the 2026-07-28
 * core is stateless — no session id). The container, however, is a
 * process-lifetime singleton. If the SessionProvider were rebuilt per request,
 * the server would log in to Vellum on every call — and Vellum rate-limits
 * FAILED logins to 5/min per IP against a bucket shared with its own web UI. A
 * single bad password would then lock the operator out of their browser.
 *
 * Per-request protocol objects; process-lifetime infrastructure. Keep that split.
 */
import { loadConfig, registerSecrets, type Config } from "./infra/config.js";
import { createLogger, type Logger } from "./infra/logger.js";
import { SessionProvider } from "./vellum/auth.js";
import { VellumClient } from "./vellum/client.js";
import { buildServices, type Services } from "./domain/services.js";

export interface Container {
  config: Config;
  logger: Logger;
  services: Services;
  shutdown(): Promise<void>;
}

export function createContainer(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
): Container {
  const config = loadConfig(env, argv);
  registerSecrets(config);

  const logger = createLogger(config.logLevel, {
    service: "vellum-mcp",
    transport: config.transport,
  });

  const session = new SessionProvider({
    baseUrl: config.vellumBaseUrl,
    password: config.vellumAppPassword,
    logger,
  });

  const client = new VellumClient({
    baseUrl: config.vellumBaseUrl,
    session,
    logger,
    defaultTimeoutMs: config.requestTimeoutMs,
  });

  const services = buildServices(config, logger, client);

  return {
    config,
    logger,
    services,
    async shutdown() {
      // Abort every in-flight generation. This is not politeness: aborting is
      // what makes Vellum release its generation lock. Exiting without it can
      // leave Vellum generating, with the lock held, until it is restarted.
      logger.info("shutting down; aborting in-flight jobs");
      services.jobs.abortAll();
      // Give the aborts a moment to propagate into Vellum before the process dies.
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}
