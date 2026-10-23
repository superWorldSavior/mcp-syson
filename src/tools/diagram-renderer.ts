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
  const nodes = new Map(
    input.map(
      (original) => [original.id, {
        ...original,
        width: Math.max(12, finite(original.width, 180)),
        height: Math.max(12, finite(original.height, 72)),
      }],
    ),
  );
  const children = new Map<string, DiagramNode[]>();
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      children.set(node.parentId, [
        ...(children.get(node.parentId) ?? []),
        node,
      ]);
    }
  }
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
        ...compartments.map((child) => child.width + 32),
      );
      node.height = Math.max(
        node.height,
        44 + compartments.reduce((sum, child) => sum + child.height + 12, 0) +
          16,
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
    let cursor = node.y + 44, portIndex = 0;
    for (const child of children.get(node.id) ?? []) {
      if (child.kind === "port") {
        place(
          child,
          node,
          node.x + node.width - child.width / 2,
          node.y + 44 + portIndex++ * (child.height + 12),
        );
      } else {
        place(child, node, node.x + 16, cursor);
        cursor += child.height + 12;
      }
    }
  };
  const roots = [...nodes.values()].filter((node) =>
    !node.parentId || !nodes.has(node.parentId)
  );
  const columnWidth = Math.max(200, ...roots.map((node) => node.width)) + 60;
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
  const allPoints = [...nodes.values()].flatMap((
    n,
  ) => [{ x: n.x, y: n.y }, { x: n.x + n.width, y: n.y + n.height }]);
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
  const text = (value: string, x: number, y: number, textColor = "#e0e7ff") =>
    value.split("\n").map((line, i) =>
      `<text x="${x}" y="${y + i * 16}" fill="${textColor}" font-size="12">${
        escape(line)
      }</text>`
    ).join("");
  // Only literal native colors are used; URLs and arbitrary CSS never enter SVG.
  const color = (value: string | undefined, fallback: string): string => {
    if (
      !value ||
      !/^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|black|white|transparent|none)$/i
        .test(value)
    ) return fallback;
    if (/^#[0-9a-f]{3,4}$/i.test(value)) {
      return "#" + [...value.slice(1)].map((c) => c + c).join("");
    }
    return value;
  };
  const boxes = [...nodes.values()].map((n) => {
    const fill = color(
      n.style?.background,
      n.kind === "port" ? "#a5b4fc" : "#1e1b4b",
    );
    const stroke = color(n.style?.borderColor, "#818cf8");
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
      } ${n.x},${cy}" fill="#0f0d1a" stroke="#e0e7ff" stroke-width="1.5"/>`;
    } else if (nativeControl === "start") {
      shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width / 2}" ry="${
        n.height / 2
      }" fill="#e0e7ff"/>`;
    } else if (nativeControl === "done") {
      shape = `<ellipse cx="${cx}" cy="${cy}" rx="${n.width * 16 / 36}" ry="${
        n.height * 16 / 36
      }" fill="none" stroke="#e0e7ff" stroke-width="1.5"/><ellipse cx="${cx}" cy="${cy}" rx="${
        n.width * 11 / 36
      }" ry="${n.height * 11 / 36}" fill="#e0e7ff"/>`;
    }
    // Composite normalized alpha colors through the container chain onto
    // the canvas before choosing readable text, including shorthand hex.
    const lineage: DiagramNode[] = [];
    const ancestors = new Set<string>();
    let ancestor: DiagramNode | undefined = n;
    while (ancestor && !ancestors.has(ancestor.id)) {
      ancestors.add(ancestor.id);
      lineage.push(ancestor);
      ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : undefined;
    }
    let rgb = [15, 13, 26];
    for (const layer of lineage.reverse()) {
      const background = color(
        layer.style?.background,
        layer.kind === "port" ? "#a5b4fc" : "#1e1b4b",
      ).toLowerCase();
      const hex = background === "white"
        ? "ffffff"
        : background === "black"
        ? "000000"
        : /^#([0-9a-f]{6}(?:[0-9a-f]{2})?)$/.exec(background)?.[1];
      if (!hex) continue;
      const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      rgb = rgb.map((channel, index) =>
        parseInt(hex.slice(index * 2, index * 2 + 2), 16) * alpha +
        channel * (1 - alpha)
      );
    }
    const light = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150;
    const outside = n.outsideLabels?.filter(Boolean).join("\n") ?? "";
    return `<g ${
      attrs("node", n.id, n.targetObjectId, n.label || outside)
    }><title>${escape(n.label || outside || n.id)}</title>${shape}${
      text(n.label, n.x + 10, n.y + 20, light ? "#141126" : "#e0e7ff")
    }${outside ? text(outside, n.x, n.y + n.height + 16) : ""}</g>`;
  }).join("");
  const links = edges.map((e) => {
    const source = nodes.get(e.sourceId), target = nodes.get(e.targetId);
    const native = e.routingPoints?.filter((p) =>
      Number.isFinite(p.x) && Number.isFinite(p.y)
    );
    let points = native && native.length >= 2 ? native : undefined;
    if (!points && source && target) {
      const start = {
        x: source.x + source.width,
        y: source.y + source.height / 2,
      };
      const end = { x: target.x, y: target.y + target.height / 2 };
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
    }" fill="none" stroke="#a5b4fc" stroke-width="2"/>${
      text(e.label ?? "", middle.x + 5, middle.y - 8)
    }${text(e.beginLabel ?? "", points[0].x + 5, points[0].y - 8)}${
      text(e.endLabel ?? "", points.at(-1)!.x + 5, points.at(-1)!.y - 8)
    }</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="sans-serif"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#0f0d1a"/><text x="${
    minX + 24
  }" y="${minY + 32}" fill="#e0e7ff" font-size="18">${
    escape(label)
  }</text>${boxes}${links}${
    input.length ? "" : text("Empty diagram", 0, 0)
  }</svg>`;
}
