# MCP Apps and recorded viewer contracts

SysON viewers are small provider-owned MCP Apps. Each resource has a compact
standalone surface and a catalog of finer components that a compatible host can
compose. The App remains responsible for validating and interpreting its own
result data.

## App resources

| Resource                                   | Primary standalone view     | Direct result schema                                  |
| ------------------------------------------ | --------------------------- | ----------------------------------------------------- |
| `ui://mcp-syson/diagram-viewer`            | Diagram visual              | `io.casys.mcp-syson.diagram-snapshot-result/1.0`      |
| `ui://mcp-syson/model-explorer-viewer`     | Model elements              | `io.casys.mcp-syson.model-children-result/1.0`        |
| `ui://mcp-syson/query-results-viewer`      | Query values                | `io.casys.mcp-syson.query-result/1.0`                 |
| `ui://mcp-syson/requirements-viewer`       | Authored requirement limits | `io.casys.mcp-syson.authored-requirements-result/1.0` |
| `ui://mcp-syson/requirements-trace-viewer` | Satisfaction-link coverage  | `io.casys.mcp-syson.requirements-trace-result/1.0`    |
| `ui://mcp-syson/validation-viewer`         | Validation state            | `io.casys.mcp-syson.validation-result/1.0`            |
| `ui://mcp-syson/value-change-viewer`       | Value readout               | `io.casys.mcp-syson.value-result/1.0`                 |

The serialized compatibility declaration is
[`src/ui/view-app-manifest.json`](../src/ui/view-app-manifest.json), exported as
`@casys/mcp-syson/view-app-manifest`. It contains presentation compatibility
only: App identity, resource URIs, accepted result and session schemas, and the
`viewer.session.apply` action. It contains no provider URL, credential, live
tool policy, project anchor or recorded session.

## Direct MCP results

Viewer-backed operations return a concise model-facing summary in `content` and
the complete UI payload in `structuredContent`. The tool result points to its
`ui://mcp-syson/*` resource through MCP Apps metadata. A host without MCP App
support still receives the same structured operation result.

The App registers its result and session handlers before connecting to the host.
This prevents an early notification from being lost during the MCP Apps
handshake.

## Navigation and selection contract

For a task-oriented workflow, see
[Browse model elements and diagram views](how-to/browse-model-views.md).

The model explorer uses the kit `PathBar`, `TreeList` and `DrillHint`
components. Opening a real listed element calls `syson_element_children` on the
originating provider. `editingContextId` is an optional addition to the children
payload; older payloads remain displayable but cannot initiate that live read.
The path retains earlier levels and their filters and scroll positions. Empty
children, loading, rejected results and read failures remain explicit. Responses
from a superseded root or abandoned level cannot replace the current branch.

Model and diagram selection uses provider element identities. Click toggles an
item; double-click and Enter inspect while preserving the preceding selection.
Space toggles items in the model explorer. In diagrams, holding Space while
dragging temporarily pans the canvas; releasing Space restores the chosen mode.
Inspection does not implicitly select. The basket belongs to the viewer root and
survives local navigation and language changes. A new root invalidates old
handlers and queues an empty context replacement. Diagram Select mode adds fully
enclosed primary diagram blocks (parts in an architecture view) through a
background selection rectangle. Internal rows, ports and relationships remain
available through individual clicks; Pan mode moves the canvas.

The local preview reuses MCP View's `ActiveContextChip` for the compact context
signal, remove controls and selection popover. `SelectionBasket` only adapts the
SysON controller and localized labels to that component. Decorative compartments
that repeat their parent's semantic identity are not independent selection
targets. Native text selection and SVG dragging are disabled inside the canvas;
text in the surrounding panels remains selectable.

The diagram chooser separates existing representations (`syson_diagram_list`)
from available native types for its target (`syson_diagram_types`). A type is
availability information, not an existing or newly created view. Only existing
diagram representations are opened through `syson_diagram_snapshot`; table or
other representations require an appropriate viewer and show that limitation.
Snapshot data retains representation metadata, nested nodes and layout data when
supplied. The subscription bounds child-node recursion to depth 8. Local SVG
rendering approximates the native diagram using the supplied topology and
coordinates; it does not reproduce every native style or editor interaction.
Empty display compartments are omitted from the local projection; populated
compartments keep their content. The original snapshot remains unchanged. Fit
and zoom use a single transform of the SVG's intrinsic dimensions.

Live navigation requires the host's `serverTools` capability plus the relevant
editing-context identifier. Recorded sessions make no provider calls, including
for element inspection or view discovery. Captured identities and summaries can
still be selected for the host's context when that host supports updates. The
basket reports unavailable, pending and rejected updates and provides remove,
clear and retry actions. Each update replaces the complete context for that
viewer, including an empty replacement when cleared. Acknowledgement means
acceptance by the host for future turns; it proves neither model consumption nor
an AI response. Selection does not send a conversational request.

## Recorded read-only sessions

A recording host can reopen an exact result without calling the live provider.
It sends `viewer.session.apply` with the session schema declared for that
resource:

```json
{
  "schemaVersion": "io.casys.mcp-syson.recorded-model-children-session/1.0",
  "resourceUri": "ui://mcp-syson/model-explorer-viewer",
  "resultSchema": "part-definitions-capture/1.0",
  "readOnly": true,
  "basis": {
    "projectId": "project-id",
    "projectRevision": 42,
    "subjectId": "project:project-id",
    "thread": { "id": "exact-thread-id", "revision": 7 },
    "artifact": {
      "id": "part-definitions-<digest>",
      "fingerprint": "sha256:<digest>"
    }
  },
  "projectionFingerprint": "sha256:<canonical-session-digest>",
  "structuredContent": {}
}
```

The parser rejects unknown keys, mismatched resource and session schemas,
non-read-only sessions, invalid basis identities and a projection fingerprint
that does not match the canonical JSON payload. Arrays must be dense JSON
arrays; non-JSON values are refused.

The complete original `structuredContent` participates in the fingerprint. Only
after that verification may an App-owned adapter project a persisted Digital
Thread capture into its bounded read model. Current adapters accept:

- `architecture-capture/4.0` and `part-definitions-capture/1.0` in the model
  elements App;
- `requirements-capture/3.0` in the requirements App.

Architecture and part-definition captures become a small list of provider
identities. Requirements become authored limits. The adapter deliberately does
not infer requirement satisfaction from a limit, and recorded mode does not gain
live mutation or provider credentials. Authored limits use the shared kit's
`ElementLimit` in a compact `CollectionCard`; the operator, value and unit are
rendered from the capture. Exact row identifiers stay behind a closed kit
`Disclosure` so they remain inspectable without flooding the default surface.
The viewer neither derives a measurement nor assigns a satisfaction verdict.
Satisfaction-link coverage remains in the separate requirements-trace resource,
which does not accept authored-limit captures. Its standalone surface is the kit
`FocusedView`: one coverage visualization, critical status outside the collapsed
details, and root identity plus optional trace/link inspection in that closed
disclosure. The trace-list and satisfaction-link keys stay independently
mountable and are not nested as a dashboard.

The authored-requirements and diagram viewers ship committed fixtures and a
documentation harness for reproducible README captures.
`docs/fixtures/requirements-session.json` is a fully fingerprinted recorded
session for the TPS03 StandBackrest capture; the
`docs/fixtures/diagram-<view>-session.json` files wrap the action flow, state
machine and interconnection snapshots recorded in
`tests/fixtures/diagram-views`. All are built deterministically by
`deno task docs:viewer-fixtures` (`scripts/build-viewer-fixtures.ts`).
`docs/fixtures/viewer-preview.html` is a minimal host harness: `?view=` picks a
fixture, `?theme=dark` the dark theme, `?capture` hides its legend. It accepts
context updates, drives the App through the standard MCP UI handshake, and
chooses a diagram's automatic layout through the viewer's own menu before it
marks the page ready. `deno task docs:viewer-screenshot`
(`scripts/capture-viewer-doc.ts`) serves them on a loopback server, drives
headless Chrome over the DevTools protocol, waits for that ready mark (the
automatic layout runs in a worker), and writes
`docs/images/mcp-syson-<view>.png` and `…-dark.png` at 2× scale. Re-running the
two tasks after any viewer change produces fresh PNGs with the same layout and
text (Chrome's rasterizer drifts by one luma level on a few anti-aliased pixels,
so the bytes are not bit-identical).

## Component catalog

Components are advertised under `io.casys.mcp.view-components/v1` and selected
through the host context `io.casys.mcp.surface/v1`.

| Resource              | Component keys                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Diagram               | `syson.diagram.summary`, `syson.diagram.visual`, `syson.diagram.elements`, `syson.diagram.identity`                       |
| Model explorer        | `syson.model.summary`, `syson.model.elements`, `syson.model.kind-breakdown`, `syson.model.parent-context`                 |
| Query results         | `syson.query.summary`, `syson.query.expression`, `syson.query.values`                                                     |
| Authored requirements | `syson.requirements.authored-list`                                                                                        |
| Requirements trace    | `syson.requirements.coverage`, `syson.requirements.trace-list`, `syson.requirements.satisfaction-links`                   |
| Validation            | `syson.validation.status`, `syson.validation.summary`, `syson.validation.resolved-values`, `syson.validation.constraints` |
| Value                 | `syson.value.readout`, `syson.value.identity`, `syson.value.verification`                                                 |

Every key has one local mount implementation and a stable component instance ID.
A host may arrange known keys in a stack, row or grid. Unknown keys, malformed
layouts and non-JSON props fail closed. The kit's surface lifecycle
(`startPreactSurfaceApp`) selects the host-negotiated surface when the host
context is ready and falls back to the App's bounded standalone surface
otherwise, in direct and recorded mode alike. Recorded sessions are still
verified against their fingerprint before any component mounts.

Example negotiated context:

```json
{
  "io.casys.mcp.surface/v1": {
    "instanceId": "coffee-machine-validation",
    "status": "ready",
    "source": "requested",
    "eventChannel": "ui/compose/event",
    "surface": {
      "layout": { "type": "grid", "columns": 2, "gap": "sm" },
      "components": [
        { "id": "status", "component": "syson.validation.status" },
        { "id": "constraints", "component": "syson.validation.constraints" }
      ]
    }
  }
}
```

Model and diagram basket selections emit named semantic selection events after
the context update is acknowledged. The events carry provider identities; they
do not perform model writes or navigate the host by themselves.

## Package and bundle layout

Viewer source lives under `src/ui/<viewer>/src/`. Vite produces self-contained
HTML in `src/ui/dist/<viewer>/index.html`. The build then generates imported
TypeScript modules under `src/ui/bundles/`; literal imports keep every App in
the JSR module graph without evaluating unrelated HTML on each resource read.

`server.ts` registers the generated HTML as MCP resources. Editing TSX without
rebuilding leaves the served bundle stale.

## Published MCP View packages

Viewer builds resolve `@mcpview/view@0.11.0`, `@mcpview/components@0.12.0` and
`@mcpview/contracts@0.2.0` directly from the npm lockfile. The server uses
`@mcpview/server@0.30.0`. No sibling checkout or file-module environment
variables are required. MCP Apps use ext-apps 2.x, the split MCP SDK v2 packages
and Zod 4.2+.

The published `/context` and `/preact/context` entries own acknowledged context
state, serialized replacements, retries, click arbitration and the context chip.
SysON maps semantic references and a graduated policy: compact fields for 1–3
items, references for 4–8, and one `syson_query_eval` reproducer above eight.
The query keeps the explicit editing context separate from the viewer root;
recorded inputs without that context cannot fabricate a resolvable query.

Interface labels, loading and empty copy, buttons, input names and `Intl`
number/date formatting follow `context.hostContext.locale` through the kit
`createTranslator` dictionaries (English base, French overrides). Missing or
invalid host locales fall back to English. Rejected-session title and message
are kit `SurfaceLabel` callbacks resolved at render; provider text, codes and
states stay literal strings. `documentLanguage: sysonMessages.locale` sets
`document.documentElement.lang`. Locale updates do not re-parse a session or
fetch the provider. Literal domain states (`linked`, `unlinked`, `unresolved`,
`error`, `unavailable`, `documentary`, `pass`, `fail`, …), source values,
identifiers, kinds, units and diagnostic messages stay untranslated. Theme-only
host changes keep the mounted surface (`themeUpdates: "in-place"`) because
viewers already follow CSS tokens; locale and surface selection still remount.

## Build and verify

Install the ordinary UI toolchain, then build all viewers:

```bash
cd src/ui
npm ci
cd ../..
deno task ui:build
```

Run the proportional viewer gates:

```bash
deno task ui:check
deno task ui:verify
git diff --exit-code -- src/ui/bundles.ts
```

`ui:verify` recrosses generated HTML with `src/ui/bundles.ts`, the exact
component keys and wire-contract names, handler ordering and absence of retired
projection contracts. The broader provider suite remains:

```bash
deno task check
deno task lint
deno task fmt
deno task test
```

For an interactive check, start the provider and open it in an MCP Apps-capable
host or MCP Inspector. Recorded-session behaviour should additionally be tested
with an exact registered artifact basis; do not replace it with invented JSON.
