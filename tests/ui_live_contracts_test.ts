import { Ajv } from "ajv";
import { SysonToolsClient } from "../src/client.ts";
import { assertEquals } from "@std/assert";
import trace from "./fixtures/live-audit/syson_query_requirements_trace.json" with {
  type: "json",
};
import requirements from "./fixtures/live-audit/syson_requirements_list.json" with {
  type: "json",
};
import validation from "./fixtures/live-audit/syson_constraint_validate.json" with {
  type: "json",
};
import {
  isRequirementsTrace,
  isRequirementsViewData,
  isValidationReport,
  isViewerMetadata,
} from "../src/ui/shared/recorded-content.ts";
import { validationDiagnostics } from "../src/viewer-data.ts";

Deno.test("fresh live trace accepts all 7 rows and actual row-level authored extraction/errors", () => {
  assertEquals(isRequirementsTrace(trace.structuredContent), true);
  assertEquals(trace.structuredContent.traces.length, 7);
  const malformed = structuredClone(trace.structuredContent) as Record<
    string,
    unknown
  >;
  const rows = malformed.traces as Array<Record<string, unknown>>;
  rows[0].authoredConstraints = {
    constraints: [{
      id: "x",
      name: "x",
      expression: { kind: "literal", value: "invented" },
    }],
  };
  assertEquals(isRequirementsTrace(malformed), false);
});
Deno.test("trace verifies only explicit identity lists; unknown verification cannot claim verifiedBy", () => {
  const data = structuredClone(trace.structuredContent) as Record<
    string,
    unknown
  >;
  const row = (data.traces as Array<Record<string, unknown>>)[0];
  row.verificationStatus = "available";
  row.verifiedBy = [{
    id: "test",
    kind: "VerificationCaseUsage",
    label: "Test",
  }];
  assertEquals(isRequirementsTrace(data), true);
  row.verifiedBy = [{ id: "test", label: "no kind" }];
  assertEquals(isRequirementsTrace(data), false);
  row.verificationStatus = "unknown";
  row.verifiedBy = [];
  assertEquals(isRequirementsTrace(data), false);
});
Deno.test("fresh live validation preserves 12 constraints and projects exactly 10 source error diagnostics", () => {
  const data = validation.structuredContent;
  assertEquals(isValidationReport(data), true);
  const diagnostics = validationDiagnostics(
    data
      .constraints as unknown as import("../src/viewer-data.ts").ValidationConstraint[],
    data.elementId,
    data.elementName,
  );
  assertEquals(data.constraints.length, 12);
  assertEquals(diagnostics.length, 10);
  assertEquals(
    data.constraints.filter((row) => row.status === "unresolved").length,
    2,
  );
  assertEquals(
    diagnostics.every((row) =>
      row.severity === "error" && row.message === "No body expression found"
    ),
    true,
  );
  assertEquals(isValidationReport({ ...data, diagnostics }), true);
  assertEquals(
    isValidationReport({
      ...data,
      diagnostics: [...diagnostics, { ...diagnostics[0], severity: "warning" }],
    }),
    false,
  );
  assertEquals(
    isValidationReport({ ...data, diagnostics: diagnostics.slice(1) }),
    false,
  );
});
Deno.test("viewer metadata never conflates project with semantic root or editing context", () => {
  assertEquals(
    isViewerMetadata({
      editingContextId: "ec",
      scope: { kind: "project", projectId: "p", editingContextId: "ec" },
    }),
    true,
  );
  assertEquals(
    isViewerMetadata({
      editingContextId: "ec",
      scope: { kind: "project", rootId: "p", editingContextId: "ec" },
    }),
    false,
  );
  assertEquals(
    isViewerMetadata({
      editingContextId: "ec",
      scope: { kind: "element", rootId: "r", editingContextId: "other" },
    }),
    false,
  );
});

Deno.test("validation diagnostics accept reordered object keys and reject malformed or misattributed facts", () => {
  const data = validation.structuredContent;
  const diagnostics = validationDiagnostics(
    data
      .constraints as unknown as import("../src/viewer-data.ts").ValidationConstraint[],
    data.elementId,
    data.elementName,
  );
  const reordered = diagnostics.map((diagnostic) => ({
    attribution: diagnostic.attribution,
    element: { label: diagnostic.element.label, id: diagnostic.element.id },
    constraint: {
      label: diagnostic.constraint.label,
      id: diagnostic.constraint.id,
    },
    source: diagnostic.source,
    message: diagnostic.message,
    severity: diagnostic.severity,
    id: diagnostic.id,
  }));
  assertEquals(isValidationReport({ ...data, diagnostics: reordered }), true);
  for (
    const malformed of [
      null,
      {},
      [null, ...diagnostics.slice(1)],
      [{ ...diagnostics[0], extra: "invented" }, ...diagnostics.slice(1)],
      [
        {
          ...diagnostics[0],
          element: { id: "other", label: data.elementName },
        },
        ...diagnostics.slice(1),
      ],
      [{
        ...diagnostics[0],
        constraint: { ...diagnostics[0].constraint, extra: true },
      }, ...diagnostics.slice(1)],
      [{ ...diagnostics[0], message: "invented" }, ...diagnostics.slice(1)],
    ]
  ) {
    assertEquals(
      isValidationReport({ ...data, diagnostics: malformed }),
      false,
    );
  }
});

Deno.test("trace preserves partial authored extraction alongside explicit errors", () => {
  const data = structuredClone(trace.structuredContent) as Record<
    string,
    unknown
  >;
  const row = (data.traces as Array<Record<string, unknown>>)[0];
  row.authoredConstraintsStatus = "unavailable";
  row.authoredConstraintsError = "No body expression found";
  row.authoredConstraints = {
    constraints: [{
      id: "parsed",
      name: "Parsed",
      expression: { kind: "literal", value: 1 },
    }],
    errors: [{
      id: "unsupported",
      name: "Unsupported",
      error: "No body expression found",
    }],
  };
  assertEquals(isRequirementsTrace(data), true);
  row.authoredConstraintsStatus = "not-requested";
  assertEquals(isRequirementsTrace(data), false);
});

Deno.test("live trace and validation fixtures satisfy the advertised server output schemas", () => {
  const client = new SysonToolsClient();
  for (
    const [name, result] of [
      ["syson_query_requirements_trace", trace],
      ["syson_constraint_validate", validation],
      ["syson_requirements_list", requirements],
    ] as const
  ) {
    const schema = client.listTools().find((tool) => tool.name === name)!
      .outputSchema!;
    const validate = new Ajv({ strict: false }).compile(schema);
    assertEquals(
      validate(result.structuredContent),
      true,
      JSON.stringify(validate.errors),
    );
  }
});

Deno.test("live authored requirements preserve the audit package data without invented limits", () => {
  const data = requirements.structuredContent;
  assertEquals(isRequirementsViewData(data), true);
  assertEquals(data.count, 7);
  assertEquals(data.scope.rootId, "738907af-25b2-4240-83f9-ce0a58a41ac7");
  assertEquals(
    data.requirements.some((row) =>
      row.textStatus === "available" && row.text?.includes("rocket booster")
    ),
    true,
  );
  assertEquals(
    data.requirements.every((row) => row.coverageStatus === "unknown"),
    true,
  );
  assertEquals(
    data.requirements.some((row) =>
      row.authoredConstraintsStatus === "unavailable" &&
      row.authoredConstraints.errors?.length
    ),
    true,
  );
});
