import {
  type RequirementsTraceData,
  type RequirementsViewData,
  type ValidationConstraint,
  validationDiagnostics,
  type ValidationReport,
} from "../../viewer-data.ts";
export type {
  AuthoredRequirement,
  ElementIdentity,
  RequirementsTraceData,
  RequirementsViewData,
  RequirementTraceEntry,
  ValidationDiagnostic,
  ValidationReport,
  ViewerScope,
} from "../../viewer-data.ts";
/** App-owned structural guards for recorded SysON structuredContent. */

import { SYSON_DIGITAL_THREAD_RESULT_SCHEMAS } from "../app-manifest.ts";
import {
  hasExactKeys,
  isDenseJsonArray,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
} from "./recorded-session.ts";

export interface ModelChildrenReadModel extends Record<string, unknown> {
  readonly parentId: string;
  readonly children: Array<{
    readonly id: string;
    readonly kind: string;
    readonly label: string;
  }>;
  readonly count: number;
}

export interface RequirementsCaptureReadModel extends Record<string, unknown> {
  readonly kind: "recorded-requirements-capture";
  readonly rootId: string;
  readonly target: {
    readonly id: string;
    readonly kind: string;
    readonly label: string;
  };
  readonly requirements: Array<{
    readonly id: string;
    readonly name: string;
    readonly metric: string;
    readonly operator: string;
    readonly limit: { readonly value: number; readonly unit: string };
  }>;
  readonly count: number;
}

/** Project the provider's exact persisted DT captures into its own small view. */
export function adaptModelExplorerRecordedContent(
  resultSchema: string,
  value: unknown,
): ModelChildrenReadModel | undefined {
  if (
    resultSchema === SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.architecture &&
    isArchitectureCapture(value)
  ) {
    const children = value.partDefinitions.map(identityFromPartDefinition);
    return {
      parentId: value.scopeRoot.id,
      children,
      count: children.length,
    };
  }
  if (
    resultSchema === SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.partDefinitions &&
    isPartDefinitionsCapture(value)
  ) {
    const children = value.partDefinitions.map(identityFromPartDefinition);
    return {
      parentId: value.architecture.semanticRoot.id,
      children,
      count: children.length,
    };
  }
  return undefined;
}

/** Keep authored requirement limits documentary; do not infer satisfaction. */
export function adaptRequirementsRecordedContent(
  resultSchema: string,
  value: unknown,
): RequirementsCaptureReadModel | undefined {
  if (
    resultSchema !== SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.requirements ||
    !isRequirementsCapture(value)
  ) return undefined;
  const requirements = value.requirements.map((requirement) => ({
    id: requirement.id,
    name: requirement.name,
    metric: requirement.metric,
    operator: requirement.operator,
    limit: {
      value: requirement.limit.value,
      unit: requirement.limit.unit,
    },
  }));
  return {
    kind: "recorded-requirements-capture",
    rootId: value.requirementsElementId,
    target: {
      id: value.target.elementId,
      kind: value.target.kind,
      label: value.target.label,
    },
    requirements,
    count: requirements.length,
  };
}

export function isRequirementsCaptureReadModel(
  value: unknown,
): value is RequirementsCaptureReadModel {
  return isExactRecord(value, [
    "count",
    "kind",
    "requirements",
    "rootId",
    "target",
  ]) &&
    value.kind === "recorded-requirements-capture" &&
    isNonEmptyString(value.rootId) &&
    isIdentity(value.target) &&
    isDenseJsonArray(value.requirements) &&
    value.requirements.every(isCapturedRequirement) &&
    isNonNegativeInteger(value.count) &&
    value.count === value.requirements.length;
}

export function isDiagramSnapshot(
  value: unknown,
): value is Record<string, unknown> {
  return hasRequiredAndOptionalKeys(
    value,
    [
      "diagramId",
      "diagramLabel",
      "nodeCount",
      "edgeCount",
      "nodes",
      "edges",
      "svg",
      "renderer",
    ],
    [
      "rendererWarning",
      "editingContextId",
      "targetObjectId",
      "metadata",
      "hiddenNodeCount",
      "hiddenEdgeCount",
    ],
  ) &&
    optionalString(value, "editingContextId", true) &&
    ["hiddenNodeCount", "hiddenEdgeCount"].every((key) =>
      value[key] === undefined || isNonNegativeInteger(value[key])
    ) &&
    optionalString(value, "targetObjectId") &&
    (value.metadata === undefined ||
      (isExactRecord(value.metadata, ["label", "kind", "description"]) &&
        typeof value.metadata.label === "string" &&
        typeof value.metadata.kind === "string" &&
        isDescription(value.metadata.description))) &&
    isNonEmptyString(value.diagramId) &&
    typeof value.diagramLabel === "string" &&
    isNonNegativeInteger(value.nodeCount) &&
    isNonNegativeInteger(value.edgeCount) &&
    isDenseJsonArray(value.nodes) && value.nodes.every(isDiagramNode) &&
    value.nodes.length === value.nodeCount &&
    isDenseJsonArray(value.edges) && value.edges.every(isDiagramEdge) &&
    value.edges.length === value.edgeCount &&
    typeof value.svg === "string" &&
    (value.renderer === "local" || value.renderer === "external") &&
    (value.rendererWarning === undefined ||
      typeof value.rendererWarning === "string");
}

export function isModelChildren(
  value: unknown,
): value is Record<string, unknown> {
  return hasRequiredAndOptionalKeys(value, ["parentId", "children", "count"], [
    "editingContextId",
  ]) &&
    optionalString(value, "editingContextId", true) &&
    isNonEmptyString(value.parentId) &&
    isDenseJsonArray(value.children) && value.children.every(isIdentity) &&
    isNonNegativeInteger(value.count) &&
    value.count === value.children.length;
}

export function isQueryResult(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (!isViewerMetadata(value)) return false;
  const { editingContextId: _ec, scope: _scope, ...legacy } = value;
  value = legacy;
  if (!isRecord(value)) return false;
  if (value.type === undefined) {
    return isExactRecord(value, ["query", "results", "count"]) &&
      typeof value.query === "string" &&
      isDenseJsonArray(value.results) &&
      value.results.every(isSearchIdentity) &&
      isNonNegativeInteger(value.count) &&
      value.count === value.results.length;
  }
  if (typeof value.expression !== "string") return false;
  if (value.type === "objects") {
    return isExactRecord(
      value,
      ["type", "expression", "results", "count"],
    ) && isDenseJsonArray(value.results) && value.results.every(isIdentity) &&
      isNonNegativeInteger(value.count) && value.count === value.results.length;
  }
  if (!isExactRecord(value, ["type", "expression", "result"])) return false;
  if (value.type === "object") return isIdentity(value.result);
  if (value.type === "string") return typeof value.result === "string";
  if (value.type === "boolean") return typeof value.result === "boolean";
  if (value.type === "int") return Number.isSafeInteger(value.result);
  return value.type === "void" && value.result === null;
}

export function isRequirementsTrace(
  value: unknown,
): value is RequirementsTraceData {
  if (
    !hasRequiredAndOptionalKeys(
      value,
      ["rootId", "requirementsCount", "traces", "coverage"],
      [
        "error",
        "editingContextId",
        "scope",
        "authoredConstraintsStatus",
        "authoredConstraintsError",
        "authoredConstraints",
      ],
    ) || !isViewerMetadata(value) || !isAuthoredEnrichment(value) ||
    !isNonEmptyString(value.rootId) ||
    !isNonNegativeInteger(value.requirementsCount) ||
    !isDenseJsonArray(value.traces) || !value.traces.every(isTrace) ||
    !isExactRecord(value.coverage, [
      "total",
      "satisfied",
      "unsatisfied",
      "percentage",
    ]) ||
    (value.error !== undefined && typeof value.error !== "string")
  ) return false;
  const coverage = value.coverage;
  const satisfied =
    value.traces.filter((trace) =>
      isRecord(trace) && trace.error === undefined &&
      isDenseJsonArray(trace.satisfiedBy) &&
      trace.satisfiedBy.length > 0
    ).length;
  const total = value.traces.length;
  const unsatisfied = total - satisfied;
  const percentage = total > 0 ? Math.round((satisfied / total) * 100) : 0;
  return value.requirementsCount === total &&
    isNonNegativeInteger(coverage.total) &&
    isNonNegativeInteger(coverage.satisfied) &&
    isNonNegativeInteger(coverage.unsatisfied) &&
    isFiniteNumber(coverage.percentage) && coverage.percentage >= 0 &&
    coverage.percentage <= 100 &&
    coverage.total === total && coverage.satisfied === satisfied &&
    coverage.unsatisfied === unsatisfied && coverage.percentage === percentage;
}

export function isValidationReport(
  value: unknown,
): value is ValidationReport {
  if (
    !hasRequiredAndOptionalKeys(value, [
      "editingContextId",
      "elementId",
      "elementName",
      "constraints",
      "summary",
      "resolvedValues",
      "validatedAt",
    ], ["scope", "diagnostics"]) || !isViewerMetadata(value) ||
    !isNonEmptyString(value.editingContextId) ||
    !isNonEmptyString(value.elementId) ||
    typeof value.elementName !== "string" ||
    !isDenseJsonArray(value.constraints) ||
    !value.constraints.every(isConstraint) ||
    !isExactRecord(value.summary, [
      "total",
      "pass",
      "fail",
      "error",
      "unresolved",
    ]) || !isRecord(value.resolvedValues) ||
    !Object.values(value.resolvedValues).every(isQuantity) ||
    typeof value.validatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.validatedAt))
  ) return false;
  if (value.diagnostics !== undefined) {
    const expected = validationDiagnostics(
      value.constraints as unknown as ValidationConstraint[],
      value.elementId,
      value.elementName,
    );
    if (
      !isDenseJsonArray(value.diagnostics) ||
      value.diagnostics.length !== expected.length ||
      !value.diagnostics.every((diagnostic, index) => {
        const source = expected[index];
        return isExactRecord(diagnostic, [
          "id",
          "severity",
          "message",
          "source",
          "constraint",
          "element",
          "attribution",
        ]) &&
          isExactRecord(diagnostic.constraint, ["id", "label"]) &&
          isExactRecord(diagnostic.element, ["id", "label"]) &&
          diagnostic.id === source.id &&
          diagnostic.severity === source.severity &&
          diagnostic.message === source.message &&
          diagnostic.source === source.source &&
          diagnostic.attribution === source.attribution &&
          diagnostic.constraint.id === source.constraint.id &&
          diagnostic.constraint.label === source.constraint.label &&
          diagnostic.element.id === source.element.id &&
          diagnostic.element.label === source.element.label;
      })
    ) return false;
  }
  const summary = value.summary;
  const counts = { pass: 0, fail: 0, error: 0, unresolved: 0 };
  for (const constraint of value.constraints) {
    if (!isRecord(constraint)) return false;
    counts[constraint.status as keyof typeof counts] += 1;
  }
  return ["total", "pass", "fail", "error", "unresolved"].every((key) =>
    isNonNegativeInteger(summary[key])
  ) && summary.total === value.constraints.length &&
    summary.pass === counts.pass && summary.fail === counts.fail &&
    summary.error === counts.error &&
    summary.unresolved === counts.unresolved;
}

export function isValueResult(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value) || !isNonEmptyString(value.element_id)) return false;
  if (!isViewerMetadata(value)) return false;
  const { editingContextId: _ec, scope: _scope, ...legacy } = value;
  value = legacy;
  if (!isRecord(value)) return false;
  if ("old_value" in value) {
    const shapeIsValid = hasRequiredAndOptionalKeys(
      value,
      [
        "element_id",
        "old_value",
        "new_value",
        "literal_id",
        "literal_kind",
        "success",
      ],
      ["verified_value", "warning"],
    ) && isFiniteNumber(value.old_value) && isFiniteNumber(value.new_value) &&
      isNonEmptyString(value.literal_id) &&
      isNonEmptyString(value.literal_kind) &&
      typeof value.success === "boolean" &&
      (value.verified_value === undefined ||
        isFiniteNumber(value.verified_value)) &&
      (value.warning === undefined || typeof value.warning === "string");
    if (!shapeIsValid) return false;
    const readBackMatches = typeof value.verified_value === "number" &&
      typeof value.new_value === "number" &&
      Math.abs(value.verified_value - value.new_value) < 1e-9;
    return value.success === readBackMatches;
  }
  return isExactRecord(value, [
    "element_id",
    "value",
    "literal_id",
    "literal_kind",
    "negated",
  ]) && isFiniteNumber(value.value) &&
    isNonEmptyString(value.literal_id) &&
    isNonEmptyString(value.literal_kind) &&
    typeof value.negated === "boolean";
}

function isBareIdentity(value: unknown): boolean {
  return isExactRecord(value, ["id", "kind", "label"]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.kind) &&
    typeof value.label === "string";
}
function isIdentity(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(value, ["id", "kind", "label"], [
    "owner",
    "path",
    "childCount",
  ]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.kind) &&
    typeof value.label === "string" &&
    (value.owner === undefined || isBareIdentity(value.owner)) &&
    (value.path === undefined ||
      (isDenseJsonArray(value.path) && value.path.every(isBareIdentity))) &&
    (value.childCount === undefined || isNonNegativeInteger(value.childCount));
}

interface CapturedIdentity {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

interface CapturedPartDefinition extends CapturedIdentity {
  readonly usages: unknown[];
  readonly attributes?: unknown[];
}

interface ArchitectureCapture extends Record<string, unknown> {
  readonly schemaVersion:
    typeof SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.architecture;
  readonly scopeRoot: CapturedIdentity;
  readonly semanticRoot: CapturedIdentity;
  readonly partDefinitions: CapturedPartDefinition[];
}

interface PartDefinitionsCapture extends Record<string, unknown> {
  readonly schemaVersion:
    typeof SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.partDefinitions;
  readonly architecture: {
    readonly semanticRoot: CapturedIdentity;
  };
  readonly partDefinitions: CapturedPartDefinition[];
}

interface RequirementsCapture extends Record<string, unknown> {
  readonly schemaVersion:
    typeof SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.requirements;
  readonly requirementsElementId: string;
  readonly target: {
    readonly elementId: string;
    readonly kind: string;
    readonly label: string;
  };
  readonly requirements: Array<{
    readonly id: string;
    readonly name: string;
    readonly metric: string;
    readonly operator: string;
    readonly limit: { readonly value: number; readonly unit: string };
  }>;
}

function isArchitectureCapture(
  value: unknown,
): value is ArchitectureCapture {
  return isExactRecord(value, [
    "insertedAt",
    "operation",
    "packageName",
    "partDefinitions",
    "schemaVersion",
    "scopeRoot",
    "seed",
    "semanticRoot",
    "sourceAnalyses",
    "systemName",
    "trustedRunId",
  ]) &&
    value.schemaVersion ===
      SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.architecture &&
    isTimestamp(value.insertedAt) && isOperation(value.operation) &&
    isNonEmptyString(value.packageName) &&
    isNonEmptyString(value.systemName) &&
    isNonEmptyString(value.trustedRunId) && isRecord(value.seed) &&
    isCapturedIdentity(value.scopeRoot) &&
    isCapturedIdentity(value.semanticRoot) &&
    isDenseJsonArray(value.sourceAnalyses) &&
    isDenseJsonArray(value.partDefinitions) &&
    value.partDefinitions.every(isCapturedPartDefinition);
}

function isPartDefinitionsCapture(
  value: unknown,
): value is PartDefinitionsCapture {
  return isExactRecord(value, [
    "architecture",
    "capturedAt",
    "kind",
    "operation",
    "partDefinitions",
    "schemaVersion",
    "scope",
    "seed",
    "statement",
    "trustedRunId",
  ]) &&
    value.schemaVersion ===
      SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.partDefinitions &&
    value.kind === "part-definitions" &&
    value.scope === "sealed-architecture-subgraph" &&
    isTimestamp(value.capturedAt) && isOperation(value.operation) &&
    typeof value.statement === "string" &&
    isNonEmptyString(value.trustedRunId) && isRecord(value.seed) &&
    isArchitectureReference(value.architecture) &&
    isDenseJsonArray(value.partDefinitions) &&
    value.partDefinitions.every(isCapturedPartDefinition);
}

function isRequirementsCapture(
  value: unknown,
): value is RequirementsCapture {
  return isExactRecord(value, [
    "architecture",
    "architectureBasis",
    "constraintUsages",
    "containerComponent",
    "insertedAt",
    "operation",
    "partDefName",
    "requirementUsage",
    "requirements",
    "requirementsElementId",
    "schemaVersion",
    "seed",
    "target",
    "trustedRunId",
  ]) &&
    value.schemaVersion === SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.requirements &&
    isTimestamp(value.insertedAt) && isOperation(value.operation) &&
    isNonEmptyString(value.containerComponent) &&
    isNonEmptyString(value.partDefName) &&
    isNonEmptyString(value.requirementsElementId) &&
    isNonEmptyString(value.trustedRunId) && isRecord(value.seed) &&
    isRecord(value.architecture) && isRecord(value.architectureBasis) &&
    isRequirementUsage(value.requirementUsage) && isTarget(value.target) &&
    isDenseJsonArray(value.constraintUsages) &&
    value.constraintUsages.every(isConstraintUsageCapture) &&
    isDenseJsonArray(value.requirements) &&
    value.requirements.every(isCapturedRequirement);
}

function identityFromPartDefinition(
  value: CapturedPartDefinition,
): CapturedIdentity {
  return { id: value.id, kind: value.kind, label: value.label };
}

function isCapturedIdentity(value: unknown): value is CapturedIdentity {
  return isExactRecord(value, ["id", "kind", "label"]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.kind) &&
    typeof value.label === "string";
}

function isCapturedPartDefinition(
  value: unknown,
): value is CapturedPartDefinition {
  return hasRequiredAndOptionalKeys(
    value,
    ["id", "kind", "label", "usages"],
    ["attributes"],
  ) && isNonEmptyString(value.id) && isNonEmptyString(value.kind) &&
    typeof value.label === "string" &&
    isDenseJsonArray(value.usages) && value.usages.every(isCapturedUsage) &&
    (value.attributes === undefined ||
      (isDenseJsonArray(value.attributes) &&
        value.attributes.every(isCapturedIdentity)));
}

function isCapturedUsage(value: unknown): boolean {
  return isExactRecord(value, [
    "id",
    "kind",
    "label",
    "targetId",
    "targetKind",
    "targetLabel",
  ]) && isNonEmptyString(value.id) && isNonEmptyString(value.kind) &&
    typeof value.label === "string" && isNonEmptyString(value.targetId) &&
    isNonEmptyString(value.targetKind) && typeof value.targetLabel === "string";
}

function isArchitectureReference(value: unknown): value is {
  semanticRoot: CapturedIdentity;
} {
  return isExactRecord(value, [
    "artifactId",
    "fingerprint",
    "packageName",
    "producerRunId",
    "schemaVersion",
    "scopeRoot",
    "semanticRoot",
    "systemName",
    "uri",
  ]) && isNonEmptyString(value.artifactId) && isRecord(value.fingerprint) &&
    isNonEmptyString(value.packageName) &&
    isNonEmptyString(value.producerRunId) &&
    value.schemaVersion === SYSON_DIGITAL_THREAD_RESULT_SCHEMAS.architecture &&
    isCapturedIdentity(value.scopeRoot) &&
    isCapturedIdentity(value.semanticRoot) &&
    isNonEmptyString(value.systemName) && isNonEmptyString(value.uri);
}

function isTarget(value: unknown): value is RequirementsCapture["target"] {
  return isExactRecord(value, ["elementId", "kind", "label"]) &&
    isNonEmptyString(value.elementId) && isNonEmptyString(value.kind) &&
    typeof value.label === "string";
}

function isRequirementUsage(value: unknown): boolean {
  return isExactRecord(value, ["id", "kind"]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.kind);
}

function isConstraintUsageCapture(value: unknown): boolean {
  return isExactRecord(value, ["id", "kind", "requirementId", "sourceId"]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.kind) &&
    isNonEmptyString(value.requirementId) && isNonEmptyString(value.sourceId);
}

function isCapturedRequirement(
  value: unknown,
): value is RequirementsCapture["requirements"][number] {
  return isExactRecord(value, [
    "id",
    "limit",
    "metric",
    "name",
    "operator",
  ]) && isNonEmptyString(value.id) && isRecord(value.limit) &&
    isExactRecord(value.limit, ["unit", "value"]) &&
    isFiniteNumber(value.limit.value) && isNonEmptyString(value.limit.unit) &&
    isNonEmptyString(value.metric) && isNonEmptyString(value.name) &&
    isNonEmptyString(value.operator);
}

function isOperation(value: unknown): boolean {
  return isExactRecord(value, ["id", "version"]) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.version);
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSearchIdentity(value: unknown): boolean {
  if (
    !hasRequiredAndOptionalKeys(value, ["id", "kind", "label", "iconURLs"], [
      "owner",
      "path",
      "childCount",
    ])
  ) return false;
  const { iconURLs, ...identity } = value;
  // Native search results may have an empty kind; all other identity fields
  // still follow the shared identity contract.
  return typeof identity.kind === "string" &&
    isIdentity({ ...identity, kind: identity.kind || "unknown" }) &&
    isDenseJsonArray(iconURLs) &&
    iconURLs.every((url) => typeof url === "string");
}
function optionalString(
  value: Record<string, unknown>,
  key: string,
  nonempty = false,
): boolean {
  return value[key] === undefined ||
    (nonempty ? isNonEmptyString(value[key]) : typeof value[key] === "string");
}
function isDescription(value: unknown): boolean {
  return isExactRecord(value, ["id", "label"]) && isNonEmptyString(value.id) &&
    typeof value.label === "string";
}
function isNativeNodeStyle(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(value, ["kind"], [
    "background",
    "borderColor",
    "borderRadius",
    "borderSize",
    "borderStyle",
    "imageURL",
    "childrenLayout",
  ]) && typeof value.kind === "string" &&
    (value.childrenLayout === undefined ||
      value.childrenLayout === "list" || value.childrenLayout === "free") &&
    [
      "ImageNodeStyle",
      "IconLabelNodeStyle",
      "RectangularNodeStyle",
      "SysMLPackageNodeStyle",
      "SysMLImportedPackageNodeStyle",
      "SysMLNoteNodeStyle",
      "SysMLViewFrameNodeStyle",
      "EllipseNodeStyle",
    ].includes(value.kind) &&
    ["background", "borderColor", "borderStyle", "imageURL"].every((key) =>
      optionalString(value, key)
    ) &&
    ["borderRadius", "borderSize"].every((key) =>
      value[key] === undefined ||
      (isFiniteNumber(value[key]) && (value[key] as number) >= 0)
    );
}
function isDiagramNode(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(value, ["id", "label"], [
    "targetObjectId",
    "type",
    "parentId",
    "kind",
    "hasLayout",
    "faded",
    "outsideLabels",
    "style",
    "x",
    "y",
    "width",
    "height",
  ]) && isNonEmptyString(value.id) && typeof value.label === "string" &&
    (value.faded === undefined || value.faded === true) &&
    ["targetObjectId", "type", "parentId"].every((key) =>
      optionalString(value, key)
    ) &&
    (value.kind === undefined ||
      (typeof value.kind === "string" &&
        ["node", "compartment", "port"].includes(value.kind))) &&
    (value.outsideLabels === undefined ||
      (isDenseJsonArray(value.outsideLabels) &&
        value.outsideLabels.every((label) => typeof label === "string"))) &&
    (value.style === undefined || isNativeNodeStyle(value.style)) &&
    (value.hasLayout === undefined || typeof value.hasLayout === "boolean") &&
    ["x", "y", "width", "height"].every((key) =>
      value[key] === undefined || isFiniteNumber(value[key])
    ) &&
    ["width", "height"].every((key) =>
      value[key] === undefined || (value[key] as number) >= 0
    );
}
function isDiagramEdge(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(value, ["id", "sourceId", "targetId"], [
    "label",
    "targetObjectId",
    "type",
    "beginLabel",
    "endLabel",
    "style",
    "faded",
    "routingPoints",
  ]) &&
    ["id", "sourceId", "targetId"].every((key) =>
      isNonEmptyString(value[key])
    ) &&
    (value.faded === undefined || value.faded === true) &&
    (value.style === undefined ||
      (isExactRecord(value.style, [
        "lineStyle",
        "sourceArrow",
        "targetArrow",
      ]) &&
        ["lineStyle", "sourceArrow", "targetArrow"].every((key) =>
          typeof (value.style as Record<string, unknown>)[key] === "string"
        ))) &&
    ["label", "targetObjectId", "type", "beginLabel", "endLabel"].every((key) =>
      optionalString(value, key)
    ) &&
    (value.routingPoints === undefined ||
      (isDenseJsonArray(value.routingPoints) &&
        value.routingPoints.every((point) =>
          isExactRecord(point, ["x", "y"]) && isFiniteNumber(point.x) &&
          isFiniteNumber(point.y)
        )));
}

/** Bounded recursive AST guard; payloads remain data and cannot add authority. */
function isConstraintExpression(value: unknown, depth = 0): boolean {
  if (depth > 48 || !isRecord(value)) return false;
  switch (value.kind) {
    case "literal":
      return hasRequiredAndOptionalKeys(value, ["kind", "value"], ["unit"]) &&
        isFiniteNumber(value.value) && optionalString(value, "unit");
    case "ref":
      return hasRequiredAndOptionalKeys(value, ["kind", "featurePath"], [
        "elementId",
      ]) && isDenseJsonArray(value.featurePath) &&
        value.featurePath.every((p) => typeof p === "string") &&
        optionalString(value, "elementId");
    case "binary":
      return isExactRecord(value, ["kind", "op", "left", "right"]) &&
        typeof value.op === "string" &&
        ["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!=", "and", "or"]
          .includes(value.op) &&
        isConstraintExpression(value.left, depth + 1) &&
        isConstraintExpression(value.right, depth + 1);
    case "unary":
      return isExactRecord(value, ["kind", "op", "operand"]) &&
        typeof value.op === "string" && ["not", "-"].includes(value.op) &&
        isConstraintExpression(value.operand, depth + 1);
    case "call":
      return isExactRecord(value, ["kind", "name", "args"]) &&
        typeof value.name === "string" && isDenseJsonArray(value.args) &&
        value.args.every((arg) => isConstraintExpression(arg, depth + 1));
    default:
      return false;
  }
}
function isAuthoredEnrichment(value: Record<string, unknown>): boolean {
  if (
    value.authoredConstraintsStatus !== undefined &&
    !(typeof value.authoredConstraintsStatus === "string" &&
      ["available", "unavailable", "not-requested"].includes(
        value.authoredConstraintsStatus,
      ))
  ) return false;
  if (!optionalString(value, "authoredConstraintsError")) return false;
  if (
    value.authoredConstraintsStatus === "available" &&
    value.authoredConstraints === undefined
  ) return false;
  if (
    value.authoredConstraintsStatus === "not-requested" &&
    value.authoredConstraints !== undefined
  ) return false;
  if (value.authoredConstraints === undefined) return true;
  const authored = value.authoredConstraints;
  return hasRequiredAndOptionalKeys(authored, ["constraints"], [
    "errors",
    "message",
  ]) && isDenseJsonArray(authored.constraints) &&
    authored.constraints.every((c) =>
      hasRequiredAndOptionalKeys(c, ["id", "name", "expression"], [
        "sourceId",
      ]) && isNonEmptyString(c.id) && typeof c.name === "string" &&
      optionalString(c, "sourceId") && isConstraintExpression(c.expression)
    ) && optionalString(authored, "message") &&
    (authored.errors === undefined ||
      (isDenseJsonArray(authored.errors) &&
        authored.errors.every((e) =>
          isExactRecord(e, ["id", "name", "error"]) && isNonEmptyString(e.id) &&
          typeof e.name === "string" && typeof e.error === "string"
        )));
}

function isTrace(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(
    value,
    ["requirement", "satisfiedBy"],
    [
      "error",
      "satisfactionLinks",
      "verifiedBy",
      "verificationStatus",
      "authoredConstraintsStatus",
      "authoredConstraintsError",
      "authoredConstraints",
    ],
  ) && isAuthoredEnrichment(value) &&
    (value.verifiedBy === undefined ||
      (isDenseJsonArray(value.verifiedBy) &&
        value.verifiedBy.every(isIdentity))) &&
    (value.verificationStatus === undefined ||
      ["unknown", "available"].includes(String(value.verificationStatus))) &&
    (value.verificationStatus !== "unknown" ||
      value.verifiedBy === undefined) &&
    isDescription(value.requirement) &&
    (value.satisfactionLinks === undefined ||
      (isDenseJsonArray(value.satisfactionLinks) &&
        value.satisfactionLinks.every((link) =>
          hasRequiredAndOptionalKeys(link, [
            "relationship",
            "targets",
            "status",
          ], ["error"]) && isIdentity(link.relationship) &&
          isDenseJsonArray(link.targets) && link.targets.every(isIdentity) &&
          typeof link.status === "string" &&
          ["resolved", "unresolved"].includes(link.status) &&
          (link.status === "resolved"
            ? link.targets.length > 0
            : link.targets.length === 0) &&
          optionalString(link, "error")
        ))) &&
    isDenseJsonArray(value.satisfiedBy) &&
    value.satisfiedBy.every(isIdentity) &&
    (value.error === undefined || typeof value.error === "string");
}

function isConstraint(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(
    value,
    ["constraintId", "constraintName", "status", "expression"],
    [
      "computedValue",
      "threshold",
      "margin",
      "marginPercent",
      "unit",
      "error",
      "unresolvedRefs",
    ],
  ) && isNonEmptyString(value.constraintId) &&
    typeof value.constraintName === "string" &&
    ["pass", "fail", "error", "unresolved"].includes(String(value.status)) &&
    typeof value.expression === "string" &&
    ["computedValue", "threshold", "margin", "marginPercent"].every((key) =>
      value[key] === undefined || isFiniteNumber(value[key])
    ) &&
    (value.unit === undefined || typeof value.unit === "string") &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.unresolvedRefs === undefined ||
      (isDenseJsonArray(value.unresolvedRefs) &&
        value.unresolvedRefs.every((item) => typeof item === "string")));
}

function isQuantity(value: unknown): boolean {
  return hasRequiredAndOptionalKeys(value, ["value"], ["unit"]) &&
    isFiniteNumber(value.value) &&
    (value.unit === undefined || typeof value.unit === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}

function hasRequiredAndOptionalKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value) || required.some((key) => !(key in value))) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((key) => allowed.has(key));
}

/** Optional metadata is closed and cannot substitute a project ID for a semantic root. */
export function isViewerMetadata(value: Record<string, unknown>): boolean {
  if (!optionalString(value, "editingContextId", true)) return false;
  if (value.scope === undefined) return true;
  const scope = value.scope;
  return hasRequiredAndOptionalKeys(scope, ["kind", "editingContextId"], [
    "rootId",
    "projectId",
    "selectedObjectIds",
    "project",
    "owner",
    "path",
  ]) &&
    ["element", "project", "selection"].includes(String(scope.kind)) &&
    isNonEmptyString(scope.editingContextId) &&
    (value.editingContextId === undefined ||
      value.editingContextId === scope.editingContextId) &&
    optionalString(scope, "rootId", true) &&
    optionalString(scope, "projectId", true) &&
    (scope.kind !== "element" || isNonEmptyString(scope.rootId)) &&
    (scope.kind !== "project" || isNonEmptyString(scope.projectId)) &&
    (scope.selectedObjectIds === undefined ||
      (isDenseJsonArray(scope.selectedObjectIds) &&
        scope.selectedObjectIds.every(isNonEmptyString))) &&
    (scope.project === undefined || isIdentity(scope.project)) &&
    (scope.owner === undefined || isIdentity(scope.owner)) &&
    (scope.path === undefined ||
      (isDenseJsonArray(scope.path) && scope.path.every(isIdentity)));
}
export function isRequirementsViewData(
  value: unknown,
): value is RequirementsViewData {
  if (isRequirementsCaptureReadModel(value)) return true;
  return hasRequiredAndOptionalKeys(value, [
    "kind",
    "rootId",
    "editingContextId",
    "scope",
    "target",
    "requirements",
    "count",
  ], []) &&
    value.kind === "live-requirements" && isViewerMetadata(value) &&
    isNonEmptyString(value.rootId) && isIdentity(value.target) &&
    isDenseJsonArray(value.requirements) &&
    value.requirements.every((row) =>
      hasRequiredAndOptionalKeys(row, [
        "id",
        "name",
        "kind",
        "textStatus",
        "identifierStatus",
        "coverageStatus",
        "authoredConstraintsStatus",
      ], [
        "text",
        "identifier",
        "metric",
        "operator",
        "limit",
        "authoredConstraints",
        "authoredConstraintsError",
        "owner",
        "path",
      ]) &&
      isNonEmptyString(row.id) && typeof row.name === "string" &&
      isNonEmptyString(row.kind) &&
      ["available", "unavailable"].includes(String(row.textStatus)) &&
      ["available", "unavailable"].includes(String(row.identifierStatus)) &&
      (row.textStatus === "available"
        ? typeof row.text === "string" && row.text.length > 0
        : row.text === undefined) &&
      (row.identifierStatus === "available"
        ? isNonEmptyString(row.identifier)
        : row.identifier === undefined) &&
      row.coverageStatus === "unknown" && isAuthoredEnrichment(row) &&
      (row.limit === undefined
        ? row.metric === undefined && row.operator === undefined
        : hasRequiredAndOptionalKeys(row.limit, ["value", "unit"], []) &&
          isFiniteNumber(row.limit.value) &&
          typeof row.limit.unit === "string" && isNonEmptyString(row.metric) &&
          isNonEmptyString(row.operator)) &&
      (row.owner === undefined || isIdentity(row.owner)) &&
      (row.path === undefined ||
        (isDenseJsonArray(row.path) && row.path.every(isIdentity)))
    ) && isNonNegativeInteger(value.count) &&
    value.count === value.requirements.length;
}
