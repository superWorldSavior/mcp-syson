/**
 * Tests for SysON query tools
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  setSysonClient,
  SysonGraphQLClient,
} from "../../src/api/graphql-client.ts";
import { queryTools } from "../../src/tools/query.ts";

function getHandler(name: string) {
  const tool = queryTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler;
}

function mockFetch(
  responses: Record<string, unknown>[],
  requests: Array<Record<string, unknown>> = [],
) {
  let callIndex = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (_input, init) => {
    if (typeof init?.body === "string") {
      requests.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const data = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return Promise.resolve(
      new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  };

  setSysonClient(new SysonGraphQLClient({ baseUrl: "http://mock:8080" }));
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("syson_query_aql - returns objects", async () => {
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: {
        __typename: "ObjectsExpressionResult",
        objsValue: [
          { id: "c1", kind: "sysml::PartUsage", label: "Engine", iconURLs: [] },
          {
            id: "c2",
            kind: "sysml::RequirementUsage",
            label: "REQ-001",
            iconURLs: [],
          },
        ],
      },
    },
  }]);

  try {
    const result = await getHandler("syson_query_aql")({
      editing_context_id: "ec-1",
      object_id: "e1",
      expression: "aql:self.eAllContents()",
    }) as Record<string, unknown>;
    assertEquals(result.type, "objects");
    assertEquals(result.count, 2);
    const results = result.results as Array<Record<string, unknown>>;
    assertEquals(results[0].label, "Engine");
    assertEquals(results[1].kind, "sysml::RequirementUsage");
  } finally {
    restore();
  }
});

Deno.test("syson_query_aql - derives string type from the AQL result", async () => {
  // The tool has no return_type input — the shape follows the
  // __typename that SysON reports back.
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: {
        __typename: "StringExpressionResult",
        strValue: "Propulsion Engine v2",
      },
    },
  }]);

  try {
    const result = await getHandler("syson_query_aql")({
      editing_context_id: "ec-1",
      object_id: "e1",
      expression: "aql:self.name",
    }) as Record<string, unknown>;
    assertEquals(result.type, "string");
    assertEquals(result.result, "Propulsion Engine v2");
  } finally {
    restore();
  }
});

Deno.test("syson_search - returns matches", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const restore = mockFetch([{
    viewer: {
      editingContext: {
        search: {
          result: {
            matches: [
              {
                id: "e1",
                kind: "sysml::PartUsage",
                label: "Propulsion",
                iconURLs: [],
              },
            ],
          },
        },
      },
    },
  }], requests);

  try {
    const result = await getHandler("syson_search")({
      editing_context_id: "ec-1",
      text: "Propulsion",
    }) as Record<string, unknown>;
    assertEquals(result.count, 1);
    const results = result.results as Array<Record<string, unknown>>;
    assertEquals(results[0].label, "Propulsion");
    const variables = requests[0].variables as Record<string, unknown>;
    const query = variables.query as Record<string, unknown>;
    assertEquals(query.searchInLibraries, false);
  } finally {
    restore();
  }
});

Deno.test("syson_search - throws on error", async () => {
  const restore = mockFetch([{
    viewer: {
      editingContext: {
        search: { message: "Invalid search query" },
      },
    },
  }]);

  try {
    await assertRejects(
      // Wrapped in async because SysonToolHandler is typed
      // `Promise<unknown> | unknown`, which collapses to `unknown`.
      async () =>
        await getHandler("syson_search")({
          editing_context_id: "ec-1",
          text: "[invalid",
        }),
      Error,
      "Search failed: Invalid search query",
    );
  } finally {
    restore();
  }
});

Deno.test("syson_query_eval - returns typed result", async () => {
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: {
        __typename: "StringExpressionResult",
        strValue: "Engine-v2",
      },
    },
  }]);

  try {
    const result = await getHandler("syson_query_eval")({
      editing_context_id: "ec-1",
      expression: "aql:self.name",
      selected_object_ids: ["e1"],
    }) as Record<string, unknown>;
    assertEquals(result.type, "string");
    assertEquals(result.result, "Engine-v2");
  } finally {
    restore();
  }
});

Deno.test("syson_query_eval - throws on error payload", async () => {
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "ErrorPayload",
      id: "m1",
      message: "Invalid expression",
    },
  }]);

  try {
    await assertRejects(
      async () =>
        await getHandler("syson_query_eval")({
          editing_context_id: "ec-1",
          expression: "bad:expr",
          selected_object_ids: ["e1"],
        }),
      Error,
      "evaluateExpression failed: Invalid expression",
    );
  } finally {
    restore();
  }
});

Deno.test("requirements trace keeps closed zero coverage on an unexpected result", async () => {
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: {
        __typename: "StringExpressionResult",
        strValue: "not a requirement collection",
      },
    },
  }]);

  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec-1",
      root_id: "root-1",
    }) as Record<string, unknown>;
    assertEquals(result, {
      editingContextId: "ec-1",
      scope: { kind: "element", editingContextId: "ec-1", rootId: "root-1" },
      rootId: "root-1",
      requirementsCount: 0,
      traces: [],
      coverage: {
        total: 0,
        satisfied: 0,
        unsatisfied: 0,
        percentage: 0,
      },
      error: "Unexpected result type: StringExpressionResult",
    });
  } finally {
    restore();
  }
});

Deno.test("queryTools - has correct tool count and categories", () => {
  assertEquals(queryTools.length, 5);
  for (const tool of queryTools) {
    assertEquals(tool.category, "query");
    assertEquals(
      tool.name.startsWith("syson_query_") ||
        tool.name.startsWith("syson_search") ||
        tool.name === "syson_part_structure",
      true,
    );
  }
});

function expressionResponse(result: Record<string, unknown>) {
  return {
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result,
    },
  };
}

Deno.test("requirements trace keeps extraction failures distinct from link coverage", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const restore = mockFetch([
    expressionResponse({
      __typename: "ObjectsExpressionResult",
      objsValue: [{
        id: "req-1",
        label: "Stand backrest",
        kind: "sysml::RequirementUsage",
      }],
    }),
    expressionResponse({
      __typename: "StringExpressionResult",
      strValue: "unreadable relationship",
    }),
    {
      evaluateExpression: {
        __typename: "ErrorPayload",
        message: "Constraint access denied",
      },
    },
  ], requests);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec-1",
      root_id: "root-1",
    }) as {
      traces: Array<Record<string, unknown>>;
      coverage: { satisfied: number };
    };
    assertEquals(result.traces[0].requirement, {
      id: "req-1",
      label: "Stand backrest",
    });
    assertEquals(
      String(result.traces[0].error).startsWith(
        "Could not resolve satisfy relationships:",
      ),
      true,
    );
    assertEquals(result.traces[0].authoredConstraintsStatus, "unavailable");
    assertEquals(typeof result.traces[0].authoredConstraintsError, "string");
    assertEquals(result.traces[0].authoredConstraints, undefined);
    assertEquals(result.coverage.satisfied, 0);
    assertEquals(requests.length, 3);
  } finally {
    restore();
  }
});

Deno.test("requirements trace bounds documentary enrichment without truncating requirements", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const restore = mockFetch([
    expressionResponse({
      __typename: "ObjectsExpressionResult",
      objsValue: Array.from(
        { length: 11 },
        (_, index) => ({
          id: `req-${index}`,
          label: `Requirement ${index}`,
          kind: "sysml::RequirementUsage",
        }),
      ),
    }),
    expressionResponse({
      __typename: "ObjectsExpressionResult",
      objsValue: [],
    }),
  ], requests);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec-1",
      root_id: "root-1",
    }) as { requirementsCount: number; traces: Array<Record<string, unknown>> };
    assertEquals(result.requirementsCount, 11);
    assertEquals(result.traces.length, 11);
    assertEquals(result.traces[0].authoredConstraintsStatus, "available");
    assertEquals(result.traces[0].authoredConstraints, {
      constraints: [],
      message: "No ConstraintUsage found under this element",
    });
    assertEquals(result.traces[10].authoredConstraintsStatus, "not-requested");
    assertEquals(result.traces[10].authoredConstraints, undefined);
    assertEquals(requests.length, 12);
  } finally {
    restore();
  }
});

Deno.test("requirements trace resolves satisfying features, never labels relationship usages as parts", async () => {
  const requirement = {
    id: "req",
    label: "Mass limit",
    kind: "sysml::RequirementUsage",
  };
  const relationship = {
    id: "satisfy",
    label: "Satisfy mass",
    kind: "sysml::SatisfyRequirementUsage",
  };
  const part = { id: "part", label: "Backrest", kind: "sysml::PartUsage" };
  const objects = (objsValue: unknown[]) =>
    expressionResponse({ __typename: "ObjectsExpressionResult", objsValue });
  const requests: Array<Record<string, unknown>> = [];
  const restore = mockFetch([
    objects([requirement]),
    objects([relationship]),
    objects([requirement]),
    objects([part]),
    objects([]),
  ], requests);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec",
      root_id: "root",
    }) as {
      traces: Array<Record<string, unknown>>;
      coverage: { satisfied: number };
    };
    assertEquals(result.traces[0].satisfiedBy, [part]);
    assertEquals(result.traces[0].satisfactionLinks, [{
      relationship,
      targets: [part],
      status: "resolved",
    }]);
    assertEquals(result.traces[0].error, undefined);
    assertEquals(result.coverage.satisfied, 1);
    const expressions = requests.map((request) =>
      (request.variables as { input: { expression: string } }).input.expression
    );
    assertEquals(
      expressions[1],
      "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::SatisfyRequirementUsage))",
    );
    assertEquals(expressions[2], "aql:self.satisfiedRequirement");
    assertEquals(expressions[3], "aql:self.satisfyingFeature");
  } finally {
    restore();
  }
});

Deno.test("requirements trace retains an unresolved satisfaction relationship without inventing its owner as a target", async () => {
  const requirement = {
    id: "req",
    label: "Mass limit",
    kind: "sysml::RequirementUsage",
  };
  const relationship = {
    id: "satisfy",
    label: "Satisfy mass",
    kind: "sysml::SatisfyRequirementUsage",
  };
  const objects = (objsValue: unknown[]) =>
    expressionResponse({ __typename: "ObjectsExpressionResult", objsValue });
  const restore = mockFetch([
    objects([requirement]),
    objects([relationship]),
    objects([requirement]),
    objects([]),
    objects([]),
  ]);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec",
      root_id: "root",
    }) as {
      traces: Array<Record<string, unknown>>;
      coverage: { satisfied: number };
    };
    assertEquals(result.traces[0].satisfiedBy, []);
    assertEquals(result.traces[0].satisfactionLinks, [{
      relationship,
      targets: [],
      status: "unresolved",
      error: "Satisfaction relationship has no explicit satisfying feature",
    }]);
    assertEquals(
      result.traces[0].error,
      "Satisfaction relationship has no explicit satisfying feature",
    );
    assertEquals(result.coverage.satisfied, 0);
  } finally {
    restore();
  }
});

/** How SysON records `satisfy R by f;`: f is the subject parameter's value. */
const SUBJECT_VALUE =
  "aql:self.subjectParameter.ownedRelationship->filter(sysml::FeatureValue).value->filter(sysml::FeatureReferenceExpression).referent";

Deno.test("requirements trace reads the `by` feature SysON leaves out of satisfyingFeature", async () => {
  const requirement = {
    id: "req",
    label: "massBudget",
    kind: "sysml::RequirementUsage",
  };
  const relationship = {
    id: "satisfy",
    label: "SatisfyRequirementUsage",
    kind: "sysml::SatisfyRequirementUsage",
  };
  const part = { id: "part", label: "budget", kind: "sysml::PartUsage" };
  const objects = (objsValue: unknown[]) =>
    expressionResponse({ __typename: "ObjectsExpressionResult", objsValue });
  const requests: Array<Record<string, unknown>> = [];
  const restore = mockFetch([
    objects([requirement]),
    objects([relationship]),
    objects([requirement]),
    // SysON v2026.7.0 derives no satisfyingFeature for `satisfy R by f;`.
    expressionResponse({ __typename: "VoidExpressionResult" }),
    objects([part]),
    objects([]),
  ], requests);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec",
      root_id: "root",
    }) as {
      traces: Array<Record<string, unknown>>;
      coverage: { satisfied: number };
    };
    assertEquals(result.traces[0].satisfiedBy, [part]);
    assertEquals(result.traces[0].satisfactionLinks, [{
      relationship,
      targets: [part],
      status: "resolved",
    }]);
    assertEquals(result.traces[0].error, undefined);
    assertEquals(result.coverage.satisfied, 1);
    const expressions = requests.map((request) =>
      (request.variables as { input: { expression: string } }).input.expression
    );
    assertEquals(expressions[3], "aql:self.satisfyingFeature");
    assertEquals(expressions[4], SUBJECT_VALUE);
  } finally {
    restore();
  }
});

Deno.test("requirements trace leaves a satisfy without a `by` feature unresolved", async () => {
  const requirement = {
    id: "req",
    label: "system components",
    kind: "sysml::RequirementUsage",
  };
  const relationship = {
    id: "satisfy",
    label: "SatisfyRequirementUsage",
    kind: "sysml::SatisfyRequirementUsage",
  };
  const objects = (objsValue: unknown[]) =>
    expressionResponse({ __typename: "ObjectsExpressionResult", objsValue });
  const restore = mockFetch([
    objects([requirement]),
    objects([relationship]),
    objects([requirement]),
    expressionResponse({ __typename: "VoidExpressionResult" }),
    // SysON answers an empty collection without a result type.
    expressionResponse({}),
    objects([]),
  ]);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec",
      root_id: "root",
    }) as {
      traces: Array<Record<string, unknown>>;
      coverage: { satisfied: number };
    };
    assertEquals(result.traces[0].satisfiedBy, []);
    assertEquals(result.traces[0].satisfactionLinks, [{
      relationship,
      targets: [],
      status: "unresolved",
      error: "Satisfaction relationship has no explicit satisfying feature",
    }]);
    assertEquals(result.coverage.satisfied, 0);
  } finally {
    restore();
  }
});

Deno.test("requirements trace keeps mixed resolved and unresolved links out of satisfied coverage", async () => {
  const requirement = {
    id: "req",
    label: "Mass limit",
    kind: "sysml::RequirementUsage",
  };
  const resolved = {
    id: "satisfy-1",
    label: "Known source",
    kind: "sysml::SatisfyRequirementUsage",
  };
  const unresolved = {
    id: "satisfy-2",
    label: "Missing source",
    kind: "sysml::SatisfyRequirementUsage",
  };
  const part = { id: "part", label: "Backrest", kind: "sysml::PartUsage" };
  const objects = (objsValue: unknown[]) =>
    expressionResponse({ __typename: "ObjectsExpressionResult", objsValue });
  const restore = mockFetch([
    objects([requirement]),
    objects([resolved, unresolved]),
    objects([requirement]),
    objects([part]),
    objects([requirement]),
    objects([]),
    objects([]),
  ]);
  try {
    const result = await getHandler("syson_query_requirements_trace")({
      editing_context_id: "ec",
      root_id: "root",
    }) as {
      traces: Array<
        {
          satisfiedBy: unknown[];
          satisfactionLinks: Array<{ status: string }>;
          error?: string;
        }
      >;
      coverage: Record<string, number>;
    };
    assertEquals(result.traces[0].satisfiedBy, [part]);
    assertEquals(
      result.traces[0].satisfactionLinks.map((link) => link.status),
      ["resolved", "unresolved"],
    );
    assertEquals(
      result.traces[0].error,
      "Satisfaction relationship has no explicit satisfying feature",
    );
    assertEquals(result.coverage, {
      total: 1,
      satisfied: 0,
      unsatisfied: 1,
      percentage: 0,
    });
  } finally {
    restore();
  }
});

Deno.test("syson_query_eval - identity-set reproducer resolves every ID in stable deduplicated order", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const ids = Array.from({ length: 9 }, (_, index) => `selected-${index}`);
  const restore = mockFetch(
    ids.map((id) => ({
      evaluateExpression: {
        __typename: "EvaluateExpressionSuccessPayload",
        result: {
          __typename: "ObjectExpressionResult",
          objValue: { id, kind: "sysml::PartUsage", label: id, iconURLs: [] },
        },
      },
    })),
    requests,
  );
  try {
    const result = await getHandler("syson_query_eval")({
      editing_context_id: "ec-selection",
      expression: "aql:self",
      selected_object_ids: [...ids, ids[0]],
    }) as Record<string, unknown>;
    assertEquals(result.type, "objects");
    assertEquals(result.count, 9);
    assertEquals(
      (result.results as Array<{ id: string }>).map((item) => item.id),
      ids,
    );
    assertEquals(
      requests.map((request) =>
        ((request.variables as Record<string, unknown>).input as Record<
          string,
          unknown
        >).selectedObjectIds
      ),
      ids.map((id) => [id]),
    );
  } finally {
    restore();
  }
});

Deno.test("syson_query_eval - identity-set reproducer rejects an unresolved member instead of returning a subset", async () => {
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: { __typename: "VoidExpressionResult" },
    },
  }]);
  try {
    await assertRejects(
      async () =>
        await getHandler("syson_query_eval")({
          editing_context_id: "ec-selection",
          expression: "aql:self",
          selected_object_ids: ["missing", "second"],
        }),
      Error,
      "Selected element could not be resolved: missing",
    );
  } finally {
    restore();
  }
});
