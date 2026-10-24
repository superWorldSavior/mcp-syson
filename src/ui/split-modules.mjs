/** Resolve one explicit, audited local mcp-view split for UI builds/checks. */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_EXPECTATIONS = Object.freeze({
  core: Object.freeze({ name: "@casys/mcp-view", version: "0.9.3" }),
  contracts: Object.freeze({
    name: "@casys/mcp-view-contracts",
    version: "0.1.0",
  }),
  components: Object.freeze({
    name: "@casys/mcp-view-components",
    version: "0.9.0",
  }),
});

export function resolveSplitModules(environment = process.env) {
  const core = requiredFileModule("MCP_VIEW_MODULE", environment);
  const components = requiredFileModule(
    "MCP_VIEW_COMPONENTS_MODULE",
    environment,
  );
  const contracts = optionalFileModule(
    "MCP_VIEW_CONTRACTS_MODULE",
    environment,
    new URL("../view-contracts/mod.ts", core.href).href,
  );
  const componentsPreact = optionalFileModule(
    "MCP_VIEW_COMPONENTS_PREACT_MODULE",
    environment,
    new URL("./preact.ts", components.href).href,
  );
  const presentation = optionalFileModule(
    "MCP_VIEW_PRESENTATION_MODULE",
    environment,
    new URL("./preact-components.ts", components.href).href,
  );
  const fonts = optionalFileModule(
    "MCP_VIEW_COMPONENTS_FONTS_MODULE",
    environment,
    new URL("./fonts.ts", components.href).href,
  );
  // The shared context control is being reviewed locally before its release.
  // Require an explicit source so a build cannot silently use a different UI.
  const contextControls = requiredFileModule(
    "MCP_VIEW_CONTEXT_MODULE",
    environment,
  );

  const corePackage = verifyPackage(core, PACKAGE_EXPECTATIONS.core, ".");
  const contractsPackage = verifyPackage(
    contracts,
    PACKAGE_EXPECTATIONS.contracts,
    ".",
  );
  const componentsPackage = verifyPackage(
    components,
    PACKAGE_EXPECTATIONS.components,
    ".",
  );
  verifyPackageMember(componentsPreact, componentsPackage.root, "./preact");
  verifyPackageMember(
    presentation,
    componentsPackage.root,
    "./preact/components",
  );
  verifyPackageMember(fonts, componentsPackage.root, "./fonts");

  if (corePackage.root === componentsPackage.root) {
    throw new Error(
      "MCP view core and presentation must resolve to distinct split packages.",
    );
  }
  if (
    readFileSync(core.path, "utf8").includes("installMcpViewTheme") ||
    readFileSync(core.path, "utf8").includes("defineComponentRegistry")
  ) {
    throw new Error(
      "MCP_VIEW_MODULE is not the renderer-neutral split core entry point.",
    );
  }

  const provenance = [corePackage, contractsPackage, componentsPackage]
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .join(" + ");
  return Object.freeze({
    core,
    contracts,
    components,
    componentsPreact,
    presentation,
    fonts,
    contextControls,
    provenance,
    environment: Object.freeze({
      MCP_VIEW_MODULE: core.href,
      MCP_VIEW_CONTRACTS_MODULE: contracts.href,
      MCP_VIEW_COMPONENTS_MODULE: components.href,
      MCP_VIEW_COMPONENTS_PREACT_MODULE: componentsPreact.href,
      MCP_VIEW_PRESENTATION_MODULE: presentation.href,
      MCP_VIEW_COMPONENTS_FONTS_MODULE: fonts.href,
      MCP_VIEW_CONTEXT_MODULE: contextControls.href,
    }),
  });
}

function requiredFileModule(name, environment) {
  const value = environment[name];
  if (!value?.trim()) {
    throw new Error(
      `${name} must be an explicit file: URL for the audited local mcp-view split.`,
    );
  }
  return fileModule(name, value);
}

function optionalFileModule(name, environment, fallback) {
  return fileModule(name, environment[name]?.trim() || fallback);
}

function fileModule(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${name} must be an absolute file: URL, received ${value}.`,
    );
  }
  if (url.protocol !== "file:" || url.search || url.hash) {
    throw new Error(
      `${name} must be a plain local file: URL, received ${value}.`,
    );
  }
  const path = realpathSync(fileURLToPath(url));
  if (!statSync(path).isFile()) {
    throw new Error(`${name} does not identify a module file: ${path}.`);
  }
  return Object.freeze({ path, href: pathToFileURL(path).href });
}

function verifyPackage(entry, expectation, exportKey) {
  const root = dirname(entry.path);
  const manifestPath = resolve(root, "deno.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest.name !== expectation.name ||
    manifest.version !== expectation.version
  ) {
    throw new Error(
      `${entry.path} belongs to ${manifest.name ?? "an unnamed package"}@${
        manifest.version ?? "unknown"
      }, expected ${expectation.name}@${expectation.version}.`,
    );
  }
  const target = typeof manifest.exports === "string"
    ? manifest.exports
    : manifest.exports?.[exportKey];
  if (!target || realpathSync(resolve(root, target)) !== entry.path) {
    throw new Error(
      `${expectation.name}@${expectation.version} does not export ${entry.path} as ${exportKey}.`,
    );
  }
  return Object.freeze({ ...expectation, root, manifest });
}

function verifyPackageMember(entry, root, exportKey) {
  const manifest = JSON.parse(readFileSync(resolve(root, "deno.json"), "utf8"));
  const target = manifest.exports?.[exportKey];
  if (!target || realpathSync(resolve(root, target)) !== entry.path) {
    throw new Error(
      `${entry.path} is not the audited ${exportKey} entry point of ${manifest.name}.`,
    );
  }
  const member = relative(root, entry.path);
  if (member.startsWith(`..${sep}`) || member === "..") {
    throw new Error(`${entry.path} escapes the audited presentation package.`);
  }
}
