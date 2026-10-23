import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  fitDiagram,
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
