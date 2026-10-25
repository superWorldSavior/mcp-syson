# Getting started and configuration

This guide covers a local SysON runtime, the MCP transports and the operator
settings exposed by `@casys/mcp-syson`.

## Prerequisites

- Deno 2.x to run the package or a source checkout.
- A reachable SysON instance.
- Docker Compose only when using the included local SysON stack.
- `z3` only for local source runs that call `syson_constraint_solve`; the
  published provider image already contains it.
- Node.js only when rebuilding the MCP App bundles.

## Start the included SysON stack

The development Compose file runs SysON and PostgreSQL:

```bash
docker compose up -d
export SYSON_URL=http://localhost:8180
```

The SysON UI is available at <http://localhost:8180>. PostgreSQL uses the named
`syson-db-data` volume. `docker compose down` preserves that volume;
`docker compose down -v` deletes the models it contains.

The default SysON image is the reviewed v2026.7.0 Linux/amd64 manifest. On Apple
Silicon, Docker runs it under emulation, so the first healthy start can take
several minutes. An operator can select another reviewed immutable image:

```bash
export SYSON_IMAGE=eclipsesyson/syson@sha256:<reviewed-digest>
docker compose up -d
```

## Run the MCP provider

### HTTP

HTTP is the default transport:

```bash
deno run -A jsr:@casys/mcp-syson@0.9.2/server
```

The default endpoint is <http://127.0.0.1:3009/mcp>. Both forms of each CLI
option are accepted:

```bash
deno run -A jsr:@casys/mcp-syson@0.9.2/server \
  --hostname 127.0.0.1 \
  --port 3009
```

The default bind is loopback-only. Do not expose an unauthenticated endpoint on
a public interface; use the framework authentication settings or a trusted
reverse proxy.

### stdio

Use stdio when an MCP client launches one provider process:

```bash
deno run -A jsr:@casys/mcp-syson@0.9.2/server --stdio
```

`--stdio` cannot be combined with `--port` or `--hostname`. It uses the same
server factory, operation contracts and MCP App resources as HTTP.

### Published OCI image

The published image contains this provider and `z3`, not SysON or PostgreSQL:

```bash
docker run --rm --publish 127.0.0.1:3009:3009 \
  --env SYSON_URL=http://host.docker.internal:8180 \
  ghcr.io/superworldsavior/mcp-syson:v0.9.2
```

For deployment, resolve and pin the immutable index digest attached to the
[GitHub release](https://github.com/superWorldSavior/mcp-syson/releases). The release
workflow builds amd64 and arm64 images, emits provenance and an SBOM, then
smokes both HTTP and stdio before publishing the JSR package.

## Limit the exposed capability categories

An operator can expose only the provider areas needed by a host:

```bash
deno run -A jsr:@casys/mcp-syson@0.9.2/server \
  --categories project,element,query
```

Valid category names are `project`, `model`, `element`, `query`, `diagram`,
`constraint` and `value`. Category selection changes discovery; it does not
change the safety semantics of the operations that remain exposed. In
particular, caller-supplied AQL expressions may mutate the model.

## Follow the identifier flow

For an existing project:

```text
syson_project_list
  -> project id
syson_project_get
  -> confirmed editingContextId
model, element and diagram operations
  -> use the editingContextId
```

For a new model:

```text
syson_project_create
  -> acknowledged project identity
syson_project_get
  -> confirmed, non-null editingContextId
syson_model_create
  -> documentId and rootPackageId
syson_element_insert_sysml
  -> provider acknowledgement
syson_element_children / syson_element_get / syson_query_aql
  -> read-back
```

A project ID, editing-context ID, element ID and REST commit ID are different
identities. Do not substitute one for another. If project creation cannot
confirm `currentEditingContext.id`, it returns `editingContextId: null` with a
warning; read the project again before a model write.

## Environment settings

| Setting                          | Required          | Purpose                                                                                     |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `SYSON_URL`                      | yes               | SysON base URL. The server appends the GraphQL and SysML v2 REST paths.                     |
| `SYSON_IMAGE`                    | no                | Immutable SysON image used by the development Compose file.                                 |
| `SYSON_KROKI_URL`                | no                | Explicitly approved Kroki-compatible diagram endpoint. Local rendering remains the default. |
| `MCP_AUTH_PROVIDER`              | no                | Enables a configured OAuth/OIDC provider in the shared MCP server framework.                |
| `MCP_AUTH_AUDIENCE`              | with auth         | Expected token audience.                                                                    |
| `MCP_AUTH_RESOURCE`              | with auth         | Protected resource identifier.                                                              |
| `MCP_AUTH_DOMAIN`                | provider-specific | Provider domain, used by configurations such as Auth0.                                      |
| `MCP_AUTH_ISSUER`                | provider-specific | Explicit OIDC issuer URL.                                                                   |
| `MCP_AUTH_JWKS_URI`              | provider-specific | Explicit JWKS URL.                                                                          |
| `MCP_AUTH_SCOPES`                | no                | Space-separated supported scopes.                                                           |
| `MCP_AUTH_RESOURCE_METADATA_URL` | no                | Public protected-resource metadata URL.                                                     |

Authentication parsing and validation are owned by
[`@mcpview/server`](https://github.com/Casys-AI/mcp-server). Keep credentials
outside source control.

## Diagram renderer privacy

`syson_diagram_snapshot` produces bounded local SVG by default. It does not send
model names, edges or generated DOT to the Internet. `SYSON_KROKI_URL` is an
operator-only opt-in, never a tool argument. If that endpoint fails, the server
returns a local SVG with `rendererWarning`; it does not expose raw DOT or keep
retrying externally.

## Release qualification boundary

Tag releases run a fresh, isolated topology containing the released provider,
the reviewed SysON image and digest-pinned PostgreSQL. The bounded route creates
and reads back a project, model root and element while recrossing image labels
and MCP contracts.

The downloadable runtime contract and qualification record are provider
compatibility evidence. They are not a Digital Thread seal, an MRTR approval or
an architecture verdict.
