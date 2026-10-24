/**
 * Proves that each generated TypeScript module is fresh with the Vite output.
 *
 * This runs after `deno task ui:build` in CI. It keeps a stale App module from
 * becoming a package that serves a different viewer than the checked build.
 */

import { loadBundledUiHtml, UI_BUNDLE_NAMES } from "../src/ui/bundles.ts";
import { VIEWER_COMPONENT_KEYS } from "../src/ui/shared/component-catalog.ts";

const EXPECTED_VIEWERS = [
  "diagram-viewer",
  "model-explorer-viewer",
  "query-results-viewer",
  "requirements-trace-viewer",
  "requirements-viewer",
  "validation-viewer",
  "value-change-viewer",
];

const VIEWER_SOURCE_PATHS = EXPECTED_VIEWERS.map((viewer) =>
  new URL(`../src/ui/${viewer}/src/main.tsx`, import.meta.url)
);

const COMPONENTS_BY_VIEWER = {
  "diagram-viewer": VIEWER_COMPONENT_KEYS.diagram,
  "model-explorer-viewer": VIEWER_COMPONENT_KEYS.modelExplorer,
  "query-results-viewer": VIEWER_COMPONENT_KEYS.queryResults,
  "requirements-trace-viewer": VIEWER_COMPONENT_KEYS.requirementsTrace,
  "requirements-viewer": VIEWER_COMPONENT_KEYS.requirements,
  "validation-viewer": VIEWER_COMPONENT_KEYS.validation,
  "value-change-viewer": VIEWER_COMPONENT_KEYS.value,
} as const;

const bundledViewers = [...UI_BUNDLE_NAMES].sort();
const expectedViewers = [...EXPECTED_VIEWERS].sort();
if (JSON.stringify(bundledViewers) !== JSON.stringify(expectedViewers)) {
  throw new Error(
    `Expected exactly ${expectedViewers.join(", ")}; found ${
      bundledViewers.join(", ")
    }`,
  );
}

for (const viewer of EXPECTED_VIEWERS) {
  const distUrl = new URL(
    `../src/ui/dist/${viewer}/index.html`,
    import.meta.url,
  );
  const distHtml = await Deno.readTextFile(distUrl);
  const bundledHtml = await loadBundledUiHtml(
    viewer as Parameters<typeof loadBundledUiHtml>[0],
  );

  if (bundledHtml !== distHtml) {
    throw new Error(
      `${viewer}: generated bundle does not match dist/index.html`,
    );
  }
  if (!bundledHtml.includes("<html") || !bundledHtml.includes('id="app"')) {
    throw new Error(`${viewer}: bundle is not a rendered MCP App document`);
  }
  if (
    bundledHtml.includes("file:///Volumes/") ||
    bundledHtml.includes("/Volumes/DEV/")
  ) {
    throw new Error(`${viewer}: bundle leaks a local split module path`);
  }
  if (
    !bundledHtml.includes("io.casys.mcp.view-components/v1") ||
    !bundledHtml.includes("io.casys.mcp.surface/v1")
  ) {
    throw new Error(
      `${viewer}: bundle does not contain both component surface contracts`,
    );
  }
  for (const component of COMPONENTS_BY_VIEWER[viewer]) {
    if (!bundledHtml.includes(component)) {
      throw new Error(`${viewer}: bundle is missing component ${component}`);
    }
  }
  if (bundledHtml.includes("io.casys.mcp.composable-view/v1")) {
    throw new Error(
      `${viewer}: bundle still contains the retired projection contract`,
    );
  }
}

for (const sourceUrl of VIEWER_SOURCE_PATHS) {
  const source = await Deno.readTextFile(sourceUrl);
  if (
    !source.includes("defineComponentRegistry") ||
    !source.includes("startSysonViewerApp") ||
    !source.includes('from "@mcpview/components"') ||
    !source.includes(
      'from "@mcpview/components/preact/components"',
    ) ||
    source.includes('from "@mcpview/view/preact"')
  ) {
    throw new Error(
      `${sourceUrl.pathname}: viewer presentation must use the optional split component package.`,
    );
  }
  if (source.includes("info:")) {
    throw new Error(
      `${sourceUrl.pathname}: viewer must not override the exact manifest appInfo identity.`,
    );
  }
  // Viewers translate through sysonMessages or a viewer catalog built on it
  // with createTranslator (for example requirementsMessages).
  if (
    !/\b[a-zA-Z]*[mM]essages\(/.test(source) ||
    !source.includes("surfaceLabel(")
  ) {
    throw new Error(
      `${sourceUrl.pathname}: viewer interface wording must use the shared createTranslator catalog.`,
    );
  }
}

const coverageSource = await Deno.readTextFile(
  new URL("../src/ui/requirements-trace-viewer/src/main.tsx", import.meta.url),
);
if (
  !coverageSource.includes("FocusedView") ||
  !coverageSource.includes("Disclosure")
) {
  throw new Error(
    "Requirements-trace coverage must use the kit FocusedView/Disclosure.",
  );
}

const adapterSource = await Deno.readTextFile(
  new URL("../src/ui/shared/preact-surface.tsx", import.meta.url),
);
if (
  !adapterSource.includes('from "@mcpview/view"') ||
  !adapterSource.includes('from "@mcpview/components"') ||
  !adapterSource.includes('from "@mcpview/components/preact"') ||
  !adapterSource.includes('from "@mcpview/components/fonts"') ||
  !adapterSource.includes("startPreactSurfaceApp(") ||
  !adapterSource.includes("viewerSession:") ||
  !adapterSource.includes("toState") ||
  !adapterSource.includes("createTranslator(") ||
  !adapterSource.includes('themeUpdates: "in-place"') ||
  !adapterSource.includes("type SurfaceLabel") ||
  !adapterSource.includes("documentLanguage: sysonMessages.locale") ||
  !adapterSource.includes("title: (locale) =>") ||
  !adapterSource.includes(
    'mcpViewMessages(locale)("sessionRejectedTitle")',
  ) ||
  !adapterSource.includes(
    'sysonMessages(locale)("sessionRejected", { view })',
  ) ||
  adapterSource.includes("export type SurfaceLabel =") ||
  adapterSource.includes("mcpViewMessages(host.locale)") ||
  !adapterSource.includes("name: SYSON_VIEW_APP_MANIFEST.app.id") ||
  !adapterSource.includes("version: SYSON_VIEW_APP_MANIFEST.app.version") ||
  adapterSource.includes("createMcpApp") ||
  adapterSource.includes("mountComponentSurface") ||
  adapterSource.includes("createComposeEventClient") ||
  adapterSource.includes('from "@mcpview/view/preact"') ||
  adapterSource.includes("defineRecordedPreactComponent")
) {
  throw new Error(
    "SysON must keep recorded hydration App-level while separating mcp-view core from optional presentation.",
  );
}

const packageJson = JSON.parse(
  await Deno.readTextFile(
    new URL("../src/ui/package.json", import.meta.url),
  ),
);
const packageLock = await Deno.readTextFile(
  new URL("../src/ui/package-lock.json", import.meta.url),
);
for (
  const [name, version] of Object.entries({
    "@mcpview/view": "0.11.0",
    "@mcpview/components": "0.12.0",
    "@mcpview/contracts": "0.2.0",
  })
) {
  if (
    packageJson.dependencies?.[name] !== version ||
    !packageLock.includes(`"node_modules/${name}"`)
  ) {
    throw new Error(`UI must use published ${name}@${version}.`);
  }
}
if (
  packageLock.includes("@casys/mcp-view") ||
  packageLock.includes("@modelcontextprotocol/sdk")
) {
  throw new Error("UI must not retain legacy MCP View or SDK v1 packages.");
}

const globalCss = await Deno.readTextFile(
  new URL("../src/ui/global.css", import.meta.url),
);
if (
  globalCss.includes("Compatibility overrides") ||
  globalCss.includes("font-family: Inter") ||
  globalCss.includes("html .mcp-view-card")
) {
  throw new Error(
    "SysON CSS must not reintroduce the retired monolith palette or typography overrides.",
  );
}

console.log(`Verified ${EXPECTED_VIEWERS.length} fresh UI bundles.`);
