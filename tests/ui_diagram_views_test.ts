/**
 * The three SysON view types beyond the General View, drawn by the client
 * from recorded snapshots (tests/fixtures/diagram-views): nested blocks in
 * free-form regions, view frames, control nodes, parameter ports, SysON's
 * own edge notation, routing and label placement, nested Auto layout.
 */
import { assert, assertEquals } from "@std/assert";
import {
  anchorToward,
  approximateMeasure,
  buildDiagramModel,
  clientRenderable,
  type DiagramModel,
  edgeDecoration,
  edgeDecorationShapes,
  isContainer,
  type ModelBlock,
  orthogonalize,
  placeEdgeLabels,
  preferredBlockSize,
  type SceneBlock,
  type ScenePort,
  type SnapshotEdge,
  type SnapshotNode,
  stackPortLabels,
  sysonScene,
} from "../src/ui/diagram-viewer/src/diagram-scene.ts";
import {
  containerPadding,
  ELK_CONTAINER_OPTIONS,
  elkGraph,
  type ElkNode,
  isOrthogonal,
  sceneFromElk,
} from "../src/ui/diagram-viewer/src/diagram-elk.ts";
import { isDiagramSnapshot } from "../src/ui/shared/recorded-content.ts";

const measure = approximateMeasure;

type Fixture = {
  diagramId: string;
  diagramLabel: string;
  nodeCount: number;
  edgeCount: number;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
};

async function fixture(name: string): Promise<Fixture> {
  return JSON.parse(
    await Deno.readTextFile(
      new URL(`./fixtures/diagram-views/${name}.json`, import.meta.url),
    ),
  );
}

async function model(name: string): Promise<DiagramModel> {
  const data = await fixture(name);
  return buildDiagramModel(data.nodes, data.edges);
}

const named = (model: DiagramModel, name: string): ModelBlock => {
  const block = model.blocks.find((item) => item.name === name);
  assert(block, `block ${name}`);
  return block;
};

const inside = (
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) =>
  inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;

Deno.test("the three views are drawn by the client, not the server SVG", async () => {
  for (const name of ["interconnection", "action-flow", "state-transition"]) {
    const data = await fixture(name);
    assertEquals(clientRenderable(data), true, name);
    // The App accepts the snapshot contract with its new fields.
    assertEquals(
      isDiagramSnapshot({ ...data, svg: "<svg/>", renderer: "local" }),
      true,
      name,
    );
  }
});

Deno.test("the snapshot contract rejects malformed edge styles and states", async () => {
  const data = await fixture("action-flow");
  const snapshot = { ...data, svg: "<svg/>", renderer: "local" };
  const edge = data.edges[0];
  const withEdge = (patch: Record<string, unknown>) => ({
    ...snapshot,
    edges: [{ ...edge, ...patch }, ...data.edges.slice(1)],
  });
  assertEquals(isDiagramSnapshot(withEdge({ faded: true })), true);
  assertEquals(isDiagramSnapshot(withEdge({ faded: false })), false);
  assertEquals(
    isDiagramSnapshot(withEdge({ style: { lineStyle: 1 } })),
    false,
  );
  assertEquals(
    isDiagramSnapshot(
      withEdge({
        style: {
          lineStyle: "Dash",
          sourceArrow: "None",
          targetArrow: "InputArrow",
          extra: "x",
        },
      }),
    ),
    false,
  );
  const node = data.nodes[0];
  assertEquals(
    isDiagramSnapshot({
      ...snapshot,
      nodes: [{
        ...node,
        style: { ...node.style, childrenLayout: "grid" },
      }, ...data.nodes.slice(1)],
    }),
    false,
  );
  assertEquals(isDiagramSnapshot({ ...snapshot, hiddenNodeCount: -1 }), false);
  assertEquals(isDiagramSnapshot({ ...snapshot, hiddenNodeCount: 3 }), true);
});

Deno.test("interconnection: a view frame holds the part, the part holds its parts", async () => {
  const view = await model("interconnection");
  const frame = view.blocks[0];
  assertEquals(frame.shape, "frame");
  assertEquals(frame.marker, "VIEW");
  // The standard view type keeps its last segment only.
  assertEquals(frame.name, "view2 : InterconnectionView");
  const drone = named(view, "Drone");
  assertEquals(drone.parent, frame.id);
  assertEquals(drone.depth, 1);
  assertEquals(drone.regions.map((region) => region.title), [
    "interconnection",
  ]);
  const parts = ["battery : Battery", "controller : Controller"].map((name) =>
    named(view, name)
  );
  for (const part of parts) {
    assertEquals(part.parent, drone.id);
    assertEquals(isContainer(part), false);
  }
  assertEquals(drone.regions[0].children.length, 3);
  assertEquals(
    named(view, "controller : Controller").ports.map((port) => port.side),
    ["north", "south", "south", "east"],
  );
  // Connections have no decoration; the item flow has a filled head.
  const decorations = view.edges.map((edge) => edge.decoration.target.shape)
    .sort();
  assertEquals(decorations, ["filledTriangle", "none", "none", "none"]);
});

Deno.test("action flow: control nodes keep their names, parameters their direction", async () => {
  const view = await model("action-flow");
  const fly = view.blocks[0];
  assertEquals(fly.name, "Fly");
  assertEquals(fly.regions.map((region) => region.title), ["action flow"]);
  const shapes = view.blocks.filter((block) => block.parent === fly.id)
    .map((block) => [block.shape, block.caption ?? ""]).sort();
  assertEquals(shapes, [
    ["bar", "forkNode"],
    ["bar", "joinNode"],
    ["card", ""],
    ["card", ""],
    ["card", ""],
    ["card", ""],
    ["card", ""],
    ["decision", "landOrAbort"],
    ["done", ""],
    ["start", ""],
  ]);
  assertEquals(named(view, "takeOff").ports[0].direction, "out");
  assertEquals(named(view, "land").ports[0].direction, "in");
  // Successions: dashed with an open head; the guarded ones keep a label.
  const successions = view.edges.filter((edge) =>
    edge.decoration.line === "dash"
  );
  assertEquals(successions.length, 11);
  assert(successions.every((edge) => edge.decoration.target.shape === "arrow"));
  assertEquals(
    successions.flatMap((edge) => edge.label ? [edge.label] : []).sort(),
    ["[fuelOk]", "[not fuelOk]"],
  );
});

Deno.test("state transition: lists stay rows, nested regions hold nested states", async () => {
  const view = await model("state-transition");
  const modes = named(view, "FlightModes");
  assertEquals(modes.sections.map((section) => section.title), [
    "actions",
    "perform actions",
  ]);
  assertEquals(modes.sections[0].rows.map((row) => row.text), [
    "initialize",
    "entry",
  ]);
  assertEquals(modes.regions.map((region) => region.title), [
    "state transition",
  ]);
  // Compartment order is kept: actions, then the region, then perform actions.
  assertEquals(
    [...modes.sections, ...modes.regions].sort((a, b) => a.order - b.order)
      .map((item) => item.title),
    ["actions", "state transition", "perform actions"],
  );
  const flying = named(view, "flying");
  assertEquals(flying.parent, modes.id);
  assertEquals(isContainer(flying), true);
  assertEquals(named(view, "climbing").parent, flying.id);
  assertEquals(named(view, "climbing").depth, 2);
  assert(
    view.edges.every((edge) =>
      edge.decoration.line === "solid" &&
      edge.decoration.target.shape === "arrow"
    ),
  );
});

Deno.test("SysON layout keeps nested blocks inside their regions", async () => {
  for (const name of ["interconnection", "action-flow", "state-transition"]) {
    const view = await model(name);
    const scene = sysonScene(view, measure);
    const rects = new Map(
      scene.blocks.map((item) => [item.block.id, item.rect]),
    );
    for (const { block, rect } of scene.blocks) {
      if (!block.parent) continue;
      assert(inside(rect, rects.get(block.parent)!), `${name}: ${block.name}`);
    }
    // Containers place their compartments where SysON put them.
    for (const { block, content, rect } of scene.blocks) {
      if (!isContainer(block) || block.shape === "frame") continue;
      for (const section of content.sections) {
        assert(section.height! > 0);
        assert(section.y >= content.headerHeight - 1);
        assert(section.y + section.height! <= rect.height + 1);
      }
    }
  }
});

Deno.test("routed edges are orthogonal from end to end", async () => {
  for (const name of ["interconnection", "action-flow", "state-transition"]) {
    const scene = sysonScene(await model(name), measure);
    for (const { edge, points } of scene.edges) {
      for (let index = 1; index < points.length; index++) {
        const a = points[index - 1], b = points[index];
        assert(
          Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5,
          `${name}: ${edge.id} segment ${index}`,
        );
      }
    }
  }
  const box = { x: 0, y: 0, width: 100, height: 40 };
  assertEquals(anchorToward(box, { x: 30, y: -50 }), {
    point: { x: 30, y: 0 },
    vertical: true,
  });
  assertEquals(anchorToward(box, { x: 200, y: 20 }), {
    point: { x: 100, y: 20 },
    vertical: false,
  });
  assertEquals(
    orthogonalize(
      [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 120, y: 80 }],
      true,
      true,
    ),
    [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 120, y: 80 }],
  );
  // The last elbow makes the final segment enter as asked.
  assertEquals(
    orthogonalize([{ x: 0, y: 0 }, { x: 60, y: 90 }], false, true),
    [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 90 }],
  );
});

Deno.test("SysON arrows map to drawn ends; unknown ones draw nothing", () => {
  const style = (
    sourceArrow: string,
    targetArrow: string,
    lineStyle = "Solid",
  ) =>
    edgeDecoration({ style: { lineStyle, sourceArrow, targetArrow } }, "none");
  assertEquals(style("None", "InputArrow", "Dash"), {
    line: "dash",
    source: { shape: "none", outward: false },
    target: { shape: "arrow", outward: false },
  });
  assertEquals(style("FillDiamond", "None").source.shape, "filledDiamond");
  assertEquals(style("None", "OutputClosedArrow").target, {
    shape: "triangle",
    outward: true,
  });
  assertEquals(
    style("None", "ClosedArrowWith4Dots").target.shape,
    "triangle4Dots",
  );
  assertEquals(style("None", "FutureArrow").target.shape, "none");
  assertEquals(style("None", "None", "Dash_Dot").line, "dashDot");
  // Without SysON's style, the marker read from the type still applies.
  assertEquals(edgeDecoration({}, "composition").source.shape, "filledDiamond");
  const points = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
  const [inward] = edgeDecorationShapes(style("None", "InputArrow"), points, 8);
  assert(inward.d.includes("L0 100"), "the tip touches the target");
  const [outward] = edgeDecorationShapes(
    style("None", "OutputArrow"),
    points,
    8,
  );
  assert(!outward.d.includes("L0 100"), "an outward tip stands off the node");
  assertEquals(
    edgeDecorationShapes(style("None", "CrossedCircle"), points, 8).length,
    2,
  );
});

Deno.test("north and south port labels stack instead of overlapping", () => {
  const port = (id: string, x: number, side: ScenePort["side"]): ScenePort => ({
    id,
    label: "^powerIn : ~PowerPort",
    side,
    rect: { x, y: 0, width: 10, height: 10 },
  });
  const stacked = stackPortLabels([
    port("a", 0, "north"),
    port("b", 20, "north"),
    port("c", 40, "north"),
    port("far", 400, "north"),
    port("d", 20, "south"),
    port("e", 0, "west"),
  ], measure);
  assertEquals(
    stacked.map((item) => [item.id, item.labelRow ?? 0]),
    [["a", 0], ["b", 1], ["c", 2], ["far", 0], ["d", 0], ["e", 0]],
  );
});

Deno.test("center labels move off the blocks they would cover", async () => {
  const view = await model("state-transition");
  const scene = sysonScene(view, measure);
  const leaves = scene.blocks.filter((item) => !isContainer(item.block));
  for (const { labels } of scene.edges) {
    for (const label of labels) {
      if (label.role !== "center") continue;
      const width = measure(label.text, { size: 11 }) + 12;
      const box = { x: label.x - width / 2, y: label.y - 9, width, height: 18 };
      const covered = leaves.filter(({ rect }) =>
        box.x < rect.x + rect.width && rect.x < box.x + box.width &&
        box.y < rect.y + rect.height && rect.y < box.y + box.height
      );
      // SysON's own layout overlaps two states; every other label is clear.
      assert(covered.length <= 1, label.text);
    }
  }
  const block: SceneBlock = {
    ...scene.blocks.find((item) => !isContainer(item.block))!,
    rect: { x: 0, y: 40, width: 100, height: 40 },
    ports: [],
  };
  const [placed] = placeEdgeLabels([block], [{
    edge: view.edges[0],
    points: [{ x: 50, y: 0 }, { x: 50, y: 120 }],
    labels: [{ text: "go", x: 50, y: 60, role: "center" }],
  }], measure);
  const label = placed.labels[0];
  assert(
    label.y < 40 - 9 || label.y > 80 + 9 || label.x - 9 > 100 ||
      label.x + 9 < 0,
  );
});

Deno.test("Auto layout nests containers and keeps edges in their region", async () => {
  const view = await model("state-transition");
  const sizes = new Map(
    view.blocks.map((block) => [block.id, { width: 200, height: 60 }]),
  );
  const graph = elkGraph(view, sizes, measure);
  const component = graph.children![0];
  assertEquals(component.children!.map((child) => child.id), [
    named(view, "FlightModes").id,
  ]);
  const modes = component.children![0];
  assertEquals(
    modes.layoutOptions?.["elk.nodeSize.constraints"],
    ELK_CONTAINER_OPTIONS["elk.nodeSize.constraints"],
  );
  const padding = containerPadding(named(view, "FlightModes"), 200, measure);
  assertEquals(
    modes.layoutOptions?.["elk.padding"],
    `[top=${padding.top},left=16,bottom=${padding.bottom},right=16]`,
  );
  // Top padding clears the header and "actions"; bottom keeps "perform actions".
  assert(padding.top > 60 && padding.bottom > 40);
  const flying = modes.children!.find((child) =>
    child.id === named(view, "flying").id
  )!;
  assertEquals(flying.children!.length, 3);
  // Transitions between FlightModes' states live in FlightModes, the one
  // between climbing and cruising in flying.
  assertEquals(modes.edges!.length, 6);
  assertEquals(flying.edges!.length, 2);
  assertEquals(component.edges, []);

  // ELK's answer: FlightModes grows around its states.
  const answer = structuredClone(graph) as ElkNode;
  let y = 0;
  const place = (node: ElkNode, x0: number, y0: number) => {
    node.x = x0;
    node.y = y0;
    let inner = y0 + 80;
    for (const child of node.children ?? []) {
      place(child, x0 + 16, inner);
      inner += (child.height ?? 60) + 20;
    }
    if (node.children?.length) node.height = inner - y0 + 60;
    node.width ??= 300;
    y = Math.max(y, y0 + (node.height ?? 0));
  };
  place(answer.children![0].children![0], 0, 0);
  const scene = sceneFromElk(view, answer, measure);
  const modesScene = scene.blocks.find((item) =>
    item.block.id === named(view, "FlightModes").id
  )!;
  const region = modesScene.content.regions[0];
  const after = modesScene.content.sections.at(-1)!;
  assertEquals(after.title, "perform actions");
  // The region takes what ELK gave; "perform actions" stays at the bottom.
  assert(region.y + region.height <= after.y + 0.5);
  assertEquals(after.y + after.height!, modesScene.rect.height);
});

Deno.test("recorded snapshots satisfy the advertised server output schema", async () => {
  const { SysonToolsClient } = await import("../src/client.ts");
  const { Ajv } = await import("ajv");
  const schema = new SysonToolsClient().listTools().find((tool) =>
    tool.name === "syson_diagram_snapshot"
  )!.outputSchema!;
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const name of ["interconnection", "action-flow", "state-transition"]) {
    const data = await fixture(name);
    const result = {
      ...data,
      nodes: data.nodes.map((node, index) =>
        index === 1 ? { ...node, faded: true } : node
      ),
      edges: data.edges.map((edge, index) =>
        index === 0 ? { ...edge, faded: true } : edge
      ),
      svg: "<svg/>",
      renderer: "local",
    };
    assertEquals(validate(result), true, JSON.stringify(validate.errors));
  }
});

Deno.test("a placed container grows around nested blocks SysON never placed", async () => {
  const data = await fixture("interconnection");
  const region = data.nodes.find((node) => node.label === "interconnection")!;
  const added = ["probe", "radio", "camera"].map((id): SnapshotNode => ({
    id,
    label: `«part»\n${id} : Sensor`,
    targetObjectId: `t-${id}`,
    kind: "node",
    parentId: region.id,
    hasLayout: false,
    style: { kind: "RectangularNodeStyle", childrenLayout: "list" },
  }));
  const view = buildDiagramModel([...data.nodes, ...added], data.edges);
  const scene = sysonScene(view, measure);
  const rects = new Map(scene.blocks.map((item) => [item.block.id, item]));
  for (const { block, rect } of scene.blocks) {
    if (!block.parent) continue;
    assert(inside(rect, rects.get(block.parent)!.rect), block.name);
  }
  const drone = rects.get(named(view, "Drone").id)!;
  const regionBand = drone.content.regions[0];
  for (const id of ["probe", "radio", "camera"]) {
    const rect = rects.get(id)!.rect;
    assert(
      rect.y + rect.height <= drone.rect.y + regionBand.y + regionBand.height,
    );
  }
});

/** The real elkjs (installed for the viewers), run by Node like a worker. */
const ELK_BUNDLE = new URL(
  "../src/ui/node_modules/elkjs/lib/elk.bundled.js",
  import.meta.url,
).pathname;
const nodeAvailable = await new Deno.Command("node", { args: ["--version"] })
  .output().then((out) => out.success).catch(() => false);
const elkAvailable = nodeAvailable &&
  await Deno.stat(ELK_BUNDLE).then(() => true).catch(() => false);

async function realElk(graph: ElkNode): Promise<ElkNode> {
  const child = new Deno.Command("node", {
    args: [
      "-e",
      `const ELK = require(${JSON.stringify(ELK_BUNDLE)});
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => new ELK().layout(JSON.parse(input))
  .then((out) => process.stdout.write(JSON.stringify(out)))
  .catch((error) => { process.stderr.write(String(error)); process.exit(1); }));`,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(graph)));
  await writer.close();
  const out = await child.output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout));
}

Deno.test({
  name: "real ELK lays out nested views, edges crossing containers included",
  ignore: !elkAvailable,
  async fn() {
    const cases: [string, (data: Fixture) => SnapshotEdge[]][] = [
      ["interconnection", (data) => {
        const battery = data.nodes.find((node) =>
          node.label?.includes("battery")
        )!;
        const port = data.nodes.find((node) => node.parentId === battery.id)!;
        const frame = data.nodes.find((node) => !node.parentId)!;
        return [{ id: "x-port-frame", sourceId: port.id, targetId: frame.id }];
      }],
      ["action-flow", () => []],
      ["state-transition", (data) => {
        const id = (name: string) =>
          data.nodes.find((node) => node.label?.endsWith(`\n${name}`))!.id;
        return [
          { id: "x-exit", sourceId: id("climbing"), targetId: id("landing") },
          { id: "x-entry", sourceId: id("idle"), targetId: id("cruising") },
        ];
      }],
    ];
    for (const [name, extra] of cases) {
      const data = await fixture(name);
      const view = buildDiagramModel(data.nodes, [
        ...data.edges,
        ...extra(data),
      ]);
      const sizes = new Map(
        view.blocks.map((
          block,
        ) => [block.id, preferredBlockSize(block, measure)]),
      );
      const scene = sceneFromElk(
        view,
        await realElk(elkGraph(view, sizes, measure)),
        measure,
      );
      const rects = new Map(
        scene.blocks.map((item) => [item.block.id, item.rect]),
      );
      for (const { block, rect } of scene.blocks) {
        if (block.parent) {
          assert(
            inside(rect, rects.get(block.parent)!),
            `${name}: ${block.name}`,
          );
        }
      }
      for (const { edge, points } of scene.edges) {
        assert(isOrthogonal(points), `${name}: ${edge.id}`);
      }
    }
  },
});
