/**
 * Bounded compatibility qualification for a released mcp-syson OCI image
 * against the reviewed SysON runtime. This is provider compatibility evidence
 * only: it does not create a Digital Thread seal, MRTR approval, or an
 * architecture verdict.
 */

const PROTOCOL_VERSION = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const OCI_DIGEST = /^sha256:[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{40}$/;
const SYSML_TEMPLATE = { id: "sysmlv2-template", label: "SysMLv2" };
const SYSML_STEREOTYPE = { id: "empty_sysmlv2", label: "SysMLv2" };
const ROOT_PACKAGE_KIND =
  "siriusComponents://semantic?domain=sysml&entity=Package";
const PART_USAGE_KIND =
  "siriusComponents://semantic?domain=sysml&entity=PartUsage";
const PART_USAGE_DESCRIPTION = {
  id: "SysMLv2EditService-PartUsage",
  label: "Part",
};

type JsonRecord = Record<string, unknown>;

export interface QualificationOptions {
  httpUrl: string;
  sysonUrl: string;
  mcpContainer: string;
  sysonContainer: string;
  databaseContainer: string;
  mcpImage: string;
  mcpImageDigest: string;
  sysonImage: string;
  sysonImageDigest: string;
  databaseImage: string;
  databaseImageDigest: string;
  packageVersion: string;
  sourceRevision: string;
  expectedSource?: string;
  runtimeContract: string;
  output?: string;
}

export interface McpClient {
  request(method: string, params?: JsonRecord): Promise<JsonRecord>;
}

export interface RuntimeLabels {
  source: string;
  revision: string;
  version: string;
}

export interface QualificationRuntime {
  mcpLabels: RuntimeLabels;
  platforms: {
    mcpSyson: string;
    syson: string;
    database: string;
  };
  sysonGraphqlReadiness: JsonRecord;
}

interface ReviewedTransportContract {
  schemaVersion: string;
  http: JsonRecord;
  stdio: JsonRecord;
}

/** Minimal JSON-RPC client for the stateless MCP HTTP transport. */
export class HttpMcpClient implements McpClient {
  #id = 0;

  constructor(private readonly url: string) {}

  async request(method: string, params: JsonRecord = {}): Promise<JsonRecord> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": method,
        ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.#id,
        method,
        params: {
          ...params,
          _meta: {
            [PROTOCOL_VERSION_KEY]: PROTOCOL_VERSION,
            [CLIENT_CAPABILITIES_KEY]: {},
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(
        `MCP HTTP ${method} returned ${response.status}: ${await response
          .text()}`,
      );
    }
    const payload = await response.json() as {
      result?: unknown;
      error?: unknown;
    };
    if (!isRecord(payload.result)) {
      throw new Error(
        `MCP ${method} did not return a result: ${
          JSON.stringify(payload.error)
        }`,
      );
    }
    return payload.result;
  }
}

export function parseQualificationOptions(
  args: readonly string[],
): QualificationOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) {
      throw new Error(
        "Usage: --http-url URL --syson-url URL --mcp-container NAME --syson-container NAME --database-container NAME --mcp-image IMAGE@sha256:DIGEST --mcp-image-digest sha256:DIGEST --syson-image IMAGE@sha256:DIGEST --syson-image-digest sha256:DIGEST --database-image IMAGE@sha256:DIGEST --database-image-digest sha256:DIGEST --version VERSION --revision GIT_SHA --runtime-contract PATH [--output PATH]",
      );
    }
    values.set(key, value);
  }
  const required = (key: string) => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const known = new Set([
    "--http-url",
    "--syson-url",
    "--mcp-container",
    "--syson-container",
    "--database-container",
    "--mcp-image",
    "--mcp-image-digest",
    "--syson-image",
    "--syson-image-digest",
    "--database-image",
    "--database-image-digest",
    "--version",
    "--revision",
    "--expected-source",
    "--runtime-contract",
    "--output",
  ]);
  for (const key of values.keys()) {
    if (!known.has(key)) throw new Error(`Unknown argument ${key}`);
  }

  const options: QualificationOptions = {
    httpUrl: required("--http-url"),
    sysonUrl: required("--syson-url"),
    mcpContainer: required("--mcp-container"),
    sysonContainer: required("--syson-container"),
    databaseContainer: required("--database-container"),
    mcpImage: required("--mcp-image"),
    mcpImageDigest: required("--mcp-image-digest"),
    sysonImage: required("--syson-image"),
    sysonImageDigest: required("--syson-image-digest"),
    databaseImage: required("--database-image"),
    databaseImageDigest: required("--database-image-digest"),
    packageVersion: required("--version"),
    sourceRevision: required("--revision"),
    expectedSource: values.get("--expected-source"),
    runtimeContract: required("--runtime-contract"),
    output: values.get("--output"),
  };
  validateQualificationOptions(options);
  return options;
}

export function validateQualificationOptions(
  options: QualificationOptions,
): void {
  for (
    const [label, value] of [
      ["--mcp-container", options.mcpContainer],
      ["--syson-container", options.sysonContainer],
      ["--database-container", options.databaseContainer],
    ]
  ) {
    if (value.trim().length === 0) {
      throw new Error(`${label} must be non-empty`);
    }
  }
  for (
    const [label, image, digest] of [
      ["mcp-syson", options.mcpImage, options.mcpImageDigest],
      ["SysON", options.sysonImage, options.sysonImageDigest],
      ["PostgreSQL", options.databaseImage, options.databaseImageDigest],
    ] as const
  ) {
    if (!OCI_DIGEST.test(digest) || !image.endsWith(`@${digest}`)) {
      throw new Error(
        `${label} must be an immutable image@sha256 reference matching its supplied digest`,
      );
    }
  }
  if (!GIT_REVISION.test(options.sourceRevision)) {
    throw new Error("--revision must be a full lowercase 40-character Git SHA");
  }
  if (
    options.expectedSource !== undefined &&
    !/^https:\/\/github\.com\/(?:Casys-AI|superWorldSavior)\/mcp-syson$/.test(
      options.expectedSource,
    )
  ) {
    throw new Error(
      "--expected-source must name the historical or personal mcp-syson repository",
    );
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.packageVersion)) {
    throw new Error("--version must be a package semantic version");
  }
  for (
    const [label, value] of [
      ["--http-url", options.httpUrl],
      ["--syson-url", options.sysonUrl],
    ]
  ) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("not HTTP");
      }
    } catch {
      throw new Error(`${label} must be an HTTP(S) URL`);
    }
  }
}

/**
 * Assert the explicit, bounded contract needed for this qualification. The
 * script intentionally does not make an aggregate tool-count assertion: this
 * is a compatibility route, not a capability census.
 */
export function assertBoundedToolContracts(tools: unknown): JsonRecord[] {
  if (!Array.isArray(tools)) {
    throw new Error("tools/list did not return a tools array");
  }
  const byName = new Map<string, JsonRecord>();
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      throw new Error("tools/list contains a malformed tool descriptor");
    }
    if (byName.has(tool.name)) {
      throw new Error(`tools/list contains duplicate ${tool.name}`);
    }
    byName.set(tool.name, tool);
  }

  const expectations: Record<string, {
    inputProperties: string[];
    inputRequired: string[];
    outputProperties?: string[];
    outputRequired?: string[];
  }> = {
    syson_project_templates: {
      inputProperties: [],
      inputRequired: [],
      outputProperties: ["templates"],
      outputRequired: ["templates"],
    },
    syson_project_create: {
      inputProperties: ["name", "template_id"],
      inputRequired: ["name"],
      outputProperties: [
        "editingContextId",
        "editingContextWarning",
        "id",
        "name",
      ],
      outputRequired: ["editingContextId", "id", "name"],
    },
    syson_project_get: {
      inputProperties: ["project_id"],
      inputRequired: ["project_id"],
      outputProperties: ["editingContextId", "id", "name", "natures"],
      outputRequired: ["editingContextId", "id", "name", "natures"],
    },
    syson_model_create: {
      inputProperties: [
        "create_root_package",
        "editing_context_id",
        "name",
        "root_package_name",
        "stereotype_id",
      ],
      inputRequired: ["editing_context_id"],
      outputProperties: [
        "documentId",
        "documentKind",
        "documentName",
        "rootPackageId",
        "rootPackageLabel",
        "rootPackageRenameWarning",
      ],
      outputRequired: [
        "documentId",
        "documentKind",
        "documentName",
        "rootPackageId",
      ],
    },
    syson_model_stereotypes: {
      inputProperties: ["editing_context_id"],
      inputRequired: ["editing_context_id"],
      outputProperties: ["stereotypes"],
      outputRequired: ["stereotypes"],
    },
    syson_model_child_types: {
      inputProperties: ["container_id", "editing_context_id"],
      inputRequired: ["container_id", "editing_context_id"],
      outputProperties: ["childTypes"],
      outputRequired: ["childTypes"],
    },
    syson_element_create: {
      inputProperties: [
        "child_type",
        "editing_context_id",
        "name",
        "parent_id",
      ],
      inputRequired: ["child_type", "editing_context_id", "parent_id"],
      outputProperties: ["id", "kind", "label", "renameWarning"],
      outputRequired: ["id", "kind", "label"],
    },
    syson_element_get: {
      inputProperties: ["editing_context_id", "element_id"],
      inputRequired: ["editing_context_id", "element_id"],
    },
    syson_element_children: {
      inputProperties: ["editing_context_id", "element_id"],
      inputRequired: ["editing_context_id", "element_id"],
      outputProperties: ["children", "count", "parentId"],
      outputRequired: ["children", "count", "parentId"],
    },
  };

  const selected: JsonRecord[] = [];
  for (const [name, expected] of Object.entries(expectations)) {
    const tool = byName.get(name);
    if (!tool) throw new Error(`tools/list is missing required ${name}`);
    assertSchemaKeys(
      tool.inputSchema,
      expected.inputProperties,
      `${name} inputSchema`,
    );
    const input = asRecord(tool.inputSchema, `${name} inputSchema`);
    if (input.additionalProperties !== false) {
      throw new Error(
        `${name} inputSchema must reject undeclared top-level fields`,
      );
    }
    assertExactStringArray(
      input.required,
      expected.inputRequired,
      `${name} inputSchema.required`,
    );
    if (expected.outputProperties && expected.outputRequired) {
      const output = asRecord(tool.outputSchema, `${name} outputSchema`);
      assertSchemaKeys(
        output,
        expected.outputProperties,
        `${name} outputSchema`,
      );
      assertExactStringArray(
        output.required,
        expected.outputRequired,
        `${name} outputSchema.required`,
      );
    }
    selected.push(tool);
  }
  return selected;
}

export async function qualifyRuntime(
  client: McpClient,
  options: QualificationOptions,
  runtime: QualificationRuntime,
  transportContract: JsonRecord,
): Promise<JsonRecord> {
  validateQualificationOptions(options);
  assertMcpRuntimeLabels(runtime.mcpLabels, options);
  assertObservedPlatforms(runtime.platforms);
  const reviewedTransport = assertReviewedTransportContract(
    transportContract,
    options,
  );

  const discovered = await client.request("server/discover");
  const serverInfo = asRecord(
    discovered.serverInfo,
    "server/discover.serverInfo",
  );
  assertEqual(serverInfo.name, "mcp-syson", "server/discover server name");
  assertEqual(
    serverInfo.version,
    options.packageVersion,
    "server/discover package version",
  );

  const listed = await client.request("tools/list");
  const allToolContracts = listed.tools;
  const boundedToolContracts = assertBoundedToolContracts(allToolContracts);
  const serverDiscoverFingerprint = await fingerprint(discovered);
  const allToolContractsFingerprint = await fingerprint(allToolContracts);
  assertEqual(
    serverDiscoverFingerprint,
    reviewedTransport.http.serverDiscoverFingerprint,
    "qualification HTTP server-discover fingerprint",
  );
  assertEqual(
    allToolContractsFingerprint,
    reviewedTransport.http.toolContractsFingerprint,
    "qualification HTTP tool-contract fingerprint",
  );
  assertEqual(
    allToolContractsFingerprint,
    reviewedTransport.stdio.toolContractsFingerprint,
    "qualification stdio tool-contract fingerprint",
  );

  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const projectName = `RuntimeQualification-${suffix}`;
  const documentName = `RuntimeQualificationModel-${suffix}`;
  const rootPackageName = `RuntimeQualificationRoot-${suffix}`;
  const elementName = `RuntimeQualificationPart-${suffix}`;

  const projectTemplates = await callTool(
    client,
    "syson_project_templates",
    {},
  );
  assertExactKeys(
    projectTemplates,
    ["templates"],
    "syson_project_templates structuredContent",
  );
  const projectTemplate = exactlyOneCatalogEntry(
    projectTemplates.templates,
    SYSML_TEMPLATE,
    "SysML project template",
  );

  const projectCreated = await callTool(client, "syson_project_create", {
    name: projectName,
    template_id: projectTemplate.id,
  });
  assertExactKeys(
    projectCreated,
    ["editingContextId", "id", "name"],
    "syson_project_create structuredContent",
  );
  const projectId = requiredNonEmptyString(
    projectCreated.id,
    "created project id",
  );
  assertEqual(projectCreated.name, projectName, "created project name");

  const projectRead = await callTool(client, "syson_project_get", {
    project_id: projectId,
  });
  assertExactKeys(
    projectRead,
    ["editingContextId", "id", "name", "natures"],
    "syson_project_get structuredContent",
  );
  assertEqual(projectRead.id, projectId, "project readback id");
  assertEqual(projectRead.name, projectName, "project readback name");
  const editingContextId = requiredNonEmptyString(
    projectRead.editingContextId,
    "project readback editingContextId",
  );
  if (editingContextId === projectId) {
    throw new Error(
      "project readback editingContextId must not equal project id",
    );
  }
  assertEqual(
    projectCreated.editingContextId,
    editingContextId,
    "project create/readback editingContextId",
  );

  const stereotypes = await callTool(client, "syson_model_stereotypes", {
    editing_context_id: editingContextId,
  });
  assertExactKeys(
    stereotypes,
    ["stereotypes"],
    "syson_model_stereotypes structuredContent",
  );
  const stereotype = exactlyOneCatalogEntry(
    stereotypes.stereotypes,
    SYSML_STEREOTYPE,
    "SysML document stereotype",
  );

  const modelCreated = await callTool(client, "syson_model_create", {
    editing_context_id: editingContextId,
    name: documentName,
    stereotype_id: stereotype.id,
    create_root_package: true,
    root_package_name: rootPackageName,
  });
  assertExactKeys(
    modelCreated,
    [
      "documentId",
      "documentKind",
      "documentName",
      "rootPackageId",
      "rootPackageLabel",
    ],
    "syson_model_create structuredContent",
  );
  assertEqual(
    modelCreated.documentName,
    `${documentName}.sysml`,
    "created document name",
  );
  assertEqual(
    modelCreated.documentKind,
    "siriusWeb://document",
    "created document kind",
  );
  const rootPackageId = requiredNonEmptyString(
    modelCreated.rootPackageId,
    "created root package id",
  );
  assertEqual(
    modelCreated.rootPackageLabel,
    rootPackageName,
    "created root package label",
  );

  const rootRead = await callTool(client, "syson_element_get", {
    editing_context_id: editingContextId,
    element_id: rootPackageId,
  });
  assertExactKeys(
    rootRead,
    ["iconURLs", "id", "kind", "label"],
    "root package readback structuredContent",
  );
  assertEqual(rootRead.id, rootPackageId, "root package readback id");
  assertEqual(rootRead.kind, ROOT_PACKAGE_KIND, "root package readback kind");
  assertEqual(rootRead.label, rootPackageName, "root package readback label");

  const childTypes = await callTool(client, "syson_model_child_types", {
    editing_context_id: editingContextId,
    container_id: rootPackageId,
  });
  assertExactKeys(
    childTypes,
    ["childTypes"],
    "syson_model_child_types structuredContent",
  );
  const childType = exactlyOnePartUsage(childTypes.childTypes);

  const elementCreated = await callTool(client, "syson_element_create", {
    editing_context_id: editingContextId,
    parent_id: rootPackageId,
    child_type: childType.id,
    name: elementName,
  });
  assertExactKeys(
    elementCreated,
    ["id", "kind", "label"],
    "syson_element_create structuredContent",
  );
  const elementId = requiredNonEmptyString(
    elementCreated.id,
    "created element id",
  );
  assertEqual(elementCreated.kind, PART_USAGE_KIND, "created element kind");
  assertEqual(elementCreated.label, elementName, "created element label");

  const elementRead = await callTool(client, "syson_element_get", {
    editing_context_id: editingContextId,
    element_id: elementId,
  });
  assertExactKeys(
    elementRead,
    ["iconURLs", "id", "kind", "label"],
    "created element readback structuredContent",
  );
  assertEqual(elementRead.id, elementId, "created element readback id");
  assertEqual(
    elementRead.kind,
    elementCreated.kind,
    "created element readback kind",
  );
  assertEqual(elementRead.label, elementName, "created element readback label");

  const childrenRead = await callTool(client, "syson_element_children", {
    editing_context_id: editingContextId,
    element_id: rootPackageId,
  });
  assertExactKeys(
    childrenRead,
    ["children", "count", "parentId"],
    "root children readback structuredContent",
  );
  assertEqual(childrenRead.parentId, rootPackageId, "root children parent id");
  const matchingChildren = asArray(
    childrenRead.children,
    "root children readback",
  )
    .filter(isRecord)
    .filter((child) => child.id === elementId);
  if (matchingChildren.length !== 1) {
    throw new Error(
      `root children readback must contain exactly one created element; found ${matchingChildren.length}`,
    );
  }
  assertExactKeys(
    matchingChildren[0],
    ["id", "kind", "label"],
    "created child readback",
  );
  assertEqual(
    matchingChildren[0].kind,
    elementCreated.kind,
    "created child kind",
  );
  assertEqual(matchingChildren[0].label, elementName, "created child label");

  const boundedReadback = {
    catalogs: { projectTemplate, stereotype, childType },
    project: projectRead,
    rootPackage: rootRead,
    element: elementRead,
    rootChildren: matchingChildren,
  };
  return {
    schemaVersion: "mcp-syson-runtime-qualification/1.0",
    generatedAt: new Date().toISOString(),
    scope:
      "SysON provider compatibility qualification only; not a Digital Thread seal, MRTR approval, or architecture verdict.",
    runtime: {
      syson: {
        image: options.sysonImage,
        digest: options.sysonImageDigest,
        observedPlatform: runtime.platforms.syson,
        graphqlReadiness: runtime.sysonGraphqlReadiness,
      },
      database: {
        image: options.databaseImage,
        digest: options.databaseImageDigest,
        observedPlatform: runtime.platforms.database,
      },
      mcpSyson: {
        image: options.mcpImage,
        digest: options.mcpImageDigest,
        sourceRevision: options.sourceRevision,
        packageVersion: options.packageVersion,
        labels: runtime.mcpLabels,
        observedPlatform: runtime.platforms.mcpSyson,
      },
    },
    contractFingerprints: {
      releasedTransportContract: await fingerprint(transportContract),
      releasedTransports: reviewedTransport,
      serverDiscover: serverDiscoverFingerprint,
      allToolContracts: allToolContractsFingerprint,
      boundedPathToolContracts: await fingerprint(boundedToolContracts),
      boundedReadback: await fingerprint(boundedReadback),
    },
    boundedPath: {
      projectTemplate,
      project: {
        created: projectCreated,
        readback: projectRead,
      },
      model: modelCreated,
      stereotype,
      rootPackage: rootRead,
      childCreationDescription: childType,
      element: {
        created: elementCreated,
        readback: elementRead,
        parentReadback: matchingChildren[0],
      },
    },
  };
}

export async function inspectQualificationRuntime(
  options: QualificationOptions,
): Promise<QualificationRuntime> {
  const [mcpImage, sysonImage, databaseImage, sysonGraphqlReadiness] =
    await Promise.all([
      inspectContainerImage(
        options.mcpContainer,
        options.mcpImage,
        "mcp-syson",
      ),
      inspectContainerImage(
        options.sysonContainer,
        options.sysonImage,
        "SysON",
      ),
      inspectContainerImage(
        options.databaseContainer,
        options.databaseImage,
        "PostgreSQL",
      ),
      verifySysonGraphqlReadiness(options.sysonUrl),
    ]);
  return {
    mcpLabels: {
      source: requiredNonEmptyString(
        mcpImage.labels["org.opencontainers.image.source"],
        "mcp-syson OCI source label",
      ),
      revision: requiredNonEmptyString(
        mcpImage.labels["org.opencontainers.image.revision"],
        "mcp-syson OCI revision label",
      ),
      version: requiredNonEmptyString(
        mcpImage.labels["org.opencontainers.image.version"],
        "mcp-syson OCI version label",
      ),
    },
    platforms: {
      mcpSyson: mcpImage.platform,
      syson: sysonImage.platform,
      database: databaseImage.platform,
    },
    sysonGraphqlReadiness,
  };
}

export async function verifySysonGraphqlReadiness(
  sysonUrl: string,
): Promise<JsonRecord> {
  const response = await fetch(`${sysonUrl.replace(/\/$/, "")}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query:
        "query RuntimeQualificationReadiness { viewer { allProjectTemplates { id label } } }",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `SysON GraphQL readiness returned ${response.status}: ${await response
        .text()}`,
    );
  }
  const payload = await response.json();
  const payloadRecord = asRecord(payload, "SysON GraphQL readiness");
  if (payloadRecord.errors !== undefined) {
    if (
      !Array.isArray(payloadRecord.errors) || payloadRecord.errors.length > 0
    ) {
      throw new Error(
        `SysON GraphQL readiness returned errors: ${
          JSON.stringify(payloadRecord.errors)
        }`,
      );
    }
  }
  const viewer = asRecord(
    asRecord(
      payloadRecord.data,
      "SysON GraphQL readiness.data",
    )
      .viewer,
    "SysON GraphQL readiness.data.viewer",
  );
  if (!Array.isArray(viewer.allProjectTemplates)) {
    throw new Error(
      "SysON GraphQL readiness response is missing viewer.allProjectTemplates",
    );
  }
  return {
    query: "viewer.allProjectTemplates",
    responseFingerprint: await fingerprint(payload),
  };
}

async function inspectImage(
  image: string,
  label: string,
): Promise<{ labels: JsonRecord; platform: string }> {
  const output = await new Deno.Command("docker", {
    args: ["image", "inspect", "--format", "{{json .}}", image],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `Could not inspect ${label} runtime ${image}: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  }
  const inspected = parseJsonRecord(
    new TextDecoder().decode(output.stdout),
    `${label} OCI inspection`,
  );
  const config = asRecord(inspected.Config, `${label} OCI Config`);
  return {
    // OCI labels are provider metadata, not a universal image invariant.  The
    // mcp-syson labels are required and checked below; SysON and PostgreSQL are
    // qualified by their immutable image coordinates and observed platform.
    labels: config.Labels === undefined || config.Labels === null
      ? {}
      : asRecord(config.Labels, `${label} OCI labels`),
    platform: `${requiredNonEmptyString(inspected.Os, `${label} OCI OS`)}/${
      requiredNonEmptyString(
        inspected.Architecture,
        `${label} OCI architecture`,
      )
    }`,
  };
}

async function inspectContainerImage(
  container: string,
  expectedImage: string,
  label: string,
): Promise<{ labels: JsonRecord; platform: string }> {
  const output = await new Deno.Command("docker", {
    args: [
      "container",
      "inspect",
      "--format",
      "{{json .Config.Image}}\n{{json .Image}}",
      container,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `Could not inspect ${label} container ${container}: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  }
  const [configuredImage, imageId, ...extra] = new TextDecoder().decode(
    output.stdout,
  ).trim().split("\n");
  if (!configuredImage || !imageId || extra.length !== 0) {
    throw new Error(
      `${label} container inspection returned an invalid image identity`,
    );
  }
  assertEqual(
    parseJsonString(configuredImage, `${label} container configured image`),
    expectedImage,
    `${label} container configured image`,
  );
  const [{ labels }, platform] = await Promise.all([
    inspectImage(
      parseJsonString(imageId, `${label} container image ID`),
      label,
    ),
    inspectContainerPlatform(container, label),
  ]);
  return { labels, platform };
}

async function inspectContainerPlatform(
  container: string,
  label: string,
): Promise<string> {
  const output = await new Deno.Command("docker", {
    args: ["container", "exec", container, "uname", "-s", "-m"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `Could not observe ${label} container platform: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  }
  return parseContainerPlatform(
    new TextDecoder().decode(output.stdout),
    `${label} container uname`,
  );
}

/** Translate the platform actually reported by the running qualification container. */
export function parseContainerPlatform(output: string, label: string): string {
  const [operatingSystem, architecture, ...extra] = output.trim().split(/\s+/);
  if (
    operatingSystem !== "Linux" || architecture !== "x86_64" || extra.length
  ) {
    throw new Error(
      `${label} must report exactly Linux x86_64; got ${
        JSON.stringify(output.trim())
      }`,
    );
  }
  return "linux/amd64";
}

export async function main(args = Deno.args): Promise<void> {
  const options = parseQualificationOptions(args);
  const [runtime, transportContract] = await Promise.all([
    inspectQualificationRuntime(options),
    readTransportContract(options.runtimeContract),
  ]);
  const manifest = await qualifyRuntime(
    new HttpMcpClient(options.httpUrl),
    options,
    runtime,
    transportContract,
  );
  const encoded = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.output) await Deno.writeTextFile(options.output, encoded);
  console.log(encoded);
}

function assertMcpRuntimeLabels(
  labels: RuntimeLabels,
  options: QualificationOptions,
): void {
  assertEqual(
    labels.source,
    options.expectedSource ?? "https://github.com/Casys-AI/mcp-syson",
    "mcp-syson OCI source label",
  );
  assertEqual(
    labels.revision,
    options.sourceRevision,
    "mcp-syson OCI revision label",
  );
  assertEqual(
    labels.version,
    options.packageVersion,
    "mcp-syson OCI version label",
  );
}

function assertObservedPlatforms(
  platforms: QualificationRuntime["platforms"],
): void {
  for (const [label, platform] of Object.entries(platforms)) {
    assertEqual(platform, "linux/amd64", `${label} observed OCI platform`);
  }
}

function assertReviewedTransportContract(
  contract: JsonRecord,
  options: QualificationOptions,
): ReviewedTransportContract {
  assertEqual(
    contract.schemaVersion,
    "mcp-syson-runtime-contract/1.0",
    "released transport contract schemaVersion",
  );
  assertEqual(
    contract.packageVersion,
    options.packageVersion,
    "released transport contract packageVersion",
  );
  assertEqual(
    contract.sourceRevision,
    options.sourceRevision,
    "released transport contract sourceRevision",
  );
  assertEqual(
    contract.image,
    options.mcpImage,
    "released transport contract image",
  );
  assertEqual(
    contract.imageDigest,
    options.mcpImageDigest,
    "released transport contract imageDigest",
  );
  const transports = asRecord(
    contract.transports,
    "released transport contract transports",
  );
  const http = asRecord(transports.http, "released transport contract HTTP");
  const stdio = asRecord(
    transports.stdio,
    "released transport contract stdio",
  );
  for (
    const [label, transport] of [["HTTP", http], ["stdio", stdio]] as const
  ) {
    for (
      const key of [
        "serverDiscoverFingerprint",
        "toolContractsFingerprint",
        "uiResourcesFingerprint",
      ]
    ) {
      const value = requiredNonEmptyString(
        transport[key],
        `released transport contract ${label} ${key}`,
      );
      if (!OCI_DIGEST.test(value)) {
        throw new Error(
          `released transport contract ${label} ${key} must be a SHA-256 digest`,
        );
      }
    }
  }
  return {
    schemaVersion: "mcp-syson-runtime-contract/1.0",
    http: {
      serverDiscoverFingerprint: http.serverDiscoverFingerprint,
      toolContractsFingerprint: http.toolContractsFingerprint,
      uiResourcesFingerprint: http.uiResourcesFingerprint,
    },
    stdio: {
      serverDiscoverFingerprint: stdio.serverDiscoverFingerprint,
      toolContractsFingerprint: stdio.toolContractsFingerprint,
      uiResourcesFingerprint: stdio.uiResourcesFingerprint,
    },
  };
}

async function readTransportContract(path: string): Promise<JsonRecord> {
  try {
    return parseJsonRecord(
      await Deno.readTextFile(path),
      "released transport contract",
    );
  } catch (error) {
    throw new Error(
      `Could not read released transport contract ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function callTool(
  client: McpClient,
  name: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  const result = await client.request("tools/call", { name, arguments: args });
  if (result.isError === true) {
    throw new Error(`${name} reported a tool error: ${JSON.stringify(result)}`);
  }
  return asRecord(result.structuredContent, `${name} structuredContent`);
}

function exactlyOnePartUsage(value: unknown): JsonRecord {
  const candidates = asArray(value, "child creation descriptions")
    .filter(isRecord)
    .filter(
      (child) =>
        child.id === PART_USAGE_DESCRIPTION.id &&
        child.label === PART_USAGE_DESCRIPTION.label,
    );
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one exact ${PART_USAGE_DESCRIPTION.id} child creation description; found ${candidates.length}`,
    );
  }
  requiredNonEmptyString(
    candidates[0].id,
    "PartUsage child creation description id",
  );
  assertExactKeys(
    candidates[0],
    ["iconURL", "id", "label"],
    "PartUsage child creation description",
  );
  const iconUrls = asArray(
    candidates[0].iconURL,
    "PartUsage child creation description iconURL",
  );
  if (!iconUrls.every((url) => typeof url === "string")) {
    throw new Error(
      "PartUsage child creation description iconURL must contain only strings",
    );
  }
  return candidates[0];
}

function exactlyOneCatalogEntry(
  value: unknown,
  expected: { id: string; label: string },
  label: string,
): JsonRecord {
  const candidates = asArray(value, `${label} catalog`)
    .filter(isRecord)
    .filter((entry) =>
      entry.id === expected.id && entry.label === expected.label
    );
  if (candidates.length !== 1) {
    throw new Error(
      `${label} must contain exactly one ${expected.id}/${expected.label}; found ${candidates.length}`,
    );
  }
  assertExactKeys(candidates[0], ["id", "label"], `${label} catalog entry`);
  return candidates[0];
}

function assertSchemaKeys(
  schema: unknown,
  expectedProperties: string[],
  label: string,
): void {
  assertExactKeys(
    asRecord(asRecord(schema, label).properties, `${label}.properties`),
    expectedProperties,
    `${label}.properties`,
  );
}

function assertExactStringArray(
  value: unknown,
  expected: string[],
  label: string,
): void {
  if (expected.length === 0 && value === undefined) {
    return;
  }
  const actual = asArray(value, label);
  if (!actual.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must contain only strings`);
  }
  const sortedActual = [...actual as string[]].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${label} drifted: expected ${JSON.stringify(sortedExpected)}, got ${
        JSON.stringify(sortedActual)
      }`,
    );
  }
}

function assertExactKeys(
  value: JsonRecord,
  expected: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `${label} drifted: expected keys ${JSON.stringify(sortedExpected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label} drifted: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function requiredNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function parseJsonRecord(text: string, label: string): JsonRecord {
  try {
    return asRecord(JSON.parse(text), label);
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function parseJsonString(text: string, label: string): string {
  try {
    return requiredNonEmptyString(JSON.parse(text), label);
  } catch (error) {
    throw new Error(
      `${label} is not a non-empty JSON string: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function fingerprint(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return `sha256:${
    Array.from(new Uint8Array(digest)).map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("")
  }`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}
