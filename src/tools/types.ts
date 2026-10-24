/**
 * Types for SysON MCP Tools
 *
 * @module lib/syson/tools/types
 */

import type { MCPToolMeta, ToolAnnotations } from "@mcpview/server";

/** MCP Tool definition */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  _meta?: MCPToolMeta;
}

/** MCP Client interface */
export interface MCPClientBase {
  readonly serverId: string;
  readonly serverName: string;
  connect(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  disconnect(): Promise<void>;
}

/** MCP Tool in wire format */
export interface MCPToolWireFormat {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  _meta?: MCPToolMeta;
}

/** SysON tool category identifier */
export type SysonToolCategory =
  | "project"
  | "element"
  | "query"
  | "model"
  | "diagram"
  // Constraint extraction, evaluation and solving (@casys/constraint-solver)
  | "constraint"
  // Numeric attribute read/write
  | "value";

/** SysON tool handler function type */
export type SysonToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

/** SysON tool definition with handler */
export interface SysonTool {
  name: string;
  description: string;
  category: SysonToolCategory;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  handler: SysonToolHandler;
  _meta?: MCPToolMeta;
}

/** Helper to create a tool with type safety */
export function defineTool(
  name: string,
  description: string,
  category: SysonToolCategory,
  inputSchema: Record<string, unknown>,
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown,
  meta?: MCPToolMeta,
): SysonTool {
  const tool: SysonTool = { name, description, category, inputSchema, handler };
  if (meta) {
    tool._meta = meta;
  }
  return tool;
}
