import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  connectedComponents,
  ELK_BLOCK_OPTIONS,
  ELK_COMPONENT_OPTIONS,
  ELK_ROOT_OPTIONS,
  elkGraph,
  type ElkNode,
  sceneFromElk,
} from "../src/ui/diagram-viewer/src/diagram-elk.ts";
import {
  approximateMeasure,
  buildDiagramModel,
  type SnapshotNode,
} from "../src/ui/diagram-viewer/src/diagram-scene.ts";

const measure = approximateMeasure;

function block(id: string, extra: Partial<SnapshotNode> = {}): SnapshotNode {
  return {
    id,
    label: `«part»\n${id}`,
    targetObjectId: `t-${id}`,
    kind: "node",
    hasLayout: false,
    ...extra,
  };
}

function model() {
  return buildDiagramModel([
    block("a"),
    {
      id: "a-port",
      label: "",
      outsideLabels: ["out : Power"],
      targetObjectId: "t-port",
      kind: "port",
      parentId: "a",
    },
    block("b"),
    block("c"),
    block("lonely"),
  ], [
    { id: "ab", sourceId: "a-port", targetId: "b", label: "supplies" },
    { id: "bc", sourceId: "b", targetId: "c" },
    { id: "self", sourceId: "c", targetId: "c" },
  ]);
}

const sizes = new Map([
  ["a", { width: 200, height: 80 }],
  ["b", { width: 220, height: 60 }],
  ["c", { width: 180, height: 60 }],
  ["lonely", { width: 200, height: 50 }],
]);

Deno.test("connected components: largest first, model order otherwise", () => {
  assertEquals(
    connectedComponents(["a", "b", "c", "d", "e"], [["d", "e"], ["a", "c"], [
      "c",
      "b",
    ]]),
    [["a", "b", "c"], ["d", "e"]],
  );
  assertEquals(connectedComponents(["x", "y"], [["x", "missing"]]), [
    ["x"],
    ["y"],
  ]);
});

Deno.test("data maps to an ELK graph: layered components packed by rectpacking", () => {
  const graph = elkGraph(model(), sizes, measure);
  assertEquals(graph.layoutOptions, ELK_ROOT_OPTIONS);
  assertEquals(graph.layoutOptions?.["elk.algorithm"], "rectpacking");
  assertEquals(
    graph.layoutOptions?.["org.eclipse.elk.json.edgeCoords"],
    "ROOT",
  );
  assertEquals(graph.children?.length, 2);
  const [main, island] = graph.children!;
  assertEquals(main.layoutOptions, ELK_COMPONENT_OPTIONS);
  assertEquals(main.layoutOptions?.["elk.algorithm"], "layered");
  assertEquals(main.layoutOptions?.["elk.direction"], "DOWN");
  assertEquals(main.layoutOptions?.["elk.edgeRouting"], "ORTHOGONAL");
  assertEquals(
    main.layoutOptions?.["elk.hierarchyHandling"],
    "INCLUDE_CHILDREN",
  );
  assertEquals(main.layoutOptions?.["elk.spacing.nodeNode"], "40");
  assertEquals(
    main.layoutOptions?.["elk.layered.spacing.nodeNodeBetweenLayers"],
    "64",
  );
  assertEquals(main.children?.map((child) => child.id), ["a", "b", "c"]);
  assertEquals(island.children?.map((child) => child.id), ["lonely"]);
  // Sizes come from our measurement; ports keep a fixed side and a label.
  const a = main.children![0];
  assertEquals([a.width, a.height], [200, 80]);
  assertEquals(a.layoutOptions, ELK_BLOCK_OPTIONS);
  assertEquals(a.ports?.map((port) => port.id), ["a-port"]);
  assertEquals(a.ports?.[0].layoutOptions?.["elk.port.side"], "EAST");
  assertEquals(a.ports?.[0].labels?.[0].text, "out : Power");
  // Edges start from the port; self-loops stay out of ELK.
  assertEquals(
    main.edges?.map((edge) => [edge.id, edge.sources, edge.targets]),
    [["ab", ["a-port"], ["b"]], ["bc", ["b"], ["c"]]],
  );
  assertEquals(main.edges?.[0].labels?.[0].text, "supplies");
  assertEquals(island.edges, []);
});

Deno.test("ELK's answer maps back to a normalized scene", () => {
  const result: ElkNode = {
    id: "syson-diagram",
    children: [{
      id: "syson-component-0",
      x: 0,
      y: 0,
      children: [
        {
          id: "a",
          x: 10,
          y: 0,
          width: 200,
          height: 80,
          ports: [{ id: "a-port", x: 205, y: 30, width: 10, height: 10 }],
        },
        { id: "b", x: 0, y: 144, width: 220, height: 60 },
        { id: "c", x: 20, y: 268, width: 180, height: 60 },
      ],
      edges: [{
        id: "ab",
        sources: ["a-port"],
        targets: ["b"],
        labels: [{ text: "supplies", width: 60, height: 18, x: 200, y: 90 }],
        sections: [{
          startPoint: { x: 215, y: 35 },
          bendPoints: [{ x: 230, y: 35 }, { x: 230, y: 120 }, {
            x: 110,
            y: 120,
          }],
          endPoint: { x: 110, y: 144 },
        }],
      }, {
        id: "bc",
        sources: ["b"],
        targets: ["c"],
        sections: [{
          startPoint: { x: 110, y: 204 },
          endPoint: { x: 110, y: 268 },
        }],
      }],
    }, {
      id: "syson-component-1",
      children: [{ id: "lonely", x: 300, y: 0, width: 200, height: 50 }],
    }],
  };
  const scene = sceneFromElk(model(), result, measure);
  assertEquals(scene.mode, "auto");
  const byId = new Map(scene.blocks.map((item) => [item.block.id, item]));
  // Shifted by the same amount: relative positions survive.
  assertEquals(byId.get("b")!.rect.y - byId.get("a")!.rect.y, 144);
  assertEquals(byId.get("lonely")!.rect.x - byId.get("b")!.rect.x, 300);
  assertEquals(byId.get("a")!.ports[0].rect.x - byId.get("a")!.rect.x, 195);
  const ab = scene.edges.find((edge) => edge.edge.id === "ab")!;
  assertEquals(ab.points.length, 5);
  assertEquals(ab.labels[0].text, "supplies");
  // The self-loop missing from ELK is still drawn, locally.
  assert(scene.edges.some((edge) => edge.edge.id === "self"));
  assertThrows(() =>
    sceneFromElk(model(), { id: "syson-diagram", children: [] }, measure)
  );
});
