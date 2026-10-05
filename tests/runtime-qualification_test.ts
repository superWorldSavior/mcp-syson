import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { SysonToolsClient } from "../src/client.ts";
import {
  assertBoundedToolContracts,
  fingerprint,
  type McpClient,
  parseContainerPlatform,
  parseQualificationOptions,
  type QualificationOptions,
  type QualificationRuntime,
  qualifyRuntime,
  verifySysonGraphqlReadiness,
} from "../src/runtime-qualification.ts";

const MCP_DIGEST = `sha256:${"a".repeat(64)}`;
const SYSON_DIGEST = `sha256:${"b".repeat(64)}`;
const DATABASE_DIGEST = `sha256:${"c".repeat(64)}`;
const REVISION = "d".repeat(40);

function options(expectedSource?: string): QualificationOptions {
  return parseQualificationOptions([
    "--http-url",
    "http://127.0.0.1:3009/mcp",
    "--syson-url",
    "http://127.0.0.1:8180",
    "--mcp-container",
    "qualification-mcp-syson-1",
    "--syson-container",
    "qualification-syson-1",
    "--database-container",
    "qualification-database-1",
    "--mcp-image",
    `ghcr.io/casys-ai/mcp-syson@${MCP_DIGEST}`,
    "--mcp-image-digest",
    MCP_DIGEST,
    "--syson-image",
    `eclipsesyson/syson@${SYSON_DIGEST}`,
    "--syson-image-digest",
    SYSON_DIGEST,
    "--database-image",
    `postgres@${DATABASE_DIGEST}`,
    "--database-image-digest",
    DATABASE_DIGEST,
    "--version",
    "0.8.4",
    "--revision",
    REVISION,
    "--runtime-contract",
    "/tmp/release-runtime-contract.json",
    ...(expectedSource === undefined
      ? []
      : ["--expected-source", expectedSource]),
  ]);
}

Deno.test("runtime qualification accepts only matching immutable image coordinates", () => {
  assertEquals(options().mcpImageDigest, MCP_DIGEST);
  assertThrows(
    () =>
      parseQualificationOptions([
        "--http-url",
        "http://127.0.0.1:3009/mcp",
        "--syson-url",
        "http://127.0.0.1:8180",
        "--mcp-container",
        "qualification-mcp-syson-1",
        "--syson-container",
        "qualification-syson-1",
        "--database-container",
        "qualification-database-1",
        "--mcp-image",
        "ghcr.io/casys-ai/mcp-syson:0.8.4",
        "--mcp-image-digest",
        MCP_DIGEST,
        "--syson-image",
        `eclipsesyson/syson@${SYSON_DIGEST}`,
        "--syson-image-digest",
        SYSON_DIGEST,
        "--database-image",
        `postgres@${DATABASE_DIGEST}`,
        "--database-image-digest",
        DATABASE_DIGEST,
        "--version",
        "0.8.4",
        "--revision",
        REVISION,
        "--runtime-contract",
        "/tmp/release-runtime-contract.json",
      ]),
    Error,
    "immutable",
  );
});

Deno.test("runtime qualification pins the bounded MCP route schema", () => {
  const contracts = new SysonToolsClient().toMCPFormat();
  const bounded = assertBoundedToolContracts(contracts);
  assertEquals(
    bounded.map((tool) => tool.name),
    [
      "syson_project_templates",
      "syson_project_create",
      "syson_project_get",
      "syson_model_create",
      "syson_model_stereotypes",
      "syson_model_child_types",
      "syson_element_create",
      "syson_element_get",
      "syson_element_children",
    ],
  );
  const childTypes = bounded.find((tool) =>
    tool.name === "syson_model_child_types"
  );
  assertEquals(
    (childTypes?.outputSchema as Record<string, unknown>).properties,
    {
      childTypes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            iconURL: { type: ["array", "null"], items: { type: "string" } },
          },
          required: ["id", "label", "iconURL"],
        },
      },
    },
  );

  const drifted = contracts.map((tool) =>
    tool.name === "syson_project_get"
      ? {
        ...tool,
        inputSchema: {
          ...tool.inputSchema,
          additionalProperties: true,
        },
      }
      : tool
  );
  assertThrows(
    () => assertBoundedToolContracts(drifted),
    Error,
    "reject undeclared",
  );
});

Deno.test("runtime qualification records a real route-shaped readback", async () => {
  const client = new FixtureMcpClient();
  const result = await qualifyRuntime(
    client,
    options(),
    runtime(),
    await releasedTransportContract(),
  );

  assertEquals(result.schemaVersion, "mcp-syson-runtime-qualification/1.0");
  assertEquals(
    (result.runtime as Record<string, unknown>).mcpSyson,
    {
      image: `ghcr.io/casys-ai/mcp-syson@${MCP_DIGEST}`,
      digest: MCP_DIGEST,
      sourceRevision: REVISION,
      packageVersion: "0.8.4",
      labels: {
        source: "https://github.com/Casys-AI/mcp-syson",
        revision: REVISION,
        version: "0.8.4",
      },
      observedPlatform: "linux/amd64",
    },
  );
  assertEquals(
    (result.boundedPath as Record<string, unknown>).projectTemplate,
    {
      id: "sysmlv2-template",
      label: "SysMLv2",
    },
  );
  assertEquals((result.boundedPath as Record<string, unknown>).stereotype, {
    id: "empty_sysmlv2",
    label: "SysMLv2",
  });
  assertEquals(
    client.calls.find((call) => call.name === "syson_project_create")?.args
      .template_id,
    "sysmlv2-template",
  );
  const modelCall = client.calls.find((call) =>
    call.name === "syson_model_create"
  );
  assertEquals(modelCall?.args.editing_context_id, "context-1");
  assertEquals(modelCall?.args.stereotype_id, "empty_sysmlv2");
  assertEquals(modelCall?.args.create_root_package, true);
  assertEquals(
    Object.keys(result.contractFingerprints as Record<string, unknown>).sort(),
    [
      "allToolContracts",
      "boundedPathToolContracts",
      "boundedReadback",
      "releasedTransportContract",
      "releasedTransports",
      "serverDiscover",
    ],
  );
});

Deno.test("runtime qualification fails closed when the element readback drifts", async () => {
  const transportContract = await releasedTransportContract();
  await assertRejects(
    () =>
      qualifyRuntime(
        new FixtureMcpClient({ elementReadLabel: "Drifted" }),
        options(),
        runtime(),
        transportContract,
      ),
    Error,
    "created element readback label",
  );
});

Deno.test("runtime qualification fails closed when the released transport binding drifts", async () => {
  const contract = await releasedTransportContract();
  contract.imageDigest = `sha256:${"0".repeat(64)}`;
  await assertRejects(
    () =>
      qualifyRuntime(new FixtureMcpClient(), options(), runtime(), contract),
    Error,
    "released transport contract imageDigest",
  );
});

Deno.test("runtime qualification refuses a non-amd64 observed image", async () => {
  const observedRuntime = runtime();
  observedRuntime.platforms.database = "linux/arm64";
  await assertRejects(
    async () =>
      qualifyRuntime(
        new FixtureMcpClient(),
        options(),
        observedRuntime,
        await releasedTransportContract(),
      ),
    Error,
    "database observed OCI platform",
  );
});

Deno.test("runtime qualification observes the running Linux amd64 container", () => {
  assertEquals(
    parseContainerPlatform("Linux x86_64\n", "qualification container uname"),
    "linux/amd64",
  );
  assertThrows(
    () =>
      parseContainerPlatform(
        "Linux aarch64\n",
        "qualification container uname",
      ),
    Error,
    "Linux x86_64",
  );
});

Deno.test("runtime qualification rejects GraphQL errors even when data is present", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: { viewer: { allProjectTemplates: [] } },
          errors: [{ message: "provider drift" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  try {
    await assertRejects(
      () => verifySysonGraphqlReadiness("http://qualification.invalid"),
      Error,
      "returned errors",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("personal qualification requires its explicitly selected OCI source", async () => {
  const personalSource = "https://github.com/superWorldSavior/mcp-syson";
  const selected = options(personalSource);
  selected.mcpImage = `ghcr.io/superworldsavior/mcp-syson@${MCP_DIGEST}`;
  const observed = runtime();
  observed.mcpLabels.source = personalSource;
  const contract = await releasedTransportContract();
  contract.image = selected.mcpImage;
  const result = await qualifyRuntime(
    new FixtureMcpClient(),
    selected,
    observed,
    contract,
  );
  assertEquals(selected.expectedSource, personalSource);
  assertEquals(
    (result.runtime as { mcpSyson: { labels: { source: string } } }).mcpSyson
      .labels.source,
    personalSource,
  );
  await assertRejects(
    () => qualifyRuntime(new FixtureMcpClient(), selected, runtime(), contract),
    Error,
    "mcp-syson OCI source label drifted",
  );
});

Deno.test("qualification preserves strict historical source and rejects unrelated coordinates", async () => {
  const observed = runtime();
  observed.mcpLabels.source = "https://github.com/superWorldSavior/mcp-syson";
  const contract = await releasedTransportContract();
  await assertRejects(
    () => qualifyRuntime(new FixtureMcpClient(), options(), observed, contract),
    Error,
    "mcp-syson OCI source label drifted",
  );
  assertThrows(
    () => options("https://github.com/another-owner/mcp-syson"),
    Error,
    "--expected-source",
  );
});

function runtime(): QualificationRuntime {
  return {
    mcpLabels: {
      source: "https://github.com/Casys-AI/mcp-syson",
      revision: REVISION,
      version: "0.8.4",
    },
    platforms: {
      mcpSyson: "linux/amd64",
      syson: "linux/amd64",
      database: "linux/amd64",
    },
    sysonGraphqlReadiness: {
      query: "viewer.allProjectTemplates",
      responseFingerprint: `sha256:${"e".repeat(64)}`,
    },
  };
}

async function releasedTransportContract(): Promise<Record<string, unknown>> {
  const discovered = { serverInfo: { name: "mcp-syson", version: "0.8.4" } };
  const tools = new SysonToolsClient().toMCPFormat();
  const toolContractsFingerprint = await fingerprint(tools);
  return {
    schemaVersion: "mcp-syson-runtime-contract/1.0",
    packageVersion: "0.8.4",
    sourceRevision: REVISION,
    image: `ghcr.io/casys-ai/mcp-syson@${MCP_DIGEST}`,
    imageDigest: MCP_DIGEST,
    transports: {
      http: {
        serverDiscoverFingerprint: await fingerprint(discovered),
        toolContractsFingerprint,
        uiResourcesFingerprint: `sha256:${"e".repeat(64)}`,
      },
      stdio: {
        serverDiscoverFingerprint: `sha256:${"f".repeat(64)}`,
        toolContractsFingerprint,
        uiResourcesFingerprint: `sha256:${"e".repeat(64)}`,
      },
    },
  };
}

class FixtureMcpClient implements McpClient {
  #projectName = "";
  #rootPackageName = "";
  #elementName = "";
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly drift: { elementReadLabel?: string } = {}) {}

  request(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return Promise.resolve(this.requestSync(method, params));
  }

  private requestSync(
    method: string,
    params: Record<string, unknown> = {},
  ): Record<string, unknown> {
    if (method === "server/discover") {
      return { serverInfo: { name: "mcp-syson", version: "0.8.4" } };
    }
    if (method === "tools/list") {
      return { tools: new SysonToolsClient().toMCPFormat() };
    }
    if (method !== "tools/call" || typeof params.name !== "string") {
      throw new Error(`Unexpected request ${method}`);
    }
    const args = params.arguments as Record<string, unknown>;
    this.calls.push({ name: params.name, args });
    return { structuredContent: this.call(params.name, args) };
  }

  private call(
    name: string,
    args: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (name) {
      case "syson_project_templates":
        return {
          templates: [{ id: "sysmlv2-template", label: "SysMLv2" }],
        };
      case "syson_project_create":
        this.#projectName = String(args.name);
        return {
          id: "project-1",
          name: this.#projectName,
          editingContextId: "context-1",
        };
      case "syson_project_get":
        return {
          id: "project-1",
          name: this.#projectName,
          natures: ["sysml"],
          editingContextId: "context-1",
        };
      case "syson_model_create":
        this.#rootPackageName = String(args.root_package_name);
        return {
          documentId: "document-1",
          documentName: `${String(args.name)}.sysml`,
          documentKind: "siriusWeb://document",
          rootPackageId: "root-1",
          rootPackageLabel: this.#rootPackageName,
        };
      case "syson_element_get":
        if (args.element_id === "root-1") {
          return {
            id: "root-1",
            kind: "siriusComponents://semantic?domain=sysml&entity=Package",
            label: this.#rootPackageName,
            iconURLs: [],
          };
        }
        return {
          id: "element-1",
          kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
          label: this.drift.elementReadLabel ?? this.#elementName,
          iconURLs: [],
        };
      case "syson_model_stereotypes":
        return {
          stereotypes: [{ id: "empty_sysmlv2", label: "SysMLv2" }],
        };
      case "syson_model_child_types":
        return {
          childTypes: [
            {
              id: "SysMLv2EditService-PartUsage",
              label: "Part",
              iconURL: ["/api/images/icons/full/obj16/PartUsage.svg"],
            },
          ],
        };
      case "syson_element_create":
        this.#elementName = String(args.name);
        return {
          id: "element-1",
          kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
          label: this.#elementName,
        };
      case "syson_element_children":
        return {
          parentId: "root-1",
          children: [{
            id: "element-1",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
            label: this.#elementName,
          }],
          count: 1,
        };
      default:
        throw new Error(`Unexpected tool ${name}`);
    }
  }
}
