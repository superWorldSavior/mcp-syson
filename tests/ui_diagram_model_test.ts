import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  diagramHeading,
  fitDiagram,
  openingFocus,
  semanticDiagramMember,
  toolContent,
} from "../src/ui/diagram-viewer/src/diagram-model.ts";
Deno.test("diagram selection resolves only recorded semantic identity", () => {
  const nodes = [{ id: "graphic", targetObjectId: "semantic", label: "Part" }, {
    id: "graphic-only",
  }];
  assertEquals(
    semanticDiagramMember(nodes, "graphic")?.targetObjectId,
    "semantic",
  );
  assertEquals(semanticDiagramMember(nodes, "graphic-only"), undefined);
  assertEquals(semanticDiagramMember(nodes, "semantic"), undefined);
});
Deno.test("diagram fit accounts for bounds origin, viewport and padding", () => {
  const fit = fitDiagram({ x: 100, y: -40, width: 400, height: 200 }, {
    width: 848,
    height: 448,
  });
  assertAlmostEquals(fit.scale, 2);
  assertAlmostEquals(fit.x, -176);
  assertAlmostEquals(fit.y, 104);
  assertEquals(
    fitDiagram({ x: 0, y: 0, width: 0, height: 0 }, {
      width: 800,
      height: 400,
    }),
    { scale: 1, x: 0, y: 0 },
  );
});
Deno.test("diagram tool response rejects failed or unstructured navigation", () => {
  assertEquals(toolContent({ structuredContent: { representations: [] } }), {
    representations: [],
  });
  assertEquals(
    toolContent({ content: [{ type: "text", text: '{"diagramId":"d"}' }] }),
    { diagramId: "d" },
  );
  assertThrows(() =>
    toolContent({ isError: true, structuredContent: { diagramId: "d" } })
  );
  assertThrows(() =>
    toolContent({ content: [{ type: "text", text: "unavailable" }] })
  );
});

Deno.test("marquee wholly encloses semantic boxes and excludes intersecting parent frames", async () => {
  const { whollyEnclosed, rectangleBetween } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  const box = rectangleBetween({ x: 140, y: 110 }, { x: 80, y: 50 });
  assertEquals(
    whollyEnclosed(box, { x: 90, y: 60, width: 30, height: 40 }),
    true,
  );
  assertEquals(
    whollyEnclosed(box, { x: 0, y: 0, width: 300, height: 300 }),
    false,
  );
  assertEquals(
    whollyEnclosed(box, { x: 130, y: 100, width: 30, height: 20 }),
    false,
  );
  assertEquals(
    whollyEnclosed(box, { x: NaN, y: 60, width: 30, height: 40 }),
    false,
  );
});
Deno.test("marquee pointer conversion honors viewport, scroll, pan and zoom", async () => {
  const { pointerToDiagram, isDrag } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  assertEquals(
    pointerToDiagram({ x: 240, y: 170 }, {
      left: 100,
      top: 50,
      scrollLeft: 20,
      scrollTop: 30,
    }, { x: 40, y: 20, scale: 2 }),
    { x: 60, y: 65 },
  );
  assertEquals(isDrag({ x: 10, y: 10 }, { x: 12, y: 12 }), false);
  assertEquals(isDrag({ x: 10, y: 10 }, { x: 13, y: 14 }), true);
});

Deno.test("recorded diagram navigation never admits live provider calls", async () => {
  const { diagramNavigationAllowed } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  assertEquals(
    diagramNavigationAllowed({
      recorded: true,
      serverTools: true,
      editingContextId: "ec",
    }),
    false,
  );
  assertEquals(
    diagramNavigationAllowed({
      recorded: false,
      serverTools: false,
      editingContextId: "ec",
    }),
    false,
  );
  assertEquals(
    diagramNavigationAllowed({ recorded: false, serverTools: true }),
    false,
  );
  assertEquals(
    diagramNavigationAllowed({
      recorded: false,
      serverTools: true,
      editingContextId: "ec",
    }),
    true,
  );
});

Deno.test("diagram commands translate without changing source labels", async () => {
  const { diagramMessages } = await import(
    "../src/ui/diagram-viewer/src/diagram-messages.ts"
  );
  assertEquals(diagramMessages("fr-FR")("Select"), "Sélectionner");
  assertEquals(diagramMessages("en-US")("Select"), "Select");
  assertEquals(
    diagramMessages("fr")("Unresolved authored type"),
    "Unresolved authored type",
  );
});

Deno.test("SVG confirmed selection patches existing semantic groups without replacing nodes", async () => {
  const { syncDiagramSelection } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  const group = (id: string) => {
    const attributes = new Map<string, string>([["data-node-id", id], [
      "aria-pressed",
      "false",
    ]]);
    return {
      getAttribute: (name: string) => attributes.get(name) || null,
      setAttribute: (name: string, value: string) => {
        attributes.set(name, value);
      },
      removeAttribute: (name: string) => {
        attributes.delete(name);
      },
    };
  };
  const node = group("graphic"),
    graphicOnly = group("graphic-only"),
    edge = group("edge-graphic");
  const groups = [node, graphicOnly, edge];
  const members = [{ id: "graphic", targetObjectId: "semantic" }, {
    id: "graphic-only",
  }, { id: "edge-graphic", targetObjectId: "edge-semantic" }];
  syncDiagramSelection(groups, members, []);
  assertEquals(node.getAttribute("aria-pressed"), "false");
  syncDiagramSelection(groups, members, [
    "semantic",
    "graphic-only",
    "edge-semantic",
  ]);
  assertEquals(groups[0], node);
  assertEquals(node.getAttribute("aria-pressed"), "true");
  assertEquals(node.getAttribute("data-selected"), "true");
  assertEquals(edge.getAttribute("aria-pressed"), "true");
  assertEquals(graphicOnly.getAttribute("data-selected"), null);
  syncDiagramSelection(groups, members, []);
  assertEquals(node.getAttribute("aria-pressed"), "false");
  assertEquals(node.getAttribute("data-selected"), "false");
});

Deno.test("drag threshold stays latched after moving out and returning near origin", async () => {
  const { dragCrossedThreshold } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  const start = { x: 20, y: 20 };
  let dragged = dragCrossedThreshold(false, start, { x: 22, y: 20 });
  assertEquals(dragged, false);
  dragged = dragCrossedThreshold(dragged, start, { x: 40, y: 20 });
  assertEquals(dragged, true);
  dragged = dragCrossedThreshold(dragged, start, { x: 21, y: 20 });
  assertEquals(dragged, true);
  assertEquals(dragCrossedThreshold(dragged, start, start), true);
  assertEquals(dragCrossedThreshold(false, start, start), false);
});

Deno.test("semantic eligibility excludes same-target decorative compartments and preserves real children", async () => {
  const { selectableDiagramMembers, uniqueSemanticMembers } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  const nodes = [
    { id: "part", kind: "node", targetObjectId: "part-semantic" },
    {
      id: "doc",
      kind: "compartment",
      parentId: "part",
      targetObjectId: "part-semantic",
    },
    {
      id: "attribute",
      kind: "compartment",
      parentId: "part",
      targetObjectId: "attribute-semantic",
    },
    {
      id: "port",
      kind: "port",
      parentId: "part",
      targetObjectId: "port-semantic",
    },
    { id: "part-second", kind: "node", targetObjectId: "part-semantic" },
  ];
  const eligible = selectableDiagramMembers(nodes, [{
    id: "edge",
    kind: "edge",
    targetObjectId: "relationship",
  }]);
  assertEquals(eligible.map((node) => node.id), [
    "part",
    "attribute",
    "port",
    "part-second",
    "edge",
  ]);
  assertEquals(uniqueSemanticMembers(eligible).map((node) => node.id), [
    "part",
    "attribute",
    "port",
    "edge",
  ]);
});
Deno.test("intrinsic SVG dimensions prevent a second responsive fit and center zoom stays anchored", async () => {
  const { svgIntrinsicSize, zoomDiagram } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  assertEquals(svgIntrinsicSize("-36 -72 855 1383", "855", "1383"), {
    width: 855,
    height: 1383,
  });
  const fit = fitDiagram({ x: 0, y: 0, width: 855, height: 1383 }, {
    width: 732,
    height: 537,
  });
  assertAlmostEquals(fit.scale, 489 / 1383);
  const zoom = zoomDiagram(0.5, { x: 20, y: 30 }, 2, { x: 300, y: 200 });
  assertEquals(zoom, { scale: 1, x: -260, y: -140 });
  assertAlmostEquals((300 - zoom.x) / zoom.scale, (300 - 20) / 0.5);
  assertAlmostEquals((200 - zoom.y) / zoom.scale, (200 - 30) / 0.5);
});

Deno.test("Pan double-click preserves acknowledged selection from an earlier Select click", async () => {
  const { createDiagramGesture } = await import(
    "../src/ui/diagram-viewer/src/diagram-gesture.ts"
  );
  const { createSelectionController } = await import(
    "../src/ui/shared/selection.ts"
  );
  let commitClick!: () => void;
  const controller = createSelectionController({
    gestureOptions: {
      schedule: (run) => {
        commitClick = run;
        return () => {};
      },
    },
    rootId: "ec",
    updateModelContext: () => Promise.resolve({}),
  });
  const item = {
    reference: { domain: "sysml", kind: "element", id: "A" },
    label: "A",
  };
  let opened = 0;
  createDiagramGesture(controller, item, () => {
    opened++;
  }, "select").onClick({ detail: 1 });
  commitClick();
  await controller.settled();
  assertEquals(
    controller.getSnapshot().items.map((item) => item.reference.id),
    ["A"],
  );
  const pan = createDiagramGesture(controller, item, () => {
    opened++;
  }, "pan");
  pan.onClick({ detail: 1 });
  pan.onClick({ detail: 2 });
  pan.onDoubleClick();
  await controller.setItems([], "add");
  assertEquals(opened, 1);
  assertEquals(
    controller.getSnapshot().items.map((item) => item.reference.id),
    ["A"],
  );
});

Deno.test("readable diagram labels use authored port text and endpoint paths without UUID primary labels", async () => {
  const { readableDiagramMembers } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  const nodes = [{
    id: "sensor-graphic",
    targetObjectId: "sensor-id",
    kind: "node",
    label: "sensor",
  }, {
    id: "ports-wrapper",
    targetObjectId: "sensor-id",
    kind: "compartment",
    parentId: "sensor-graphic",
    label: "ports",
  }, {
    id: "output-graphic",
    targetObjectId: "output-id",
    kind: "port",
    parentId: "ports-wrapper",
    label: " ",
    outsideLabels: [" ", "^output : Signal"],
  }, {
    id: "controller-graphic",
    targetObjectId: "controller-id",
    label: "controller",
  }, {
    id: "input-graphic",
    targetObjectId: "input-id",
    parentId: "controller-graphic",
    outsideLabels: ["input"],
  }, { id: "unlabeled-graphic", targetObjectId: "unlabeled-id", label: "" }];
  const edges = [{
    id: "edge",
    targetObjectId: "edge-id",
    sourceId: "output-graphic",
    targetId: "input-graphic",
  }, {
    id: "unknown-edge",
    targetObjectId: "unknown-edge-id",
    sourceId: "missing",
  }];
  const members = readableDiagramMembers(nodes, edges, {
    element: "Element",
    relationship: "Relationship",
  });
  assertEquals(
    members.find((member) => member.id === "output-graphic")?.label,
    "^output : Signal",
  );
  assertEquals(
    members.find((member) => member.id === "edge")?.label,
    "sensor.^output : Signal → controller.input",
  );
  assertEquals(
    members.find((member) => member.id === "unlabeled-graphic")?.label,
    "Element",
  );
  assertEquals(
    members.find((member) => member.id === "unknown-edge")?.label,
    "Relationship",
  );
  assertEquals(
    members.find((member) => member.id === "output-graphic")?.targetObjectId,
    "output-id",
  );
  assertEquals(members.some((member) => member.id === "ports-wrapper"), false);
});

Deno.test("marquee takes primary blocks only while click keeps fine-grained semantic members", async () => {
  const {
    readableDiagramMembers,
    marqueeDiagramMembers,
    semanticDiagramMember,
    uniqueSemanticMembers,
    whollyEnclosed,
  } = await import("../src/ui/diagram-viewer/src/diagram-model.ts");
  const nodes = [
    { id: "part-a", kind: "node", targetObjectId: "A", label: "A" },
    { id: "part-b", kind: "node", targetObjectId: "B", label: "B" },
    { id: "part-c", kind: "node", targetObjectId: "C", label: "C" },
    { id: "part-a-copy", kind: "node", targetObjectId: "A", label: "A" },
    {
      id: "row-a",
      kind: "compartment",
      parentId: "part-a",
      targetObjectId: "attribute-a",
      label: "attribute",
    },
    {
      id: "port-a",
      kind: "port",
      parentId: "part-a",
      targetObjectId: "port-a-semantic",
      label: "port",
    },
    { id: "old-kindless", targetObjectId: "old", label: "old" },
  ];
  const edges = [{
    id: "link",
    targetObjectId: "relationship",
    sourceId: "port-a",
    targetId: "part-b",
  }];
  const all = readableDiagramMembers(nodes, edges, {
    element: "Element",
    relationship: "Relationship",
  });
  const box = { x: 0, y: 0, width: 200, height: 200 };
  // Both blocks and all their small rows, ports and links are enclosed; C is outside.
  const enclosed = all.filter((member) =>
    whollyEnclosed(box, {
      x: member.id === "part-c" ? 300 : 20,
      y: 20,
      width: 40,
      height: 40,
    })
  );
  assertEquals(
    uniqueSemanticMembers(marqueeDiagramMembers(enclosed)).map((member) =>
      member.targetObjectId
    ),
    ["A", "B"],
  );
  assertEquals(
    semanticDiagramMember(all, "row-a")?.targetObjectId,
    "attribute-a",
  );
  assertEquals(
    semanticDiagramMember(all, "port-a")?.targetObjectId,
    "port-a-semantic",
  );
  assertEquals(
    semanticDiagramMember(all, "link")?.targetObjectId,
    "relationship",
  );
});

Deno.test("Space pan latches a drag until completion, releases cleanly, and never toggles selection", async () => {
  const { createDiagramPanState, acceptsDiagramSpace } = await import(
    "../src/ui/diagram-viewer/src/diagram-model.ts"
  );
  const { createDiagramGesture } = await import(
    "../src/ui/diagram-viewer/src/diagram-gesture.ts"
  );
  const { createSelectionController } = await import(
    "../src/ui/shared/selection.ts"
  );
  const pan = createDiagramPanState();
  assertEquals(acceptsDiagramSpace(" ", false, true), true);
  assertEquals(acceptsDiagramSpace(" ", true, true), false);
  assertEquals(acceptsDiagramSpace(" ", false, false), false);
  pan.press();
  assertEquals(pan.effective("select"), "pan");
  assertEquals(pan.begin("select"), "pan");
  pan.release();
  assertEquals(pan.effective("select"), "pan");
  pan.end();
  assertEquals(pan.effective("select"), "select");
  pan.press();
  pan.begin("select");
  pan.reset();
  assertEquals(pan.effective("select"), "select");
  assertEquals(pan.held, false);
  const controller = createSelectionController({
    rootId: "ec",
    updateModelContext: () => Promise.resolve({}),
  });
  const item = {
    reference: { domain: "sysml", kind: "element", id: "A" },
    label: "A",
  };
  let prevented = false;
  createDiagramGesture(controller, item, () => {}, "select").onKeyDown({
    key: " ",
    preventDefault() {
      prevented = true;
    },
  });
  assertEquals(prevented, true);
  await controller.setItems([], "add");
  assertEquals(controller.getSnapshot().items, []);
});

Deno.test("opening focus follows reading order, not document order", () => {
  const node = (x: number, y: number) => ({
    kind: "node",
    rect: { x, y, width: 100, height: 40 },
  });
  // SysON can list a bottom block first; the opening view starts top-left.
  assertEquals(
    openingFocus([
      node(400, 900),
      { kind: "edge" },
      node(300, 12),
      node(40, 10),
    ]),
    { x: 40, y: 10, width: 100, height: 40 },
  );
  assertEquals(openingFocus([{ kind: "edge" }]), undefined);
  // A container spanning the diagram: its header corner, not its middle.
  assertEquals(
    openingFocus([{
      kind: "node",
      rect: { x: 12, y: 12, width: 700, height: 1150 },
    }, { kind: "node", rect: { x: 400, y: 200, width: 194, height: 60 } }]),
    { x: 12, y: 12, width: 360, height: 120 },
  );
});

Deno.test("the diagram's name is the title, its representation type the eyebrow", () => {
  assertEquals(
    diagramHeading({
      representation: "General View",
      name: "FlightModes  state transition",
      fallback: "Diagram",
    }),
    { eyebrow: "General View", title: "FlightModes state transition" },
  );
  // The element the diagram shows wins over the view's generated name.
  assertEquals(
    diagramHeading({
      representation: "General View",
      name: "view1",
      target: "Batmobile",
      fallback: "Diagram",
    }),
    { eyebrow: "General View", title: "Batmobile" },
  );
  assertEquals(
    diagramHeading({ representation: "General View", fallback: "Diagram" }),
    { title: "General View" },
  );
  assertEquals(
    diagramHeading({
      name: "General View",
      representation: "General View",
      fallback: "Diagram",
    }),
    { title: "General View" },
  );
  assertEquals(diagramHeading({ fallback: "Diagram" }), { title: "Diagram" });
});
