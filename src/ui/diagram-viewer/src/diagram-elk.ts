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
  connectedComponents,
  type DiagramModel,
  type DiagramScene,
  FONTS,
  layoutBlockContent,
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

const ELK_SIDES = {
  west: "WEST",
  east: "EAST",
  north: "NORTH",
  south: "SOUTH",
} as const;

export { connectedComponents };

/**
 * The ELK input: block sizes from our own content measurement, ports on
 * fixed sides with their outside labels, and one compound node per
 * connected component. Self-loops stay out (routed locally).
 */
export function elkGraph(
  model: DiagramModel,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  measure: TextMeasure,
): ElkNode {
  const linked = model.edges.filter((edge) =>
    edge.sourceBlock !== edge.targetBlock
  );
  const components = connectedComponents(
    model.blocks.map((block) => block.id),
    linked.map((edge) => [edge.sourceBlock, edge.targetBlock] as const),
  );
  const byId = new Map(model.blocks.map((block) => [block.id, block]));
  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });
  const node = (id: string): ElkNode => {
    const block = byId.get(id)!;
    const size = sizes.get(id) ?? { width: BLOCK.minWidth, height: 60 };
    return {
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
  };
  return {
    id: "syson-diagram",
    layoutOptions: { ...ELK_ROOT_OPTIONS },
    children: components.map((component, index) => ({
      id: `syson-component-${index}`,
      layoutOptions: { ...ELK_COMPONENT_OPTIONS },
      children: component.map(node),
      edges: linked.filter((edge) =>
        componentOf.get(edge.sourceBlock) === index
      ).map((edge) => ({
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
      })),
    })),
  };
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
    return {
      block,
      rect,
      content: layoutBlockContent(block, rect.width, undefined, measure),
      ports,
    };
  });
  const routed: SceneEdge[] = [];
  const local = [];
  for (const edge of model.edges) {
    const section = edges.get(edge.id)?.sections?.[0];
    if (!section) {
      local.push(edge);
      continue;
    }
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((point) => ({ x: point.x, y: point.y }));
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
