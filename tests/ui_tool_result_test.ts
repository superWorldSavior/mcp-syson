import { assertEquals } from "@std/assert";
import { toolResultIssue } from "../src/ui/shared/tool-result.ts";

Deno.test("provider refusal remains an error even when its data could pass a view guard", () => {
  assertEquals(
    toolResultIssue({
      isError: true,
      structuredContent: {
        code: "SYSON_OPERATION_FAILED",
        message: "No numeric literal found",
      },
    }, true),
    {
      kind: "provider",
      code: "SYSON_OPERATION_FAILED",
      message: "No numeric literal found",
    },
  );
});

Deno.test("structured and textual provider errors retain useful details", () => {
  assertEquals(
    toolResultIssue({
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: { code: "UNAVAILABLE", message: "Model is unavailable" },
          }),
        },
      ],
    }, false),
    { kind: "provider", code: "UNAVAILABLE", message: "Model is unavailable" },
  );
  assertEquals(
    toolResultIssue({
      isError: true,
      content: [{ type: "text", text: "Connection refused" }],
    }, false),
    {
      kind: "provider",
      code: "provider-operation-failed",
      message: "Connection refused",
    },
  );
});

Deno.test("payload rejected by a view is distinguished from no result", () => {
  assertEquals(
    toolResultIssue({ structuredContent: { count: 26, results: [] } }, false),
    {
      kind: "invalid",
      code: "invalid-view-data",
    },
  );
  assertEquals(toolResultIssue({ content: [] }, false), undefined);
  assertEquals(
    toolResultIssue({ structuredContent: { count: 0, results: [] } }, true),
    undefined,
  );
});
