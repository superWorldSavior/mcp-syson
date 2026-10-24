/**
 * MCP SysON (MBSE) Library
 *
 * MCP tools for SysML v2 model management through SysON's GraphQL and
 * SysML v2 REST surfaces. The custom GraphQL client uses fetch().
 *
 * @module lib/syson
 */

// Re-export client and tools
export {
  allTools,
  defaultClient,
  getCategories,
  getToolByName,
  getToolsByCategory,
  SysonToolsClient,
  SysonToolsMCP,
  sysonToolsMCP,
  toolsByCategory,
} from "./src/client.ts";

// Re-export client types
export type {
  MCPClientBase,
  MCPTool,
  SysonToolsClientOptions,
} from "./src/client.ts";

// Re-export types
export type {
  SysonTool,
  SysonToolCategory,
  SysonToolHandler,
} from "./src/client.ts";

// Re-export GraphQL client for direct use
export {
  getSysonClient,
  resetSysonClient,
  setSysonClient,
  SysonGraphQLClient,
} from "./src/client.ts";
export type { SysonGraphQLClientOptions } from "./src/client.ts";

// Re-export individual tool arrays
export {
  constraintTools,
  diagramTools,
  elementTools,
  modelTools,
  projectTools,
  queryTools,
  requirementsTools,
  valueTools,
} from "./src/tools/mod.ts";

// Constraint infrastructure — AST parsing and model value resolution
export { normalizeKind, parseAstNode } from "./src/constraints/ast-parser.ts";
export type { SysonAstNode } from "./src/constraints/ast-parser.ts";
export {
  collectAllRefs,
  collectRefs,
  readAttributeValue,
  resolveValues,
} from "./src/constraints/resolver.ts";
export type { AttributeReading } from "./src/constraints/resolver.ts";

// Re-export shared AQL helpers — the building blocks every tool traverses with
export {
  evalAql,
  evalAqlObjects,
  getChildren,
  getDescendants,
  getParent,
  getSelf,
} from "./src/tools/mod.ts";
export type { ExprResult } from "./src/tools/mod.ts";

// MCP App compatibility declarations for generic read-only hosts.
export {
  SYSON_RECORDED_SESSION_SCHEMAS,
  SYSON_RESULT_SCHEMAS,
  SYSON_UI_RESOURCE_URIS,
  SYSON_VIEW_APP_MANIFEST,
  SYSON_VIEW_APP_MANIFEST_SCHEMA,
  SYSON_VIEWER_SESSION_ACTION,
} from "./src/ui/app-manifest.ts";
export {
  fingerprintSysonRecordedProjection,
  parseSysonRecordedViewSession,
} from "./src/ui/shared/recorded-session.ts";
export type {
  SysonRecordedViewSession,
} from "./src/ui/shared/recorded-session.ts";
