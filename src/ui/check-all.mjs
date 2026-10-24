/** Type-check all Apps against the published dependency versions used by the build. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
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
          minimumDependencyAge: { age: "P0D" },
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
            "@mcpview/view": "npm:@mcpview/view@0.11.0",
            "@mcpview/view/context": "npm:@mcpview/view@0.11.0/context",
            "@mcpview/contracts": "npm:@mcpview/contracts@0.2.0",
            "@mcpview/components": "npm:@mcpview/components@0.12.0",
            "@mcpview/components/preact":
              "npm:@mcpview/components@0.12.0/preact",
            "@mcpview/components/preact/components":
              "npm:@mcpview/components@0.12.0/preact/components",
            "@mcpview/components/preact/context":
              "npm:@mcpview/components@0.12.0/preact/context",
            "@mcpview/components/fonts": "npm:@mcpview/components@0.12.0/fonts",
            "@modelcontextprotocol/ext-apps":
              "npm:@modelcontextprotocol/ext-apps@^2.0.3",
            "@modelcontextprotocol/client":
              "npm:@modelcontextprotocol/client@^2.3.1",
            "@modelcontextprotocol/core":
              "npm:@modelcontextprotocol/core@^2.3.1",
            zod: "npm:zod@^4.2.0",
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
  console.log(
    `Checked ${entries.length} Apps against published MCP View packages.`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
