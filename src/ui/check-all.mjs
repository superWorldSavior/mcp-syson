/** Type-check all Apps against the same explicit local split as the build. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSplitModules } from "./split-modules.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const split = resolveSplitModules();
const temporaryDirectory = mkdtempSync(join(tmpdir(), "mcp-syson-ui-check-"));
const configPath = join(temporaryDirectory, "deno.json");
const entries = [
  "diagram-viewer",
  "model-explorer-viewer",
  "query-results-viewer",
  "requirements-trace-viewer",
  "requirements-viewer",
  "validation-viewer",
  "value-change-viewer",
].map((name) => resolve(here, name, "src", "main.tsx"));

try {
  writeFileSync(
    configPath,
    `${
      JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            jsx: "react-jsx",
            jsxImportSource: "preact",
            lib: [
              "deno.ns",
              "deno.window",
              "dom",
              "dom.iterable",
              "dom.asynciterable",
              "esnext",
            ],
          },
          imports: {
            "@casys/mcp-view": split.core.href,
            "@casys/mcp-view-contracts": split.contracts.href,
            "@casys/mcp-view-components": split.components.href,
            "@casys/mcp-view-components/preact": split.componentsPreact.href,
            "@casys/mcp-view-components/preact/components":
              split.presentation.href,
            "@casys/mcp-view-components/preact/context":
              split.contextControls.href,
            "@casys/mcp-view-components/fonts": split.fonts.href,
            "@modelcontextprotocol/ext-apps":
              "npm:@modelcontextprotocol/ext-apps@^1.7.4",
            "@modelcontextprotocol/sdk":
              "npm:@modelcontextprotocol/sdk@^1.29.0",
            "@modelcontextprotocol/sdk/types.js":
              "npm:@modelcontextprotocol/sdk@^1.29.0/types.js",
            preact: "npm:preact@^10.28.3",
            "preact/hooks": "npm:preact@^10.28.3/hooks",
            "preact/jsx-runtime": "npm:preact@^10.28.3/jsx-runtime",
          },
        },
        null,
        2,
      )
    }\n`,
  );
  execFileSync(
    "deno",
    [
      "check",
      "--config",
      configPath,
      "--sloppy-imports",
      "--no-lock",
      "--node-modules-dir=none",
      ...entries,
    ],
    { cwd: here, stdio: "inherit" },
  );
  console.log(`Checked ${entries.length} Apps against ${split.provenance}.`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
