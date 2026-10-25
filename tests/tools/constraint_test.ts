/**
 * Tests for SysON constraint tools
 *
 * The offline paths (explicit values, pre-extracted constraints) are covered
 * directly; extraction plumbing is exercised through the AST parser tests.
 * The solve tests require the z3 executable, installed in CI.
 */

import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import { Ajv } from "ajv";
import {
  constraintExtractOutputSchema,
  constraintTools,
} from "../../src/tools/constraint.ts";
import {
  setSysonClient,
  SysonGraphQLClient,
} from "../../src/api/graphql-client.ts";
import type { Constraint, ConstraintExpr } from "@casys/constraint-solver";

function getHandler(name: string) {
  const tool = constraintTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler;
}

function comparison(
  path: string,
  op: "<" | "<=" | ">" | ">=",
  value: number,
  unit?: string,
): ConstraintExpr {
  return {
    kind: "binary",
    op,
    left: { kind: "ref", featurePath: path.split(".") },
    right: { kind: "literal", value, unit },
  };
}

function constraint(id: string, expression: ConstraintExpr): Constraint {
  return { id, name: id, expression };
}

// ── syson_constraint_evaluate (offline) ─────────────────────────────────────

Deno.test("syson_constraint_evaluate - explicit values, pass and fail counted", async () => {
  const result = await getHandler("syson_constraint_evaluate")({
    constraints: [
      constraint("mass-budget", comparison("totalMass", "<=", 5)),
      constraint("mass-floor", comparison("totalMass", ">=", 4)),
    ],
    values: { totalMass: 2.86 },
  }) as Record<string, unknown>;

  assertEquals(result.summary, {
    total: 2,
    pass: 1,
    fail: 1,
    error: 0,
    unresolved: 0,
  });
});

Deno.test("syson_constraint_evaluate - unit-carrying values convert (kg vs lb)", async () => {
  const result = await getHandler("syson_constraint_evaluate")({
    constraints: [constraint("budget", comparison("totalMass", "<=", 4, "lb"))],
    values: { totalMass: { value: 2.5, unit: "kg" } },
  }) as { results: Array<Record<string, unknown>> };

  // 2.5 kg = 5.51 lb — over the 4 lb budget.
  assertEquals(result.results[0].status, "fail");
});

Deno.test("syson_constraint_evaluate - missing value reports unresolved, never zero", async () => {
  const result = await getHandler("syson_constraint_evaluate")({
    constraints: [constraint("budget", comparison("missing", "<=", 5))],
    values: {},
  }) as { results: Array<Record<string, unknown>> };

  assertEquals(result.results[0].status, "unresolved");
  assertEquals(result.results[0].unresolvedRefs, ["missing"]);
});

Deno.test("syson_constraint_evaluate - throws without values or model coordinates", async () => {
  await assertRejects(
    async () =>
      await getHandler("syson_constraint_evaluate")({
        constraints: [constraint("c", comparison("x", "<=", 1))],
      }),
    Error,
    "Either 'values' or both",
  );
});

// ── syson_constraint_solve (needs z3) ───────────────────────────────────────

Deno.test("syson_constraint_solve - contradiction is unsat with named conflict", async () => {
  const result = await getHandler("syson_constraint_solve")({
    constraints: [
      constraint("upper", comparison("m", "<=", 2)),
      constraint("lower", comparison("m", ">=", 5)),
    ],
  }) as Record<string, unknown>;

  assertEquals(result.status, "unsat");
  assertEquals((result.conflict as string[]).toSorted(), ["lower", "upper"]);
});

Deno.test("syson_constraint_solve - objective returns the optimum", async () => {
  const result = await getHandler("syson_constraint_solve")({
    constraints: [
      constraint("floor", comparison("m", ">=", 1.2)),
      constraint("ceiling", comparison("m", "<=", 4)),
    ],
    objective: { variable: "m", direction: "minimize" },
  }) as { status: string; objectiveValue: { value: number } };

  assertEquals(result.status, "sat");
  assertEquals(Math.abs(result.objectiveValue.value - 1.2) < 1e-9, true);
});

Deno.test("syson_constraint_solve - element without constraints is trivially sat", async () => {
  // Mock a model that contains no ConstraintUsage at all.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            evaluateExpression: {
              __typename: "EvaluateExpressionSuccessPayload",
              result: { __typename: "VoidExpressionResult" },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  setSysonClient(new SysonGraphQLClient({ baseUrl: "http://mock-syson:8180" }));

  try {
    const result = await getHandler("syson_constraint_solve")({
      editing_context_id: "ec-1",
      element_id: "empty-package",
    }) as Record<string, unknown>;

    assertEquals(result.status, "sat");
    assertEquals(
      (result.message as string).includes("trivially satisfiable"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── syson_constraint_extract (mocked SysON) ─────────────────────────────────

/**
 * Answer each AQL evaluation from `answers`, keyed by `<self id>|<expression>`.
 * A key mapped to `null` fails in GraphQL, the way SysON fails on a value
 * its expression results cannot carry.
 */
function mockAql(answers: Record<string, unknown>): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => {
    const { input } = JSON.parse(String(init?.body)).variables;
    const key = `${input.selectedObjectIds.join(",")}|${input.expression}`;
    if (!(key in answers)) throw new Error(`Unexpected AQL ${key}`);
    const answer = answers[key];
    const body = answer === null
      ? {
        data: null,
        errors: [{
          message:
            "The field at path '/evaluateExpression/result/objValue/id' was declared as a non null type, but the code involved in retrieving data has wrongly returned a null value.",
        }],
      }
      : {
        data: {
          evaluateExpression: {
            __typename: "EvaluateExpressionSuccessPayload",
            result: answer,
          },
        },
      };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  setSysonClient(new SysonGraphQLClient({ baseUrl: "http://mock-syson:8180" }));
  return () => globalThis.fetch = originalFetch;
}

const element = (id: string, entity: string, label = entity) => ({
  id,
  kind: `siriusComponents://semantic?domain=sysml&entity=${entity}`,
  label,
});
const objects = (...objsValue: unknown[]) => ({
  __typename: "ObjectsExpressionResult",
  objsValue,
});
const text = (strValue: string) => ({
  __typename: "StringExpressionResult",
  strValue,
});

/**
 * Extract `totalMass <= <literal>` where the literal is a LiteralRational
 * whose `self.value.toString()` is `literalText`. As on SysON, `self.value`
 * itself fails in GraphQL: expression results have no real-number type.
 */
async function extractWithRational(literalText: string) {
  const restore = mockAql({
    "part|aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::ConstraintUsage))":
      objects(element("c", "ConstraintUsage", "massMargin")),
    "c|aql:self.ownedElement": objects(element("op", "OperatorExpression")),
    "op|aql:self.ownedElement": objects(
      element("ref", "FeatureReferenceExpression"),
      element("lit", "LiteralRational"),
    ),
    "op|aql:self.operator": text("<="),
    "ref|aql:self.ownedElement": objects(),
    "ref|aql:self.referent.shortName": text(""),
    "ref|aql:self.referent.declaredName": text("totalMass"),
    "lit|aql:self.ownedElement": objects(),
    "lit|aql:self.value": null,
    "lit|aql:self.value.toString()": text(literalText),
  });
  try {
    return await getHandler("syson_constraint_extract")({
      editing_context_id: "ec-1",
      element_id: "part",
    }) as { constraints: Constraint[]; errors?: Array<{ error: string }> };
  } finally {
    restore();
  }
}

Deno.test("syson_constraint_extract - reads a decimal literal SysON cannot return as a number", async () => {
  for (
    const [literalText, value] of [["2.5", 2.5], ["5.5E7", 55_000_000]] as const
  ) {
    const result = await extractWithRational(literalText);
    assertEquals(result.errors ?? [], [], literalText);
    assertEquals(result.constraints[0].expression, {
      kind: "binary",
      op: "<=",
      left: { kind: "ref", featurePath: ["totalMass"] },
      right: { kind: "literal", value },
    });
  }
});

Deno.test("syson_constraint_extract - an unreadable decimal is reported, never read as 0", async () => {
  for (const literalText of ["", "  ", "NaN", "Infinity"]) {
    const result = await extractWithRational(literalText);
    assertEquals(result.constraints, [], JSON.stringify(literalText));
    assertEquals(
      result.errors?.[0].error,
      "[lib/syson] Cannot parse literal value from 'LiteralRational'",
    );
  }
});

Deno.test("syson_constraint_solve - throws without constraints or coordinates", async () => {
  await assertRejects(
    async () => await getHandler("syson_constraint_solve")({}),
    Error,
    "Either 'constraints' or both",
  );
});

// ── Invariants ──────────────────────────────────────────────────────────────

Deno.test("constraintTools - tool count and category", () => {
  assertEquals(constraintTools.length, 4);
  for (const tool of constraintTools) {
    assertEquals(tool.category, "constraint");
  }
});

Deno.test("constraintTools - every required field exists in properties", () => {
  for (const tool of constraintTools) {
    const schema = tool.inputSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    for (const field of schema.required ?? []) {
      assertEquals(
        Object.hasOwn(schema.properties, field),
        true,
        `${tool.name}: required field "${field}" missing from properties`,
      );
    }
  }
});

Deno.test("syson_constraint_extract - output schema covers the recursive expression contract", () => {
  const validate = new Ajv({ strict: false }).compile(
    constraintExtractOutputSchema,
  );
  const extraction = {
    constraints: [{
      id: "c-1",
      name: "Bounded transformed mass",
      sourceId: "requirement-1",
      expression: {
        kind: "binary",
        op: "<=",
        left: {
          kind: "call",
          name: "abs",
          args: [{
            kind: "unary",
            op: "-",
            operand: {
              kind: "ref",
              featurePath: ["assembly", "mass"],
              elementId: "mass-attribute",
            },
          }],
        },
        right: { kind: "literal", value: 5, unit: "kg" },
      },
    }],
    errors: [{ id: "c-2", name: "Unreadable", error: "No body" }],
  };

  assertEquals(validate(extraction), true, JSON.stringify(validate.errors));
  assertEquals(validate({ ...extraction, legacyText: "{}" }), false);
});

// ── AQL injection hardening ─────────────────────────────────────────────────

Deno.test("aqlEscape - quotes and backslashes cannot break out of AQL strings", async () => {
  const { aqlEscape } = await import("../../src/tools/aql.ts");

  // The classic breakout: close the string, inject an expression.
  assertEquals(
    aqlEscape("x') or true or ('"),
    "x\\') or true or (\\'",
  );
  // Backslashes are escaped first, so a crafted \' cannot re-open the string.
  assertEquals(aqlEscape("a\\'b"), "a\\\\\\'b");
  // Benign names pass through untouched.
  assertEquals(aqlEscape("totalMass"), "totalMass");
});
