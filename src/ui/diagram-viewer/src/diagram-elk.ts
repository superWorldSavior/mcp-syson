/**
 * Automatic layout with ELK (syson-diagram-design.md §4): the diagram model
 * maps to an ELK JSON graph, and ELK's answer maps back to a scene. Pure;
 * loading and running ELK lives in `elk-runner.ts`.
 *
 * Each connected component is a `layered` (DOWN, orthogonal) sub-graph; the
 * root packs the components and isolated blocks with `rectpacking`, so the
 * islands sit side by side instead of in one long row.
 */
import type { DiagramPoint } from "./diagram-model.ts";
import {
  BLOCK,
  blockContent,
  compartmentSlots,
  connectedComponents,
  type DiagramModel,
  type DiagramScene,
  FONTS,
  isContainer,
  type ModelBlock,
  normalizeScene,
  pointAlong,
  routeSceneEdges,
  type SceneBlock,
  type SceneEdge,
  type ScenePort,
  type TextMeasure,
} from "./diagram-scene.ts";

export interface ElkLabel {
  text: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}
export interface ElkPort {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  labels?: ElkLabel[];
}
export interface ElkEdgeSection {
  startPoint: DiagramPoint;
  endPoint: DiagramPoint;
  bendPoints?: DiagramPoint[];
}
export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  sections?: ElkEdgeSection[];
}
export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  ports?: ElkPort[];
  edges?: ElkEdge[];
}

/** Root: pack the islands; every coordinate in the answer is absolute. */
export const ELK_ROOT_OPTIONS: Readonly<Record<string, string>> = {
  "elk.algorithm": "rectpacking",
  "elk.aspectRatio": "1.6",
  "elk.spacing.nodeNode": "72",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
  "org.eclipse.elk.json.shapeCoords": "ROOT",
  "org.eclipse.elk.json.edgeCoords": "ROOT",
};

/** One connected component: layered, top-down, orthogonal edges. */
export const ELK_COMPONENT_OPTIONS: Readonly<Record<string, string>> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "64",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "10",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "10",
  "elk.separateConnectedComponents": "true",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  // Shorter, straighter edges than the default on SysON views (view1: −9 %
  // edge length, −18 % bends).
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "elk.edgeLabels.placement": "CENTER",
  "elk.padding": "[top=0,left=0,bottom=0,right=0]",
};

/** Blocks keep their ports on the side the model gives them. */
export const ELK_BLOCK_OPTIONS: Readonly<Record<string, string>> = {
  "elk.portConstraints": "FIXED_SIDE",
  "elk.portLabels.placement": "OUTSIDE",
};

/**
 * A container grows around its nested blocks, never below its own content.
 * Its ports stay free: fixed sides on a compound node break the edges that
 * cross its border (ELK returns diagonal sections or throws).
 */
export const ELK_CONTAINER_OPTIONS: Readonly<Record<string, string>> = {
  "elk.portConstraints": "FREE",
  "elk.nodeSize.constraints": "MINIMUM_SIZE",
  "elk.spacing.nodeNode": "32",
  "elk.layered.spacing.nodeNodeBetweenLayers": "48",
};

const ELK_SIDES = {
  west: "WEST",
  east: "EAST",
  north: "NORTH",
  south: "SOUTH",
} as const;

export { connectedComponents };

/** What a container keeps around its nested blocks: header, list sections. */
export function containerPadding(
  block: ModelBlock,
  width: number,
  measure: TextMeasure,
): { top: number; bottom: number } {
  const stacked = compartmentSlots(block, width, measure, () => 0);
  const regions = stacked.slots.filter((slot) => slot.region);
  if (block.shape === "frame" || !regions.length) {
    return {
      top: stacked.headerHeight + BLOCK.regionPad,
      bottom: BLOCK.regionPad,
    };
  }
  const first = regions[0], last = regions.at(-1)!;
  const titled = block.regions.find((region) => region.id === first.id)?.title;
  return {
    top: first.y + (titled ? BLOCK.regionTitle : BLOCK.regionPad),
    bottom: stacked.height - (last.y + last.height) + BLOCK.regionPad,
  };
}

/**
 * The ELK input: block sizes from our own content measurement, ports on
 * fixed sides with their outside labels, and one compound node per
 * connected component of top-level blocks. A container is a compound node
 * whose padding keeps its header and list sections clear; each edge lives
 * in the closest node holding both its ends. Self-loops and edges between a
 * block and a block it contains stay out (routed locally).
 */
export function elkGraph(
  model: DiagramModel,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  measure: TextMeasure,
): ElkNode {
  const byId = new Map(model.blocks.map((block) => [block.id, block]));
  const ancestors = (id: string) => {
    const chain: string[] = [];
    for (
      let block = byId.get(id);
      block?.parent && chain.length < 64;
      block = byId.get(block.parent)
    ) chain.push(block.parent);
    return chain;
  };
  const topOf = (id: string) => ancestors(id).at(-1) ?? id;
  const linked = model.edges.filter((edge) =>
    edge.sourceBlock !== edge.targetBlock &&
    !ancestors(edge.sourceBlock).includes(edge.targetBlock) &&
    !ancestors(edge.targetBlock).includes(edge.sourceBlock)
  );
  const roots = model.blocks.filter((block) => !block.parent);
  const components = connectedComponents(
    roots.map((block) => block.id),
    linked.map((edge) =>
      [topOf(edge.sourceBlock), topOf(edge.targetBlock)] as const
    ),
  );
  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });
  /** The closest container holding both ends, else the component. */
  const homeOf = (edge: (typeof linked)[number]) => {
    const up = new Set(ancestors(edge.sourceBlock));
    return ancestors(edge.targetBlock).find((id) => up.has(id));
  };
  const edgesIn = new Map<string, typeof linked>();
  for (const edge of linked) {
    const key = homeOf(edge) ??
      `syson-component-${componentOf.get(topOf(edge.sourceBlock))}`;
    const list = edgesIn.get(key) ?? [];
    list.push(edge);
    edgesIn.set(key, list);
  }
  const elkEdges = (key: string): ElkEdge[] =>
    (edgesIn.get(key) ?? []).map((edge) => ({
      id: edge.id,
      sources: [edge.sourcePort ?? edge.sourceBlock],
      targets: [edge.targetPort ?? edge.targetBlock],
      labels: edge.label
        ? [{
          text: edge.label,
          width: Math.ceil(measure(edge.label, FONTS.edgeLabel) + 12),
          height: 18,
        }]
        : [],
    }));
  const children = new Map<string, ModelBlock[]>();
  for (const block of model.blocks) {
    if (!block.parent) continue;
    const list = children.get(block.parent) ?? [];
    list.push(block);
    children.set(block.parent, list);
  }
  const node = (id: string): ElkNode => {
    const block = byId.get(id)!;
    const size = sizes.get(id) ?? { width: BLOCK.minWidth, height: 60 };
    const elk: ElkNode = {
      id,
      width: size.width,
      height: size.height,
      layoutOptions: { ...ELK_BLOCK_OPTIONS },
      ports: block.ports.map((port) => ({
        id: port.id,
        width: BLOCK.port,
        height: BLOCK.port,
        layoutOptions: { "elk.port.side": ELK_SIDES[port.side] },
        labels: port.label
          ? [{
            text: port.label,
            width: Math.ceil(
              Math.min(BLOCK.portLabelMax, measure(port.label, FONTS.port)),
            ),
            height: 13,
          }]
          : [],
      })),
    };
    const nested = children.get(id);
    if (isContainer(block) && nested?.length) {
      const padding = containerPadding(block, size.width, measure);
      elk.layoutOptions = {
        ...elk.layoutOptions,
        ...ELK_CONTAINER_OPTIONS,
        "elk.padding":
          `[top=${padding.top},left=${BLOCK.regionPad},bottom=${padding.bottom},right=${BLOCK.regionPad}]`,
        "elk.nodeSize.minimum": `(${size.width}, ${size.height})`,
      };
      elk.children = nested.map((child) => node(child.id));
      elk.edges = elkEdges(id);
    }
    return elk;
  };
  return {
    id: "syson-diagram",
    layoutOptions: { ...ELK_ROOT_OPTIONS },
    children: components.map((component, index) => ({
      id: `syson-component-${index}`,
      layoutOptions: { ...ELK_COMPONENT_OPTIONS },
      children: component.map(node),
      edges: elkEdges(`syson-component-${index}`),
    })),
  };
}

/** Every segment horizontal or vertical (within half a pixel). */
export function isOrthogonal(points: readonly DiagramPoint[]): boolean {
  return points.length >= 2 &&
    points.every((point, index) =>
      index === 0 || Math.abs(point.x - points[index - 1].x) < 0.6 ||
      Math.abs(point.y - points[index - 1].y) < 0.6
    );
}

function collect(
  node: ElkNode,
  nodes: Map<string, ElkNode>,
  edges: Map<string, ElkEdge>,
) {
  for (const child of node.children ?? []) {
    nodes.set(child.id, child);
    collect(child, nodes, edges);
  }
  for (const edge of node.edges ?? []) edges.set(edge.id, edge);
}

/** ELK's answer (absolute coordinates) back to a drawable scene. */
export function sceneFromElk(
  model: DiagramModel,
  result: ElkNode,
  measure: TextMeasure,
): DiagramScene {
  const nodes = new Map<string, ElkNode>();
  const edges = new Map<string, ElkEdge>();
  collect(result, nodes, edges);
  const blocks: SceneBlock[] = model.blocks.map((block) => {
    const laid = nodes.get(block.id);
    if (
      !laid || !Number.isFinite(laid.x) || !Number.isFinite(laid.y) ||
      !Number.isFinite(laid.width) || !Number.isFinite(laid.height)
    ) {
      throw new Error(`ELK returned no position for block ${block.id}`);
    }
    const rect = {
      x: laid.x!,
      y: laid.y!,
      width: laid.width!,
      height: laid.height!,
    };
    const laidPorts = new Map(
      (laid.ports ?? []).map((port) => [port.id, port]),
    );
    const ports: ScenePort[] = block.ports.map((port, index) => {
      const answer = laidPorts.get(port.id);
      const placed = answer && Number.isFinite(answer.x) &&
        Number.isFinite(answer.y);
      return {
        id: port.id,
        targetObjectId: port.targetObjectId,
        label: port.label,
        side: port.side,
        direction: port.direction,
        rect: placed
          ? {
            x: answer.x!,
            y: answer.y!,
            width: BLOCK.port,
            height: BLOCK.port,
          }
          : {
            x: port.side === "west"
              ? rect.x - BLOCK.port / 2
              : rect.x + rect.width - BLOCK.port / 2,
            y: rect.y + 30 + index * BLOCK.portGap,
            width: BLOCK.port,
            height: BLOCK.port,
          },
      };
    });
    let slots;
    if (isContainer(block)) {
      // The region takes what ELK gave beyond the padding.
      const stacked = compartmentSlots(block, rect.width, measure, () => 0);
      const regionIndex = stacked.slots.findIndex((slot) => slot.region);
      const extra = rect.height - stacked.height;
      slots = stacked.slots.map((slot, index) =>
        regionIndex < 0 || index < regionIndex
          ? slot
          : index === regionIndex
          ? { ...slot, height: slot.height + extra }
          : { ...slot, y: slot.y + extra }
      );
    }
    return {
      block,
      rect,
      content: blockContent(block, rect, false, measure, slots),
      ports,
    };
  });
  const routed: SceneEdge[] = [];
  const local = [];
  for (const edge of model.edges) {
    const section = edges.get(edge.id)?.sections?.[0];
    const points = section
      ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        .map((point) => ({ x: point.x, y: point.y }))
      : [];
    // A missing or diagonal section is routed here instead.
    if (!section || !isOrthogonal(points)) {
      local.push(edge);
      continue;
    }
    const labels = (edges.get(edge.id)?.labels ?? []).filter((label) =>
      Number.isFinite(label.x) && Number.isFinite(label.y)
    ).map((label) => ({
      text: label.text,
      x: label.x! + label.width / 2,
      y: label.y! + label.height / 2,
    }));
    if (edge.beginLabel) {
      labels.push({ text: edge.beginLabel, ...pointAlong(points, 0.12) });
    }
    if (edge.endLabel) {
      labels.push({ text: edge.endLabel, ...pointAlong(points, 0.88) });
    }
    routed.push({ edge, points, labels });
  }
  // Authored bend points belong to the SysON positions, not to these.
  routed.push(
    ...routeSceneEdges(
      blocks,
      local.map((edge) => ({ ...edge, routing: undefined })),
    ),
  );
  return normalizeScene("auto", blocks, routed, measure);
}
