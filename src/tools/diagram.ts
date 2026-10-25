/**
 * SysON Diagram Tools
 *
 * CRUD operations on SysON diagrams (representations).
 * - list: query existing diagrams for an editing context
 * - create: create a new diagram (General View, etc.)
 * - drop: add semantic elements onto a diagram
 * - arrange: auto-layout the diagram
 * - snapshot: render an SVG locally, with an operator-controlled external option
 *
 * @module lib/syson/tools/diagram
 */

import { renderLocalTopology } from "./diagram-renderer.ts";
import { evalAql, evalAqlObjects } from "./aql.ts";
import type { SysonTool } from "./types.ts";
import { getSysonClient } from "../api/graphql-client.ts";

import {
  GET_REPRESENTATION_DESCRIPTIONS,
  LIST_REPRESENTATIONS,
} from "../api/queries.ts";
import {
  ARRANGE_ALL,
  CREATE_REPRESENTATION,
  DROP_ON_DIAGRAM,
} from "../api/mutations.ts";
import type {
  ArrangeAllResult,
  CreateRepresentationResult,
  DropOnDiagramResult,
  GetRepresentationDescriptionsResult,
  ListRepresentationsResult,
} from "../api/types.ts";

/**
 * Extract mutation result, throwing on ErrorPayload.
 */
function unwrapMutation<T extends object>(
  result: T,
  operationName: string,
): Record<string, unknown> {
  const payload = Object.values(result)[0] as Record<string, unknown>;
  if (payload?.__typename === "ErrorPayload") {
    throw new Error(
      `[lib/syson] ${operationName} failed: ${
        (payload as { message: string }).message
      }`,
    );
  }
  return payload;
}

// ============================================================================
// WebSocket diagram snapshot
// ============================================================================

/** Children layout of a node style: compartments stack rows, free-form ones hold nested nodes. */
const LAYOUT = "childrenLayoutStrategy { __typename }";
const nodeFields = (depth: number): string =>
  `id type targetObjectId state insideLabel { text } outsideLabels { text } style { __typename ... on EllipseNodeStyle { background borderColor borderSize borderStyle ${LAYOUT} } ... on RectangularNodeStyle { background borderColor borderRadius borderSize borderStyle ${LAYOUT} } ... on ImageNodeStyle { imageURL borderColor borderRadius borderSize borderStyle ${LAYOUT} } ... on IconLabelNodeStyle { background ${LAYOUT} } ... on SysMLViewFrameNodeStyle { background borderColor borderRadius borderSize borderStyle } } defaultWidth defaultHeight ${
    depth > 0
      ? `borderNodes { ${nodeFields(0)} } childNodes { ${
        nodeFields(depth - 1)
      } }`
      : ""
  }`;
const DIAGRAM_SUBSCRIPTION =
  `subscription DiagramEvent($input: DiagramEventInput!) {
 diagramEvent(input: $input) { __typename ... on DiagramRefreshedEventPayload {
 diagram { id targetObjectId metadata { label kind description { id label } }
 nodes { ${nodeFields(8)} }
 edges { id type targetObjectId sourceId targetId state style { lineStyle sourceArrow targetArrow } beginLabel { text } centerLabel { text } endLabel { text } }
 layoutData { nodeLayoutData { id position { x y } size { width height } } edgeLayoutData { id bendingPoints { x y } } }
 } } } }`;

export interface DiagramNode {
  id: string;
  label: string;
  targetObjectId?: string;
  type?: string;
  parentId?: string;
  /** `node`: a top-level node or one nested in a free-form compartment; `compartment`: a compartment or a row of a list. */
  kind?: "node" | "compartment" | "port";
  hasLayout?: boolean;
  /** SysON draws the node faded (ViewModifier `Faded`). */
  faded?: true;
  outsideLabels?: string[];
  style?: {
    kind: string;
    background?: string;
    borderColor?: string;
    borderRadius?: number;
    borderSize?: number;
    borderStyle?: string;
    imageURL?: string;
    /** `list`: children stack as rows; `free`: children are nested nodes. */
    childrenLayout?: "list" | "free";
  };
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  targetObjectId?: string;
  type?: string;
  beginLabel?: string;
  endLabel?: string;
  /** SysON edge style: `lineStyle` Solid/Dash/Dot/Dash_Dot, arrows as SysON `ArrowStyle` names. */
  style?: { lineStyle: string; sourceArrow: string; targetArrow: string };
  faded?: true;
  routingPoints?: { x: number; y: number }[];
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  label: string;
  childToParent: Map<string, string>;
  targetObjectId?: string;
  metadata?: Record<string, unknown>;
  /** Elements SysON keeps on the diagram but hides; left out of `nodes`/`edges`. */
  hidden: { nodes: number; edges: number };
}

type Raw = Record<string, unknown>;

const CHILDREN_LAYOUT: Record<string, "list" | "free"> = {
  ListLayoutStrategy: "list",
  FreeFormLayoutStrategy: "free",
};

/**
 * One `DiagramRefreshedEventPayload.diagram` as flat nodes and edges with
 * absolute layout data. Hidden elements (and everything under a hidden
 * node, and every edge touching one) are left out: SysON keeps them on the
 * diagram, but nobody sees them there.
 */
export function snapshotFromDiagram(d: Raw): DiagramData {
  const layoutData = (d.layoutData ?? {}) as {
    nodeLayoutData?: {
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }[];
    edgeLayoutData?: {
      id: string;
      bendingPoints?: { x: number; y: number }[];
    }[];
  };
  const layoutMap = new Map(
    (layoutData.nodeLayoutData ?? []).map((l) => [l.id, l]),
  );
  const bends = new Map(
    (layoutData.edgeLayoutData ?? []).map((l) => [l.id, l.bendingPoints]),
  );

  const childToParent = new Map<string, string>();
  const nodes: DiagramNode[] = [];
  const kept = new Set<string>();
  let hiddenNodes = 0;
  const countAll = (items: Raw[]): number =>
    items.reduce(
      (sum, n) =>
        sum + 1 + countAll((n.childNodes ?? []) as Raw[]) +
        countAll((n.borderNodes ?? []) as Raw[]),
      0,
    );
  const visit = (
    items: Raw[],
    parentId?: string,
    kind: DiagramNode["kind"] = "node",
  ) => {
    for (const n of items) {
      if (n.state === "Hidden") {
        hiddenNodes += countAll([n]);
        continue;
      }
      const id = n.id as string;
      const layout = layoutMap.get(id);
      if (parentId) childToParent.set(id, parentId);
      const nativeStyle = n.style as Raw | undefined;
      let style: DiagramNode["style"];
      if (nativeStyle) {
        const { __typename, childrenLayoutStrategy, ...rest } = nativeStyle;
        const childrenLayout = CHILDREN_LAYOUT[
          (childrenLayoutStrategy as Raw | undefined)?.__typename as string
        ];
        style = {
          kind: __typename as string,
          ...rest,
          ...(childrenLayout && { childrenLayout }),
        };
      }
      kept.add(id);
      nodes.push({
        id,
        label: (n.insideLabel as { text?: string } | null)?.text ?? "",
        targetObjectId: n.targetObjectId as string,
        type: n.type as string,
        parentId,
        kind,
        ...(n.state === "Faded" && { faded: true as const }),
        outsideLabels: ((n.outsideLabels ?? []) as { text: string }[]).map(
          (label) => label.text,
        ),
        style,
        hasLayout: !!layout,
        x: layout?.position.x ?? 0,
        y: layout?.position.y ?? 0,
        width: layout?.size.width ?? (n.defaultWidth as number) ??
          (kind === "port" ? 16 : 180),
        height: layout?.size.height ?? (n.defaultHeight as number) ??
          (kind === "port" ? 16 : 72),
      });
      // Children of a free-form node (or of a view frame) are nodes of their
      // own; children of a list node are its compartments and rows.
      const holdsNodes = style?.childrenLayout === "free" ||
        style?.kind === "SysMLViewFrameNodeStyle";
      visit(
        (n.childNodes ?? []) as Raw[],
        id,
        holdsNodes ? "node" : "compartment",
      );
      visit((n.borderNodes ?? []) as Raw[], id, "port");
    }
  };
  visit((d.nodes ?? []) as Raw[]);

  let hiddenEdges = 0;
  const edges: DiagramEdge[] = [];
  for (const e of (d.edges ?? []) as Raw[]) {
    if (
      e.state === "Hidden" || !kept.has(e.sourceId as string) ||
      !kept.has(e.targetId as string)
    ) {
      hiddenEdges++;
      continue;
    }
    const style = e.style as DiagramEdge["style"] | undefined;
    edges.push({
      id: e.id as string,
      targetObjectId: e.targetObjectId as string,
      type: e.type as string,
      beginLabel: (e.beginLabel as { text: string } | null)?.text,
      endLabel: (e.endLabel as { text: string } | null)?.text,
      ...(style && {
        style: {
          lineStyle: style.lineStyle,
          sourceArrow: style.sourceArrow,
          targetArrow: style.targetArrow,
        },
      }),
      ...(e.state === "Faded" && { faded: true as const }),
      routingPoints: bends.get(e.id as string),
      sourceId: e.sourceId as string,
      targetId: e.targetId as string,
      label: (e.centerLabel as { text: string } | null)?.text,
    });
  }

  const metadata = d.metadata as Record<string, unknown> | undefined;
  return {
    nodes,
    edges,
    label: typeof metadata?.label === "string" ? metadata.label : "",
    childToParent,
    targetObjectId: d.targetObjectId as string | undefined,
    metadata,
    hidden: { nodes: hiddenNodes, edges: hiddenEdges },
  };
}

/**
 * Fetch diagram data via WebSocket subscription (one-shot).
 * Connects, gets first DiagramRefreshedEventPayload, disconnects.
 */
function fetchDiagramData(
  baseUrl: string,
  ecId: string,
  diagramId: string,
  timeoutMs = 10_000,
): Promise<DiagramData> {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/subscriptions";

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, "graphql-ws");
    const timer = setTimeout(() => {
      ws.close();
      reject(
        new Error(
          `[lib/syson] diagram snapshot timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "connection_init" }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);

      if (msg.type === "connection_ack") {
        ws.send(JSON.stringify({
          id: "snap",
          type: "start",
          payload: {
            query: DIAGRAM_SUBSCRIPTION,
            variables: {
              input: {
                id: crypto.randomUUID(),
                editingContextId: ecId,
                diagramId,
              },
            },
          },
        }));
      }

      if (msg.type === "data") {
        if (msg.payload?.errors?.length) {
          clearTimeout(timer);
          ws.close();
          reject(
            new Error(
              `[lib/syson] diagram subscription error: ${
                JSON.stringify(msg.payload.errors)
              }`,
            ),
          );
          return;
        }
        const payload = msg.payload?.data?.diagramEvent;
        if (payload?.__typename === "DiagramRefreshedEventPayload") {
          clearTimeout(timer);
          ws.send(JSON.stringify({ id: "snap", type: "stop" }));
          ws.close();

          resolve(snapshotFromDiagram(payload.diagram));
        }
      }

      if (msg.type === "error") {
        clearTimeout(timer);
        ws.close();
        reject(
          new Error(
            `[lib/syson] diagram subscription error: ${
              JSON.stringify(msg.payload)
            }`,
          ),
        );
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("[lib/syson] WebSocket connection failed"));
    };
  });
}

/**
 * SysON draws every SysML view through one diagram description ("General
 * View"); the view type the user chose is the definition its ViewUsage is
 * typed by, e.g. `StandardViewDefinitions::ActionFlowView`.
 */
const VIEW_DEFINITION = "aql:self.viewDefinition.qualifiedName";
const VIEW_USAGES = "aql:self.ownedElement->filter(sysml::ViewUsage)";

/** The view definition a ViewUsage is typed by; undefined for anything else. */
export async function readViewDefinition(
  ecId: string,
  viewUsageId: string | undefined,
): Promise<string | undefined> {
  if (!viewUsageId) return undefined;
  const result = await evalAql(ecId, VIEW_DEFINITION, [viewUsageId]);
  return result.__typename === "StringExpressionResult"
    ? result.strValue.trim() || undefined
    : undefined;
}

const KROKI_ENV = "SYSON_KROKI_URL";

export type SvgRenderResult = {
  svg: string;
  renderer: "local" | "external";
  rendererWarning?: string;
};

/**
 * Render locally by default. An operator can explicitly opt into an external
 * Kroki-compatible renderer with SYSON_KROKI_URL; the MCP caller cannot select
 * an endpoint or cause a model graph to leave the deployment.
 */
export async function renderDiagramSvg(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  diagramLabel: string,
  childToParent?: Map<string, string>,
): Promise<SvgRenderResult> {
  if (nodes.length === 0) {
    return {
      renderer: "local",
      rendererWarning:
        "External diagram rendering is disabled; returned a local SVG.",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60">
      <rect width="100%" height="100%" fill="#0f0d1a" rx="8"/>
      <text x="200" y="35" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#888">Empty diagram</text>
    </svg>`,
    };
  }

  const externalRendererUrl = Deno.env.get(KROKI_ENV)?.trim();
  if (!externalRendererUrl) {
    return localDiagramSvg(
      nodes,
      edges,
      diagramLabel,
      "External rendering is disabled. Set SYSON_KROKI_URL only after approving the renderer as a model-data recipient.",
    );
  }

  // Explicit graphical IDs bind returned groups to the original model data.
  // Keep every node and relationship: parallel edges have distinct identities.
  const quote = (value: string) => JSON.stringify(value);
  const dotLines = [
    `digraph ${quote(diagramLabel)} {`,
    `graph [bgcolor="#0f0d1a",rankdir=TB]`,
    `node [shape=box,style="rounded,filled",fillcolor="#1e1b4b",fontcolor="#e0e7ff",color="#818cf8"]`,
    `edge [color="#a5b4fc",fontcolor="#a5b4fc"]`,
  ];
  const nodeIds = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const graphical = new Map<
    string,
    {
      kind: "node" | "edge";
      id: string;
      targetObjectId?: string;
      label: string;
    }
  >();
  nodes.forEach((node, index) => {
    const svgId = `syson_node_${index}`;
    graphical.set(svgId, {
      kind: "node",
      id: node.id,
      targetObjectId: node.targetObjectId,
      label: node.label,
    });
    dotLines.push(
      `${nodeIds.get(node.id)} [id=${quote(svgId)},label=${
        quote(node.label || node.id)
      }]`,
    );
  });
  edges.forEach((edge, index) => {
    // Old callers may supply only top-level nodes and a descendant map.
    let source = nodeIds.get(edge.sourceId) ??
      nodeIds.get(childToParent?.get(edge.sourceId) ?? "");
    let target = nodeIds.get(edge.targetId) ??
      nodeIds.get(childToParent?.get(edge.targetId) ?? "");
    if (!source) {
      source = `missing_source_${index}`;
      dotLines.push(
        `${source} [label=${quote("Unavailable endpoint: " + edge.sourceId)}]`,
      );
    }
    if (!target) {
      target = `missing_target_${index}`;
      dotLines.push(
        `${target} [label=${quote("Unavailable endpoint: " + edge.targetId)}]`,
      );
    }
    const svgId = `syson_edge_${index}`;
    graphical.set(svgId, {
      kind: "edge",
      id: edge.id,
      targetObjectId: edge.targetObjectId,
      label: edge.label ?? "",
    });
    dotLines.push(
      `${source} -> ${target} [id=${quote(svgId)},label=${
        quote(edge.label ?? "")
      },taillabel=${quote(edge.beginLabel ?? "")},headlabel=${
        quote(edge.endLabel ?? "")
      }]`,
    );
  });
  dotLines.push("}");
  const dot = dotLines.join("\n");

  try {
    const resp = await fetch(externalRendererUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: dot,
    });
    if (!resp.ok) {
      throw new Error(`Kroki returned ${resp.status}: ${await resp.text()}`);
    }
    const externalSvg = await resp.text();
    // Never accept semantic metadata supplied by the renderer. Only annotate
    // Graphviz groups whose explicit graphical ID belongs to this request.
    const clean = externalSvg.replace(
      /\sdata-(?:node-id|edge-id|target-object-id|label)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    );
    const annotated = new Set<string>();
    const svg = clean.replace(/<g\b[^>]*>/gi, (group) => {
      const id = /\sid\s*=\s*["']([^"']+)["']/i.exec(group)?.[1];
      const original = id ? graphical.get(id) : undefined;
      if (!original) return group;
      annotated.add(id!);
      const attributes = ` data-${original.kind}-id="${
        esc(original.id)
      }" data-label="${esc(original.label)}"${
        original.targetObjectId
          ? ` data-target-object-id="${esc(original.targetObjectId)}"`
          : ""
      }`;
      return group.replace(
        /\s*\/?\s*>$/,
        (ending) => attributes + (ending.includes("/") ? "/>" : ">"),
      );
    });
    if (annotated.size !== graphical.size) {
      return localDiagramSvg(
        nodes,
        edges,
        diagramLabel,
        "External renderer omitted graphical identity groups; returned a local SVG to preserve element selection.",
      );
    }
    return { svg, renderer: "external" };
  } catch (err) {
    const detail = (err as Error).message;
    console.error(
      `[syson_diagram_snapshot] External renderer failed: ${detail}; returning local SVG`,
    );
    return localDiagramSvg(
      nodes,
      edges,
      diagramLabel,
      `External renderer failed (${detail}); returned a local SVG without sending a retry.`,
    );
  }
}

/** Local topology renderer; native coordinates are retained when supplied. */
function localDiagramSvg(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  diagramLabel: string,
  rendererWarning: string,
): SvgRenderResult {
  return {
    renderer: "local",
    rendererWarning,
    svg: renderLocalTopology(nodes, edges, diagramLabel),
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// Tool definitions
// ============================================================================

export const diagramTools: SysonTool[] = [
  // --------------------------------------------------------------------------
  // syson_diagram_list
  // --------------------------------------------------------------------------
  {
    name: "syson_diagram_list",
    description:
      "List all diagrams in a project. Returns diagram IDs needed by " +
      "syson_diagram_snapshot, syson_diagram_drop, and syson_diagram_arrange.",
    category: "diagram",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID from syson_project_get.",
        },
      },
      required: ["editing_context_id"],
    },
    handler: async ({ editing_context_id }) => {
      const client = getSysonClient();
      const data = await client.query<ListRepresentationsResult>(
        LIST_REPRESENTATIONS.replace(
          "id label kind",
          "id label kind description { id label }",
        ),
        { editingContextId: editing_context_id as string },
      );

      const representations = data.viewer.editingContext.representations.edges
        .map(
          (e) => ({
            id: e.node.id,
            label: e.node.label,
            kind: e.node.kind,
            description: (e.node as typeof e.node & {
              description?: { id: string; label: string };
            }).description,
          }),
        );

      return {
        editingContextId: editing_context_id,
        representations,
        count: representations.length,
      };
    },
  },

  {
    name: "syson_diagram_types",
    description:
      "Read available native representation types for an element, including diagram and table views. Does not create a representation.",
    category: "diagram",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: { type: "string" },
        element_id: { type: "string" },
      },
      required: ["editing_context_id", "element_id"],
    },
    handler: async ({ editing_context_id, element_id }) => {
      const data = await getSysonClient().query<
        GetRepresentationDescriptionsResult
      >(GET_REPRESENTATION_DESCRIPTIONS, {
        editingContextId: editing_context_id as string,
        objectId: element_id as string,
      });
      const availableTypes = data.viewer.editingContext
        .representationDescriptions.edges.map(({ node }) => ({
          ...node,
          category: /table/i.test(node.label) ? "table" : "diagram",
        }));
      return {
        editingContextId: editing_context_id,
        elementId: element_id,
        availableTypes,
        count: availableTypes.length,
      };
    },
  },
  // --------------------------------------------------------------------------
  // syson_diagram_create
  // --------------------------------------------------------------------------
  {
    name: "syson_diagram_create",
    description:
      "Create a new diagram. Call without description_label to list available types " +
      "(General View, Interconnection View, etc.). " +
      "Then call again with description_label to create. " +
      "SysON records the view type on a SysML ViewUsage it creates in the element: " +
      "the result's `viewDefinition` (e.g. StandardViewDefinitions::ActionFlowView) is " +
      "the type actually created, while the representation itself is always described " +
      "as 'General View'. " +
      "After creating, use syson_diagram_drop to add elements, then syson_diagram_arrange for layout.",
    category: "diagram",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID from syson_project_get.",
        },
        element_id: {
          type: "string",
          description:
            "UUID of the SysML element (package, part, etc.) that owns the diagram. " +
            "Obtain via syson_element_children.",
        },
        name: {
          type: "string",
          description:
            "Display name for the new diagram. Defaults to 'Diagram'.",
        },
        description_id: {
          type: "string",
          description:
            "Diagram type ID (UUID). Takes priority over description_label. " +
            "Obtain by calling this tool without description_id/description_label.",
        },
        description_label: {
          type: "string",
          description:
            "Diagram type by name (e.g., 'General View', 'Interconnection View'). " +
            "Case-insensitive partial match. Ignored if description_id is set.",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    handler: async ({
      editing_context_id,
      element_id,
      name,
      description_id,
      description_label,
    }) => {
      const client = getSysonClient();
      const ecId = editing_context_id as string;
      const elementId = element_id as string;

      // Get available diagram types
      const descData = await client.query<GetRepresentationDescriptionsResult>(
        GET_REPRESENTATION_DESCRIPTIONS,
        { editingContextId: ecId, objectId: elementId },
      );

      const descriptions = descData.viewer.editingContext
        .representationDescriptions.edges.map(
          (e) => e.node,
        );

      // If no description specified, list available types
      if (!description_id && !description_label) {
        return {
          message: "No diagram type specified. Available types:",
          availableTypes: descriptions,
        };
      }

      // Resolve description ID
      let resolvedDescId = description_id as string | undefined;
      if (!resolvedDescId && description_label) {
        const label = (description_label as string).toLowerCase();
        const match = descriptions.find(
          (d) =>
            d.label.toLowerCase() === label ||
            d.label.toLowerCase().includes(label),
        );
        if (!match) {
          throw new Error(
            `[lib/syson] syson_diagram_create: No diagram type matching '${description_label}'. ` +
              `Available: ${descriptions.map((d) => d.label).join(", ")}`,
          );
        }
        resolvedDescId = match.id;
      }

      if (!resolvedDescId) {
        throw new Error(
          "[lib/syson] syson_diagram_create: Could not resolve diagram type description ID.",
        );
      }

      // The ViewUsage SysON adds to the element tells which view was created.
      // Never throws: after the creation, a failed listing must not turn a
      // created diagram into an error the caller would retry.
      const viewUsages = () =>
        evalAqlObjects(ecId, VIEW_USAGES, elementId).then(
          (items) =>
            new Map(
              items.filter((item) => item?.id).map((item) => [
                item.id,
                item.label,
              ]),
            ),
        ).catch(() => undefined);
      const before = await viewUsages();

      // Create the diagram
      const mutationId = crypto.randomUUID();
      const data = await client.mutate<CreateRepresentationResult>(
        CREATE_REPRESENTATION,
        {
          input: {
            id: mutationId,
            editingContextId: ecId,
            objectId: elementId,
            representationDescriptionId: resolvedDescId,
            representationName: (name as string) ?? "Diagram",
          },
        },
      );

      const payload = unwrapMutation(data, "createRepresentation");
      const representation = (
        payload as {
          representation: { id: string; label: string; kind: string };
        }
      ).representation;

      const after = await viewUsages();
      const added = before && after
        ? [...after].filter(([id]) => !before.has(id))
        : [];
      // SysON names the ViewUsage after the representation; the name breaks
      // a tie when someone else added a view to the element meanwhile.
      const named = added.filter(([, label]) => label === representation.label);
      const viewUsageId = added.length === 1
        ? added[0][0]
        : named.length === 1
        ? named[0][0]
        : undefined;
      const viewDefinition = await readViewDefinition(ecId, viewUsageId)
        .catch(() => undefined);

      return {
        id: representation.id,
        label: representation.label,
        kind: representation.kind,
        ...(viewUsageId && { viewUsageId }),
        ...(viewDefinition && { viewDefinition }),
      };
    },
  },

  // --------------------------------------------------------------------------
  // syson_diagram_drop
  // --------------------------------------------------------------------------
  {
    name: "syson_diagram_drop",
    description: "Make model elements visible on a diagram. " +
      "Elements must already exist in the model (created via syson_element_create or " +
      "syson_element_insert_sysml). This adds their graphical representation to the diagram. " +
      "Call syson_diagram_arrange after to auto-layout.",
    category: "diagram",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID from syson_project_get.",
        },
        diagram_id: {
          type: "string",
          description:
            "UUID of the target diagram. Obtain via syson_diagram_list or syson_diagram_create.",
        },
        element_ids: {
          type: "array",
          items: { type: "string" },
          description:
            "UUIDs of SysML elements (parts, packages, etc.) to make visible on the diagram. " +
            "Obtain via syson_element_children or syson_query_aql.",
        },
        target_element_id: {
          type: "string",
          description:
            "UUID of an element already on the diagram to drop into (nesting). " +
            "Omit to drop at diagram root level.",
        },
        x: {
          type: "number",
          description: "X pixel position for placement. Defaults to 0.",
        },
        y: {
          type: "number",
          description: "Y pixel position for placement. Defaults to 0.",
        },
      },
      required: ["editing_context_id", "diagram_id", "element_ids"],
    },
    handler: async ({
      editing_context_id,
      diagram_id,
      element_ids,
      target_element_id,
      x,
      y,
    }) => {
      const client = getSysonClient();
      const ecId = editing_context_id as string;
      const diagramId = diagram_id as string;
      const objectIds = element_ids as string[];

      if (objectIds.length === 0) {
        throw new Error(
          "[lib/syson] syson_diagram_drop: element_ids must contain at least one ID.",
        );
      }

      const mutationId = crypto.randomUUID();
      const data = await client.mutate<DropOnDiagramResult>(DROP_ON_DIAGRAM, {
        input: {
          id: mutationId,
          editingContextId: ecId,
          representationId: diagramId,
          objectIds,
          diagramTargetElementId: (target_element_id as string) ?? null,
          startingPositionX: (x as number) ?? 0,
          startingPositionY: (y as number) ?? 0,
        },
      });

      unwrapMutation(data, "dropOnDiagram");
      return {
        dropped: true,
        diagramId,
        elementCount: objectIds.length,
        elementIds: objectIds,
      };
    },
  },

  // --------------------------------------------------------------------------
  // syson_diagram_arrange
  // --------------------------------------------------------------------------
  {
    name: "syson_diagram_arrange",
    description: "Auto-layout all elements on a diagram. " +
      "Call after syson_diagram_drop. Then use syson_diagram_snapshot to render.",
    category: "diagram",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID from syson_project_get.",
        },
        diagram_id: {
          type: "string",
          description:
            "UUID of the diagram to arrange. Obtain via syson_diagram_list or syson_diagram_create.",
        },
      },
      required: ["editing_context_id", "diagram_id"],
    },
    handler: async ({ editing_context_id, diagram_id }) => {
      const client = getSysonClient();
      const mutationId = crypto.randomUUID();

      const data = await client.mutate<ArrangeAllResult>(ARRANGE_ALL, {
        input: {
          id: mutationId,
          editingContextId: editing_context_id as string,
          representationId: diagram_id as string,
        },
      });

      unwrapMutation(data, "arrangeAll");
      return {
        arranged: true,
        diagramId: diagram_id,
      };
    },
  },

  // --------------------------------------------------------------------------
  // syson_diagram_snapshot
  // --------------------------------------------------------------------------
  {
    name: "syson_diagram_snapshot",
    description:
      "Render a diagram as SVG. Shows parts, interfaces, and connections " +
      "with a dark-themed layout. Rendering is local by default. An operator may " +
      "explicitly configure SYSON_KROKI_URL for an external renderer; the result " +
      "then identifies that external path. Call after syson_diagram_arrange for best results. " +
      "Structured `nodes` and `edges` hold only what SysON shows: hidden elements are left out " +
      "and counted in `hiddenNodeCount` / `hiddenEdgeCount`. Nodes nested in a free-form " +
      "compartment have kind `node`; edges carry SysON's `style` (line and arrows). " +
      "`viewDefinition` is the diagram's view type (e.g. " +
      "StandardViewDefinitions::StateTransitionView); `metadata.description` always " +
      "names SysON's single 'General View' diagram description.",
    category: "diagram",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID from syson_project_get.",
        },
        diagram_id: {
          type: "string",
          description:
            "UUID of the diagram to snapshot. Obtain via syson_diagram_list or syson_diagram_create.",
        },
      },
      required: ["editing_context_id", "diagram_id"],
    },
    _meta: {
      ui: {
        resourceUri: "ui://mcp-syson/diagram-viewer",
        emits: ["syson.element.selected"],
      },
    },
    handler: async ({ editing_context_id, diagram_id }) => {
      const client = getSysonClient();
      const baseUrl = client.url;
      const ecId = editing_context_id as string;
      const diagId = diagram_id as string;

      const {
        nodes,
        edges,
        label,
        childToParent,
        targetObjectId,
        metadata,
        hidden,
      } = await fetchDiagramData(
        baseUrl,
        ecId,
        diagId,
      );
      const [rendered, viewDefinition] = await Promise.all([
        renderDiagramSvg(nodes, edges, label, childToParent),
        // Optional: a snapshot stays valid without its view type.
        readViewDefinition(ecId, targetObjectId).catch(() => undefined),
      ]);

      const result = {
        diagramId: diagId,
        editingContextId: ecId,
        targetObjectId,
        metadata,
        diagramLabel: label,
        ...(viewDefinition && { viewDefinition }),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        ...((hidden.nodes || hidden.edges) && {
          hiddenNodeCount: hidden.nodes,
          hiddenEdgeCount: hidden.edges,
        }),
        nodes,
        edges,
        svg: rendered.svg,
        renderer: rendered.renderer,
        ...(rendered.rendererWarning &&
          { rendererWarning: rendered.rendererWarning }),
      };

      return result;
    },
  },
];
