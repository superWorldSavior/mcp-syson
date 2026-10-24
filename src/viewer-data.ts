/** Shared provider/viewer data: semantic identities never imply verification. */
/** Wire expression AST; dependency-free so browser type checks need no solver. */
export type ConstraintExpr =
  | { kind: "literal"; value: number; unit?: string }
  | { kind: "ref"; featurePath: string[]; elementId?: string }
  | { kind: "binary"; op: string; left: ConstraintExpr; right: ConstraintExpr }
  | { kind: "unary"; op: string; operand: ConstraintExpr }
  | { kind: "call"; name: string; args: ConstraintExpr[] };
export interface ElementIdentity {
  id: string;
  label: string;
  kind: string;
  owner?: { id: string; label: string; kind: string };
  path?: Array<{ id: string; label: string; kind: string }>;
  childCount?: number;
}
export interface ViewerScope {
  kind: "element" | "project" | "selection";
  editingContextId: string;
  rootId?: string;
  projectId?: string;
  selectedObjectIds?: string[];
  project?: ElementIdentity;
  owner?: ElementIdentity;
  path?: ElementIdentity[];
}
export interface AuthoredConstraints {
  constraints: Array<
    { id: string; name: string; sourceId?: string; expression: ConstraintExpr }
  >;
  errors?: Array<{ id: string; name: string; error: string }>;
  message?: string;
}
export interface AuthoredRequirement {
  id: string;
  name: string;
  kind?: string;
  identifier?: string;
  identifierStatus?: "available" | "unavailable";
  text?: string;
  textStatus?: "available" | "unavailable";
  metric?: string;
  operator?: string;
  limit?: { value: number; unit: string };
  authoredConstraintsStatus?: "available" | "unavailable" | "not-requested";
  authoredConstraints?: AuthoredConstraints;
  authoredConstraintsError?: string;
  coverageStatus?: "unknown";
  owner?: ElementIdentity;
  path?: ElementIdentity[];
}
export interface RequirementsViewData extends Record<string, unknown> {
  kind: "recorded-requirements-capture" | "live-requirements";
  rootId: string;
  editingContextId?: string;
  scope?: ViewerScope;
  target: ElementIdentity;
  requirements: AuthoredRequirement[];
  count: number;
}
export interface ValidationConstraint {
  constraintId: string;
  constraintName: string;
  status: "pass" | "fail" | "error" | "unresolved";
  expression: string;
  computedValue?: number;
  threshold?: number;
  margin?: number;
  marginPercent?: number;
  unit?: string;
  error?: string;
  unresolvedRefs?: string[];
}
export interface ValidationDiagnostic {
  id: string;
  severity: "error";
  message: string;
  source: "constraint.error";
  constraint: { id: string; label: string };
  element: { id: string; label: string };
  attribution: "validation-scope";
}
export interface ValidationReport extends Record<string, unknown> {
  editingContextId: string;
  elementId: string;
  elementName: string;
  scope?: ViewerScope;
  constraints: ValidationConstraint[];
  diagnostics?: ValidationDiagnostic[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    error: number;
    unresolved: number;
  };
  resolvedValues: Record<string, number | { value: number; unit?: string }>;
  validatedAt: string;
}
export interface RequirementTraceEntry {
  requirement: { id: string; label: string };
  satisfiedBy: ElementIdentity[];
  verifiedBy?: ElementIdentity[];
  verificationStatus?: "unknown" | "available";
  error?: string;
  satisfactionLinks?: Array<
    {
      relationship: ElementIdentity;
      targets: ElementIdentity[];
      status: "resolved" | "unresolved";
      error?: string;
    }
  >;
  authoredConstraintsStatus?: "available" | "unavailable" | "not-requested";
  authoredConstraints?: AuthoredConstraints;
  authoredConstraintsError?: string;
}
export interface RequirementsTraceData extends Record<string, unknown> {
  authoredConstraintsStatus?: "available" | "unavailable" | "not-requested";
  authoredConstraints?: AuthoredConstraints;
  authoredConstraintsError?: string;
  editingContextId?: string;
  scope?: ViewerScope;
  rootId: string;
  requirementsCount: number;
  traces: RequirementTraceEntry[];
  error?: string;
  coverage: {
    total: number;
    satisfied: number;
    unsatisfied: number;
    percentage: number;
  };
}
/** Only explicit provider error facts become diagnostics; unresolved refs stay constraints. */
export function validationDiagnostics(
  constraints: readonly ValidationConstraint[],
  elementId: string,
  elementName: string,
): ValidationDiagnostic[] {
  return constraints.filter((constraint) =>
    typeof constraint.error === "string"
  ).map((constraint) => ({
    id: `constraint-error:${constraint.constraintId}`,
    severity: "error",
    message: constraint.error!,
    source: "constraint.error",
    constraint: {
      id: constraint.constraintId,
      label: constraint.constraintName,
    },
    element: { id: elementId, label: elementName },
    attribution: "validation-scope",
  }));
}

const bareIdentitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string", minLength: 1 },
    label: { type: "string" },
    kind: { type: "string", minLength: 1 },
  },
  required: ["id", "label", "kind"],
};
export const viewerIdentitySchema = {
  ...bareIdentitySchema,
  properties: {
    ...bareIdentitySchema.properties,
    owner: bareIdentitySchema,
    path: { type: "array", items: bareIdentitySchema },
    childCount: { type: "integer", minimum: 0 },
  },
};
export const viewerScopeSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { enum: ["element", "project", "selection"] },
    editingContextId: { type: "string", minLength: 1 },
    rootId: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 },
    selectedObjectIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    project: viewerIdentitySchema,
    owner: viewerIdentitySchema,
    path: { type: "array", items: viewerIdentitySchema },
  },
  required: ["kind", "editingContextId"],
};
export const viewerMetadataSchema = {
  editingContextId: { type: "string", minLength: 1 },
  scope: viewerScopeSchema,
};
export const validationDiagnosticSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    severity: { const: "error" },
    message: { type: "string" },
    source: { const: "constraint.error" },
    constraint: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" }, label: { type: "string" } },
      required: ["id", "label"],
    },
    element: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" }, label: { type: "string" } },
      required: ["id", "label"],
    },
    attribution: { const: "validation-scope" },
  },
  required: [
    "id",
    "severity",
    "message",
    "source",
    "constraint",
    "element",
    "attribution",
  ],
};
