/** Canonical SysON component keys shared by registries, docs and tests. */

import type { SysonRecordedViewSession } from "./recorded-session.ts";

type RecordedBasis = SysonRecordedViewSession<Record<string, unknown>>["basis"];

export const VIEWER_COMPONENT_KEYS = {
  diagram: [
    "syson.diagram.summary",
    "syson.diagram.visual",
    "syson.diagram.elements",
    "syson.diagram.identity",
  ],
  modelExplorer: [
    "syson.model.summary",
    "syson.model.elements",
    "syson.model.kind-breakdown",
    "syson.model.parent-context",
  ],
  queryResults: [
    "syson.query.summary",
    "syson.query.expression",
    "syson.query.values",
  ],
  requirements: ["syson.requirements.authored-list"],
  requirementsTrace: [
    "syson.requirements.coverage",
    "syson.requirements.trace-list",
    "syson.requirements.satisfaction-links",
  ],
  validation: [
    "syson.validation.status",
    "syson.validation.summary",
    "syson.validation.resolved-values",
    "syson.validation.constraints",
  ],
  value: [
    "syson.value.readout",
    "syson.value.identity",
    "syson.value.verification",
  ],
} as const;

/**
 * Standalone whiteboard defaults: one bounded primary view per resource.
 * Remaining catalog keys stay registered for host-negotiated composition.
 */
export const VIEWER_DEFAULT_SURFACE_KEYS = {
  diagram: ["syson.diagram.visual"],
  modelExplorer: ["syson.model.elements"],
  queryResults: ["syson.query.values"],
  requirements: ["syson.requirements.authored-list"],
  requirementsTrace: ["syson.requirements.trace-list"],
  validation: ["syson.validation.status"],
  value: ["syson.value.readout"],
} as const;

export const SYSON_SEMANTIC_DOMAIN = "sysml" as const;

type ComponentKey =
  typeof VIEWER_COMPONENT_KEYS[keyof typeof VIEWER_COMPONENT_KEYS][number];

/** Structural surface shape; @mcpview/components validates and freezes it. */
export function defaultComponentSurface(keys: readonly ComponentKey[]) {
  return {
    layout: { type: "stack" as const, gap: "sm" as const },
    components: keys.map((component, index) => ({
      id: `standalone-${index + 1}`,
      component,
    })),
  };
}

export function sysmlRef(
  kind: string,
  id: string,
  basisFingerprint?: string,
) {
  return {
    domain: SYSON_SEMANTIC_DOMAIN,
    kind,
    id,
    ...(basisFingerprint ? { basisFingerprint } : {}),
  };
}

export function digestFromSha256Prefix(
  value: string | undefined,
): string | undefined {
  if (typeof value !== "string" || !value.startsWith("sha256:")) {
    return undefined;
  }
  const digest = value.slice("sha256:".length);
  return /^[a-f0-9]{64}$/.test(digest) ? digest : undefined;
}

export function recordedProjectionDigest(
  context: {
    readonly state?: {
      readonly currentData?: {
        readonly recorded?: { readonly projectionFingerprint?: string };
      };
    };
  },
): string | undefined {
  return digestFromSha256Prefix(
    context.state?.currentData?.recorded?.projectionFingerprint,
  );
}

/** Digital Thread basis of the recorded session behind the current data, if any. */
export function recordedBasis(
  context: {
    readonly state?: {
      readonly currentData?: {
        readonly recorded?: { readonly basis?: RecordedBasis };
      };
    };
  },
): RecordedBasis | undefined {
  return context.state?.currentData?.recorded?.basis;
}

export function shortSysmlKind(kind: string): string {
  const entity = kind.match(/[?&]entity=([^&]+)/)?.[1];
  if (entity) return entity;
  return kind.includes("::") ? kind.split("::").pop()! : kind;
}

export function validationContractLabel(
  status: "pass" | "fail" | "error" | "unresolved" | "empty",
): string {
  return status === "empty" ? "unavailable" : status;
}

export function validationOverallStatus(summary: {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly error: number;
  readonly unresolved: number;
}): "pass" | "fail" | "error" | "unresolved" | "empty" {
  if (summary.total === 0) return "empty";
  if (summary.error > 0) return "error";
  if (summary.fail > 0) return "fail";
  if (summary.unresolved > 0) return "unresolved";
  return "pass";
}

export function traceLinkStatus(trace: {
  readonly satisfiedBy: readonly unknown[];
  readonly error?: string;
}): "linked" | "unlinked" | "unresolved" {
  if (trace.error !== undefined) return "unresolved";
  return trace.satisfiedBy.length > 0 ? "linked" : "unlinked";
}

export function linkCoverageGauge(coverage: {
  readonly total: number;
  readonly satisfied: number;
  readonly unsatisfied: number;
  readonly percentage: number;
}, unresolvedCount = 0):
  | { readonly available: false; readonly statusLabel: "unavailable" }
  | {
    readonly available: true;
    readonly label: "Link coverage";
    readonly min: 0;
    readonly max: 100;
    readonly value: number;
    readonly valueLabel: string;
    readonly statusLabel: "linked" | "unlinked" | "unresolved";
    readonly tone: "info" | "warning";
  } {
  if (
    !Number.isSafeInteger(unresolvedCount) || unresolvedCount < 0 ||
    unresolvedCount > coverage.unsatisfied
  ) {
    throw new RangeError(
      "Requirements coverage unresolved count must fit the unsatisfied count.",
    );
  }
  if (coverage.total <= 0) {
    return { available: false, statusLabel: "unavailable" };
  }
  const statusLabel = unresolvedCount > 0
    ? "unresolved"
    : coverage.unsatisfied > 0
    ? "unlinked"
    : "linked";
  return {
    available: true,
    label: "Link coverage",
    min: 0,
    max: 100,
    value: coverage.percentage,
    valueLabel: `${Math.round(coverage.percentage)}%`,
    statusLabel,
    tone: statusLabel === "linked" ? "info" : "warning",
  };
}
