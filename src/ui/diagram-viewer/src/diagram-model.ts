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
/** Patch confirmed selection only; preserve SVG nodes, native focus and double-click targets. */
export function syncDiagramSelection(
  groups: Iterable<SelectableDiagramGroup>,
  members: readonly DiagramMember[],
  confirmedIds: readonly string[],
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
      continue;
    }
    const confirmed = selected.has(member.targetObjectId!);
    group.setAttribute("aria-pressed", String(confirmed));
    group.setAttribute("data-selected", String(confirmed));
  }
}

/** Once a gesture crossed the drag threshold, returning to its origin is still a drag. */
export function dragCrossedThreshold(
  previous: boolean,
  start: DiagramPoint,
  current: DiagramPoint,
) {
  return previous || isDrag(start, current);
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
      member.targetObjectId === parent.targetObjectId);
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
        node.targetObjectId === parent.targetObjectId;
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
