/**
 * Bundled MCP App resources for mcp-syson.
 *
 * Each generated TypeScript bundle is reached through a literal dynamic import.
 * Literal imports keep every App in the published Deno module graph while
 * avoiding evaluation of the five unrelated HTML documents on each read.
 */

import { loadBundledUiHtml } from "./bundles.ts";

export interface UIResourceMeta {
  name: string;
  description: string;
  tools: string[];
}

const NAMESPACE = "mcp-syson";

const UI_BUNDLES = {
  "ui://mcp-syson/diagram-viewer": {
    bundle: "diagram-viewer",
    name: "Diagram Viewer",
    description: "SysON UI: diagram-viewer",
    tools: ["syson_diagram_snapshot"],
  },
  "ui://mcp-syson/model-explorer-viewer": {
    bundle: "model-explorer-viewer",
    name: "Model Explorer Viewer",
    description: "SysON UI: model-explorer-viewer",
    tools: ["syson_element_children"],
  },
  "ui://mcp-syson/query-results-viewer": {
    bundle: "query-results-viewer",
    name: "Query Results Viewer",
    description: "SysON UI: query-results-viewer",
    tools: ["syson_search", "syson_query_eval"],
  },
  "ui://mcp-syson/requirements-viewer": {
    bundle: "requirements-viewer",
    name: "Authored Requirements Viewer",
    description: "SysON UI: authored requirement limits",
    tools: ["syson_requirements_list"],
  },
  "ui://mcp-syson/requirements-trace-viewer": {
    bundle: "requirements-trace-viewer",
    name: "Requirements Trace Viewer",
    description: "SysON UI: requirements-trace-viewer",
    tools: ["syson_query_requirements_trace"],
  },
  "ui://mcp-syson/validation-viewer": {
    bundle: "validation-viewer",
    name: "Validation Viewer",
    description: "SysON UI: validation-viewer",
    tools: ["syson_constraint_validate"],
  },
  "ui://mcp-syson/value-change-viewer": {
    bundle: "value-change-viewer",
    name: "Value Change Viewer",
    description: "SysON UI: value-change-viewer",
    tools: ["syson_value_read", "syson_value_set"],
  },
} as const;

export const UI_RESOURCE_URIS = Object.freeze(Object.keys(UI_BUNDLES));

export const UI_RESOURCES: Record<string, UIResourceMeta> = Object.fromEntries(
  Object.entries(UI_BUNDLES).map(([uri, bundle]) => [uri, {
    name: bundle.name,
    description: bundle.description,
    tools: [...bundle.tools],
  }]),
);

/**
 * Return the HTML for a registered `ui://mcp-syson/*` resource.
 */
export async function loadUiHtml(uri: string): Promise<string> {
  if (!uri.startsWith(`ui://${NAMESPACE}/`)) {
    throw new Error(`[mcp-syson] UI resource not found: ${uri}`);
  }

  const bundle = UI_BUNDLES[uri as keyof typeof UI_BUNDLES];
  if (!bundle) {
    throw new Error(`[mcp-syson] UI resource not found: ${uri}`);
  }

  return await loadBundledUiHtml(bundle.bundle);
}
