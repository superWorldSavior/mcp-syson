/**
 * Vite config for building a single UI
 *
 * Used by build-all.mjs to build each UI individually.
 * UI_NAME env var specifies which UI to build.
 *
 * Stack: Preact + explicit local mcp-view core/components split
 */

import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSplitModules } from "./split-modules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiName = process.env.UI_NAME;
const split = resolveSplitModules();

if (!uiName) {
  throw new Error("UI_NAME environment variable is required");
}

export default defineConfig({
  plugins: [
    preact(),
    viteSingleFile(),
    {
      name: "casys-mcp-view-split-provenance",
      transformIndexHtml: {
        order: "post",
        handler: () => [{
          tag: "meta",
          attrs: {
            name: "casys-mcp-view-split",
            content: split.provenance,
          },
          injectTo: "head",
        }, {
          tag: "meta",
          attrs: { name: "casys-mcp-view-context", content: "local-preview" },
          injectTo: "head",
        }],
      },
    },
  ],
  root: resolve(__dirname, uiName),
  resolve: {
    dedupe: [
      "preact",
      "@modelcontextprotocol/ext-apps",
      "@modelcontextprotocol/sdk",
    ],
    preserveSymlinks: true,
    alias: {
      "@casys/mcp-view-components/preact/components": split.presentation.path,
      "@casys/mcp-view-components/preact/context": split.contextControls.path,
      "@casys/mcp-view-components/preact": split.componentsPreact.path,
      "@casys/mcp-view-components/fonts": split.fonts.path,
      "@casys/mcp-view-components": split.components.path,
      "@casys/mcp-view-contracts": split.contracts.path,
      "@casys/mcp-view": split.core.path,
      "~": resolve(__dirname),
      "@": resolve(__dirname),
      "react": "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
  build: {
    outDir: resolve(__dirname, "dist", uiName),
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: resolve(__dirname, uiName, "index.html"),
    },
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    minify: true,
  },
});
