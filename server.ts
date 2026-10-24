/**
 * MCP Server Bootstrap for SysON (MBSE) Tools.
 *
 * SysON exposes stateless HTTP by default and an explicit local stdio mode.
 */

import { MCP_APP_MIME_TYPE, McpApp } from "@mcpview/server";
import { getCategories, SysonToolsClient } from "./src/client.ts";
import { SYSON_VIEW_APP_MANIFEST } from "./src/ui/app-manifest.ts";
import { loadUiHtml, UI_RESOURCES } from "./src/ui/mod.ts";

const DEFAULT_HTTP_PORT = 3009;
const PACKAGE_VERSION = SYSON_VIEW_APP_MANIFEST.app.version;

const SERVER_INSTRUCTIONS =
  "Use SysON as a provider for explicit model reads and writes. Inspect tools/list " +
  "because category filtering can intentionally omit operations. When registered, " +
  "recommended navigation is syson_project_list, then syson_project_get, then model or " +
  "element reads with the returned editingContextId. Before creating a child, " +
  "use syson_model_child_types; after textual SysML insertion, re-read critical " +
  "content because acknowledgement is not semantic completeness. Prefer " +
  "syson_constraint_validate values overrides for non-mutating what-if checks; " +
  "syson_value_set mutates the model. syson_query_aql and syson_query_eval can " +
  "mutate or delete state, so use them only with an explicit reviewed expression. " +
  "Direct provider mutations are not Digital Thread seals or approved product operations.";

/** Register every shipped viewer, including the currently standalone explorer. */
export function registerUiResources(
  server: Pick<McpApp, "registerResource">,
): ReadonlySet<string> {
  const registeredUris = new Set<string>();
  for (const [uri, resourceMeta] of Object.entries(UI_RESOURCES)) {
    server.registerResource(
      {
        uri,
        name: resourceMeta.name,
        description: resourceMeta.description,
        mimeType: MCP_APP_MIME_TYPE,
      },
      async () => ({
        uri,
        mimeType: MCP_APP_MIME_TYPE,
        text: await loadUiHtml(uri),
      }),
    );
    registeredUris.add(uri);
    console.error(`[mcp-syson] Registered UI resource: ${uri}`);
  }
  return registeredUris;
}

export interface CreateSysonServerOptions {
  categories?: string[];
  logger?: (message: string) => void;
}

export interface SysonServer {
  server: McpApp;
  toolsClient: SysonToolsClient;
}

export function createSysonServer(
  options: CreateSysonServerOptions = {},
): SysonServer {
  const categories = options.categories
    ? normalizeCategories(options.categories)
    : undefined;
  const toolsClient = new SysonToolsClient(
    categories ? { categories } : undefined,
  );
  const logger = options.logger ??
    ((message: string) => console.error(`[mcp-syson] ${message}`));
  const server = new McpApp({
    name: "mcp-syson",
    version: PACKAGE_VERSION,
    maxConcurrent: 10,
    backpressureStrategy: "queue",
    transport: "stateless",
    validateSchema: true,
    instructions: SERVER_INSTRUCTIONS,
    logger: (message) => {
      // Tool counts age immediately and are not a useful capability contract.
      // Keep the framework's operational logging without emitting that count.
      if (/^Tools available:\s+\d+$/.test(message)) return;
      logger(message);
    },
  });
  server.registerTools(
    toolsClient.toMCPFormat(),
    toolsClient.buildHandlersMap(),
  );

  const registeredUris = registerUiResources(server);
  for (const tool of toolsClient.listTools()) {
    const ui = tool._meta?.ui;
    if (ui?.resourceUri && !registeredUris.has(ui.resourceUri)) {
      throw new Error(
        `[mcp-syson] Tool ${tool.name} advertises an unregistered UI resource: ${ui.resourceUri}`,
      );
    }
  }
  return { server, toolsClient };
}

export type CliOptions =
  | { transport: "stdio"; categories?: string[] }
  | {
    transport: "http";
    port: number;
    hostname: string;
    categories?: string[];
  };

export function parseCli(args: readonly string[]): CliOptions {
  let port = DEFAULT_HTTP_PORT;
  let hostname = "127.0.0.1";
  let categories: string[] | undefined;
  let stdio = false;
  let hasHttpArgument = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--stdio") {
      if (stdio) throw new TypeError("--stdio may only be specified once.");
      stdio = true;
    } else if (argument.startsWith("--port=")) {
      hasHttpArgument = true;
      port = positivePort(argument.slice("--port=".length));
    } else if (argument === "--port") {
      hasHttpArgument = true;
      port = positivePort(args[++index]);
    } else if (argument.startsWith("--hostname=")) {
      hasHttpArgument = true;
      hostname = nonEmpty(argument.slice("--hostname=".length), "--hostname");
    } else if (argument === "--hostname") {
      hasHttpArgument = true;
      hostname = nonEmpty(args[++index], "--hostname");
    } else if (argument.startsWith("--categories=")) {
      categories = commaSeparated(argument.slice("--categories=".length));
    } else if (argument === "--categories") {
      categories = commaSeparated(args[++index]);
    } else {
      throw new TypeError(`Unknown argument '${argument}'.`);
    }
  }
  if (stdio && hasHttpArgument) {
    throw new TypeError(
      "--stdio cannot be combined with --port or --hostname.",
    );
  }
  return stdio
    ? { transport: "stdio", ...(categories ? { categories } : {}) }
    : {
      transport: "http",
      port,
      hostname,
      ...(categories ? { categories } : {}),
    };
}

export async function main(args = Deno.args): Promise<void> {
  const cli = parseCli(args);
  const { server } = createSysonServer({
    categories: cli.categories,
  });
  if (cli.transport === "stdio") {
    await server.start();
    console.error(
      `[mcp-syson] Stdio server ready${
        cli.categories ? ` - categories: ${cli.categories.join(", ")}` : ""
      }.`,
    );
    return;
  }
  await server.startHttp({
    port: cli.port,
    hostname: cli.hostname,
    cors: true,
    onListen: (info) => {
      console.error(
        `[mcp-syson] HTTP server listening on http://${info.hostname}:${info.port}`,
      );
    },
  });
  console.error(
    `[mcp-syson] Server ready${
      cli.categories ? ` - categories: ${cli.categories.join(", ")}` : ""
    }.`,
  );
}

function positivePort(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new TypeError("--port must be an integer between 1 and 65535.");
  }
  return parsed;
}

function nonEmpty(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
  return value;
}

function commaSeparated(value: string | undefined): string[] {
  if (!value) {
    throw new TypeError("--categories must name at least one category.");
  }
  const categories = value.split(",").map((category) => category.trim()).filter(
    Boolean,
  );
  if (categories.length === 0) {
    throw new TypeError("--categories must name at least one category.");
  }
  return normalizeCategories(categories);
}

function normalizeCategories(categories: readonly string[]): string[] {
  const known = new Set(getCategories());
  const normalized = [...new Set(categories)];
  const unknown = normalized.filter((category) => !known.has(category));
  if (unknown.length > 0) {
    throw new TypeError(
      `Unknown SysON categor${unknown.length === 1 ? "y" : "ies"}: ${
        unknown.join(", ")
      }. Valid categories: ${[...known].join(", ")}.`,
    );
  }
  return normalized;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[mcp-syson] Fatal error:", error);
    Deno.exit(1);
  });
}
