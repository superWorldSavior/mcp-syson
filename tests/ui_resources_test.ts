import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { MCP_APP_MIME_TYPE } from "@mcpview/server";
import { registerUiResources } from "../server.ts";
import { loadUiHtml, UI_RESOURCE_URIS, UI_RESOURCES } from "../src/ui/mod.ts";

const EXPECTED_RESOURCE_URIS = [
  "ui://mcp-syson/diagram-viewer",
  "ui://mcp-syson/model-explorer-viewer",
  "ui://mcp-syson/query-results-viewer",
  "ui://mcp-syson/requirements-trace-viewer",
  "ui://mcp-syson/requirements-viewer",
  "ui://mcp-syson/validation-viewer",
  "ui://mcp-syson/value-change-viewer",
];

Deno.test("ships all SysON viewer bundles as readable UI resources", async () => {
  assertEquals([...UI_RESOURCE_URIS].sort(), EXPECTED_RESOURCE_URIS);
  assertEquals(Object.keys(UI_RESOURCES).sort(), EXPECTED_RESOURCE_URIS);

  for (const uri of EXPECTED_RESOURCE_URIS) {
    const html = await loadUiHtml(uri);
    assertMatch(html, /<html/i);
    assertMatch(html, /<div id="app"><\/div>/i);
  }

  assertEquals(
    UI_RESOURCES["ui://mcp-syson/model-explorer-viewer"].tools,
    ["syson_element_children"],
  );
});

Deno.test("does not resolve unknown UI resources", async () => {
  await assertRejects(
    () => loadUiHtml("ui://mcp-syson/not-a-viewer"),
    Error,
    "UI resource not found",
  );
});

Deno.test("registers every bundled viewer, including model explorer", async () => {
  const registrations: Array<{
    uri: string;
    mimeType: string;
    read: () => Promise<{ uri: string; mimeType: string; text: string }>;
  }> = [];

  const fakeServer = {
    registerResource(
      resource: { uri: string; mimeType: string },
      read: () => Promise<{ uri: string; mimeType: string; text: string }>,
    ) {
      registrations.push({
        uri: resource.uri,
        mimeType: resource.mimeType,
        read,
      });
    },
  };

  const registeredUris = registerUiResources(fakeServer as never);
  assertEquals([...registeredUris].sort(), EXPECTED_RESOURCE_URIS);
  assertEquals(
    registrations.map(({ uri }) => uri).sort(),
    EXPECTED_RESOURCE_URIS,
  );

  for (const registration of registrations) {
    assertEquals(registration.mimeType, MCP_APP_MIME_TYPE);
    const resource = await registration.read();
    assertEquals(resource.uri, registration.uri);
    assertEquals(resource.mimeType, MCP_APP_MIME_TYPE);
    assertMatch(resource.text, /<html/i);
  }
});
