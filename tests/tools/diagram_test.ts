import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderDiagramSvg } from "../../src/tools/diagram.ts";

const NODES = [{
  id: "part-1",
  label: "Heater",
  x: 0,
  y: 0,
  width: 160,
  height: 60,
}];

Deno.test("diagram snapshot is local and does not fetch without operator opt-in", async () => {
  const saved = Deno.env.get("SYSON_KROKI_URL");
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  Deno.env.delete("SYSON_KROKI_URL");
  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error("external renderer must not be called");
  };
  try {
    const rendered = await renderDiagramSvg(NODES, [], "Thermal model");
    assertEquals(rendered.renderer, "local");
    assertEquals(fetchCalls, 0);
    assertStringIncludes(rendered.svg, "Thermal model");
    assertStringIncludes(rendered.rendererWarning ?? "", "disabled");
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) Deno.env.delete("SYSON_KROKI_URL");
    else Deno.env.set("SYSON_KROKI_URL", saved);
  }
});

Deno.test("diagram snapshot uses an explicitly configured external renderer", async () => {
  const saved = Deno.env.get("SYSON_KROKI_URL");
  const originalFetch = globalThis.fetch;
  Deno.env.set("SYSON_KROKI_URL", "https://renderer.example/graphviz/svg");
  globalThis.fetch = (input) => {
    assertEquals(String(input), "https://renderer.example/graphviz/svg");
    return Promise.resolve(
      new Response('<svg id="external"><g id="syson_node_0"></g></svg>', {
        status: 200,
      }),
    );
  };
  try {
    const rendered = await renderDiagramSvg(NODES, [], "Thermal model");
    assertEquals(rendered, {
      renderer: "external",
      svg:
        '<svg id="external"><g id="syson_node_0" data-node-id="part-1" data-label="Heater"></g></svg>',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) Deno.env.delete("SYSON_KROKI_URL");
    else Deno.env.set("SYSON_KROKI_URL", saved);
  }
});

Deno.test("local topology preserves nested semantic nodes, parallel edges, routing and labels", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const svg = renderLocalTopology([
    {
      id: "container",
      targetObjectId: "semantic-container",
      label: "System",
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    },
    {
      id: "child",
      parentId: "container",
      targetObjectId: "semantic-child",
      kind: "compartment",
      label: "Requirements",
      x: 20,
      y: 50,
      width: 200,
      height: 100,
    },
    {
      id: "port",
      parentId: "child",
      targetObjectId: "semantic-port",
      kind: "port",
      label: "",
      x: 195,
      y: 40,
      width: 10,
      height: 10,
    },
  ], [
    {
      id: "edge-a",
      targetObjectId: "semantic-edge",
      sourceId: "port",
      targetId: "child",
      label: "satisfies",
      routingPoints: [{ x: 325, y: 195 }, { x: 360, y: 195 }, {
        x: 360,
        y: 150,
      }],
    },
    {
      id: "edge-b",
      targetObjectId: "semantic-edge-b",
      sourceId: "port",
      targetId: "child",
      label: "second",
    },
  ], "Native topology");
  assertStringIncludes(svg, 'data-target-object-id="semantic-port"');
  assertStringIncludes(
    svg,
    'data-edge-id="edge-a" data-target-object-id="semantic-edge"',
  );
  assertStringIncludes(svg, 'data-edge-id="edge-b"');
  assertStringIncludes(svg, 'points="325,195 360,195 360,150"');
  assertStringIncludes(svg, 'x="120" y="150"');
  assertStringIncludes(svg, "satisfies");
});

Deno.test("local topology renders every node and escapes untrusted text and semantic IDs", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const nodes = Array.from({ length: 25 }, (_, i) => ({
    id: `node-${i}`,
    targetObjectId: i === 24 ? '" onload="evil' : `semantic-${i}`,
    label: i === 24 ? "<script>alert(1)</script>&" : `Node ${i}`,
    x: 0,
    y: 0,
    width: 180,
    height: 70,
    hasLayout: false,
  }));
  const svg = renderLocalTopology(nodes, [{
    id: "edge",
    sourceId: "node-0",
    targetId: "node-24",
    label: '<img onerror="evil">',
  }], "<unsafe>");
  assertStringIncludes(svg, 'data-node-id="node-24"');
  assertStringIncludes(svg, 'data-target-object-id="&quot; onload=&quot;evil"');
  assertStringIncludes(svg, "&lt;script&gt;alert(1)&lt;/script&gt;&amp;");
  assertEquals(svg.includes("<script"), false);
  assertEquals(svg.includes(' onload="'), false);
  assertEquals(svg.includes("NaN"), false);
  assertEquals((svg.match(/data-node-id=/g) ?? []).length, 25);
  assertStringIncludes(svg, 'points="180,35 90,35 90,815 0,815"');
});

Deno.test("external rendering maps explicit graphical IDs without losing parallel edges or orphan nodes", async () => {
  const saved = Deno.env.get("SYSON_KROKI_URL"),
    originalFetch = globalThis.fetch;
  Deno.env.set("SYSON_KROKI_URL", "https://renderer.example/graphviz/svg");
  let dot = "";
  globalThis.fetch = (_input, init) => {
    dot = String(init?.body);
    return Promise.resolve(
      new Response(
        '<svg><g id="syson_node_0" data-target-object-id="forged" data-label="forged"><rect/></g><g id="syson_node_1"/><g id="syson_node_2"/><g id="syson_edge_0"><path/></g><g id="syson_edge_1"><path/></g><g id="syson_edge_2"><path/></g><g id="unmapped" data-node-id="forged" data-target-object-id="forged"/></svg>',
      ),
    );
  };
  try {
    const nodes = [
      ...NODES.map((n) => ({ ...n, targetObjectId: 'semantic"<&' })),
      {
        ...NODES[0],
        id: "other",
        label: 'Other"\\\n<unsafe>',
        targetObjectId: "semantic-other",
      },
      {
        ...NODES[0],
        id: "orphan",
        label: "Orphan",
        targetObjectId: "semantic-orphan",
      },
    ];
    const edges = [{
      id: "edge-a",
      sourceId: "part-1",
      targetId: "other",
      targetObjectId: 'relationship"<&',
      label: "connects",
    }, {
      id: "edge-b",
      sourceId: "part-1",
      targetId: "other",
      targetObjectId: "relationship-b",
      label: "connects",
    }, {
      id: "edge-unavailable",
      sourceId: "part-1",
      targetId: "missing",
      targetObjectId: "relationship-missing",
    }];
    const rendered = await renderDiagramSvg(nodes, edges, "Model");
    assertEquals(rendered.renderer, "external");
    assertStringIncludes(dot, 'n2 [id="syson_node_2",label="Orphan"]');
    assertStringIncludes(dot, 'n0 -> n1 [id="syson_edge_0"');
    assertStringIncludes(dot, 'n0 -> n1 [id="syson_edge_1"');
    assertStringIncludes(dot, 'id="syson_edge_2"');
    assertStringIncludes(dot, JSON.stringify(nodes[1].label));
    assertStringIncludes(rendered.svg, 'data-node-id="orphan"');
    assertStringIncludes(
      rendered.svg,
      'data-edge-id="edge-a" data-label="connects" data-target-object-id="relationship&quot;&lt;&amp;"',
    );
    assertStringIncludes(rendered.svg, 'data-edge-id="edge-b"');
    assertStringIncludes(rendered.svg, 'data-edge-id="edge-unavailable"');
    assertStringIncludes(
      rendered.svg,
      'data-target-object-id="semantic&quot;&lt;&amp;"',
    );
    assertEquals(rendered.svg.includes('="forged"'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) Deno.env.delete("SYSON_KROKI_URL");
    else Deno.env.set("SYSON_KROKI_URL", saved);
  }
});

Deno.test("external output missing explicit identity groups falls back to selectable local topology", async () => {
  const saved = Deno.env.get("SYSON_KROKI_URL"),
    originalFetch = globalThis.fetch;
  Deno.env.set("SYSON_KROKI_URL", "https://renderer.example/graphviz/svg");
  globalThis.fetch = () =>
    Promise.resolve(
      new Response('<svg><g id="unknown" data-node-id="forged"/></svg>'),
    );
  try {
    const result = await renderDiagramSvg(NODES, [], "Model");
    assertEquals(result.renderer, "local");
    assertStringIncludes(result.rendererWarning ?? "", "identity groups");
    assertStringIncludes(result.svg, 'data-node-id="part-1"');
  } finally {
    globalThis.fetch = originalFetch;
    if (saved === undefined) Deno.env.delete("SYSON_KROKI_URL");
    else Deno.env.set("SYSON_KROKI_URL", saved);
  }
});

Deno.test("local topology preserves native ellipse style without inferring shapes from user labels", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const svg = renderLocalTopology(
    [
      {
        ...NODES[0],
        id: "initial",
        label: "",
        width: 20,
        height: 20,
        style: {
          kind: "EllipseNodeStyle",
          background: "#000000",
          borderColor: "#000000",
          borderSize: 0,
        },
        outsideLabels: ["Initial"],
      },
      {
        ...NODES[0],
        id: "named-decision",
        label: "Decision",
        x: 100,
        style: {
          kind: "RectangularNodeStyle",
          background: "url(https://evil.example)",
          borderColor: 'red" onload="evil',
          borderRadius: 12,
        },
      },
    ],
    [],
    "Controls",
  );
  assertStringIncludes(
    svg,
    '<ellipse cx="10" cy="10" rx="10" ry="10" fill="var(--mcp-view-text, currentColor)" stroke="var(--mcp-view-border-strong, currentColor)" stroke-width="0"',
  );
  assertStringIncludes(svg, 'data-node-id="initial"');
  assertStringIncludes(svg, ">Initial</text>");
  assertStringIncludes(
    svg,
    '<rect x="100" y="0" width="160" height="60" rx="12"',
  );
  assertEquals(svg.includes("evil.example"), false);
  assertEquals(svg.includes(' onload="'), false);
});

Deno.test("native control image paths produce recognizable shapes without user-name inference or image fetches", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const control = (id: string, imageURL: string, x: number) => ({
    ...NODES[0],
    id,
    label: "",
    x,
    width: 36,
    height: 36,
    targetObjectId: `semantic-${id}`,
    style: { kind: "ImageNodeStyle", imageURL },
  });
  const svg = renderLocalTopology(
    [
      control("decision", "/api/images/decision_action.svg", 0),
      control("merge", "images/merge_action.svg", 50),
      control("start", "images/start_action.svg", 100),
      control("done", "images/done_action.svg", 150),
      {
        ...control("unrecognized", "https://evil.example/decision.svg", 200),
        label: "Start decision final",
      },
    ],
    [],
    "Controls",
  );
  assertEquals((svg.match(/<polygon /g) ?? []).length, 2);
  assertEquals((svg.match(/<ellipse /g) ?? []).length, 3);
  assertStringIncludes(svg, 'data-target-object-id="semantic-decision"');
  assertStringIncludes(svg, '<rect x="200"');
  assertEquals(svg.includes("https://evil.example"), false);
});

Deno.test("missing native layout separates variable-height compartments and subsequent root rows", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const roots = Array.from(
    { length: 5 },
    (_, i) => ({ ...NODES[0], id: `root-${i}`, hasLayout: false }),
  );
  const children = [{
    ...NODES[0],
    id: "tall",
    parentId: "root-0",
    kind: "compartment" as const,
    height: 200,
    hasLayout: false,
  }, {
    ...NODES[0],
    id: "short",
    parentId: "root-0",
    kind: "compartment" as const,
    height: 40,
    hasLayout: false,
  }];
  const svg = renderLocalTopology(
    [...roots, ...children],
    [],
    "Missing layout",
  );
  const bounds = (id: string) => {
    const group = svg.split(`data-node-id="${id}"`)[1].split("</g>")[0];
    const match =
      /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/.exec(
        group,
      )!;
    return {
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]),
      height: Number(match[4]),
    };
  };
  const tall = bounds("tall"),
    short = bounds("short"),
    parent = bounds("root-0"),
    nextRow = bounds("root-4");
  assertEquals(tall.y + tall.height < short.y, true);
  assertEquals(short.y + short.height < parent.y + parent.height, true);
  assertEquals(nextRow.y > parent.y + parent.height, true);
});

Deno.test("native colors cannot override the host's diagram theme", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  for (
    const background of [
      "#fff",
      "#ffff",
      "#ffffff",
      "#ffffffff",
      "#fff0",
      "#ffffff00",
      "#12345",
      "#1234567",
      "url(https://evil.example)",
    ]
  ) {
    const svg = renderLocalTopology(
      [{ ...NODES[0], style: { kind: "RectangularNodeStyle", background } }],
      [],
      "Color",
    );
    assertStringIncludes(
      svg,
      'fill="var(--mcp-view-text, currentColor)" font-size="12">Heater</text>',
    );
    assertStringIncludes(svg, 'fill="var(--mcp-view-panel, #ffffff)"');
    assertEquals(svg.includes(`fill="${background}"`), false);
    assertEquals(svg.includes("evil.example"), false);
  }
});

Deno.test("actual action-view structure hides repeated empty display compartments without changing semantic input", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const actions = ["observe", "evaluate", "actuate"].map((id, index) => ({
    ...NODES[0],
    id,
    targetObjectId: `semantic-${id}`,
    label: `«action»\n${id}`,
    hasLayout: false,
    x: index * 200,
  }));
  const empty = actions.flatMap((parent) =>
    [
      "doc",
      "parameters",
      "attributes",
      "items",
      "actions",
      "action flow",
      "perform actions",
    ].map((label, index) => ({
      ...NODES[0],
      id: `${parent.id}-display-${index}`,
      parentId: parent.id,
      targetObjectId: parent.targetObjectId,
      label,
      kind: "compartment" as const,
      hasLayout: false,
      height: label === "action flow" ? 150 : 60,
    }))
  );
  const nodes = [...actions, ...empty];
  const svg = renderLocalTopology(nodes, [{
    id: "first",
    sourceId: "observe",
    targetId: "evaluate",
  }, { id: "second", sourceId: "evaluate", targetId: "actuate" }], "Cycle");
  assertEquals(nodes.length, 24);
  assertEquals((svg.match(/data-node-id=/g) ?? []).length, 3);
  assertEquals((svg.match(/data-edge-id=/g) ?? []).length, 2);
  assertEquals(svg.includes("action flow"), false);
  assertEquals(svg.includes(">doc</text>"), false);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1].split(" ").map(Number);
  assertEquals(viewBox[3] < 200, true);
  assertEquals(nodes[0].height, 60);
});

Deno.test("nonempty display compartments become compact nonselectable headings while real rows and edge ports survive", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const nodes = [
    {
      ...NODES[0],
      id: "controller",
      targetObjectId: "semantic-controller",
      label: "«part»\ncontroller : Controller",
      hasLayout: false,
    },
    {
      ...NODES[0],
      id: "attributes-wrapper",
      parentId: "controller",
      targetObjectId: "semantic-controller",
      label: "attributes",
      kind: "compartment" as const,
      hasLayout: false,
    },
    {
      ...NODES[0],
      id: "threshold-row",
      parentId: "attributes-wrapper",
      targetObjectId: "semantic-threshold",
      label: "^threshold : ScalarValues::Integer = 8",
      kind: "compartment" as const,
      hasLayout: false,
      height: 15,
    },
    {
      ...NODES[0],
      id: "ports-wrapper",
      parentId: "controller",
      targetObjectId: "semantic-controller",
      label: "ports",
      kind: "compartment" as const,
      hasLayout: false,
    },
    {
      ...NODES[0],
      id: "input-row",
      parentId: "ports-wrapper",
      targetObjectId: "semantic-input",
      label: "^in input : Signal",
      kind: "compartment" as const,
      hasLayout: false,
      height: 15,
    },
    {
      ...NODES[0],
      id: "input-border",
      parentId: "controller",
      targetObjectId: "semantic-input",
      label: "",
      kind: "port" as const,
      hasLayout: false,
      width: 10,
      height: 10,
    },
    {
      ...NODES[0],
      id: "sensor",
      targetObjectId: "semantic-sensor",
      label: "Sensor",
      hasLayout: false,
    },
  ];
  const svg = renderLocalTopology(nodes, [{
    id: "connection",
    targetObjectId: "semantic-connection",
    sourceId: "sensor",
    targetId: "input-border",
  }], "Architecture");
  assertEquals(svg.includes('data-node-id="attributes-wrapper"'), false);
  assertStringIncludes(svg, ">attributes</text>");
  assertStringIncludes(
    svg,
    'data-node-id="threshold-row" data-target-object-id="semantic-threshold"',
  );
  assertStringIncludes(
    svg,
    'data-node-id="input-border" data-target-object-id="semantic-input"',
  );
  assertStringIncludes(
    svg,
    'data-edge-id="connection" data-target-object-id="semantic-connection"',
  );
  assertEquals((svg.match(/data-edge-id=/g) ?? []).length, 1);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1].split(" ").map(Number);
  assertEquals(viewBox[3] < 350, true);
});

Deno.test("fallback parents reserve distinct slots for every border port", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const nodes = [
    {
      ...NODES[0],
      id: "parent",
      targetObjectId: "parent-semantic",
      hasLayout: false,
      height: 60,
    },
    ...Array.from({ length: 3 }, (_, index) => ({
      ...NODES[0],
      id: `port-${index}`,
      parentId: "parent",
      targetObjectId: `port-semantic-${index}`,
      kind: "port" as const,
      label: `Port ${index}`,
      hasLayout: false,
      width: 10,
      height: 10,
    })),
  ];
  const svg = renderLocalTopology(nodes, [], "Ports");
  const bounds = (id: string) => {
    const group = svg.split(`data-node-id="${id}"`)[1].split("</g>")[0];
    const rect =
      /<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/.exec(
        group,
      )!;
    return { y: Number(rect[2]), height: Number(rect[4]) };
  };
  const parent = bounds("parent"),
    ports = [0, 1, 2].map((index) => bounds(`port-${index}`));
  assertEquals(new Set(ports.map((port) => port.y)).size, 3);
  assertEquals(
    ports.every((port) => port.y + port.height < parent.y + parent.height),
    true,
  );
  assertEquals(ports[0].y + ports[0].height < ports[1].y, true);
  assertEquals(ports[1].y + ports[1].height < ports[2].y, true);
});

Deno.test("border ports keep accessible identity but omit text duplicated in a semantic row", async () => {
  const { renderLocalTopology } = await import(
    "../../src/tools/diagram-renderer.ts"
  );
  const nodes = [{
    ...NODES[0],
    id: "controller",
    targetObjectId: "controller-semantic",
    hasLayout: false,
  }, {
    ...NODES[0],
    id: "ports",
    parentId: "controller",
    targetObjectId: "controller-semantic",
    kind: "compartment" as const,
    label: "ports",
    hasLayout: false,
  }, {
    ...NODES[0],
    id: "input-row",
    parentId: "ports",
    targetObjectId: "input-semantic",
    kind: "compartment" as const,
    label: "in input : Signal",
    hasLayout: false,
  }, {
    ...NODES[0],
    id: "input-border",
    parentId: "controller",
    targetObjectId: "input-semantic",
    kind: "port" as const,
    label: "",
    outsideLabels: ["input : Signal"],
    hasLayout: false,
    width: 10,
    height: 10,
  }];
  const svg = renderLocalTopology(nodes, [], "Ports");
  const port = svg.split('data-node-id="input-border"')[1].split("</g>")[0];
  assertStringIncludes(port, 'data-target-object-id="input-semantic"');
  assertStringIncludes(port, 'data-label="input : Signal"');
  assertStringIncludes(port, "<title>input : Signal</title>");
  assertEquals(port.includes("<text"), false);
  assertEquals((svg.match(/>in input : Signal<\/text>/g) ?? []).length, 1);
});
