/**
 * Vite config for building a single UI
 *
 * Used by build-all.mjs to build each UI individually.
 * UI_NAME env var specifies which UI to build.
 *
 * Stack: Preact + published MCP View packages
 */

import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiName = process.env.UI_NAME;

if (!uiName) {
  throw new Error("UI_NAME environment variable is required");
}

export default defineConfig({
  plugins: [
    preact(),
    viteSingleFile(),
  ],
  root: resolve(__dirname, uiName),
  resolve: {
    dedupe: [
      "preact",
      "@modelcontextprotocol/ext-apps",
      "@modelcontextprotocol/client",
      "@modelcontextprotocol/core",
    ],
    preserveSymlinks: true,
    alias: {
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
