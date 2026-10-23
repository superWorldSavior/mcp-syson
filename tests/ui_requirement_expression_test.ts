import { assertEquals } from "@std/assert";
import { requirementExpressionText } from "../src/ui/requirements-trace-viewer/src/requirement-expression.ts";

Deno.test("authored expressions retain unknown feature references, thresholds and units", () => {
  assertEquals(
    requirementExpressionText({
      kind: "binary",
      op: "<=",
      left: { kind: "ref", featurePath: ["backrest", "maxDisplacement"] },
      right: { kind: "literal", value: 1, unit: "mm" },
    }),
    "(backrest.maxDisplacement <= 1 mm)",
  );
  assertEquals(
    requirementExpressionText({
      kind: "unary",
      op: "not",
      operand: {
        kind: "call",
        name: "known",
        args: [{ kind: "ref", featurePath: ["maxVonMises"] }],
      },
    }),
    "not (known(maxVonMises))",
  );
});
