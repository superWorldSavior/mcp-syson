# Changelog

All notable changes to `@casys/mcp-syson` will be documented in this file.

## [Unreleased]

## [0.9.2] - 2026-10-25

### Changed

- Package, App manifest and current server identity are `0.9.2`.
- `@casys/constraint-solver` 0.1.1: validation and evaluation results show
  expressions with the parentheses their reading depends on
  (`thrust / (totalMass * 9.81) ≥ 2`, formerly `thrust / totalMass * 9.81 ≥ 2`).
  Like the other first-party packages, it is exempt from the minimum dependency
  age.
- README: the viewers section is a gallery with one capture per viewer (model
  explorer, query results, value change, requirements, requirements trace,
  validation, and two diagram views), each in light and dark.
- The documentation harness delivers a recorded tool result as a host does and
  answers the viewer's own calls from recordings, so a capture shows what a host
  shows (the value change names its attribute). It is ready once those calls are
  answered, and fails the capture instead of drawing a wrong one when a
  recording cannot be read or a view name is unknown. The new recordings are in
  `tests/fixtures/live-audit`.
- `deno task docs:viewer-screenshot` crops each image to the viewer and accepts
  view names to capture only those.

### Fixed

- Constraint extraction reads decimal literals: `totalMass <= 2.5` or
  `thrust / (totalMass * 9.81) >= 2` failed with "Cannot parse literal value
  from 'LiteralRational'", because SysON's expression results have no
  real-number type and `self.value` fails in GraphQL on a `LiteralRational`. Its
  value is now read as text. Validation, solving, requirement limits and the
  requirements trace's authored constraints all go through this extraction.
- `syson_query_requirements_trace` resolves what satisfies a requirement:
  `satisfy massBudget by budget;` was reported as an unresolved link
  ("Unexpected relationship result: VoidExpressionResult"), since SysON
  v2026.7.0 derives no `satisfyingFeature` from it. The trace now reads the
  explicit `by` feature (e.g. `by budget`), the value of the relationship's
  subject parameter, when the derived accessor is empty. A feature chain
  (`by rover.pack.cell`) is reported as its last feature, labelled with the path
  (`rover.pack.cell`). A satisfy without a `by` feature is reported unresolved
  as "no explicit satisfying feature" (instead of the old "Unexpected
  relationship result" text), with no inferred target. A root with requirements
  but no satisfy relationship, or with no requirements, no longer reports a
  resolution error: SysON answers an empty collection with no result type, which
  the trace now reads as zero objects.

## [0.9.1] - 2026-10-25

### Added

- `syson_diagram_snapshot` returns `viewDefinition`, the view type the diagram's
  ViewUsage is typed by (e.g. `StandardViewDefinitions::StateTransitionView`).
  SysON draws every SysML view through one diagram description, so
  `metadata.description` always reads "General View".
- `syson_diagram_create` returns the `viewUsageId` and `viewDefinition` SysON
  actually created, and its description says how SysON records the view type.

### Changed

- The diagram viewer's eyebrow, current-view line and rendering details name the
  real view type ("State Transition View") instead of "General View".
- Package, App manifest and current server identity are `0.9.1`.
- README: an action-flow capture leads the page, a viewers section shows the
  state machine, interconnection and requirements captures, each in light and
  dark. Captures are taken over the DevTools protocol once the harness reports
  the viewer ready, so diagrams appear in their automatic layout.

## [0.9.0] - 2026-10-25

### Added

- The diagram viewer draws SysON diagrams itself from the snapshot's nodes and
  edges, for the General, Interconnection, Action Flow and State Transition
  views:
  - nested parts, actions and states inside their free-form regions, view frames
    with a title tab, list compartments as rows;
  - start, done and decision nodes, fork and join bars with their names, ports
    with outside labels, parameters with their in/out direction;
  - SysON's own edge notation (dashed successions with open heads, filled
    item-flow heads, composition diamonds, specialization and typing triangles),
    with the type-based marker as fallback;
  - edges drawn under blocks; routed edges stay orthogonal; edge labels sit
    clear of blocks and other labels; port labels on one side stack;
  - three levels of detail (full blocks from 60 %, header only from 30 %, tinted
    outlines below) with names at a constant on-screen size, a mini-map, zoom to
    selection and a 35 % opening floor in reading order.
- **Layout** in the diagram's "⋯" menu: SysON's positions (default) or an
  automatic layout computed by ELK (layered, nested containers, orthogonal
  routing), loaded only when chosen and run in a worker. A failure keeps the
  SysON layout with a quiet status.
- `syson_requirements_list`: the authored requirements under a root element with
  their limits, read live by the requirements viewer.
- `syson_diagram_types`: the native representation types SysON offers for an
  element (diagram and table views), read-only.
- AI context selection with compact, reference and query tiers: more than eight
  selected elements become one query element the model can resolve.
- Reproducible README captures of the diagram viewer
  (`docs/fixtures/diagram-session.json`,
  `docs/images/mcp-syson-diagram-viewer.png`) next to the requirements one.

### Changed

- **`syson_diagram_snapshot` result** (breaking for consumers of `nodes` and
  `edges`):
  - hidden elements (and everything under a hidden node) are left out and
    counted in `hiddenNodeCount` / `hiddenEdgeCount`; faded ones carry
    `faded: true`;
  - nodes nested in a free-form compartment or a view frame have kind `node`
    (was `compartment`); node styles carry `childrenLayout` (`list` / `free`);
  - edges carry SysON's `style` (`lineStyle`, `sourceArrow`, `targetArrow`).
- Seven viewers on one UX: a shared header (eyebrow, title, meta, actions, AI
  context basket), selectable rows with SysML kind pills (outlined definitions,
  filled usages), identifiers behind a technical-details disclosure.
  - Model explorer: a tree with lazy, cached branches, family groups, kind
    filters and WAI-ARIA keyboard navigation; an element page per item.
  - Validation: counts per severity, diagnostics named by their constraint.
  - Requirements trace: rows with TRACE GAP, a gaps-only filter and a summary.
  - Diagram: the diagram's name is the title, the representation type ("General
    View") the eyebrow.
- Dependencies: `@casys/mcp-server` 0.26.1 → `@mcpview/server` 0.30.0,
  `@casys/mcp-view-contracts` → `@mcpview/contracts` 0.2.0; viewers on
  `@mcpview/view` 0.11.0 and `@mcpview/components` 0.12.0; MCP SDK v2
  (`@modelcontextprotocol/client` and `core` 2.3, `ext-apps` 2.0.3).
- Package, App manifest and current server identity are `0.9.0`. The published
  OCI image moves to `ghcr.io/superworldsavior/mcp-syson`.
- The diagram viewer bundle grows to about 2.3 MB (ELK, never evaluated unless
  Auto is chosen).

### Fixed

- The requirements trace accepts the output of the provider's own tools.
- Validation shows its diagnostics instead of a bare count.
- Interconnection, Action Flow and State Transition diagrams no longer fall back
  to an approximate SVG that drew every element SysON hides.

## [0.8.7] - 2026-09-05

### Added

- Reproducible README capture: `docs/fixtures/requirements-trace-session.json`
  is a fully fingerprinted TPS03 StandBackrest recorded session built by
  `deno task docs:viewer-fixtures`; `docs/fixtures/viewer-preview.html` is the
  documentation harness that drives the viewer through the standard MCP UI
  handshake; `deno task docs:viewer-screenshot` produces
  `docs/images/mcp-syson-requirements-viewer.png` from headless Chrome at 2×
  scale without manual intervention.

### Changed

- Package, App manifest and current server identity are `0.8.7`.
- Viewer presentation pins the audited `@casys/mcp-view-components@0.9.0` split
  (kit commit `b08802d`) while keeping `@casys/mcp-view@0.9.3` and
  `@casys/mcp-view-contracts@0.1.0`. Interface copy follows the host locale
  through the kit `createTranslator`; literal contract states stay untranslated.
  Rejected recorded sessions keep `code: "session-rejected"` and resolve
  title/message through kit `SurfaceLabel` callbacks at render, so a locale
  change does not re-parse or refetch. `documentLanguage: sysonMessages.locale`
  stamps `document.documentElement.lang`. The trace-list empty state for filter
  `all` uses a natural English/French phrase; `linked`/`unlinked`/`unresolved`
  remain literal.
- Requirements-trace coverage uses `FocusedView`/`Disclosure` for one primary
  visualization, and authored-limit row IDs sit behind a closed disclosure.
  Theme-only host updates stay in place on the CSS-token surfaces.
- Requirements-trace, validation, query-results and model-explorer viewers read
  as datasheets: ident + one reading + provenance once, host-locale `Intl`
  number and date formatting (UTC), the recorded basis as the requirement set's
  provenance ("Recorded from tps03 r15"), operator glyphs (≤ ≥ = ≠) and grouped
  limit values, and no single-row `KeyValueList` field dumps.
- Viewers boot through `@casys/mcp-view-components` `startPreactSurfaceApp`
  (kit-owned statuses, host-context remount and surface selection; the
  recorded-mode standalone lock, `data-mode`/`data-display-mode`/`data-platform`
  stamps and the `aria-label` are gone).
- Kit status wording replaces the facade's: a missing host surface reads "This
  App exposes components and requires a host-selected surface." and a rejected
  one renders the "Surface invalid" title; the kit stamps `data-casys-surface-*`
  on the document element on every host-context change. The
  `data-display-mode="fullscreen"` layout rule (`min-height: 100vh`) is gone
  with the stamp it keyed on.
- Viewer builds require the audited `@casys/mcp-view@0.9.3` +
  `@casys/mcp-view-contracts@0.1.0` + `@casys/mcp-view-components@0.9.0` split
  (kit commit `b08802d`); the kit fonts are installed at boot. A complete
  `tool-input`, not only a partial one, returns the App to `loading`.

## [0.8.6] - 2026-08-31

### Fixed

- The CI-only audited MCP View checkout is ignored by Git, so the JSR
  cleanliness gate can run without weakening its dirty-worktree protection.

## [0.8.5] - 2026-08-31

### Added

- A provider-owned serialized View App manifest, published through the
  `./view-app-manifest` package export, declares all six viewer bundles and
  their exact recorded-session compatibility without embedding a session, anchor
  or provider authority.
- Provider-owned read-only projections for exact Digital Thread architecture,
  part-definition and requirements captures, verified against their original
  recorded-session fingerprint before adaptation.
- Focused MCP App, safety, configuration and provider-development guides, plus a
  real recorded requirements-viewer capture in the public README.

### Changed

- Viewer builds now require the audited local `@casys/mcp-view@0.9.1` and
  `@casys/mcp-view-components@0.2.0` split that owns the shared v2 primitives.
- The public README now presents the provider and quick start concisely while
  keeping exact contracts and operational detail in `docs/`.
- The UI build lock now resolves the maintained Vite 6 line and current
  transitive build dependencies; the committed Apps were rebuilt with no
  source-contract change.

## [0.8.4] - 2026-08-30

### Added

- Tag releases now qualify the published, digest-pinned `mcp-syson` image
  against a fresh topology containing reviewed, digest-pinned SysON v2026.7.0
  and PostgreSQL runtimes. The downloadable qualification result binds those
  identities, OCI labels, source revision, package version and bounded-route
  fingerprints after project/model/element creation and exact read-back.

### Changed

- The qualification workflow discovers its Compose service IDs, gives SysON a
  240-second healthcheck start period and up to 600 seconds to become ready, and
  fails the release if cleanup cannot complete.
- Local SysON and PostgreSQL Compose defaults now use immutable OCI digests.

## [0.8.3] - 2026-08-28

### Fixed

- The release runtime-contract is now written to the GitHub runner temporary
  directory. JSR therefore verifies and publishes the exact clean tagged source,
  while the identical generated evidence is uploaded and attached to the GitHub
  Release. This reissues the complete package release after the `v0.8.2`
  workflow published its OCI image but stopped before JSR and GitHub Release
  creation.

## [0.8.2] - 2026-08-28

### Added

- A dedicated, digest-pinned Deno OCI build for `ghcr.io/casys-ai/mcp-syson`,
  including `z3`, OCI source/revision/version labels, and release-time
  multi-architecture SBOM/provenance attestation.
- A release runtime-contract manifest that binds the published image digest,
  source revision, semantic version, server discovery, tool contracts and UI
  resource fingerprints after actual HTTP and stdio image smoke tests.
- Closed top-level input schemas for all normal provider tools, plus output
  contracts for search, requirement trace, diagram and validation results.

### Changed

- The provider release now pins supported Deno 2.9.6 in CI and to its verified
  multi-architecture OCI index
  (`sha256:2014dc167ece617ef7e7ba40631ac2234c59e75ce693e7cc2dc2602b3c87859d`),
  with Node.js 24.20.0 LTS for the viewer build. The `v0.8.1` tag was cancelled
  before image, JSR, or GitHub Release publication because its Deno 2.5.4 pin
  was past LTS support.
- External Kroki rendering is opt-in through operator-only `SYSON_KROKI_URL`.
  Local SVG rendering is the default and external failures fall back locally
  without exposing raw DOT.
- The stdio integration test now makes a real `tools/call` through the same mock
  provider fixture used to prove HTTP handler behavior.
- `main` verifies source only; a matching `v<semver>` tag is required to publish
  the linked JSR package and OCI image.

## [0.8.0] - 2026-08-28

### Added

- Native `--stdio` transport with the same server factory, tools, MCP App
  resources and server instructions as the default loopback HTTP transport.
- Agent-facing MCP initialization instructions for the recommended project →
  editing-context → model/element path, explicit AQL safety, and the boundary
  between direct provider mutation and Digital Thread authority.
- Closed output schemas and concise structured MCP results for the core project,
  model, element and value chains.
- Standard MCP annotations for every registered operation, including the fact
  that caller-supplied AQL is potentially destructive and diagram rendering can
  contact the external Kroki renderer.
- Normalized structured domain errors for MCP tool-handler failures. Existing
  delete error codes and no-retry unknown-outcome semantics remain intact.

### Changed

- Upgraded `@casys/mcp-server` to `0.26.1` so modern stdio requests use the same
  protocol negotiation and result envelope as the HTTP path.
- Core schema-declared non-viewer results now use concise `content` summaries;
  their complete payload remains in `structuredContent` under the declared
  output schema.

## [0.7.0] - 2026-08-25

### Documentation

- Reworked the public setup, transport, tool-safety, API-boundary and provenance
  guidance against the current registry and REST delete contracts.
- Added a private vulnerability-reporting policy in `SECURITY.md`.

### Fixed

- Package manifest and MCP `server/discover` metadata report `0.7.0`, matching
  the published JSR package and source tag `v0.7.0`.
- Made `syson_model_create.root_package_name` effective. An explicit name is now
  applied and read back after root creation, while an unconfirmed rename returns
  the created package with `rootPackageRenameWarning` instead of silently
  ignoring the input.
- `syson_project_create` never substitutes `project.id` for an absent
  `currentEditingContext.id`. A confirmed follow-up GET still returns
  `id`/`name`/`editingContextId`. When that context is missing or the
  post-create GET fails after `CREATE_PROJECT` succeeded, the result preserves
  the acknowledged project identity with `editingContextId: null` and
  `editingContextWarning`; callers must call `syson_project_get` before model
  writes.

### Changed

- `syson_element_insert_sysml` qualifies SuccessPayload evidence with
  `acknowledged: true` and `semanticCompleteness: "unverified"`. The
  model-facing summary states that SysON acknowledged a textual insertion
  request; semantic completeness is unverified. Callers must still read back
  critical content.

## [0.6.0] - 2026-08-10

### Added

- `syson_element_delete` now uses the stateless SysML v2 REST commit API and
  reports success only after a GET against the acknowledged commit confirms the
  element is absent.
- `syson_project_delete` now uses REST with existence precheck and GET-404
  postcondition verification.
- Destructive failures expose machine-readable precondition, unknown-outcome,
  acknowledged-unverified and postcondition states with recovery and review
  metadata.

### Changed

- `syson_element_create` accepts an exact child-creation ID or exact label and
  rejects ambiguous labels before mutation.
- Project listing and element reads remain on GraphQL where the observed REST
  responses do not preserve their existing pagination or Sirius object
  contracts.

## [0.5.2] - 2026-08-02

### Added

- `syson_project_create`, `syson_model_create`, and `syson_element_get` now
  declare closed `outputSchema` contracts and return their existing payloads in
  `structuredContent` over MCP HTTP while retaining their JSON-text fallback.
  They remain non-viewer tools; direct `SysonToolsClient.execute()` behavior is
  unchanged.

## [0.5.0] - 2026-08-01

### Added

- All shipped Preact MCP Apps now advertise catalogs of small renderer-neutral
  domain components under `io.casys.mcp.view-components/v1` and accept live
  layouts through `io.casys.mcp.surface/v1`. Their complete catalogs form the
  standalone default surfaces.
- Existing element, requirement, and constraint selections can emit named
  Compose events when the host opens `ui/compose/event`.
- `model-explorer-viewer` is now attached to `syson_element_children`.

### Changed

- Viewer-backed calls now keep the full domain payload in `structuredContent`
  and send a concise factual summary in model-facing text. Direct
  `SysonToolsClient.execute()` behavior is unchanged.
- The viewer build now uses `@modelcontextprotocol/ext-apps` 1.7.5; the
  self-contained bundles are smaller than the former 1.0.1 builds.
- Preact components are mounted through the shared `@casys/mcp-view` 0.7 surface
  runtime, while notification handlers remain registered before the handshake
  and every component unmounts during surface changes and teardown.

### Fixed

- `syson_search` now sends SysON v2026.7's required `searchInLibraries: false`
  field. The previous request failed against the shipped Docker stack before a
  result could reach the query viewer.

## [0.4.0] - 2026-07-31

### Changed

- **Breaking transport migration: stateless HTTP only.** The server now runs
  only on `/mcp` with the MCP 2026-07-28 stateless HTTP transport. stdio,
  session state, SSE, and the former `--http` switch are removed. `--port`,
  `--hostname`, and category filtering remain; the default bind is now
  `127.0.0.1`.
- **`syson_constraint_evaluate` now declares and returns a closed structured
  output.** Its concise text fallback is accompanied by `structuredContent`
  containing results, summary, and resolved values, so strict MCP clients can
  validate the response without parsing prose.
- **MCP App handshake order.** Every viewer source registers its one-shot result
  handler before `app.connect()`, and the bundle verifier enforces the ordering
  before publication.

## [0.3.1] - 2026-07-30

### Fixed

- **MCP App bundles are now static package dependencies.** JSR did publish the
  generated HTML, but Deno only fetched the imported module graph and the former
  runtime directory scan could not retrieve those unimported assets. The UI
  build now produces an imported TypeScript bundle; all shipped viewers are
  registered as readable MCP resources and checked in CI before JSR publication.
  `model-explorer-viewer` is available as a resource even though no tool
  attaches it yet.

## [0.3.0] - 2026-07-30

### Added

- **`syson_part_structure`** (query category) — derives the product breakdown
  structure (parts, hierarchy, quantities, numeric attributes) from a SysML v2
  model by recursive AQL traversal of `PartUsage` elements. Quantity comes from
  the model's multiplicity when readable; when it isn't, the tool reports
  SysML's own default of 1 labelled as `quantitySource: "sysml-default"` — never
  a silent, unlabelled 1. Numeric `AttributeUsage` children are read via the
  existing `readAttributeValue` resolver and listed even when unvalued
  (`value: null`), never omitted. Optional `flatten` adds a flat list with
  quantities multiplied along each part's path; `max_depth` bounds recursion and
  `maxDepthReached` reports truncation rather than hiding it.
- **eBOM/mBOM separation, made explicit in the tool surface.**
  `syson_part_structure` derives structure only — no prices, no inferred
  materials. Costing is entirely the ERP's job: the full bill-of-materials flow
  is `syson_part_structure` (structure) → `erpnext_doc_create` with
  `doctype: "BOM"` (cost, from ERPNext's real purchasing prices) — zero glue
  code required, since ERPNext's generic document operations already cover every
  doctype.
- This is the definitive replacement for the retired `plm_bom_generate`, which
  derived cost from name-matched materials and hardcoded default masses —
  exactly the kind of invented data this tool refuses to produce (see
  `.claude/rules/no-hidden-heuristics.md`). `plm/` has been removed from the
  monorepo; `syson_part_structure` is the capability that survives the
  dissolution.

## [0.2.1] - 2026-07-30

### Security

- **AQL injection via element names.** The value resolver ported from `lib/sim`
  interpolated feature names into AQL `select(e | e.declaredName = '…')`
  expressions without escaping. AQL runs server-side with full model access
  (`eSet`, deletion), so an element named `x') or …` was an injection vector,
  not a display quirk. Every dynamic value embedded in AQL now goes through a
  shared `aqlEscape` (backslashes first, then quotes) — including the
  SysON-provided ids in `syson_value_set`, as defence in depth.

## [0.2.0] - 2026-07-30

Absorbs the constraint stack from the internal `lib/sim` module, which is
retired, adding constraint and numeric-value capabilities.

### Added

- **Constraint category** — `syson_constraint_extract` (ConstraintUsage →
  structured AST), `syson_constraint_evaluate`, `syson_constraint_validate`
  (one-shot extract + resolve + evaluate with margins and what-if `values`
  overrides), and **`syson_constraint_solve`**: satisfiability, solving and
  optimisation via
  [`@casys/constraint-solver`](https://jsr.io/@casys/constraint-solver). A
  contradiction (`mass <= 2` and `mass >= 5`) returns `unsat` with the
  conflicting constraint ids — the question no evaluation can answer. Solving
  requires the `z3` executable.
- **Value category** — `syson_value_read` / `syson_value_set` for numeric
  attributes, with negation handling and read-back verification.
- **MCP App viewers** — `validation-viewer` and `value-change-viewer`, ported
  from `lib/sim` under the `ui://mcp-syson/*` namespace.
- **Constraint infrastructure exported** — `parseAstNode` (KerML expression tree
  → constraint AST), `resolveValues`, `readAttributeValue`, for downstream
  packages.

### Fixed relative to the `lib/sim` code this replaces

- **Unit-blind comparisons.** The old evaluator displayed units but compared
  bare numbers: `totalMass ≤ 4 lb` with a 2.5 kg mass reported **pass** (2.5 kg
  is 5.51 lb). Evaluation now goes through `@casys/constraint-solver`, where
  units convert and incompatible dimensions are errors.
- **`LiteralBoolean` crashed the parser.** Prefixed kinds
  (`sysml::LiteralBoolean`) were not recognised; boolean literals now parse to
  1/0.
- **`parseConstraintNodes` dropped.** Its error path substituted a fake
  `literal 0` constraint for anything unparseable — a silent fallback. Parse
  failures are now reported per constraint, never replaced by a value.
- **Model-resolved values are explicitly dimensionless.** A unit-carrying
  constraint evaluated against them reports an `error` instead of silently
  comparing bare numbers, until MeasurementReference reading is implemented.

## [0.1.0] - 2026-07-30

Initial public release.

### Added

- **MCP tools for project, model, element, query, and diagram operations.**
  Every tool is a deterministic primitive; none calls a language model.
- **Shared AQL helper module** (`src/tools/aql.ts`) — `evalAql` plus
  `getChildren`/`getDescendants`/`getParent`/`getSelf`, exported from the
  package root for downstream packages to traverse models with. Replaces three
  near-identical copies of the `evaluateExpression` call that had accumulated
  across `query.ts` and `element.ts`.
- **Zero-dependency GraphQL client** over `fetch()` against SysON's
  `/api/graphql`, throwing on both HTTP and GraphQL-level errors.
- **AQL query surface** — `syson_query_aql`, `syson_query_eval`, full-text
  `syson_search`, and `syson_query_requirements_trace` with coverage metrics.
- **MCP App viewers** — `query-results-viewer`, `requirements-trace-viewer`,
  `diagram-viewer`, `model-explorer-viewer`, served as `ui://mcp-syson/*`.
- **`docker-compose.yml`** bringing up SysON plus PostgreSQL on
  `http://localhost:8180`, with a named volume so models survive
  `docker compose down` (upstream's compose file has no volume) and a database
  healthcheck gating startup.
- **stdio and HTTP transports**, with `--categories` filtering to load a tool
  subset.

### Fixed

- **No default SysON URL.** The GraphQL client previously fell back to
  `http://localhost:8080` — the wrong port for the documented setup, which
  surfaced as a misleading `ECONNREFUSED` instead of a configuration error. An
  unset `SYSON_URL` is now a hard failure with an actionable message.
- **`diagramTools` was missing from the public API** — `mod.ts` re-exported
  every other tool array but not this one.
- **Test suite repaired.** Handlers had migrated to the generic
  `evaluateExpression` AQL mutation while mocks still described the older
  specialised queries (`queryBasedObjects`, `queryBasedString`,
  `renameTreeItem`, `projectTemplates.edges`), leaving failing tests. Type
  errors from `assertRejects` receiving non-async callbacks are also resolved;
  the suite now passes under type checking.

### Removed before release

- **The `syson_agent_*` tools and the sampling bridge.** They ran agentic loops
  through MCP sampling, which is
  [deprecated as of the 2026-07-28 revision](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
  More fundamentally, the caller of an MCP tool is already a language model, so
  having the server ask the host to run another one added an indirection without
  adding information. The replacement mechanism (Multi Round-Trip Requests,
  SEP-2322) surfaces every round-trip to the client, removing the one real
  benefit — saving client context. Generating SysML belongs to the caller;
  `syson_element_insert_sysml` writes it.
- **A prototyped `syson_model_overview` / `syson_element_impact` pair.** Dropped
  for taking three to four AQL round-trips to produce what an agent obtains in
  one or two via `syson_query_aql`, and for inferring "unnamed element" from
  SysON's label fallback rather than reading the model — a hidden heuristic that
  would break silently if SysON changed how it labels.

### Known gaps

- `model-explorer-viewer` is built and shipped but no tool references it yet.
- `SysonToolHandler` is typed `Promise<unknown> | unknown`, which collapses to
  `unknown` and forces callers to await defensively. Narrowing it is an API
  change deferred to a later release.
