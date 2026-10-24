import type { DiagramEdge, DiagramNode } from "./diagram.ts";

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}
const finite = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;

/** A semantic topology, not a reproduction of native SysON styling. */
export function renderLocalTopology(
  input: DiagramNode[],
  edges: DiagramEdge[],
  label: string,
): string {
  const originals = new Map(input.map((node) => [node.id, node]));
  const decorative = new Set(
    input.filter((node) =>
      node.kind === "compartment" && node.parentId && node.targetObjectId &&
      node.targetObjectId === originals.get(node.parentId)?.targetObjectId
    ).map((node) => node.id),
  );
  const incident = new Set(
    edges.flatMap((edge) => [edge.sourceId, edge.targetId]),
  );
  const rawChildren = new Map<string, DiagramNode[]>();
  input.forEach((node) => {
    if (node.parentId) {
      rawChildren.set(node.parentId, [
        ...(rawChildren.get(node.parentId) ?? []),
        node,
      ]);
    }
  });
  const hidden = new Set(
    [...decorative].filter((id) =>
      !(rawChildren.get(id)?.length) && !incident.has(id)
    ),
  );
  const rowIds = new Set(
    input.filter((node) =>
      node.kind === "compartment" && node.parentId &&
      decorative.has(node.parentId) && !decorative.has(node.id) &&
      !rawChildren.get(node.id)?.length
    ).map((node) => node.id),
  );
  const nodes = new Map(
    input.filter((node) => !hidden.has(node.id)).map(
      (original) => [original.id, {
        ...original,
        width: Math.max(12, finite(original.width, 180)),
        height: Math.max(12, finite(original.height, 72)),
      }],
    ),
  );
  for (const node of nodes.values()) {
    if (node.hasLayout === false) {
      if (decorative.has(node.id)) {
        node.width = 80;
        node.height = 20;
      } else if (rowIds.has(node.id)) {
        node.width = Math.max(
          100,
          ...node.label.split("\n").map((line) => line.length * 6.8 + 20),
        );
        node.height = Math.max(24, node.label.split("\n").length * 16 + 8);
      }
    }
  }
  const children = new Map<string, DiagramNode[]>();
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      children.set(node.parentId, [
        ...(children.get(node.parentId) ?? []),
        node,
      ]);
    }
  }
  const headerHeight = (node: DiagramNode) =>
    decorative.has(node.id)
      ? 22
      : Math.max(36, node.label.split("\n").length * 16 + 16);
  const visiting = new Set<string>();
  const size = (node: DiagramNode): void => {
    if (visiting.has(node.id)) return;
    visiting.add(node.id);
    const content = children.get(node.id) ?? [];
    content.forEach(size);
    const compartments = content.filter((child) => child.kind !== "port");
    if (node.hasLayout === false && compartments.length) {
      node.width = Math.max(
        node.width,
        ...compartments.map((child) =>
          child.width + (decorative.has(node.id) ? 0 : 24)
        ),
      );
      node.height = Math.max(
        node.height,
        headerHeight(node) + compartments.reduce((sum, child) =>
          sum + child.height + (decorative.has(node.id) ? 2 : 8), 0) +
          8,
      );
    }
    const ports = content.filter((child) => child.kind === "port");
    if (node.hasLayout === false && ports.length) {
      node.height = Math.max(
        node.height,
        headerHeight(node) + 12 + (ports.length - 1) * 24 +
          Math.max(...ports.map((port) => port.height)) + 16,
      );
    }
  };
  nodes.forEach(size);
  const placed = new Set<string>();
  const place = (
    node: DiagramNode,
    parent?: DiagramNode,
    fallbackX = 0,
    fallbackY = 0,
  ): void => {
    if (placed.has(node.id)) return;
    placed.add(node.id);
    if (node.hasLayout !== false) {
      node.x = finite(node.x) + (parent?.x ?? 0);
      node.y = finite(node.y) + (parent?.y ?? 0);
    } else {
      node.x = fallbackX;
      node.y = fallbackY;
    }
    let cursor = node.y + headerHeight(node), portIndex = 0;
    for (const child of children.get(node.id) ?? []) {
      if (child.kind === "port") {
        place(
          child,
          node,
          edges.some((edge) => edge.targetId === child.id) &&
            !edges.some((edge) => edge.sourceId === child.id)
            ? node.x - child.width / 2
            : node.x + node.width - child.width / 2,
          node.y + headerHeight(node) + 12 + portIndex++ * 24,
        );
      } else {
        place(child, node, node.x + (decorative.has(node.id) ? 0 : 12), cursor);
        cursor += child.height + (decorative.has(node.id) ? 2 : 8);
      }
    }
  };
  const rootOf = (id: string): string | undefined => {
    const seen = new Set<string>();
    let node = originals.get(id);
    while (
      node?.parentId && originals.has(node.parentId) && !seen.has(node.id)
    ) {
      seen.add(node.id);
      node = originals.get(node.parentId);
    }
    return node?.id;
  };
  const unorderedRoots = [...nodes.values()].filter((node) =>
    !node.parentId || !nodes.has(node.parentId)
  );
  const rootLinks = edges.map(
    (edge) => [rootOf(edge.sourceId), rootOf(edge.targetId)],
  ).filter(([source, target]) => source && target && source !== target);
  const roots: DiagramNode[] = [];
  const remaining = new Map(unorderedRoots.map((node) => [node.id, node]));
  while (remaining.size) {
    const next = [...remaining.values()].find((node) =>
      !rootLinks.some(([source, target]) =>
        target === node.id && remaining.has(source!)
      )
    ) ?? remaining.values().next().value!;
    roots.push(next);
    remaining.delete(next.id);
  }
  const columnWidth = Math.max(200, ...roots.map((node) => node.width)) + 80;
  let rowY = 0;
  for (let index = 0; index < roots.length; index += 4) {
    const row = roots.slice(index, index + 4);
    row.forEach((node, column) =>
      place(node, undefined, column * columnWidth, rowY)
    );
    rowY += Math.max(...row.map((node) => node.height)) + 60;
  }
  // Malformed cyclic hierarchy cannot make rendering recurse indefinitely.
  nodes.forEach((node) => {
    if (!placed.has(node.id)) place(node, undefined, 0, rowY);
  });
  const portRows = new Map(
    [...nodes.values()].filter((node) =>
      node.kind === "port" && node.targetObjectId
    ).map((port) => [
      port.id,
      [...nodes.values()].find((row) =>
        rowIds.has(row.id) && row.targetObjectId === port.targetObjectId &&
        rootOf(row.id) === rootOf(port.id)
      ),
    ]),
  );
  const allPoints = [...nodes.values()].flatMap((
    n,
  ) => [{ x: n.x, y: n.y }, { x: n.x + n.width, y: n.y + n.height }]);
  for (const node of nodes.values()) {
    const outside = node.outsideLabels?.filter(Boolean).join("\n") ?? "";
    const label = node.kind === "port"
      ? (portRows.get(node.id) ? "" : node.label || outside)
      : outside;
    if (label) {
      allPoints.push({
        x: node.x + (node.kind === "port" ? node.width + 8 : 0) +
          Math.max(...label.split("\n").map((line) => line.length * 7)),
        y: node.y + node.height + label.split("\n").length * 16,
      });
    }
  }
  allPoints.push(
    ...edges.flatMap((e) => e.routingPoints ?? []).filter((p) =>
      Number.isFinite(p.x) && Number.isFinite(p.y)
    ),
  );
  const minX = Math.min(0, ...allPoints.map((p) => p.x)) - 36;
  const minY = Math.min(0, ...allPoints.map((p) => p.y)) - 72;
  const width = Math.max(
    400,
    Math.max(0, ...allPoints.map((p) => p.x)) - minX + 36,
  );
  const height = Math.max(
    160,
    Math.max(0, ...allPoints.map((p) => p.y)) - minY + 36,
  );
  const attrs = (
    kind: string,
    id: string,
    target: string | undefined,
    text: string,
  ) =>
    `data-${kind}-id="${escape(id)}"${
      target ? ` data-target-object-id="${escape(target)}"` : ""
    } data-label="${escape(text)}"`;
  const foreground = "var(--mcp-view-text, currentColor)";
  const muted = "var(--mcp-view-muted, currentColor)";
  const panel = "var(--mcp-view-panel, #ffffff)";
  const border = "var(--mcp-view-border-strong, currentColor)";
  const text = (value: string, x: number, y: number, textColor = foreground) =>
    value
      ? value.split("\n").map((line, index) =>
        `<text x="${x}" y="${
          y + index * 16
        }" fill="${textColor}" font-size="12">${escape(line)}</text>`
      ).join("")
      : "";
  const boxes = [...nodes.values()].map((n) => {
    const outside = n.outsideLabels?.filter(Boolean).join("\n") ?? "";
    const portRow = portRows.get(n.id);
    const accessibleLabel = n.label || outside || portRow?.label || n.id;
    if (decorative.has(n.id)) {
      return `<g><title>${escape(n.label)}</title>${
        text(n.label, n.x + 2, n.y + 14, muted)
      }</g>`;
    }
    if (rowIds.has(n.id)) {
      return `<g ${attrs("node", n.id, n.targetObjectId, n.label)}><title>${
        escape(n.label)
      }</title>${text(n.label, n.x + 6, n.y + 16)}</g>`;
    }
    const nativeBar = (n.style?.kind === "RectangularNodeStyle" ||
      n.style?.kind === "EllipseNodeStyle") &&
      !n.label &&
      (n.style.background === "black" || n.style.background === "#000000" ||
        n.style.background === "#000");
    const fill = n.kind === "port" || nativeBar ? foreground : panel;
    const stroke = border;
    const strokeWidth = Math.max(0, finite(n.style?.borderSize ?? 1, 1));
    const common =
      `fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"`;
    let shape = n.style?.kind === "EllipseNodeStyle"
      ? `<ellipse cx="${n.x + n.width / 2}" cy="${n.y + n.height / 2}" rx="${
        n.width / 2
      }" ry="${n.height / 2}" ${common}/>`
      : `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${
        n.kind === "port"
          ? 0
          : Math.max(0, finite(n.style?.borderRadius ?? 5, 5))
      }" ${common}/>`;
    // Native SysON v2026.7.0 control assets: the matching description
    // providers select these image paths (StartState/DoneState reuse them).
    // Geometry is drawn locally; no image URL is fetched or embedded.
    const nativeControl = n.style?.kind === "ImageNodeStyle"
      ? /(?:^|\/)images\/(decision|merge|start|done)_action\.svg$/.exec(
        n.style.imageURL ?? "",
      )?.[1]
      : undefined;
    const cx = n.x + n.width / 2, cy = n.y + n.height / 2;
    if (nativeControl === "decision" || nativeControl === "merge") {
      shape = `<polygon points="${cx},${n.y} ${n.x + n.width},${cy} ${cx},${
        n.y + n.height
      } ${n.x},${cy}" fill="${panel}" stroke="${foreground}" stroke-width="1.5"/>`;
    } else if (nativeControl === "start") {
      shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width / 2}" ry="${
        n.height / 2
      }" fill="${foreground}"/>`;
    } else if (nativeControl === "done") {
      shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width * 16 / 36}" ry="${
        n.height * 16 / 36
      }" fill="none" stroke="${foreground}" stroke-width="1.5"/><ellipse cx="${cx}" cy="${cy}" rx="${
        n.width * 11 / 36
      }" ry="${n.height * 11 / 36}" fill="${foreground}"/>`;
    }
    return `<g ${
      attrs("node", n.id, n.targetObjectId, accessibleLabel)
    }><title>${escape(accessibleLabel)}</title>${shape}${
      n.kind === "port"
        ? (portRow
          ? ""
          : text(n.label || outside, n.x + n.width + 8, n.y - 6, foreground))
        : text(n.label, n.x + 10, n.y + 20, foreground)
    }${
      n.kind !== "port" && outside
        ? text(outside, n.x, n.y + n.height + 16)
        : ""
    }</g>`;
  }).join("");
  const links = edges.map((e) => {
    const source = nodes.get(e.sourceId), target = nodes.get(e.targetId);
    const native = e.routingPoints?.filter((p) =>
      Number.isFinite(p.x) && Number.isFinite(p.y)
    );
    let points = native && native.length >= 2 ? native : undefined;
    if (!points && source && target) {
      const start = {
        x: source.x +
          (source.kind === "port" ? source.width / 2 : source.width),
        y: source.y + source.height / 2,
      };
      const end = {
        x: target.x + (target.kind === "port" ? target.width / 2 : 0),
        y: target.y + target.height / 2,
      };
      const middle = (start.x + end.x) / 2;
      points = [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end];
    }
    if (!points) {
      return `<g ${
        attrs("edge", e.id, e.targetObjectId, e.label ?? "")
      }><title>${
        escape(e.label || e.id)
      } (endpoint layout unavailable)</title></g>`;
    }
    const middle = points[Math.floor(points.length / 2)];
    return `<g ${attrs("edge", e.id, e.targetObjectId, e.label ?? "")}><title>${
      escape(e.label || e.id)
    }</title><polyline points="${
      points.map((p) => `${p.x},${p.y}`).join(" ")
    }" fill="none" stroke="${muted}" stroke-width="2"/>${
      text(e.label ?? "", middle.x + 5, middle.y - 8)
    }${text(e.beginLabel ?? "", points[0].x + 5, points[0].y - 8)}${
      text(e.endLabel ?? "", points.at(-1)!.x + 5, points.at(-1)!.y - 8)
    }</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="sans-serif"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${panel}"/><text x="${
    minX + 24
  }" y="${minY + 32}" fill="${foreground}" font-size="18">${
    escape(label)
  }</text>${boxes}${links}${
    input.length ? "" : text("Empty diagram", 0, 0)
  }</svg>`;
}
