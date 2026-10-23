import { assertEquals } from "@std/assert";
import {
  inspectDiagramSvgAttribute,
  inspectDiagramSvgSource,
} from "../src/ui/diagram-viewer/src/sanitize-svg.ts";

Deno.test("diagram SVG admission rejects active and external content", () => {
  assertEquals(
    inspectDiagramSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
    "active-element-forbidden",
  );
  assertEquals(
    inspectDiagramSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><path onclick="run()" /></svg>',
    ),
    "event-handler-forbidden",
  );
  assertEquals(
    inspectDiagramSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/a" /></svg>',
    ),
    "link-forbidden",
  );
});

Deno.test("diagram SVG source preflight accepts passive local geometry", () => {
  assertEquals(
    inspectDiagramSvgSource(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="currentColor" /></svg>',
    ),
    undefined,
  );
});

Deno.test("diagram SVG admission accepts the bounded Graphviz SVG 1.1 preamble", () => {
  const graphviz = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"
 "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <text xml:space="preserve">recorded diagram</text>
</svg>`;
  assertEquals(inspectDiagramSvgSource(graphviz), undefined);
  assertEquals(
    inspectDiagramSvgSource(
      `${graphviz}<!ENTITY payload SYSTEM "https://example.test/payload">`,
    ),
    "xml-declaration-forbidden",
  );
  assertEquals(
    inspectDiagramSvgSource(
      '<!DOCTYPE svg SYSTEM "https://example.test/other.dtd"><svg xmlns="http://www.w3.org/2000/svg"/>',
    ),
    "xml-declaration-forbidden",
  );
});

Deno.test("diagram SVG attributes admit namespaces but no active references", () => {
  assertEquals(
    inspectDiagramSvgAttribute("xmlns", "http://www.w3.org/2000/svg"),
    undefined,
  );
  assertEquals(
    inspectDiagramSvgAttribute(
      "xmlns:xlink",
      "http://www.w3.org/1999/xlink",
    ),
    undefined,
  );
  assertEquals(inspectDiagramSvgAttribute("xml:space", "preserve"), undefined);
  assertEquals(
    inspectDiagramSvgAttribute("xmlns:xlink", "https://example.test/ns"),
    "invalid-namespace",
  );
  assertEquals(
    inspectDiagramSvgAttribute("fill", "url(https://example.test/fill)"),
    "external-reference:fill",
  );
});

Deno.test("diagram semantic group metadata is passive and narrowly admitted", () => {
  for (
    const name of [
      "data-node-id",
      "data-edge-id",
      "data-target-object-id",
      "data-label",
    ]
  ) {
    assertEquals(inspectDiagramSvgAttribute(name, "local-element"), undefined);
  }
  assertEquals(
    inspectDiagramSvgAttribute("data-action", "execute"),
    "unsupported-attribute:data-action",
  );
  assertEquals(
    inspectDiagramSvgAttribute("data-target-object-id", "javascript:execute"),
    "external-reference:data-target-object-id",
  );
});
