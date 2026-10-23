/** Graphical identities are never promoted into semantic SysML references. */
export interface DiagramMember {
  id: string;
  label?: string;
  targetObjectId?: string;
  type?: string;
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
