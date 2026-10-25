/** App-owned compatibility declaration for standalone and recorded SysON views. */

import {
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "@mcpview/contracts";
export const SYSON_VIEW_APP_MANIFEST_SCHEMA = VIEW_APP_MANIFEST_SCHEMA;
export const SYSON_VIEWER_SESSION_ACTION = VIEWER_SESSION_APPLY_ACTION;

export const SYSON_UI_RESOURCE_URIS = {
  diagram: "ui://mcp-syson/diagram-viewer",
  modelExplorer: "ui://mcp-syson/model-explorer-viewer",
  queryResults: "ui://mcp-syson/query-results-viewer",
  requirements: "ui://mcp-syson/requirements-viewer",
  requirementsTrace: "ui://mcp-syson/requirements-trace-viewer",
  validation: "ui://mcp-syson/validation-viewer",
  value: "ui://mcp-syson/value-change-viewer",
} as const;

export const SYSON_RESULT_SCHEMAS = {
  diagram: "io.casys.mcp-syson.diagram-snapshot-result/1.0",
  modelExplorer: "io.casys.mcp-syson.model-children-result/1.0",
  queryResults: "io.casys.mcp-syson.query-result/1.0",
  requirements: "io.casys.mcp-syson.authored-requirements-result/1.0",
  requirementsTrace: "io.casys.mcp-syson.requirements-trace-result/1.0",
  validation: "io.casys.mcp-syson.validation-result/1.0",
  value: "io.casys.mcp-syson.value-result/1.0",
} as const;

/** Exact Digital Thread captures that this provider-owned App can project. */
export const SYSON_DIGITAL_THREAD_RESULT_SCHEMAS = {
  architecture: "architecture-capture/4.0",
  partDefinitions: "part-definitions-capture/1.0",
  requirements: "requirements-capture/3.0",
} as const;

export const SYSON_RECORDED_SESSION_SCHEMAS = {
  diagram: "io.casys.mcp-syson.recorded-diagram-session/1.0",
  modelExplorer: "io.casys.mcp-syson.recorded-model-children-session/1.0",
  queryResults: "io.casys.mcp-syson.recorded-query-session/1.0",
  requirements: "io.casys.mcp-syson.recorded-authored-requirements-session/1.0",
  requirementsTrace:
    "io.casys.mcp-syson.recorded-requirements-trace-session/1.0",
  validation: "io.casys.mcp-syson.recorded-validation-session/1.0",
  value: "io.casys.mcp-syson.recorded-value-session/1.0",
} as const;

export type SysonViewKey = keyof typeof SYSON_UI_RESOURCE_URIS;

export interface SysonViewAppResource {
  readonly uri: (typeof SYSON_UI_RESOURCE_URIS)[SysonViewKey];
  readonly ownership: "whole-view";
  readonly resultSchemas: readonly string[];
  readonly acceptedActions: readonly [typeof SYSON_VIEWER_SESSION_ACTION];
  readonly sessionSchemas: readonly string[];
}

export interface SysonViewAppManifest {
  readonly schemaVersion: typeof SYSON_VIEW_APP_MANIFEST_SCHEMA;
  readonly app: Readonly<{
    id: "io.casys.mcp-syson";
    title: "SysON Views";
    version: "0.9.2";
  }>;
  readonly resources: readonly Readonly<SysonViewAppResource>[];
}

const resources: SysonViewAppResource[] = (
  Object.keys(SYSON_UI_RESOURCE_URIS) as SysonViewKey[]
).map(
  (key) => ({
    uri: SYSON_UI_RESOURCE_URIS[key],
    ownership: "whole-view" as const,
    resultSchemas: [
      SYSON_RESULT_SCHEMAS[key],
      ...(key === "modelExplorer"
        ? [
          SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.architecture,
          SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.partDefinitions,
        ]
        : key === "requirements"
        ? [SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.requirements]
        : []),
    ],
    acceptedActions: [SYSON_VIEWER_SESSION_ACTION],
    sessionSchemas: [SYSON_RECORDED_SESSION_SCHEMAS[key]],
  }),
);

/**
 * Presentation compatibility only. This manifest deliberately contains no
 * SysON endpoint, credentials, tool name, arguments or live-provider policy.
 */
export const SYSON_VIEW_APP_MANIFEST: Readonly<SysonViewAppManifest> = Object
  .freeze({
    schemaVersion: SYSON_VIEW_APP_MANIFEST_SCHEMA,
    app: Object.freeze({
      id: "io.casys.mcp-syson",
      title: "SysON Views",
      version: "0.9.2",
    }),
    resources: Object.freeze(
      resources.map((resource) => Object.freeze(resource)),
    ),
  });
