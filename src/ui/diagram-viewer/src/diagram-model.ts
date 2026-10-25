/** Graphical identities are never promoted into semantic SysML references. */
export interface DiagramMember {
  id: string;
  label?: string;
  targetObjectId?: string;
  type?: string;
  kind?: string;
  parentId?: string;
  outsideLabels?: string[];
  sourceId?: string;
  targetId?: string;
}
export function semanticDiagramMember<T extends DiagramMember>(
  members: readonly T[],
  graphicalId: string | null,
): T | undefined {
  return members.find((member) =>
    member.id === graphicalId && !!member.targetObjectId?.trim()
  );
}
export function fitDiagram(
  bounds: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  padding = 24,
) {
  if (
    ![
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      viewport.width,
      viewport.height,
    ].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 ||
    viewport.width <= padding * 2 || viewport.height <= padding * 2
  ) return { scale: 1, x: 0, y: 0 };
  const scale = Math.min(
    (viewport.width - padding * 2) / bounds.width,
    (viewport.height - padding * 2) / bounds.height,
    5,
  );
  return {
    scale,
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}
export function toolContent(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") {
    throw new Error("Invalid tool response");
  }
  const value = result as Record<string, unknown>;
  if (value.isError) throw new Error("SysON could not complete the request");
  if (value.structuredContent && typeof value.structuredContent === "object") {
    return value.structuredContent as Record<string, unknown>;
  }
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      if (block?.type === "text") {
        try {
          const parsed = JSON.parse(block.text);
          if (parsed && typeof parsed === "object") return parsed;
        } catch { /* Try another text block. */ }
      }
    }
  }
  throw new Error("Missing structured SysON response");
}

export interface DiagramPoint {
  x: number;
  y: number;
}
export function pointerToDiagram(
  point: DiagramPoint,
  viewport: {
    left: number;
    top: number;
    scrollLeft: number;
    scrollTop: number;
  },
  transform: { x: number; y: number; scale: number },
): DiagramPoint {
  return {
    x: (point.x - viewport.left + viewport.scrollLeft - transform.x) /
      transform.scale,
    y: (point.y - viewport.top + viewport.scrollTop - transform.y) /
      transform.scale,
  };
}
export function rectangleBetween(a: DiagramPoint, b: DiagramPoint) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
export function whollyEnclosed(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
) {
  return [
    outer.x,
    outer.y,
    outer.width,
    outer.height,
    inner.x,
    inner.y,
    inner.width,
    inner.height,
  ].every(Number.isFinite) && inner.width >= 0 && inner.height >= 0 &&
    outer.width > 0 && outer.height > 0 && inner.x >= outer.x &&
    inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}
export function isDrag(a: DiagramPoint, b: DiagramPoint, threshold = 5) {
  return Math.hypot(b.x - a.x, b.y - a.y) >= threshold;
}

export function diagramNavigationAllowed(
  options: {
    recorded: boolean;
    serverTools: boolean;
    editingContextId?: string;
  },
) {
  return !options.recorded && options.serverTools &&
    !!options.editingContextId?.trim();
}

interface SelectableDiagramGroup {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
/** The kit's context states (`data-context-state`): confirmed vs pending intent. */
export type DiagramContextState = "selected" | "adding" | "removing" | "none";
/**
 * Patch selection only; preserve SVG nodes, native focus and double-click
 * targets. `states` (by semantic id) adds the kit's `data-context-state` so
 * pending intent reads differently from confirmed selection.
 */
export function syncDiagramSelection(
  groups: Iterable<SelectableDiagramGroup>,
  members: readonly DiagramMember[],
  confirmedIds: readonly string[],
  states?: ReadonlyMap<string, DiagramContextState>,
) {
  const selected = new Set(confirmedIds);
  for (const group of groups) {
    const member = semanticDiagramMember(
      members,
      group.getAttribute("data-node-id") || group.getAttribute("data-edge-id"),
    );
    if (!member) {
      group.removeAttribute("data-selected");
      group.removeAttribute("aria-pressed");
      group.removeAttribute("data-context-state");
      continue;
    }
    const confirmed = selected.has(member.targetObjectId!);
    group.setAttribute("aria-pressed", String(confirmed));
    group.setAttribute("data-selected", String(confirmed));
    if (states) {
      group.setAttribute(
        "data-context-state",
        states.get(member.targetObjectId!) ?? "none",
      );
    }
  }
}

export interface DiagramRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DiagramTransform {
  scale: number;
  x: number;
  y: number;
}

/** Opening legibility floor (syson-ux-design.md §2, diagram-viewer). */
export const DIAGRAM_OPENING_FLOOR = 0.35;

function finiteRect(rect: DiagramRect | undefined): rect is DiagramRect {
  return !!rect &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width >= 0 && rect.height >= 0;
}

/**
 * One axis of a floored view: center the content when it fits, otherwise
 * follow the focus without scrolling past the content edges.
 */
function followAxis(
  viewport: number,
  start: number,
  size: number,
  focus: number,
  scale: number,
  padding: number,
) {
  const extent = size * scale;
  if (extent + padding * 2 <= viewport) {
    return (viewport - extent) / 2 - start * scale;
  }
  const wanted = viewport / 2 - focus * scale;
  const atStart = padding - start * scale;
  const atEnd = viewport - padding - (start + size) * scale;
  return Math.min(atStart, Math.max(atEnd, wanted));
}

/**
 * Reading-order focus for the opening view: the top-most node, then the
 * left-most among nodes on that row (within `rowTolerance`). Document order
 * says nothing about position: SysON may list a bottom block first. Only
 * the node's top-left corner counts, so a container spanning the whole
 * diagram opens on its header, not on its middle.
 */
export function openingFocus(
  entries: readonly { kind?: string; rect?: DiagramRect }[],
  rowTolerance = 8,
): DiagramRect | undefined {
  let best: DiagramRect | undefined;
  for (const entry of entries) {
    if (entry.kind !== "node" || !finiteRect(entry.rect)) continue;
    const rect = entry.rect;
    if (
      !best || rect.y < best.y - rowTolerance ||
      (Math.abs(rect.y - best.y) <= rowTolerance && rect.x < best.x)
    ) {
      best = rect;
    }
  }
  return best && {
    ...best,
    width: Math.min(best.width, OPENING_CORNER.width),
    height: Math.min(best.height, OPENING_CORNER.height),
  };
}

/** The part of the focus node the opening view frames. */
export const OPENING_CORNER = { width: 360, height: 120 } as const;

/**
 * Opening view: the whole diagram when "fit" stays legible, otherwise the
 * floor scale centered on `focus` (the first primary block), clamped so the
 * view never opens on empty space past the diagram edges. Without a focus the
 * diagram's top-left corner is shown. The explicit Fit control stays
 * `fitDiagram`.
 */
export function openingDiagramView(
  bounds: DiagramRect,
  viewport: { width: number; height: number },
  focus?: DiagramRect,
  floor = DIAGRAM_OPENING_FLOOR,
  padding = 24,
): DiagramTransform & { floored: boolean } {
  const fit = fitDiagram(bounds, viewport, padding);
  if (fit.scale >= floor || !finiteRect(bounds) || !(floor > 0)) {
    return { ...fit, floored: false };
  }
  const target = finiteRect(focus)
    ? focus
    : { x: bounds.x, y: bounds.y, width: 0, height: 0 };
  return {
    scale: floor,
    x: followAxis(
      viewport.width,
      bounds.x,
      bounds.width,
      target.x + target.width / 2,
      floor,
      padding,
    ),
    y: followAxis(
      viewport.height,
      bounds.y,
      bounds.height,
      target.y + target.height / 2,
      floor,
      padding,
    ),
    floored: true,
  };
}

/**
 * Frame one region (zoom to selection): fit it with padding, never past
 * `maxScale` so a single small row is not blown up, centered in the viewport.
 */
export function frameDiagramRegion(
  region: DiagramRect,
  viewport: { width: number; height: number },
  options: { padding?: number; minScale?: number; maxScale?: number } = {},
): DiagramTransform | undefined {
  const { minScale = 0.1, maxScale = 1.5 } = options;
  if (
    !finiteRect(region) || !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) || viewport.width <= 0 ||
    viewport.height <= 0
  ) return undefined;
  const padding = Math.min(
    options.padding ?? 48,
    viewport.width / 4,
    viewport.height / 4,
  );
  const fitWidth = region.width > 0
    ? (viewport.width - padding * 2) / region.width
    : Infinity;
  const fitHeight = region.height > 0
    ? (viewport.height - padding * 2) / region.height
    : Infinity;
  const scale = Math.min(
    Math.max(Math.min(fitWidth, fitHeight), minScale),
    maxScale,
  );
  return {
    scale,
    x: viewport.width / 2 - (region.x + region.width / 2) * scale,
    y: viewport.height / 2 - (region.y + region.height / 2) * scale,
  };
}

export function unionDiagramRects(
  rects: Iterable<DiagramRect>,
): DiagramRect | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) {
    if (!finiteRect(rect)) continue;
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return left === Infinity
    ? undefined
    : { x: left, y: top, width: right - left, height: bottom - top };
}

/** Diagram-space rectangle to canvas pixels under the current pan and zoom. */
export function diagramRectToCanvas(
  rect: DiagramRect,
  transform: DiagramTransform,
): DiagramRect {
  return {
    x: transform.x + rect.x * transform.scale,
    y: transform.y + rect.y * transform.scale,
    width: rect.width * transform.scale,
    height: rect.height * transform.scale,
  };
}

/** The diagram-space area the canvas currently shows (the mini-map viewport). */
export function visibleDiagramRect(
  viewport: { width: number; height: number },
  transform: DiagramTransform,
): DiagramRect {
  return {
    x: -transform.x / transform.scale,
    y: -transform.y / transform.scale,
    width: viewport.width / transform.scale,
    height: viewport.height / transform.scale,
  };
}

/** Keep the zoom and bring one diagram point to the canvas center. */
export function centerDiagramPoint(
  point: DiagramPoint,
  viewport: { width: number; height: number },
  scale: number,
): DiagramTransform {
  return {
    scale,
    x: viewport.width / 2 - point.x * scale,
    y: viewport.height / 2 - point.y * scale,
  };
}

export function rectsIntersect(a: DiagramRect, b: DiagramRect) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Mini-map size: the diagram bounds fitted in a box, aspect preserved. */
export function minimapSize(
  bounds: DiagramRect,
  box: { width: number; height: number },
) {
  if (!finiteRect(bounds) || bounds.width <= 0 || bounds.height <= 0) {
    return undefined;
  }
  const scale = Math.min(box.width / bounds.width, box.height / bounds.height);
  return {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

/** A source label without stereotype guillemets or line breaks, for titles. */
export function plainElementName(label: string | undefined): string {
  const text = label ?? "";
  const plain = text.replace(/«[^»]*»/g, " ").replace(/\s+/g, " ").trim();
  return plain || text.replace(/\s+/g, " ").trim();
}

/**
 * Readable view type from the view definition a diagram's ViewUsage is
 * typed by: "StandardViewDefinitions::ActionFlowView" → "Action Flow View".
 */
export function viewTypeLabel(
  definition: string | undefined,
): string | undefined {
  // SysML quotes unrestricted names: 'Thermal Budget'.
  const name = definition?.split("::").at(-1)?.trim().replace(/^'(.*)'$/, "$1");
  return name ? name.replace(/([a-z0-9])([A-Z])/g, "$1 $2") : undefined;
}

/**
 * Viewer heading (syson-ux-design.md §1.3): the element the diagram shows
 * as the title, else the view's own name; the representation type ("General
 * View") as the eyebrow above it. The type is the title only when nothing
 * names the diagram.
 */
export function diagramHeading(parts: {
  readonly representation?: string;
  readonly name?: string;
  readonly target?: string;
  readonly fallback: string;
}): { readonly eyebrow?: string; readonly title: string } {
  const clean = (value?: string) => value?.replace(/\s+/g, " ").trim() || "";
  const representation = clean(parts.representation);
  const subject = clean(parts.target) || clean(parts.name);
  if (subject) {
    return {
      ...(representation && representation !== subject &&
        { eyebrow: representation }),
      title: subject,
    };
  }
  return { title: representation || clean(parts.fallback) };
}

/** Once a gesture crossed the drag threshold, returning to its origin is still a drag. */
export function dragCrossedThreshold(
  previous: boolean,
  start: DiagramPoint,
  current: DiagramPoint,
) {
  return previous || isDrag(start, current);
}

/**
 * One semantic element, whatever the spelling: SysON may send a compartment's
 * target as `sirius:///<resource>#<id>` while its block says `<id>`.
 */
export function sameDiagramElement(a?: string, b?: string): boolean {
  const key = (value?: string) => {
    const id = value?.trim();
    if (!id) return undefined;
    const hash = id.lastIndexOf("#");
    return hash >= 0 && /^[a-z][a-z0-9+.-]*:/i.test(id)
      ? id.slice(hash + 1)
      : id;
  };
  const left = key(a);
  return left !== undefined && left === key(b);
}

export function selectableDiagramMembers<T extends DiagramMember>(
  nodes: readonly T[],
  edges: readonly T[] = [],
): T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return [...nodes, ...edges].filter((member) => {
    if (!member.targetObjectId?.trim()) return false;
    const parent = member.parentId ? byId.get(member.parentId) : undefined;
    return !(member.kind === "compartment" && parent &&
      sameDiagramElement(member.targetObjectId, parent.targetObjectId));
  });
}
export function uniqueSemanticMembers<T extends DiagramMember>(
  members: readonly T[],
): T[] {
  const unique = new Map<string, T>();
  for (const member of members) {
    if (member.targetObjectId && !unique.has(member.targetObjectId)) {
      unique.set(member.targetObjectId, member);
    }
  }
  return [...unique.values()];
}
export function zoomDiagram(
  scale: number,
  translate: DiagramPoint,
  factor: number,
  anchor: DiagramPoint,
) {
  const next = Math.min(Math.max(scale * factor, 0.1), 5);
  return {
    scale: next,
    x: anchor.x - (anchor.x - translate.x) * next / scale,
    y: anchor.y - (anchor.y - translate.y) * next / scale,
  };
}
export function svgIntrinsicSize(
  viewBox: string | null,
  width: string | null,
  height: string | null,
) {
  const box = viewBox?.trim().split(/[\s,]+/).map(Number);
  if (
    box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
  ) return { width: box[2], height: box[3] };
  const w = Number.parseFloat(width || ""), h = Number.parseFloat(height || "");
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return undefined;
}

/** Source-authored labels win; graphical and semantic IDs remain references, never primary labels. */
export function readableDiagramMembers(
  nodes: readonly DiagramMember[],
  edges: readonly DiagramMember[],
  labels: { element: string; relationship: string },
): (DiagramMember & { label: string })[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const authored = (member: DiagramMember | undefined) =>
    member?.label?.trim() || member?.outsideLabels?.map((label) =>
      label.trim()
    ).filter(Boolean).join(" ") || "";
  const endpoint = (id: string | undefined): string => {
    const visited = new Set<string>();
    const parts: string[] = [];
    let node = id ? byId.get(id) : undefined;
    while (node && !visited.has(node.id)) {
      visited.add(node.id);
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      const decorative = node.kind === "compartment" && parent &&
        sameDiagramElement(node.targetObjectId, parent.targetObjectId);
      const label = authored(node);
      if (label && !decorative) parts.unshift(label);
      node = parent;
    }
    return parts.join(".");
  };
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return selectableDiagramMembers(nodes, edges).map((member) => {
    let label = authored(member);
    if (!label && edgeIds.has(member.id)) {
      const source = endpoint(member.sourceId),
        target = endpoint(member.targetId);
      label = source && target ? `${source} → ${target}` : labels.relationship;
    }
    return { ...member, label: label || labels.element };
  });
}

/** Marquee chooses primary diagram blocks; individual click keeps finer semantic detail. */
export function marqueeDiagramMembers<T extends DiagramMember>(
  members: readonly T[],
): T[] {
  return members.filter((member) =>
    member.kind === "node" && !!member.targetObjectId?.trim()
  );
}

/** A held Space affects new drags; each drag keeps its mode until completion. */
export function createDiagramPanState() {
  let held = false;
  let drag: "select" | "pan" | undefined;
  return {
    press() {
      held = true;
    },
    release() {
      held = false;
    },
    begin(mode: "select" | "pan") {
      drag = held ? "pan" : mode;
      return drag;
    },
    end() {
      drag = undefined;
    },
    reset() {
      held = false;
      drag = undefined;
    },
    effective(mode: "select" | "pan") {
      return drag || (held ? "pan" : mode);
    },
    get held() {
      return held;
    },
  };
}
export function acceptsDiagramSpace(
  key: string,
  editable: boolean,
  insideCanvas: boolean,
) {
  return key === " " && !editable && insideCanvas;
}
