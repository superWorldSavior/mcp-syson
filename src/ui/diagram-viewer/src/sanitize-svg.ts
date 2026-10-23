/** Strict browser-side admission for SysON diagram snapshots. */

const MAX_SVG_BYTES = 2_000_000;

// Graphviz's SVG writer emits this public SVG 1.1 declaration. It is removed
// before DOMParser sees the source, so the browser never resolves the external
// DTD. Every other DOCTYPE (and every ENTITY declaration) remains forbidden.
const GRAPHVIZ_SVG_1_1_DOCTYPE =
  /<!DOCTYPE\s+svg\s+PUBLIC\s+["']-\/\/W3C\/\/DTD SVG 1\.1\/\/EN["']\s+["']http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd["']\s*>/i;

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "xmlns",
  "xmlns:xlink",
  "xml:space",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "pathLength",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "id",
  "class",
  "role",
  "aria-label",
  "data-node-id",
  "data-edge-id",
  "data-target-object-id",
  "data-label",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "orient",
  "refX",
  "refY",
  "marker-start",
  "marker-mid",
  "marker-end",
  "gradientUnits",
  "gradientTransform",
  "offset",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "mask",
]);

const URL_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "mask",
]);

export type DiagramSvgAdmission =
  | { readonly status: "available"; readonly markup: string }
  | { readonly status: "unavailable"; readonly reason: string };

interface SvgAttributeLike {
  readonly name: string;
  readonly value: string;
}

interface SvgElementLike {
  readonly localName: string;
  readonly namespaceURI: string | null;
  readonly attributes: Iterable<SvgAttributeLike>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelectorAll(selector: string): Iterable<SvgElementLike>;
}

interface SvgDocumentLike {
  readonly documentElement: SvgElementLike;
  querySelector(selector: string): unknown;
}

interface SvgBrowserGlobals {
  readonly DOMParser?: new () => {
    parseFromString(source: string, mimeType: string): SvgDocumentLike;
  };
  readonly XMLSerializer?: new () => {
    serializeToString(node: SvgElementLike): string;
  };
}

/** Cheap fail-closed checks that are also usable in non-DOM unit tests. */
export function inspectDiagramSvgSource(svg: string): string | undefined {
  if (!svg.trim()) return "empty";
  if (new TextEncoder().encode(svg).byteLength > MAX_SVG_BYTES) {
    return "too-large";
  }
  const sourceWithoutSupportedDoctype = svg.replace(
    GRAPHVIZ_SVG_1_1_DOCTYPE,
    "",
  );
  if (/<!\s*(?:doctype|entity)\b/i.test(sourceWithoutSupportedDoctype)) {
    return "xml-declaration-forbidden";
  }
  if (
    /<\s*(?:script|foreignObject|iframe|object|embed|link|meta|style|use)\b/i
      .test(svg)
  ) {
    return "active-element-forbidden";
  }
  if (/\son[a-z0-9:_-]*\s*=/i.test(svg)) return "event-handler-forbidden";
  if (/\s(?:href|xlink:href)\s*=/i.test(svg)) return "link-forbidden";
  return undefined;
}

/**
 * Parse, allowlist and reserialize one recorded SVG before it reaches Preact.
 * Any unsupported construct makes the whole visual unavailable; silently
 * deleting fragments could misrepresent an engineering diagram.
 */
export function sanitizeDiagramSvg(
  svg: string,
  semanticMembers: readonly {
    id: string;
    targetObjectId?: string;
    label?: string;
  }[] = [],
  selectedIds: readonly string[] = [],
): DiagramSvgAdmission {
  const sourceReason = inspectDiagramSvgSource(svg);
  if (sourceReason) return { status: "unavailable", reason: sourceReason };

  const browser = globalThis as unknown as SvgBrowserGlobals;
  if (!browser.DOMParser || !browser.XMLSerializer) {
    return { status: "unavailable", reason: "browser-parser-unavailable" };
  }
  const sourceWithoutSupportedDoctype = svg.replace(
    GRAPHVIZ_SVG_1_1_DOCTYPE,
    "",
  );
  const parsed = new browser.DOMParser().parseFromString(
    sourceWithoutSupportedDoctype,
    "image/svg+xml",
  );
  if (parsed.querySelector("parsererror")) {
    return { status: "unavailable", reason: "invalid-xml" };
  }
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== "http://www.w3.org/2000/svg"
  ) {
    return { status: "unavailable", reason: "invalid-root" };
  }

  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (!ALLOWED_ELEMENTS.has(element.localName)) {
      return {
        status: "unavailable",
        reason: `unsupported-element:${element.localName}`,
      };
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      const value = attribute.value.trim();
      const reason = inspectDiagramSvgAttribute(name, value);
      if (reason) return { status: "unavailable", reason };
    }
  }

  // Annotate the detached admitted document from the snapshot's identity table.
  // SVG-provided labels and semantic IDs never authorize context selection.
  for (const group of root.querySelectorAll("g")) {
    const id = group.getAttribute("data-node-id") ||
      group.getAttribute("data-edge-id");
    const member = semanticMembers.find((member) =>
      member.id === id && !!member.targetObjectId?.trim()
    );
    if (!member) continue;
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", member.label || member.targetObjectId!);
    group.setAttribute(
      "aria-pressed",
      String(selectedIds.includes(member.targetObjectId!)),
    );
    if (selectedIds.includes(member.targetObjectId!)) {
      group.setAttribute("stroke", "#0d7c8a");
      group.setAttribute("stroke-width", "3");
    }
  }

  return {
    status: "available",
    markup: new browser.XMLSerializer().serializeToString(root),
  };
}

/** Attribute admission is exported so the non-DOM security suite covers it. */
export function inspectDiagramSvgAttribute(
  name: string,
  value: string,
): string | undefined {
  if (!ALLOWED_ATTRIBUTES.has(name)) return `unsupported-attribute:${name}`;
  if (
    (name === "xmlns" && value !== "http://www.w3.org/2000/svg") ||
    (name === "xmlns:xlink" && value !== "http://www.w3.org/1999/xlink")
  ) {
    return "invalid-namespace";
  }
  if (name === "xml:space" && value !== "default" && value !== "preserve") {
    return "invalid-xml-space";
  }
  const namespaceDeclaration = name === "xmlns" || name === "xmlns:xlink";
  if (
    !namespaceDeclaration &&
    /\b(?:javascript|vbscript|data|https?):/i.test(value)
  ) {
    return `external-reference:${name}`;
  }
  if (
    URL_ATTRIBUTES.has(name) &&
    /url\s*\(/i.test(value) &&
    !/^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/.test(value)
  ) {
    return `external-url:${name}`;
  }
  return undefined;
}
