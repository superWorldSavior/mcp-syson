/**
 * SysON tools - aggregated exports
 *
 * @module lib/syson/src/tools/mod
 */

export type {
  SysonTool,
  SysonToolCategory,
  SysonToolHandler,
} from "./types.ts";

// Tool categories
export { projectTools } from "./project.ts";
export { modelTools } from "./model.ts";
export { elementTools } from "./element.ts";
export { requirementsTools } from "./requirements.ts";
export { queryTools } from "./query.ts";
export { diagramTools } from "./diagram.ts";
export { constraintTools } from "./constraint.ts";
export { valueTools } from "./value.ts";

// Shared AQL helpers
export {
  evalAql,
  evalAqlObjects,
  getChildren,
  getDescendants,
  getParent,
  getSelf,
} from "./aql.ts";
export type { ExprResult } from "./aql.ts";

// Imports for combined arrays
import { projectTools } from "./project.ts";
import { modelTools } from "./model.ts";
import { elementTools } from "./element.ts";
import { requirementsTools } from "./requirements.ts";
import { queryTools } from "./query.ts";
import { diagramTools } from "./diagram.ts";
import { constraintTools } from "./constraint.ts";
import { valueTools } from "./value.ts";
import type { SysonTool } from "./types.ts";

/** All SysON tools combined */
export const allTools: SysonTool[] = [
  ...projectTools,
  ...modelTools,
  ...elementTools,
  ...queryTools,
  ...requirementsTools,
  ...diagramTools,
  ...constraintTools,
  ...valueTools,
];

/** Tools organized by category */
export const toolsByCategory: Record<string, SysonTool[]> = {
  project: projectTools,
  model: modelTools,
  element: elementTools,
  query: [...queryTools, ...requirementsTools],
  diagram: diagramTools,
  constraint: constraintTools,
  value: valueTools,
};

/** Get tools by category */
export function getToolsByCategory(category: string): SysonTool[] {
  return toolsByCategory[category] || [];
}

/** Get a specific tool by name */
export function getToolByName(name: string): SysonTool | undefined {
  return allTools.find((t) => t.name === name);
}

/** Get all available categories */
export function getCategories(): string[] {
  return Object.keys(toolsByCategory);
}
