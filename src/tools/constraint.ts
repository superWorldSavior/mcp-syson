import {
  validationDiagnostics,
  validationDiagnosticSchema,
  viewerScopeSchema,
} from "../viewer-data.ts";
/**
 * SysON Constraint Tools
 *
 * Extract ConstraintUsage expressions from a model, evaluate them against
 * resolved or provided values, and check their mutual satisfiability.
 * Evaluation and solving are delegated to `@casys/constraint-solver` —
 * this module owns only the SysON side: finding constraints, walking their
 * expression trees, resolving referenced values.
 *
 * @module lib/syson/tools/constraint
 */

import {
  type Constraint,
  type ConstraintResult,
  evaluateAll,
  type QuantityValue,
  solve,
  toValueMap,
  type ValueMap,
} from "@casys/constraint-solver";
import type { StructuredToolResult } from "@mcpview/server";
import type { SysonTool } from "./types.ts";
import { evalAql, evalAqlObjects, getSelf } from "./aql.ts";
import {
  normalizeKind,
  parseAstNode,
  type SysonAstNode,
} from "../constraints/ast-parser.ts";
import { resolveValues } from "../constraints/resolver.ts";
import type { GqlObject } from "../api/types.ts";

// ============================================================================
// Extraction helpers
// ============================================================================

/**
 * Recursively build a SysonAstNode tree from a SysON expression element,
 * reading the properties each node kind needs (operator, value, referent).
 */
async function buildAstTree(
  ecId: string,
  elementId: string,
  obj: GqlObject,
): Promise<SysonAstNode> {
  const children = await evalAqlObjects(
    ecId,
    "aql:self.ownedElement",
    elementId,
  );
  const shortKind = normalizeKind(obj.kind);

  let props: Record<string, string | number | boolean> | undefined;

  if (shortKind.includes("OperatorExpression")) {
    try {
      const op = await evalAql(ecId, "aql:self.operator", [elementId]);
      if (op.__typename === "StringExpressionResult") {
        props = { operator: op.strValue };
      }
    } catch { /* no operator property on this node */ }
  }

  if (shortKind.includes("LiteralRational")) {
    // SysON's expression results have no real-number type: `self.value` on a
    // LiteralRational fails in GraphQL, so the decimal is read as its text.
    try {
      const val = await evalAql(ecId, "aql:self.value.toString()", [
        elementId,
      ]);
      const num = val.__typename === "StringExpressionResult"
        ? Number(val.strValue)
        : NaN;
      if (Number.isFinite(num)) props = { ...props, value: num };
    } catch { /* unreadable: the parser reports the literal */ }
  } else if (shortKind.includes("Literal")) {
    try {
      const val = await evalAql(ecId, "aql:self.value", [elementId]);
      if (val.__typename === "IntExpressionResult") {
        props = { ...props, value: val.intValue };
      } else if (val.__typename === "StringExpressionResult") {
        const num = parseFloat(val.strValue);
        if (!isNaN(num)) props = { ...props, value: num };
      } else if (val.__typename === "BooleanExpressionResult") {
        props = { ...props, value: val.boolValue };
      }
    } catch { /* no value property on this node */ }
  }

  if (shortKind.includes("FeatureReferenceExpression")) {
    let referentName: string | undefined;
    try {
      const shortRef = await evalAql(ecId, "aql:self.referent.shortName", [
        elementId,
      ]);
      if (
        shortRef.__typename === "StringExpressionResult" &&
        shortRef.strValue.trim() !== ""
      ) {
        referentName = shortRef.strValue;
      }
    } catch { /* most ordinary features do not declare a short name */ }
    if (!referentName) {
      try {
        const ref = await evalAql(ecId, "aql:self.referent.declaredName", [
          elementId,
        ]);
        if (ref.__typename === "StringExpressionResult") {
          referentName = ref.strValue;
        }
      } catch { /* no referent on this node */ }
    }
    if (referentName) {
      props = { ...props, referentName };
    }
  }

  const childNodes: SysonAstNode[] = [];
  for (const child of children) {
    childNodes.push(await buildAstTree(ecId, child.id, child));
  }

  return {
    id: obj.id,
    kind: obj.kind,
    label: obj.label,
    children: childNodes.length > 0 ? childNodes : undefined,
    props,
  };
}

/** A constraint that could not be parsed, reported alongside the others. */
interface ExtractionError {
  id: string;
  name: string;
  error: string;
}

/**
 * Find every ConstraintUsage under an element and parse its body expression.
 * Parse failures are returned as errors, never silently dropped.
 */
async function extractConstraints(
  ecId: string,
  elementId: string,
): Promise<{ constraints: Constraint[]; errors: ExtractionError[] }> {
  const found = await evalAqlObjects(
    ecId,
    "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::ConstraintUsage))",
    elementId,
  );

  const constraints: Constraint[] = [];
  const errors: ExtractionError[] = [];

  for (const obj of found) {
    try {
      const bodyChildren = await evalAqlObjects(
        ecId,
        "aql:self.ownedElement",
        obj.id,
      );
      const bodyExpr = bodyChildren.find((c) => {
        const k = normalizeKind(c.kind);
        return k.includes("Expression") || k.includes("Literal");
      });

      if (!bodyExpr) {
        errors.push({
          id: obj.id,
          name: obj.label,
          error: "No body expression found",
        });
        continue;
      }

      const astTree = await buildAstTree(ecId, bodyExpr.id, bodyExpr);
      constraints.push({
        id: obj.id,
        name: obj.label,
        sourceId: obj.id,
        expression: parseAstNode(astTree),
      });
    } catch (e) {
      errors.push({
        id: obj.id,
        name: obj.label,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { constraints, errors };
}

/** Values as the tools accept them: bare numbers or { value, unit }. */
type ValuesInput = Record<string, number | { value: number; unit?: string }>;

type ConstraintEvaluationOutput = {
  results: ConstraintResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    error: number;
    unresolved: number;
  };
  resolvedValues: Record<string, QuantityValue>;
} & Record<string, unknown>;

type ConstraintExtractionOutput = {
  constraints: Constraint[];
  errors?: ExtractionError[];
  message?: string;
};

const constraintExpressionOutputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "literal" },
        value: { type: "number" },
        unit: { type: "string" },
      },
      required: ["kind", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "ref" },
        featurePath: { type: "array", items: { type: "string" } },
        elementId: { type: "string" },
      },
      required: ["kind", "featurePath"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "binary" },
        op: {
          enum: [
            "+",
            "-",
            "*",
            "/",
            "<",
            "<=",
            ">",
            ">=",
            "==",
            "!=",
            "and",
            "or",
          ],
        },
        left: { $ref: "#/$defs/constraintExpression" },
        right: { $ref: "#/$defs/constraintExpression" },
      },
      required: ["kind", "op", "left", "right"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "unary" },
        op: { enum: ["not", "-"] },
        operand: { $ref: "#/$defs/constraintExpression" },
      },
      required: ["kind", "op", "operand"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { const: "call" },
        name: { type: "string" },
        args: {
          type: "array",
          items: { $ref: "#/$defs/constraintExpression" },
        },
      },
      required: ["kind", "name", "args"],
    },
  ],
};

/** Closed contract for constraints extracted from the SysON expression tree. */
export const constraintExtractOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    constraints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          sourceId: { type: "string" },
          expression: { $ref: "#/$defs/constraintExpression" },
        },
        required: ["id", "name", "expression"],
      },
    },
    errors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          error: { type: "string" },
        },
        required: ["id", "name", "error"],
      },
    },
    message: { type: "string" },
  },
  required: ["constraints"],
  $defs: {
    constraintExpression: constraintExpressionOutputSchema,
  },
};

const quantityOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "number" },
    unit: { type: "string" },
  },
  required: ["value"],
};

const constraintResultOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    constraintId: { type: "string" },
    constraintName: { type: "string" },
    status: { enum: ["pass", "fail", "error", "unresolved"] },
    expression: { type: "string" },
    computedValue: { type: "number" },
    threshold: { type: "number" },
    margin: { type: "number" },
    marginPercent: { type: "number" },
    unit: { type: "string" },
    error: { type: "string" },
    unresolvedRefs: { type: "array", items: { type: "string" } },
  },
  required: ["constraintId", "constraintName", "status", "expression"],
};

const constraintSummaryOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    total: { type: "integer", minimum: 0 },
    pass: { type: "integer", minimum: 0 },
    fail: { type: "integer", minimum: 0 },
    error: { type: "integer", minimum: 0 },
    unresolved: { type: "integer", minimum: 0 },
  },
  required: ["total", "pass", "fail", "error", "unresolved"],
};

/** Closed contract for the explicit, offline-capable constraint evaluation output. */
export const constraintEvaluateOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: { type: "array", items: constraintResultOutputSchema },
    summary: constraintSummaryOutputSchema,
    resolvedValues: {
      type: "object",
      additionalProperties: quantityOutputSchema,
    },
  },
  required: ["results", "summary", "resolvedValues"],
};

/** Closed output contract for one-shot extraction, resolution and evaluation. */
export const constraintValidateOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    editingContextId: { type: "string" },
    elementId: { type: "string" },
    elementName: { type: "string" },
    constraints: { type: "array", items: constraintResultOutputSchema },
    scope: viewerScopeSchema,
    diagnostics: { type: "array", items: validationDiagnosticSchema },
    summary: constraintSummaryOutputSchema,
    resolvedValues: {
      type: "object",
      additionalProperties: quantityOutputSchema,
    },
    validatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "editingContextId",
    "elementId",
    "elementName",
    "constraints",
    "summary",
    "resolvedValues",
    "validatedAt",
  ],
};

/** Serialise a ValueMap for the tool response. */
function valuesToJson(values: ValueMap): Record<string, QuantityValue> {
  return Object.fromEntries(values);
}

/** Keep the text fallback concise while strict clients use structuredContent. */
export function toConstraintEvaluateResult(
  value: unknown,
): StructuredToolResult {
  const report = value as ConstraintEvaluationOutput;
  const { summary } = report;
  return {
    content: `Evaluated ${summary.total} constraint${
      summary.total === 1 ? "" : "s"
    }: ${summary.pass} pass, ${summary.fail} fail, ${summary.error} error, ${summary.unresolved} unresolved.`,
    structuredContent: report,
  };
}

/** Expose extracted constraints natively without asking callers to parse text. */
export function toConstraintExtractResult(
  value: unknown,
): StructuredToolResult {
  const extraction = value as ConstraintExtractionOutput;
  const errorCount = extraction.errors?.length ?? 0;
  return {
    content: `Extracted ${extraction.constraints.length} constraint${
      extraction.constraints.length === 1 ? "" : "s"
    }${
      errorCount > 0
        ? ` with ${errorCount} parse error${errorCount === 1 ? "" : "s"}`
        : ""
    }.`,
    structuredContent: extraction,
  };
}

/** Count statuses over results that may include extraction errors. */
function summarise(results: ConstraintResult[]) {
  return {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    error: results.filter((r) => r.status === "error").length,
    unresolved: results.filter((r) => r.status === "unresolved").length,
  };
}

// ============================================================================
// Tool definitions
// ============================================================================

export const constraintTools: SysonTool[] = [
  {
    name: "syson_constraint_extract",
    description: "Extract constraint definitions from a SysML element. " +
      "Returns structured constraints (operator, operands, thresholds) plus " +
      "parse errors for any ConstraintUsage that could not be read. " +
      "Pass the result to syson_constraint_evaluate or syson_constraint_solve. " +
      "For one-shot extract+evaluate, use syson_constraint_validate.",
    category: "constraint",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID (from syson_project_get)",
        },
        element_id: {
          type: "string",
          description:
            "UUID of the SysML element to scan for constraints (e.g., a package or part)",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    outputSchema: constraintExtractOutputSchema,
    handler: async ({ editing_context_id, element_id }) => {
      const { constraints, errors } = await extractConstraints(
        editing_context_id as string,
        element_id as string,
      );
      return {
        constraints,
        ...(errors.length > 0 && { errors }),
        ...(constraints.length === 0 && errors.length === 0 &&
          { message: "No ConstraintUsage found under this element" }),
      };
    },
  },

  {
    name: "syson_constraint_evaluate",
    description:
      "Evaluate constraints and return pass/fail with margins, units included " +
      "(2.5 kg against a 4 lb limit fails, since 2.5 kg is 5.51 lb). " +
      "Pass 'values' directly for offline evaluation — numbers or " +
      "{value, unit} objects — or editing_context_id + element_id to resolve " +
      "values from the model. Model-resolved values are dimensionless: a " +
      "constraint whose literal carries a unit then reports an error rather " +
      "than comparing bare numbers; override such values explicitly.",
    category: "constraint",
    inputSchema: {
      type: "object",
      properties: {
        constraints: {
          type: "array",
          items: { type: "object" },
          description: "Constraints from syson_constraint_extract",
        },
        values: {
          type: "object",
          description:
            'Feature path → value map, e.g. {"totalMass": 2.86} or ' +
            '{"totalMass": {"value": 2.86, "unit": "kg"}}. ' +
            "Omit to resolve from the model (requires editing_context_id + element_id).",
        },
        editing_context_id: {
          type: "string",
          description: "Editing context ID, for model value resolution",
        },
        element_id: {
          type: "string",
          description: "Element scope for model value resolution",
        },
      },
      required: ["constraints"],
    },
    outputSchema: constraintEvaluateOutputSchema,
    handler: async (args) => {
      const constraints = args.constraints as Constraint[];
      const provided = args.values as ValuesInput | undefined;
      const ecId = args.editing_context_id as string | undefined;
      const elementId = args.element_id as string | undefined;

      let values: ValueMap;
      if (provided) {
        values = toValueMap(provided);
      } else if (ecId && elementId) {
        values = await resolveValues(ecId, elementId, constraints);
      } else {
        throw new Error(
          "[lib/syson] Either 'values' or both 'editing_context_id' and " +
            "'element_id' must be provided.",
        );
      }

      const report = evaluateAll(constraints, values);
      return {
        ...report,
        resolvedValues: valuesToJson(values),
      } satisfies ConstraintEvaluationOutput;
    },
  },

  {
    name: "syson_constraint_validate",
    description:
      "Validate a model element against all its constraints in one call: " +
      "extract, resolve values from the model, evaluate, and report with " +
      "margins. Pass 'values' to override parameters for what-if scenarios " +
      '(e.g. {"totalMass": 6.5} to test an over-budget mass).',
    category: "constraint",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID (from syson_project_get)",
        },
        element_id: {
          type: "string",
          description: "UUID of the element to validate (system, package…)",
        },
        values: {
          type: "object",
          description:
            "Optional overrides, as numbers or {value, unit} objects. " +
            "Missing keys are resolved from the model.",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    _meta: {
      ui: {
        resourceUri: "ui://mcp-syson/validation-viewer",
        emits: ["syson.constraint.selected"],
      },
    },
    outputSchema: constraintValidateOutputSchema,
    handler: async (args) => {
      const ecId = args.editing_context_id as string;
      const elementId = args.element_id as string;
      const provided = args.values as ValuesInput | undefined;

      const self = await getSelf(ecId, elementId);
      const elementName = self?.label ?? "(unknown)";

      const { constraints, errors } = await extractConstraints(ecId, elementId);

      const parseErrors: ConstraintResult[] = errors.map((e) => ({
        constraintId: e.id,
        constraintName: e.name,
        status: "error",
        expression: "(unparsed)",
        error: e.error,
      }));

      const values = await resolveValues(
        ecId,
        elementId,
        constraints,
        provided ? toValueMap(provided) : undefined,
      );

      const report = evaluateAll(constraints, values);
      const allResults = [...report.results, ...parseErrors];

      return {
        editingContextId: ecId,
        elementId,
        elementName,
        scope: { kind: "element", editingContextId: ecId, rootId: elementId },
        constraints: allResults,
        diagnostics: validationDiagnostics(allResults, elementId, elementName),
        summary: summarise(allResults),
        resolvedValues: valuesToJson(values),
        validatedAt: new Date().toISOString(),
      };
    },
  },

  {
    name: "syson_constraint_solve",
    description:
      "Check whether constraints can hold together at all — the question no " +
      "evaluation answers, since a contradiction (mass <= 2 and mass >= 5) " +
      "holds for NO values. Returns sat with admissible values, or unsat " +
      "with the conflicting constraint ids named. An objective turns the " +
      "answer into an optimum (e.g. minimize totalMass); 'fixed' pins known " +
      "values. Pass pre-extracted 'constraints', or editing_context_id + " +
      "element_id to extract first. Requires the z3 executable on the " +
      "machine running this MCP server (apt install z3 / brew install z3).",
    category: "constraint",
    inputSchema: {
      type: "object",
      properties: {
        constraints: {
          type: "array",
          items: { type: "object" },
          description: "Constraints from syson_constraint_extract",
        },
        editing_context_id: {
          type: "string",
          description: "Editing context ID, to extract constraints first",
        },
        element_id: {
          type: "string",
          description: "Element to extract constraints from",
        },
        objective: {
          type: "object",
          properties: {
            variable: {
              type: "string",
              description: "Feature path to optimise",
            },
            direction: { type: "string", enum: ["minimize", "maximize"] },
          },
          required: ["variable", "direction"],
          description:
            "Optimise one variable instead of returning any solution",
        },
        fixed: {
          type: "object",
          description:
            "Values to pin before solving, as numbers or {value, unit} objects",
        },
        timeout_ms: {
          type: "number",
          description: "z3 time limit in milliseconds (default 10000)",
        },
      },
    },
    handler: async (args) => {
      const provided = args.constraints as Constraint[] | undefined;
      const ecId = args.editing_context_id as string | undefined;
      const elementId = args.element_id as string | undefined;

      let constraints: Constraint[];
      let extractionErrors: ExtractionError[] = [];

      if (provided && provided.length > 0) {
        constraints = provided;
      } else if (ecId && elementId) {
        const extracted = await extractConstraints(ecId, elementId);
        constraints = extracted.constraints;
        extractionErrors = extracted.errors;
      } else {
        throw new Error(
          "[lib/syson] Either 'constraints' or both 'editing_context_id' and " +
            "'element_id' must be provided.",
        );
      }

      if (constraints.length === 0) {
        return {
          status: "sat",
          message: "No constraints to solve — trivially satisfiable.",
          ...(extractionErrors.length > 0 && { extractionErrors }),
        };
      }

      const fixed = args.fixed as ValuesInput | undefined;
      const result = await solve(constraints, {
        objective: args.objective as
          | { variable: string; direction: "minimize" | "maximize" }
          | undefined,
        fixed: fixed ? toValueMap(fixed) : undefined,
        timeoutMs: args.timeout_ms as number | undefined,
      });

      return {
        ...result,
        ...(extractionErrors.length > 0 && { extractionErrors }),
      };
    },
  },
];
