/**
 * Tests for SysON element tools
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  setSysonClient,
  SysonGraphQLClient,
} from "../../src/api/graphql-client.ts";
import { elementTools } from "../../src/tools/element.ts";

function getHandler(name: string) {
  const tool = elementTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler;
}

function mockFetch(responses: Record<string, unknown>[]) {
  let callIndex = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = () => {
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

Deno.test("syson_element_get - returns element", async () => {
  const restore = mockFetch([{
    viewer: {
      editingContext: {
        object: {
          id: "e1",
          kind: "sysml::PartUsage",
          label: "Propulsion",
          iconURLs: [],
        },
      },
    },
  }]);

  try {
    const result = await getHandler("syson_element_get")({
      editing_context_id: "ec-1",
      element_id: "e1",
    }) as Record<string, unknown>;
    assertEquals(result.id, "e1");
    assertEquals(result.kind, "sysml::PartUsage");
    assertEquals(result.label, "Propulsion");
  } finally {
    restore();
  }
});

Deno.test("syson_element_children - returns children via AQL", async () => {
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: {
        __typename: "ObjectsExpressionResult",
        objsValue: [
          { id: "c1", kind: "sysml::PartUsage", label: "Engine", iconURLs: [] },
          { id: "c2", kind: "sysml::PartUsage", label: "Frame", iconURLs: [] },
        ],
      },
    },
  }]);

  try {
    const result = await getHandler("syson_element_children")({
      editing_context_id: "ec-1",
      element_id: "e1",
    }) as Record<string, unknown>;
    const children = result.children as Array<Record<string, unknown>>;
    assertEquals(result.editingContextId, "ec-1");
    assertEquals(result.parentId, "e1");
    assertEquals(children.length, 2);
    assertEquals(children[0].label, "Engine");
    assertEquals(children[1].label, "Frame");
  } finally {
    restore();
  }
});

Deno.test("syson_element_create - resolves child type by label", async () => {
  const restore = mockFetch([
    // 1. getChildCreationDescriptions
    {
      viewer: {
        editingContext: {
          childCreationDescriptions: [
            { id: "desc-part", label: "New PartUsage", iconURL: null },
            { id: "desc-req", label: "New RequirementUsage", iconURL: null },
          ],
        },
      },
    },
    // 2. createChild
    {
      createChild: {
        __typename: "CreateChildSuccessPayload",
        id: "m1",
        object: { id: "new-1", kind: "sysml::PartUsage", label: "PartUsage1" },
      },
    },
  ]);

  try {
    const result = await getHandler("syson_element_create")({
      editing_context_id: "ec-1",
      parent_id: "root-1",
      child_type: "New PartUsage",
    }) as Record<string, unknown>;
    assertEquals(result.id, "new-1");
    assertEquals(result.kind, "sysml::PartUsage");
  } finally {
    restore();
  }
});

Deno.test("syson_element_create - throws on unknown child type", async () => {
  const restore = mockFetch([{
    viewer: {
      editingContext: {
        childCreationDescriptions: [
          { id: "desc-part", label: "New PartUsage", iconURL: null },
        ],
      },
    },
  }]);

  try {
    await assertRejects(
      async () =>
        await getHandler("syson_element_create")({
          editing_context_id: "ec-1",
          parent_id: "root-1",
          child_type: "NonExistent",
        }),
      Error,
      "No exact child type matching 'NonExistent'",
    );
  } finally {
    restore();
  }
});

Deno.test(
  "syson_element_create - refuses an ambiguous child label before creating",
  async () => {
    const restore = mockFetch([{
      viewer: {
        editingContext: {
          childCreationDescriptions: [
            { id: "desc-a", label: "New PartUsage", iconURL: null },
            { id: "desc-b", label: "New PartUsage", iconURL: null },
          ],
        },
      },
    }]);

    try {
      let caught: { code?: string } | undefined;
      try {
        await getHandler("syson_element_create")({
          editing_context_id: "ec-1",
          parent_id: "root-1",
          child_type: "New PartUsage",
        });
      } catch (error) {
        caught = error as { code?: string };
      }

      assertEquals(caught?.code, "SYSON_ELEMENT_CREATE_CHILD_TYPE_AMBIGUOUS");
    } finally {
      restore();
    }
  },
);

Deno.test("syson_element_rename - returns success", async () => {
  // Rename goes through AQL eSet on declaredName, not renameTreeItem —
  // the latter needs a representationId the tools do not have.
  const restore = mockFetch([{
    evaluateExpression: {
      __typename: "EvaluateExpressionSuccessPayload",
      result: { __typename: "VoidExpressionResult" },
    },
  }]);

  try {
    const result = await getHandler("syson_element_rename")({
      editing_context_id: "ec-1",
      element_id: "e1",
      new_name: "Propulsion Module",
    }) as Record<string, unknown>;
    assertEquals(result.newName, "Propulsion Module");
  } finally {
    restore();
  }
});

// syson_element_delete invariant tests live in element_delete_test.ts —
// the REST-based implementation has its own mock machinery (sequence + throw slots).

Deno.test("syson_element_insert_sysml - returns exact mutation evidence", async () => {
  const restore = mockFetch([{
    insertTextualSysMLv2: { __typename: "SuccessPayload", id: "m1" },
  }]);

  try {
    const result = await getHandler("syson_element_insert_sysml")({
      editing_context_id: "ec-1",
      parent_id: "part-1",
      sysml_text: "attribute mass : Real = 2.86;",
    });
    assertEquals(result, {
      inserted: true,
      parentId: "part-1",
      text: "attribute mass : Real = 2.86;",
      acknowledged: true,
      semanticCompleteness: "unverified",
    });
  } finally {
    restore();
  }
});

Deno.test(
  "syson_element_insert_sysml - rejects unexpected payload typename instead of acknowledging",
  async () => {
    const restore = mockFetch([{
      insertTextualSysMLv2: { __typename: "UnexpectedPayload", id: "m1" },
    }]);

    try {
      await assertRejects(
        async () =>
          await getHandler("syson_element_insert_sysml")({
            editing_context_id: "ec-1",
            parent_id: "part-1",
            sysml_text: "part heater;",
          }),
        Error,
        "expected SuccessPayload, got UnexpectedPayload",
      );
    } finally {
      restore();
    }
  },
);

Deno.test("elementTools - has correct tool count and categories", () => {
  assertEquals(elementTools.length, 6);
  for (const tool of elementTools) {
    assertEquals(tool.category, "element");
    assertEquals(tool.name.startsWith("syson_element_"), true);
  }
});
