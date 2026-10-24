import { assertEquals, assertRejects } from "@std/assert";
import {
  setSysonClient,
  SysonGraphQLClient,
} from "../../src/api/graphql-client.ts";
import { constraintTools } from "../../src/tools/constraint.ts";
import { requirementsTools } from "../../src/tools/requirements.ts";
import { isRequirementsViewData } from "../../src/ui/shared/recorded-content.ts";
import { getToolByName } from "../../src/tools/mod.ts";
import type {
  AuthoredConstraints,
  RequirementsViewData,
} from "../../src/viewer-data.ts";
const req = {
  id: "req",
  label: "Authored requirement",
  kind: "sysml::RequirementUsage",
  iconURLs: [],
};
function provider(
  options: {
    empty?: boolean;
    failExtraction?: boolean;
    project?: boolean;
    unavailableText?: boolean;
    voidDiscovery?: boolean;
    missingSearch?: boolean;
    missingRoot?: boolean;
  } = {},
) {
  const old = globalThis.fetch;
  globalThis.fetch = (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const expression: string = request.variables.input?.expression ?? "";
    let data: unknown;
    if (request.query.includes("GetProject")) {
      data = {
        viewer: {
          project: {
            id: "project",
            name: "Project",
            currentEditingContext: { id: "ec" },
          },
        },
      };
    } else if (request.query.includes("SearchElements")) {
      data = {
        viewer: {
          editingContext: {
            search: {
              result: {
                matches: options.empty ? [] : [req, req, {
                  ...req,
                  id: "satisfy",
                  kind: "sysml::SatisfyRequirementUsage",
                }],
              },
            },
          },
        },
      };
      if (options.missingSearch) {
        data = { viewer: { editingContext: { search: {} } } };
      }
    } else {
      let result: unknown = { __typename: "VoidExpressionResult" };
      if (expression.startsWith("aql:self.oclIsKindOf")) {
        result = {
          __typename: "BooleanExpressionResult",
          boolValue: request.variables.input.selectedObjectIds[0] === "req",
        };
      } else if (expression === "aql:self") {
        result = {
          __typename: "ObjectExpressionResult",
          objValue: {
            id: "root",
            label: "Package",
            kind: "sysml::Package",
            iconURLs: [],
          },
        };
      } else if (expression.includes("RequirementUsage")) {
        result = {
          __typename: "ObjectsExpressionResult",
          objsValue: options.empty ? [] : [req],
        };
      } else if (expression.includes("ConstraintUsage")) {
        result = { __typename: "ObjectsExpressionResult", objsValue: [] };
      } else if (expression.includes("documentation")) {
        result = {
          __typename: "StringExpressionResult",
          strValue: "The system shall retain this exact authored text.",
        };
      }
      if (
        options.unavailableText && expression.includes("documentation") ||
        options.voidDiscovery && expression.includes("RequirementUsage") &&
          !expression.startsWith("aql:self.oclIsKindOf") ||
        options.missingRoot && expression === "aql:self"
      ) {
        result = { __typename: "VoidExpressionResult" };
      }
      const payload =
        expression.includes("ConstraintUsage") && options.failExtraction
          ? { __typename: "ErrorPayload", message: "extraction refused" }
          : { __typename: "EvaluateExpressionSuccessPayload", result };
      data = { evaluateExpression: payload };
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  setSysonClient(new SysonGraphQLClient({ baseUrl: "http://mock" }));
  return () => {
    globalThis.fetch = old;
  };
}
Deno.test("live requirements package/project routes share a truthful canonical read model", async () => {
  for (const project of [false, true]) {
    const restore = provider({ project });
    try {
      const data = await requirementsTools[0].handler(
        project
          ? { project_id: "project" }
          : { editing_context_id: "ec", root_id: "root" },
      ) as RequirementsViewData;
      assertEquals(isRequirementsViewData(data), true);
      assertEquals(data.count, 1);
      assertEquals(data.scope?.kind, project ? "project" : "element");
      assertEquals(data.scope?.rootId, project ? undefined : "root");
      assertEquals(
        data.requirements[0].text,
        "The system shall retain this exact authored text.",
      );
      assertEquals(data.requirements[0].identifierStatus, "unavailable");
      assertEquals(data.requirements[0].limit, undefined);
      assertEquals(data.requirements[0].coverageStatus, "unknown");
    } finally {
      restore();
    }
  }
});
Deno.test("requirements empty output and failed extraction remain honest readable data", async () => {
  for (const empty of [false, true]) {
    const restore = provider({ empty, failExtraction: true });
    try {
      const data = await requirementsTools[0].handler({
        editing_context_id: "ec",
        root_id: "root",
      }) as RequirementsViewData;
      assertEquals(isRequirementsViewData(data), true);
      assertEquals(data.count, empty ? 0 : 1);
      if (!empty) {
        assertEquals(
          data.requirements[0].authoredConstraintsStatus,
          "unavailable",
        );
        assertEquals(
          data.requirements[0].authoredConstraintsError?.includes(
            "extraction refused",
          ),
          true,
        );
      }
    } finally {
      restore();
    }
  }
});
Deno.test("requirements tool is live-registered and rejects ambiguous scope before provider IO", async () => {
  assertEquals(
    getToolByName("syson_requirements_list")?._meta?.ui?.resourceUri,
    "ui://mcp-syson/requirements-viewer",
  );
  await assertRejects(
    async () =>
      await requirementsTools[0].handler({
        project_id: "p",
        editing_context_id: "ec",
        root_id: "root",
      }),
    Error,
    "Supply project_id OR",
  );
});

Deno.test("requirements reject invalid scope values before provider IO", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    throw new Error("Unexpected provider IO");
  };
  try {
    for (
      const scope of [
        {},
        { project_id: "" },
        { project_id: " " },
        { project_id: null },
        { editing_context_id: "ec", root_id: " " },
        { editing_context_id: " ", root_id: "root" },
        { project_id: "", editing_context_id: "ec", root_id: "root" },
        { project_id: "p", root_id: "root" },
      ]
    ) {
      await assertRejects(
        async () => await requirementsTools[0].handler(scope),
        Error,
        "Supply project_id OR",
      );
    }
    assertEquals(calls, 0);
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("requirements do not present unresolved discovery as an empty collection", async () => {
  for (
    const options of [{ voidDiscovery: true }, { missingSearch: true }, {
      missingRoot: true,
    }]
  ) {
    const restore = provider(options);
    try {
      await assertRejects(async () =>
        await requirementsTools[0].handler(
          options.missingSearch
            ? { project_id: "project" }
            : { editing_context_id: "ec", root_id: "root" },
        )
      );
    } finally {
      restore();
    }
  }
});

Deno.test("requirements preserve unavailable prose without substituting the label", async () => {
  const restore = provider({ unavailableText: true });
  try {
    const data = await requirementsTools[0].handler({
      editing_context_id: "ec",
      root_id: "root",
    }) as RequirementsViewData;
    assertEquals(data.requirements[0].textStatus, "unavailable");
    assertEquals(data.requirements[0].text, undefined);
  } finally {
    restore();
  }
});

Deno.test("requirements expose only a complete single numeric authored comparison as a limit", async () => {
  const extract = constraintTools.find((tool) =>
    tool.name === "syson_constraint_extract"
  )!;
  const original = extract.handler;
  const constraint: AuthoredConstraints["constraints"][number] = {
    id: "constraint",
    name: "Mass limit",
    expression: {
      kind: "binary",
      op: "<=",
      left: { kind: "ref", featurePath: ["mass"] },
      right: { kind: "literal", value: 5, unit: "kg" },
    },
  };
  const cases: AuthoredConstraints[] = [
    { constraints: [constraint] },
    {
      constraints: [constraint],
      errors: [{
        id: "bad",
        name: "Unreadable",
        error: "No body expression found",
      }],
    },
    { constraints: [constraint, { ...constraint, id: "second" }] },
    { constraints: [] },
  ];
  const restore = provider();
  try {
    for (const [index, result] of cases.entries()) {
      extract.handler = () => Promise.resolve(result);
      const data = await requirementsTools[0].handler({
        editing_context_id: "ec",
        root_id: "root",
      }) as RequirementsViewData;
      const row = data.requirements[0];
      assertEquals(row.authoredConstraints, result);
      assertEquals(
        row.authoredConstraintsStatus,
        index === 1 ? "unavailable" : "available",
      );
      assertEquals(
        row.limit,
        index === 0 ? { value: 5, unit: "kg" } : undefined,
      );
      assertEquals(row.metric, index === 0 ? "mass" : undefined);
      assertEquals(row.operator, index === 0 ? "<=" : undefined);
      assertEquals(row.coverageStatus, "unknown");
      if (index === 1) {
        assertEquals(
          row.authoredConstraintsError,
          "Unreadable: No body expression found",
        );
      }
    }
  } finally {
    extract.handler = original;
    restore();
  }
});
