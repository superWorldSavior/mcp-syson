import { assert, assertEquals } from "@std/assert";
import {
  approximateMeasure,
  BLOCK,
  blockKind,
  buildDiagramModel,
  clientRenderable,
  edgeMarker,
  edgeMarkerShapes,
  ellipsize,
  kindFromKeyword,
  layoutBlockContent,
  levelOfDetail,
  naturalBreak,
  orthogonalConnector,
  parseNodeLabel,
  roundedPath,
  rowText,
  sceneEntries,
  type SnapshotEdge,
  type SnapshotNode,
  sysonScene,
  wrapText,
} from "../src/ui/diagram-viewer/src/diagram-scene.ts";
import {
  sameDiagramElement,
  selectableDiagramMembers,
} from "../src/ui/diagram-viewer/src/diagram-model.ts";

const measure = approximateMeasure;
const width = (text: string) => text.length * 10;

/** A part definition with two titled compartments and one port. */
function snapshot(): { nodes: SnapshotNode[]; edges: SnapshotEdge[] } {
  return {
    nodes: [
      {
        id: "g-vehicle",
        label: "«part def»\nVehicle",
        targetObjectId: "vehicle",
        kind: "node",
        hasLayout: false,
        style: { kind: "RectangularNodeStyle" },
      },
      {
        id: "g-attributes",
        label: "attributes",
        targetObjectId: "vehicle",
        kind: "compartment",
        parentId: "g-vehicle",
      },
      {
        id: "g-mass",
        label: "mass : Real",
        targetObjectId: "mass",
        kind: "compartment",
        parentId: "g-attributes",
        style: { kind: "IconLabelNodeStyle" },
      },
      {
        id: "g-empty",
        label: "ports",
        targetObjectId: "vehicle",
        kind: "compartment",
        parentId: "g-vehicle",
      },
      {
        id: "g-port",
        label: "",
        outsideLabels: ["power : PowerIP"],
        targetObjectId: "power",
        kind: "port",
        parentId: "g-vehicle",
      },
      {
        id: "g-wheel",
        label: "«part»\nwheels[4] : Wheel",
        targetObjectId: "wheels",
        kind: "node",
        hasLayout: false,
      },
    ],
    edges: [{
      id: "g-edge",
      sourceId: "g-vehicle",
      targetId: "g-wheel",
      targetObjectId: "membership",
      type: "edge:straight",
    }],
  };
}

Deno.test("level of detail switches at 0.6 and 0.3", () => {
  assertEquals(levelOfDetail(1.5), "full");
  assertEquals(levelOfDetail(0.6), "full");
  assertEquals(levelOfDetail(0.5999), "header");
  assertEquals(levelOfDetail(0.35), "header");
  assertEquals(levelOfDetail(0.3), "header");
  assertEquals(levelOfDetail(0.2999), "tint");
  assertEquals(levelOfDetail(0.05), "tint");
  assertEquals(levelOfDetail(Number.NaN), "full");
});

Deno.test("edge markers follow the type, never invented", () => {
  assertEquals(edgeMarker({ type: "edge:straight" }), "none");
  assertEquals(edgeMarker({}), "none");
  assertEquals(edgeMarker({ type: "Subclassification" }), "specialization");
  assertEquals(edgeMarker({ type: "edge:Specialization" }), "specialization");
  assertEquals(edgeMarker({ type: "ReferenceSubsetting" }), "specialization");
  assertEquals(edgeMarker({ type: "FeatureTyping" }), "dependency");
  assertEquals(edgeMarker({ type: "SatisfyRequirementUsage" }), "dependency");
  assertEquals(edgeMarker({ type: "Dependency" }), "dependency");
  assertEquals(edgeMarker({ type: "FeatureMembership" }), "composition");
  assertEquals(edgeMarker({ type: "OwningMembership" }), "composition");
  assertEquals(edgeMarker({ type: "ConnectionUsage" }), "flow");
  assertEquals(edgeMarker({ type: "FlowConnectionUsage" }), "flow");
  // A rendering-only type defers to an authored «keyword» in the label.
  assertEquals(
    edgeMarker({ type: "edge:straight", label: "«satisfy»" }),
    "dependency",
  );
  assertEquals(
    edgeMarker({ type: "edge:straight", label: "wheels" }),
    "none",
  );
});

Deno.test("edge marker shapes sit on the right end", () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
  assertEquals(edgeMarkerShapes("none", points, 8), []);
  const [triangle] = edgeMarkerShapes("specialization", points, 8);
  assertEquals(triangle.fill, "panel");
  assert(triangle.d.startsWith("M0 100"));
  const [diamond] = edgeMarkerShapes("composition", points, 8);
  assertEquals(diamond.fill, "line");
  assert(diamond.d.startsWith("M0 0"), "diamond on the owner (source) side");
  assertEquals(edgeMarkerShapes("dependency", points, 8)[0].fill, "none");
  assertEquals(edgeMarkerShapes("flow", points, 8)[0].fill, "line");
});

Deno.test("the server SVG stays the fallback for what the client cannot draw", () => {
  assertEquals(clientRenderable(snapshot()), true);
  assertEquals(clientRenderable({ nodes: [], edges: [] }), false);
  assertEquals(clientRenderable({ edges: [] }), false);
  assertEquals(clientRenderable({ nodes: "x" }), false);
  assertEquals(
    clientRenderable({ nodes: [{ id: "a", label: "A" }], edges: "x" }),
    false,
  );
  assertEquals(
    clientRenderable({
      nodes: [{ id: "a", label: "A", style: { kind: "FutureNodeStyle" } }],
      edges: [],
    }),
    false,
  );
  assertEquals(clientRenderable({ nodes: [{ label: "no id" }] }), false);
  // Every node has a missing parent: still drawable (orphans become blocks).
  assertEquals(
    clientRenderable({ nodes: [{ id: "a", label: "A", parentId: "gone" }] }),
    true,
  );
});

Deno.test("labels split stereotypes from the name; the last keyword names the kind", () => {
  assertEquals(parseNodeLabel("«variation»\n«part def»\nEngineChoices"), {
    stereotypes: ["variation", "part def"],
    name: "EngineChoices",
  });
  assertEquals(parseNodeLabel("", ["driver : Batman"]), {
    stereotypes: [],
    name: "driver : Batman",
  });
  assertEquals(kindFromKeyword("part def"), "PartDefinition");
  assertEquals(kindFromKeyword("perform action"), "PerformActionUsage");
  assertEquals(kindFromKeyword("use case def"), "UseCaseDefinition");
  assertEquals(kindFromKeyword(""), undefined);
  assertEquals(blockKind(["variation", "part def"]), {
    kind: "PartDefinition",
    qualifiers: ["variation"],
  });
  assertEquals(blockKind(["timeslice", "occurrence"]), {
    kind: "OccurrenceUsage",
    qualifiers: ["timeslice"],
  });
  assertEquals(
    blockKind([], {
      kind: "ImageNodeStyle",
      imageURL: "/api/images/images/actor.svg",
    }),
    { kind: "ActorUsage", qualifiers: [] },
  );
  assertEquals(blockKind([]), { kind: undefined, qualifiers: [] });
  assertEquals(
    rowText("* Reduce the parts\n         * to special suppliers."),
    "Reduce the parts to special suppliers.",
  );
  assertEquals(rowText("mass : Real"), "mass : Real");
});

Deno.test("the model keeps blocks, non-empty sections, rows and ports", () => {
  const { nodes, edges } = snapshot();
  const model = buildDiagramModel(nodes, edges);
  assertEquals(model.blocks.map((block) => block.id), ["g-vehicle", "g-wheel"]);
  const [vehicle, wheel] = model.blocks;
  assertEquals(vehicle.name, "Vehicle");
  assertEquals(vehicle.marker, "PART");
  assertEquals(vehicle.tone, "structure");
  assertEquals(vehicle.definition, true);
  assertEquals(wheel.definition, false);
  // The empty "ports" compartment is not drawn.
  assertEquals(vehicle.sections.map((section) => section.title), [
    "attributes",
  ]);
  assertEquals(vehicle.sections[0].rows, [{
    id: "g-mass",
    targetObjectId: "mass",
    text: "mass : Real",
    title: "mass : Real",
  }]);
  assertEquals(vehicle.ports.map((port) => [port.id, port.label, port.side]), [
    ["g-port", "power : PowerIP", "east"],
  ]);
  assertEquals(vehicle.rowCount, 1);
  assertEquals(
    model.edges.map((edge) => [edge.sourceBlock, edge.targetBlock]),
    [
      ["g-vehicle", "g-wheel"],
    ],
  );
  assertEquals(model.edges[0].marker, "none");
});

Deno.test("edges to rows and ports resolve to their drawn block", () => {
  const { nodes } = snapshot();
  const model = buildDiagramModel(nodes, [
    { id: "to-row", sourceId: "g-wheel", targetId: "g-mass" },
    { id: "to-port", sourceId: "g-port", targetId: "g-wheel" },
    { id: "dangling", sourceId: "g-wheel", targetId: "missing" },
  ]);
  assertEquals(model.edges.map((edge) => edge.id), ["to-row", "to-port"]);
  assertEquals(model.edges[0].targetBlock, "g-vehicle");
  assertEquals(model.edges[0].targetRow, "g-mass");
  assertEquals(model.edges[1].sourcePort, "g-port");
  // A port with only incoming edges sits on the west side.
  const incoming = buildDiagramModel(nodes, [
    { id: "in", sourceId: "g-wheel", targetId: "g-port" },
  ]);
  assertEquals(incoming.blocks[0].ports[0].side, "west");
});

Deno.test("authored geometry is absolute; children are relative to parents", () => {
  const model = buildDiagramModel([
    {
      id: "a",
      label: "«part»\na",
      kind: "node",
      x: 100,
      y: 50,
      width: 200,
      height: 120,
    },
    {
      id: "p",
      label: "p",
      kind: "port",
      parentId: "a",
      x: 195,
      y: 40,
      width: 10,
      height: 10,
    },
  ], []);
  assertEquals(model.blocks[0].authored, {
    x: 100,
    y: 50,
    width: 200,
    height: 120,
  });
  assertEquals(model.blocks[0].ports[0].authored, {
    x: 295,
    y: 90,
    width: 10,
    height: 10,
  });
  assertEquals(model.blocks[0].ports[0].side, "east");
});

Deno.test("text fits by words, then characters, with an ellipsis", () => {
  assertEquals(wrapText("alpha beta gamma", 100, 2, width), [
    "alpha beta",
    "gamma",
  ]);
  assertEquals(wrapText("alpha beta gamma delta", 100, 2, width), [
    "alpha beta",
    "gamma del…",
  ]);
  assertEquals(wrapText("abcdefghijkl", 50, 3, width), [
    "abcde",
    "fghij",
    "kl",
  ]);
  // A narrower first line (the pill shares it).
  assertEquals(wrapText("alpha beta", 200, 2, width, 60), ["alpha", "beta"]);
  assertEquals(wrapText("", 100, 2, width), []);
  assertEquals(wrapText("alpha", 100, 0, width), []);
  assertEquals(ellipsize("short", 100, width), "short");
  assertEquals(ellipsize("much too long", 60, width), "much…");
});

Deno.test("compartments show six rows, then +N more", () => {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    id: `r${index}`,
    label: `row ${index}`,
    targetObjectId: `t${index}`,
    kind: "compartment",
    parentId: "parts",
  }));
  const model = buildDiagramModel([
    { id: "b", label: "«part def»\nB", targetObjectId: "b", kind: "node" },
    {
      id: "parts",
      label: "parts",
      targetObjectId: "b",
      kind: "compartment",
      parentId: "b",
    },
    ...rows,
  ], []);
  const content = layoutBlockContent(model.blocks[0], 240, undefined, measure);
  const [section] = content.sections;
  assertEquals(section.rows.length, BLOCK.maxRows);
  assertEquals(section.more?.count, 3);
  // An authored height that holds two lines: one row, then "+8 more".
  const tight = layoutBlockContent(
    model.blocks[0],
    240,
    content.headerHeight + BLOCK.sectionTitle + BLOCK.row * 2 + BLOCK.bottom,
    measure,
  );
  assertEquals(tight.sections[0].rows.length, 1);
  assertEquals(tight.sections[0].more?.count, 8);
});

Deno.test("SysON layout keeps authored positions and grids the rest without overlap", () => {
  const nodes: SnapshotNode[] = Array.from({ length: 10 }, (_, index) => ({
    id: `n${index}`,
    label: `«part»\npart${index}`,
    targetObjectId: `t${index}`,
    kind: "node",
    hasLayout: false,
  }));
  const scene = sysonScene(buildDiagramModel(nodes, []), measure);
  const rects = scene.blocks.map((block) => block.rect);
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      assert(
        a.x + a.width <= b.x || b.x + b.width <= a.x ||
          a.y + a.height <= b.y || b.y + b.height <= a.y,
        "blocks never overlap",
      );
    }
  }
  assert(rects.every((rect) => rect.x >= 0 && rect.y >= 0));
  const authored = sysonScene(
    buildDiagramModel([{
      id: "a",
      label: "«part»\na",
      targetObjectId: "a",
      kind: "node",
      x: 500,
      y: 300,
      width: 180,
      height: 90,
    }, {
      id: "b",
      label: "«part»\nb",
      targetObjectId: "b",
      kind: "node",
      x: 900,
      y: 300,
      width: 180,
      height: 90,
    }], []),
    measure,
  );
  // Normalized to the padding, the authored distance is kept.
  assertEquals(authored.blocks[1].rect.x - authored.blocks[0].rect.x, 400);
  assertEquals(authored.blocks[0].rect.width, 180);
});

Deno.test("scene entries expose semantic blocks, rows, ports and edges", () => {
  const { nodes, edges } = snapshot();
  const scene = sysonScene(buildDiagramModel(nodes, edges), measure);
  const entries = sceneEntries(scene);
  assertEquals(
    entries.map((entry) => [entry.id, entry.targetId, entry.kind]),
    [
      ["g-vehicle", "vehicle", "node"],
      ["g-mass", "mass", "compartment"],
      ["g-port", "power", "port"],
      ["g-wheel", "wheels", "node"],
      ["g-edge", "membership", undefined],
    ],
  );
  const edge = scene.edges[0];
  assert(edge.points.length >= 2);
  // Orthogonal segments only.
  for (const [index, point] of edge.points.slice(1).entries()) {
    const previous = edge.points[index];
    assert(point.x === previous.x || point.y === previous.y);
  }
});

Deno.test("orthogonal connectors and rounded corners", () => {
  assertEquals(
    orthogonalConnector({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 100 }, {
      x: 0,
      y: -1,
    }),
    [{ x: 0, y: 0 }, { x: 0, y: 100 }],
  );
  assertEquals(
    orthogonalConnector({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 80, y: 100 }, {
      x: 0,
      y: -1,
    }),
    [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 50 }, { x: 80, y: 100 }],
  );
  assertEquals(
    roundedPath([{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 80, y: 50 }], 6),
    "M0 0 L0 44 Q0 50 6 50 L80 50",
  );
  assertEquals(roundedPath([{ x: 0, y: 0 }]), "");
});

Deno.test("long identifiers break at camelCase or punctuation", () => {
  assertEquals(naturalBreak("PowerInterface", 11), 5);
  assertEquals(naturalBreak("batmobileDesignV23", 14), 9);
  assertEquals(naturalBreak("Items::Item", 9), 7);
  assertEquals(naturalBreak("abcdefgh", 5), 5);
  assertEquals(wrapText("PowerInterface", 110, 2, width), [
    "Power",
    "Interface",
  ]);
});

Deno.test("compartments addressed by a sirius URI still belong to their block", () => {
  assertEquals(
    sameDiagramElement("sirius:///resource-id#seat", "seat"),
    true,
  );
  assertEquals(sameDiagramElement("seat", "seat"), true);
  assertEquals(sameDiagramElement("seat", "wheel"), false);
  assertEquals(sameDiagramElement(undefined, undefined), false);
  assertEquals(sameDiagramElement("a#b", "b"), false);
  const model = buildDiagramModel([
    { id: "b", label: "«part»\nseat", targetObjectId: "seat", kind: "node" },
    {
      id: "doc",
      label: "doc",
      targetObjectId: "sirius:///resource-id#seat",
      kind: "compartment",
      parentId: "b",
    },
  ], []);
  assertEquals(model.blocks[0].sections, []);
  assertEquals(model.blocks[0].rowCount, 0);
  assertEquals(
    selectableDiagramMembers([
      { id: "b", targetObjectId: "seat", kind: "node" },
      {
        id: "doc",
        targetObjectId: "sirius:///resource-id#seat",
        kind: "compartment",
        parentId: "b",
      },
    ]).map((member) => member.id),
    ["b"],
  );
});

Deno.test("connections inside one block keep the server SVG", () => {
  const nodes: SnapshotNode[] = [
    { id: "car", label: "«part»\ncar", targetObjectId: "car", kind: "node" },
    {
      id: "parts",
      label: "parts",
      targetObjectId: "car",
      kind: "compartment",
      parentId: "car",
    },
    {
      id: "engine",
      label: "engine",
      targetObjectId: "engine",
      kind: "compartment",
      parentId: "parts",
    },
    {
      id: "wheel",
      label: "wheel",
      targetObjectId: "wheel",
      kind: "compartment",
      parentId: "parts",
    },
    { id: "other", label: "«part»\nother", kind: "node" },
  ];
  assertEquals(
    clientRenderable({
      nodes,
      edges: [{ id: "e", sourceId: "engine", targetId: "wheel" }],
    }),
    false,
  );
  assertEquals(
    clientRenderable({
      nodes,
      edges: [{ id: "e", sourceId: "engine", targetId: "other" }],
    }),
    true,
  );
});

Deno.test("aligned anchors facing away detour around, black ellipses start", () => {
  const route = orthogonalConnector({ x: 0, y: 0 }, { x: 1, y: 0 }, {
    x: -100,
    y: 0,
  }, { x: 1, y: 0 });
  assert(route.some((point) => point.y !== 0), "never straight through");
  const model = buildDiagramModel([{
    id: "initial",
    label: "",
    kind: "node",
    style: { kind: "EllipseNodeStyle", background: "black" },
  }, {
    id: "fork",
    label: "",
    kind: "node",
    style: { kind: "RectangularNodeStyle", background: "#000000" },
  }], []);
  assertEquals(model.blocks.map((block) => block.shape), ["start", "bar"]);
});
