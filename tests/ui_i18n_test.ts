import { assertEquals } from "@std/assert";
import {
  compareText,
  formatHostDateTime,
  formatHostNumber,
  presentationLocale,
  SYSON_MESSAGES_EN,
  SYSON_MESSAGES_FR,
} from "../src/ui/shared/messages.ts";

Deno.test("interface dictionaries cover English and French with the same keys", () => {
  assertEquals(
    Object.keys(SYSON_MESSAGES_FR).sort(),
    Object.keys(SYSON_MESSAGES_EN).sort(),
  );
  assertEquals(SYSON_MESSAGES_EN.authoredRequirements, "Authored requirements");
  assertEquals(SYSON_MESSAGES_FR.authoredRequirements, "Exigences rédigées");
  assertEquals(SYSON_MESSAGES_EN.zoomIn, "Zoom in");
  assertEquals(SYSON_MESSAGES_FR.zoomIn, "Zoom avant");
  assertEquals(SYSON_MESSAGES_EN.filterAll, "all");
  assertEquals(SYSON_MESSAGES_FR.filterAll, "tous");
  assertEquals(SYSON_MESSAGES_EN.noRequirements, "No requirements");
  assertEquals(SYSON_MESSAGES_FR.noRequirements, "Aucune exigence");
  assertEquals(SYSON_MESSAGES_EN.noModeRequirements.includes("{mode}"), true);
  assertEquals(SYSON_MESSAGES_FR.noModeRequirements.includes("{mode}"), true);
  assertEquals(SYSON_MESSAGES_FR.noRequirements.includes("all"), false);
  assertEquals(SYSON_MESSAGES_EN.sessionRejected.includes("{view}"), true);
  assertEquals(
    Object.prototype.hasOwnProperty.call(SYSON_MESSAGES_EN, "linked"),
    false,
  );
  assertEquals(
    Object.prototype.hasOwnProperty.call(SYSON_MESSAGES_FR, "unresolved"),
    false,
  );
});

Deno.test("missing and invalid locales fall back to English without throwing", () => {
  assertEquals(presentationLocale(undefined), "en");
  assertEquals(presentationLocale(""), "en");
  assertEquals(presentationLocale("not a locale"), "en");
  assertEquals(presentationLocale("!!!"), "en");
  assertEquals(presentationLocale("fr-CA"), "fr-CA");

  const english = new Intl.NumberFormat("en").format(1234.5);
  assertEquals(formatHostNumber(1234.5, undefined), english);
  assertEquals(formatHostNumber(1234.5, "not a locale"), english);
  assertEquals(
    formatHostNumber(1234.5, "fr-FR"),
    new Intl.NumberFormat("fr-FR").format(1234.5),
  );
  assertEquals(
    formatHostDateTime("2026-01-02T03:04:05.000Z", "!!!", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }),
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date("2026-01-02T03:04:05.000Z")),
  );
  assertEquals(compareText("b", "a", "not a locale") > 0, true);
});

Deno.test("published kit versions replace local split provenance", async () => {
  const packages = JSON.parse(
    await Deno.readTextFile(new URL("../src/ui/package.json", import.meta.url)),
  );
  const verify = await Deno.readTextFile(
    new URL("../scripts/verify-ui-bundles.ts", import.meta.url),
  );
  const workflow = await Deno.readTextFile(
    new URL("../.github/workflows/publish.yml", import.meta.url),
  );
  const docs = await Deno.readTextFile(
    new URL("../docs/mcp-apps.md", import.meta.url),
  );
  const adapter = await Deno.readTextFile(
    new URL("../src/ui/shared/preact-surface.tsx", import.meta.url),
  );
  const trace = await Deno.readTextFile(
    new URL(
      "../src/ui/requirements-trace-viewer/src/main.tsx",
      import.meta.url,
    ),
  );

  assertEquals(packages.dependencies["@mcpview/view"], "0.11.0");
  assertEquals(packages.dependencies["@mcpview/components"], "0.12.0");
  assertEquals(packages.dependencies["@mcpview/contracts"], "0.2.0");
  assertEquals(verify.includes("local split provenance"), false);
  assertEquals(workflow.includes("MCP_VIEW_MODULE"), false);
  assertEquals(workflow.includes(".deps/mcp-server"), false);
  assertEquals(docs.includes("@mcpview/components@0.12.0"), true);
  assertEquals(
    adapter.includes("documentLanguage: sysonMessages.locale"),
    true,
  );
  assertEquals(adapter.includes("export type SurfaceLabel ="), false);
  assertEquals(adapter.includes("type SurfaceLabel"), true);
  assertEquals(adapter.includes("title: (locale) =>"), true);
  assertEquals(
    adapter.includes('mcpViewMessages(locale)("sessionRejectedTitle")'),
    true,
  );
  assertEquals(
    adapter.includes('sysonMessages(locale)("sessionRejected", { view })'),
    true,
  );
  assertEquals(adapter.includes("mcpViewMessages(host.locale)"), false);
  assertEquals(trace.includes('t("noRequirements")'), true);
  assertEquals(trace.includes('t("noModeRequirements", { mode })'), true);
  assertEquals(trace.includes("Aucune exigence all"), false);
});
