/**
 * Client-side diagram scene (syson-diagram-design.md §1–§3): the snapshot's
 * structured nodes and edges become blocks, compartments, ports and routed
 * edges in diagram coordinates. Pure: text width comes from an injected
 * `TextMeasure`, so the same code runs in the viewer and in the unit tests.
 */
import { kindInfo, type KindTone } from "../../shared/sysml-kind.ts";
import {
  type DiagramPoint,
  type DiagramRect,
  sameDiagramElement,
} from "./diagram-model.ts";

// ── Snapshot input ──────────────────────────────────────────────────────────

export interface SnapshotNodeStyle {
  readonly kind?: string;
  readonly imageURL?: string;
  readonly background?: string;
  /** `list`: children stack as rows; `free`: children are nested nodes. */
  readonly childrenLayout?: "list" | "free";
}
export interface SnapshotNode {
  readonly id: string;
  readonly label?: string;
  readonly targetObjectId?: string;
  readonly type?: string;
  readonly kind?: string;
  readonly parentId?: string;
  readonly hasLayout?: boolean;
  readonly faded?: boolean;
  readonly outsideLabels?: readonly string[];
  readonly style?: SnapshotNodeStyle;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}
/** SysON edge style: `lineStyle` and `ArrowStyle` names as SysON gives them. */
export interface SnapshotEdgeStyle {
  readonly lineStyle?: string;
  readonly sourceArrow?: string;
  readonly targetArrow?: string;
}
export interface SnapshotEdge {
  readonly id: string;
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly label?: string;
  readonly targetObjectId?: string;
  readonly type?: string;
  readonly beginLabel?: string;
  readonly endLabel?: string;
  readonly style?: SnapshotEdgeStyle;
  readonly faded?: boolean;
  readonly routingPoints?: readonly DiagramPoint[];
}

/** Native styles the client renderer draws; anything else keeps the server SVG. */
const KNOWN_STYLES = new Set([
  "RectangularNodeStyle",
  "EllipseNodeStyle",
  "ImageNodeStyle",
  "IconLabelNodeStyle",
  "SysMLViewFrameNodeStyle",
]);

/** A view frame, or a node whose children SysON lays out freely: they are nodes. */
export function holdsNodes(node: SnapshotNode | undefined): boolean {
  return node?.style?.childrenLayout === "free" ||
    node?.style?.kind === "SysMLViewFrameNodeStyle";
}

/**
 * The viewer draws the diagram itself when the snapshot carries structured
 * nodes it understands. Recorded sessions without nodes, a native style this
 * renderer does not know, or an edge between two rows of one block (which a
 * block with rows cannot show) keep the sanitized server SVG. Nodes nested
 * in a free-form compartment are blocks of their own, so edges between them
 * are drawn.
 */
export function clientRenderable(
  snapshot: { readonly nodes?: unknown; readonly edges?: unknown },
): boolean {
  const nodes = snapshot.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return false;
  if (snapshot.edges !== undefined && !Array.isArray(snapshot.edges)) {
    return false;
  }
  const byId = new Map<string, SnapshotNode>();
  for (const node of nodes as SnapshotNode[]) {
    if (!node || typeof node.id !== "string" || !node.id) return false;
    if (node.style?.kind !== undefined && !KNOWN_STYLES.has(node.style.kind)) {
      return false;
    }
    byId.set(node.id, node);
  }
  /** The block a node is drawn in: itself when it is a block. */
  const blockOf = (id: string | undefined) => {
    let node = id ? byId.get(id) : undefined;
    for (let depth = 0; node; depth++) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (!parent || holdsNodes(parent) || depth > 64) return node.id;
      node = parent;
    }
    return undefined;
  };
  for (const edge of (snapshot.edges ?? []) as SnapshotEdge[]) {
    if (!edge || edge.sourceId === edge.targetId) continue;
    const source = blockOf(edge.sourceId);
    if (source && source === blockOf(edge.targetId)) return false;
  }
  return (nodes as SnapshotNode[]).some((node) =>
    !node.parentId || !byId.has(node.parentId)
  );
}

// ── Level of detail (§3) ────────────────────────────────────────────────────

export type DiagramDetail = "full" | "header" | "tint";
export const DETAIL_FULL_SCALE = 0.6;
export const DETAIL_HEADER_SCALE = 0.3;

/** ≥ 0.6 full blocks, 0.3–0.6 header only, < 0.3 tinted rectangles. */
export function levelOfDetail(scale: number): DiagramDetail {
  if (!Number.isFinite(scale) || scale >= DETAIL_FULL_SCALE) return "full";
  return scale >= DETAIL_HEADER_SCALE ? "header" : "tint";
}

// ── Edge markers (§2) ───────────────────────────────────────────────────────

export type EdgeMarker =
  | "specialization"
  | "dependency"
  | "composition"
  | "flow"
  | "none";

const MARKER_WORDS: readonly (readonly [EdgeMarker, readonly string[]])[] = [
  ["specialization", [
    "subclassification",
    "specialization",
    "specialisation",
    "generalization",
    "subsetting",
    "redefinition",
    "conjugation",
  ]],
  ["dependency", [
    "featuretyping",
    "typing",
    "satisfy",
    "verify",
    "dependency",
    "allocat",
    "refine",
    "derive",
    "trace",
    "import",
    "expose",
  ]],
  ["composition", [
    "composition",
    "composite",
    "membership",
    "containment",
    "owning",
  ]],
  ["flow", [
    "connection",
    "connector",
    "flow",
    "binding",
    "succession",
    "transition",
    "message",
    "interface",
  ]],
];

function markerFromWords(text: string): EdgeMarker {
  const plain = text.toLowerCase().replace(/[^a-z]/g, "");
  if (!plain) return "none";
  for (const [marker, words] of MARKER_WORDS) {
    if (words.some((word) => plain.includes(word))) return marker;
  }
  return "none";
}

/**
 * Marker from the edge type, else from a «keyword» in its center label.
 * Rendering types such as `edge:straight` say nothing: plain line, never an
 * invented semantic.
 */
export function edgeMarker(
  edge: { readonly type?: string; readonly label?: string },
): EdgeMarker {
  const byType = markerFromWords((edge.type ?? "").replace(/^edge:/i, ""));
  if (byType !== "none") return byType;
  for (const match of (edge.label ?? "").matchAll(/«([^»]*)»/g)) {
    const byLabel = markerFromWords(match[1]);
    if (byLabel !== "none") return byLabel;
  }
  return "none";
}

export type EdgeLine = "solid" | "dash" | "dot" | "dashDot";
/** What one end of an edge carries (SysON `ArrowStyle`, simplified). */
export type EdgeEnd =
  | "none"
  | "arrow"
  | "triangle"
  | "filledTriangle"
  | "diamond"
  | "filledDiamond"
  | "circle"
  | "filledCircle"
  | "crossedCircle"
  | "triangleBar"
  | "triangleDots"
  | "triangle4Dots";
export interface EdgeTip {
  readonly shape: EdgeEnd;
  /** Points away from the node it touches (SysON `Output…` arrows). */
  readonly outward: boolean;
}
export interface EdgeDecoration {
  readonly line: EdgeLine;
  readonly source: EdgeTip;
  readonly target: EdgeTip;
}

const ARROWS: Record<string, readonly [EdgeEnd, boolean]> = {
  None: ["none", false],
  InputArrow: ["arrow", false],
  OutputArrow: ["arrow", true],
  InputClosedArrow: ["triangle", false],
  OutputClosedArrow: ["triangle", true],
  InputFillClosedArrow: ["filledTriangle", false],
  OutputFillClosedArrow: ["filledTriangle", true],
  Diamond: ["diamond", false],
  FillDiamond: ["filledDiamond", false],
  InputArrowWithDiamond: ["diamond", false],
  InputArrowWithFillDiamond: ["filledDiamond", false],
  Circle: ["circle", false],
  FillCircle: ["filledCircle", false],
  CrossedCircle: ["crossedCircle", false],
  ClosedArrowWithVerticalBar: ["triangleBar", false],
  ClosedArrowWithDots: ["triangleDots", false],
  ClosedArrowWith4Dots: ["triangle4Dots", false],
};
const LINES: Record<string, EdgeLine> = {
  Solid: "solid",
  Dash: "dash",
  Dot: "dot",
  Dash_Dot: "dashDot",
};
const NO_TIP: EdgeTip = { shape: "none", outward: false };
const tip = (shape: EdgeEnd): EdgeTip => ({ shape, outward: false });

/**
 * SysON's own edge style when the snapshot carries it (exact notation:
 * dashed successions, filled flow heads…); otherwise the marker read from
 * the type. An arrow name this viewer does not know draws nothing.
 */
export function edgeDecoration(
  edge: { readonly style?: SnapshotEdgeStyle },
  marker: EdgeMarker,
): EdgeDecoration {
  const style = edge.style;
  if (style && (style.lineStyle || style.sourceArrow || style.targetArrow)) {
    const end = (name?: string): EdgeTip => {
      const known = name ? ARROWS[name] : undefined;
      return known ? { shape: known[0], outward: known[1] } : NO_TIP;
    };
    return {
      line: LINES[style.lineStyle ?? ""] ?? "solid",
      source: end(style.sourceArrow),
      target: end(style.targetArrow),
    };
  }
  switch (marker) {
    case "specialization":
      return { line: "solid", source: NO_TIP, target: tip("triangle") };
    case "dependency":
      return { line: "dash", source: NO_TIP, target: tip("arrow") };
    case "composition":
      return { line: "solid", source: tip("filledDiamond"), target: NO_TIP };
    case "flow":
      return { line: "solid", source: NO_TIP, target: tip("filledTriangle") };
    default:
      return { line: "solid", source: NO_TIP, target: NO_TIP };
  }
}

// ── Labels and kinds ────────────────────────────────────────────────────────

export interface ParsedLabel {
  readonly stereotypes: readonly string[];
  readonly name: string;
}

/** «stereotypes» apart from the name; outside labels stand in when inside is empty. */
export function parseNodeLabel(
  label: string | undefined,
  outside: readonly string[] = [],
): ParsedLabel {
  const text = label?.trim()
    ? label
    : outside.filter((value) => value.trim()).join(" ");
  const stereotypes = [...text.matchAll(/«([^»]*)»/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const name = text.replace(/«[^»]*»/g, " ").replace(/\s+/g, " ").trim();
  return { stereotypes, name };
}

/** Keywords that qualify an element rather than name its kind. */
const QUALIFIERS = new Set([
  "abstract",
  "variation",
  "variant",
  "timeslice",
  "snapshot",
  "individual",
  "ref",
  "in",
  "out",
  "inout",
  "end",
  "derived",
  "readonly",
  "portion",
  "composite",
]);

/** `part def` → `PartDefinition`, `perform action` → `PerformActionUsage`. */
export function kindFromKeyword(keyword: string): string | undefined {
  const words = keyword.trim().toLowerCase().split(/\s+/).filter((word) =>
    /^[a-z]+$/.test(word)
  );
  const definition = words.at(-1) === "def";
  if (definition) words.pop();
  if (!words.length) return undefined;
  const base = words.map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
  return `${base}${definition ? "Definition" : "Usage"}`;
}

/** The last kind keyword names the kind; the others stay as qualifiers. */
export function blockKind(
  stereotypes: readonly string[],
  style?: SnapshotNodeStyle,
): { kind?: string; qualifiers: string[] } {
  let kindIndex = -1;
  for (let index = stereotypes.length - 1; index >= 0; index--) {
    if (!QUALIFIERS.has(stereotypes[index].toLowerCase())) {
      kindIndex = index;
      break;
    }
  }
  const kind = kindIndex >= 0
    ? kindFromKeyword(stereotypes[kindIndex])
    : style?.kind === "ImageNodeStyle" &&
        /(?:^|\/)actor\.svg$/i.test(style.imageURL ?? "")
    ? "ActorUsage"
    : undefined;
  return {
    kind,
    qualifiers: stereotypes.filter((_, index) => index !== kindIndex),
  };
}

/** Row text: one line; javadoc-style `*` continuation markers dropped. */
export function rowText(label: string): string {
  const lines = label.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulleted = lines.length > 0 && lines.every((line) => /^\*/.test(line));
  return (bulleted ? lines.map((line) => line.replace(/^\*\s?/, "")) : lines)
    .join(" ").replace(/\s+/g, " ").trim();
}

// ── Model ───────────────────────────────────────────────────────────────────

export type PortSide = "west" | "east" | "north" | "south";
export type BlockShape =
  | "card"
  | "frame"
  | "start"
  | "done"
  | "decision"
  | "bar";

export interface ModelRow {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly text: string;
  readonly title: string;
}
export interface ModelSection {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly ModelRow[];
  /** Position among the block's compartments (sections and regions). */
  readonly order: number;
  /** Authored geometry, absolute diagram coordinates. */
  readonly authored?: DiagramRect;
}
/** A free-form compartment: the nested blocks SysON lays out inside it. */
export interface ModelRegion {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly authored?: DiagramRect;
  readonly children: readonly string[];
}
export interface ModelPort {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly label: string;
  readonly side: PortSide;
  /** Parameter direction, from SysON's in/out feature images. */
  readonly direction?: "in" | "out";
  /** Authored geometry, absolute diagram coordinates. */
  readonly authored?: DiagramRect;
}
export interface ModelBlock {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly name: string;
  /** Full source label, for the tooltip. */
  readonly title: string;
  readonly qualifiers: readonly string[];
  readonly kind?: string;
  readonly marker?: string;
  readonly tone: KindTone;
  readonly definition: boolean;
  readonly shape: BlockShape;
  readonly sections: readonly ModelSection[];
  /** Free-form compartments; a block with regions is a container. */
  readonly regions: readonly ModelRegion[];
  readonly ports: readonly ModelPort[];
  readonly rowCount: number;
  /** Containing block, for blocks nested in a region. */
  readonly parent?: string;
  readonly depth: number;
  /** Name drawn under a control node (fork, join, decision). */
  readonly caption?: string;
  readonly faded?: boolean;
  /** Authored geometry, absolute diagram coordinates. */
  readonly authored?: DiagramRect;
}
export interface ModelEdge {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly sourceBlock: string;
  readonly targetBlock: string;
  readonly sourcePort?: string;
  readonly targetPort?: string;
  /** Row drawn inside the block that the edge really ends on. */
  readonly sourceRow?: string;
  readonly targetRow?: string;
  readonly label?: string;
  readonly beginLabel?: string;
  readonly endLabel?: string;
  readonly marker: EdgeMarker;
  readonly decoration: EdgeDecoration;
  readonly faded?: boolean;
  readonly routing?: readonly DiagramPoint[];
}
export interface DiagramModel {
  /** Parents always come before the blocks nested in them. */
  readonly blocks: readonly ModelBlock[];
  readonly edges: readonly ModelEdge[];
}

/** A block with free-form compartments draws its nested blocks itself. */
export const isContainer = (block: ModelBlock) =>
  block.regions.length > 0 || block.shape === "frame";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const semanticId = (value?: string) => value?.trim() ? value : undefined;

const BLACK = new Set(["black", "#000", "#000000"]);

function controlShape(node: SnapshotNode): BlockShape {
  if (node.style?.kind === "SysMLViewFrameNodeStyle") return "frame";
  const image = node.style?.kind === "ImageNodeStyle"
    ? /(?:^|\/)images\/(decision|merge|start|done)_action\.svg$/.exec(
      node.style.imageURL ?? "",
    )?.[1]
    : undefined;
  if (image === "decision" || image === "merge") return "decision";
  if (image === "start") return "start";
  if (image === "done") return "done";
  // Fork and join bars: black, no inside label (the name sits outside).
  if (
    !node.label?.trim() &&
    BLACK.has(node.style?.background?.toLowerCase() ?? "")
  ) return node.style?.kind === "EllipseNodeStyle" ? "start" : "bar";
  return "card";
}

function portDirection(node: SnapshotNode): ModelPort["direction"] {
  if (node.style?.kind !== "ImageNodeStyle") return undefined;
  const match = /(?:^|\/)feature_(in|out)\.svg$/.exec(
    node.style.imageURL ?? "",
  );
  return match?.[1] as ModelPort["direction"];
}

/**
 * Structure the snapshot into blocks. A block's compartments (decorative
 * children with its own semantic target) become titled sections of rows,
 * or regions when SysON lays their children out freely: those children are
 * blocks of their own, nested in the region. A view frame holds its nodes
 * the same way. Border nodes become ports. Every descendant maps to the
 * block that draws it, so edges always find a drawn endpoint.
 */
export function buildDiagramModel(
  nodes: readonly SnapshotNode[],
  edges: readonly SnapshotEdge[] = [],
): DiagramModel {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, SnapshotNode[]>();
  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const list = children.get(node.parentId) ?? [];
      list.push(node);
      children.set(node.parentId, list);
    }
  }
  const roots = nodes.filter((node) =>
    !node.parentId || !byId.has(node.parentId)
  );

  // Absolute authored geometry: SysON positions are relative to the parent.
  const absolute = new Map<string, DiagramRect | null>();
  const authoredRect = (node: SnapshotNode, depth = 0): DiagramRect | null => {
    if (absolute.has(node.id)) return absolute.get(node.id)!;
    absolute.set(node.id, null); // cycle guard
    let rect: DiagramRect | null = null;
    if (
      node.hasLayout !== false && finite(node.x) && finite(node.y) &&
      finite(node.width) && finite(node.height) && node.width > 0 &&
      node.height > 0 && depth < 64
    ) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      const origin = parent ? authoredRect(parent, depth + 1) : undefined;
      if (!parent || origin) {
        rect = {
          x: node.x + (origin?.x ?? 0),
          y: node.y + (origin?.y ?? 0),
          width: node.width,
          height: node.height,
        };
      }
    }
    absolute.set(node.id, rect);
    return rect;
  };

  const owner = new Map<string, string>();
  const anchorRow = new Map<string, string>();
  const portIds = new Set<string>();
  const incoming = new Set(edges.map((edge) => edge.targetId));
  const outgoing = new Set(edges.map((edge) => edge.sourceId));

  const claim = (node: SnapshotNode, block: string, row?: string) => {
    const stack = [node];
    const seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      owner.set(current.id, block);
      if (row) anchorRow.set(current.id, row);
      stack.push(...(children.get(current.id) ?? []));
    }
  };

  const blocks: ModelBlock[] = [];
  const placed = new Set<string>();
  const addBlock = (node: SnapshotNode, parent?: string, depth = 0) => {
    if (placed.has(node.id) || depth > 32) return;
    placed.add(node.id);
    claim(node, node.id);
    const parsed = parseNodeLabel(node.label, node.outsideLabels);
    const shape = controlShape(node);
    const control = shape !== "card" && shape !== "frame";
    const { kind, qualifiers } = control
      ? { kind: undefined, qualifiers: [] }
      : blockKind(parsed.stereotypes, node.style);
    const info = kind ? kindInfo(kind) : undefined;
    const blockRect = authoredRect(node);
    const sections: ModelSection[] = [];
    const regions: (ModelRegion & { children: string[] })[] = [];
    const ports: ModelPort[] = [];
    const nested: [SnapshotNode, string[]][] = [];
    let loose: ModelRow[] | undefined;
    let order = 0;

    const decorative = (child: SnapshotNode, owner: SnapshotNode) =>
      child.kind === "compartment" &&
      sameDiagramElement(child.targetObjectId, owner.targetObjectId);
    const toRow = (child: SnapshotNode): ModelRow => {
      claim(child, node.id, child.id);
      const label = parseNodeLabel(child.label, child.outsideLabels);
      const source = child.label?.trim()
        ? child.label
        : (child.outsideLabels ?? []).join(" ");
      return {
        id: child.id,
        targetObjectId: semanticId(child.targetObjectId),
        text: label.stereotypes.length ? label.name : rowText(source),
        title: source.replace(/\s+/g, " ").trim(),
      };
    };
    const collectRows = (section: SnapshotNode, level = 0): ModelRow[] => {
      const rows: ModelRow[] = [];
      for (const child of children.get(section.id) ?? []) {
        if (child.kind === "port") continue;
        if (decorative(child, section) && level < 8) {
          rows.push(...collectRows(child, level + 1));
        } else rows.push(toRow(child));
      }
      return rows.filter((row) => row.text);
    };
    const addPort = (child: SnapshotNode) => {
      portIds.add(child.id);
      const rect = authoredRect(child);
      const label = (child.label?.trim() ? child.label : "") ||
        (child.outsideLabels ?? []).filter(Boolean).join(" ");
      let side: PortSide = incoming.has(child.id) && !outgoing.has(child.id)
        ? "west"
        : "east";
      if (rect && blockRect) {
        const distances: [PortSide, number][] = [
          ["west", Math.abs(rect.x + rect.width / 2 - blockRect.x)],
          [
            "east",
            Math.abs(rect.x + rect.width / 2 - blockRect.x - blockRect.width),
          ],
          ["north", Math.abs(rect.y + rect.height / 2 - blockRect.y)],
          [
            "south",
            Math.abs(rect.y + rect.height / 2 - blockRect.y - blockRect.height),
          ],
        ];
        side = distances.sort((a, b) => a[1] - b[1])[0][0];
      }
      const direction = portDirection(child);
      ports.push({
        id: child.id,
        targetObjectId: semanticId(child.targetObjectId),
        label: label.replace(/\s+/g, " ").trim(),
        side,
        ...(direction && { direction }),
        authored: rect && blockRect ? rect : undefined,
      });
    };
    const addRegion = (holder: SnapshotNode, title: string) => {
      const region = {
        id: holder.id,
        title,
        order: order++,
        // A frame is its own region: no band of its own to place.
        authored: holder === node
          ? undefined
          : authoredRect(holder) ?? undefined,
        children: [] as string[],
      };
      regions.push(region);
      for (const child of children.get(holder.id) ?? []) {
        if (child.kind === "port") {
          if (holder === node) addPort(child);
        } else nested.push([child, region.children]);
      }
    };

    if (control) {
      for (const child of children.get(node.id) ?? []) {
        if (child.kind === "port") addPort(child);
      }
    } else if (holdsNodes(node)) {
      // A view frame (or a free-form node): its children are blocks.
      addRegion(node, "");
    } else {
      for (const child of children.get(node.id) ?? []) {
        if (child.kind === "port") {
          addPort(child);
          loose = undefined;
        } else if (decorative(child, node) && holdsNodes(child)) {
          loose = undefined;
          addRegion(child, parseNodeLabel(child.label).name);
        } else if (decorative(child, node)) {
          loose = undefined;
          const rows = collectRows(child);
          if (rows.length) {
            sections.push({
              id: child.id,
              title: parseNodeLabel(child.label).name,
              rows,
              order: order++,
              authored: authoredRect(child) ?? undefined,
            });
          }
        } else {
          const row = toRow(child);
          if (!row.text) continue;
          if (!loose) {
            loose = [];
            sections.push({
              id: `${child.id}:rows`,
              title: "",
              rows: loose,
              order: order++,
            });
          }
          loose.push(row);
        }
      }
    }
    const caption = control
      ? (node.outsideLabels ?? []).map((label) => label.trim()).filter(Boolean)
        .join(" ") || undefined
      : undefined;
    // A view frame names a standard view: keep the last segment of its type.
    const name = shape === "frame"
      ? parsed.name.replace(/(?:[\w$]+::)+/g, "")
      : parsed.name;
    blocks.push({
      id: node.id,
      targetObjectId: semanticId(node.targetObjectId),
      name: control ? caption ?? "" : name,
      title: (node.label?.trim() ? node.label : parsed.name).replace(
        /\s+/g,
        " ",
      ).trim(),
      qualifiers,
      kind,
      marker: info?.marker,
      tone: info?.tone ?? "neutral",
      definition: info?.definition ?? false,
      shape,
      sections,
      regions,
      ports,
      rowCount: sections.reduce((sum, section) => sum + section.rows.length, 0),
      ...(parent && { parent }),
      depth,
      ...(caption && { caption }),
      ...(node.faded && { faded: true }),
      authored: blockRect ?? undefined,
    });
    for (const [child, list] of nested) {
      if (placed.has(child.id)) continue;
      list.push(child.id);
      addBlock(child, node.id, depth + 1);
    }
  };
  for (const root of roots) addBlock(root);

  const modelEdges: ModelEdge[] = [];
  for (const edge of edges) {
    const sourceBlock = edge.sourceId ? owner.get(edge.sourceId) : undefined;
    const targetBlock = edge.targetId ? owner.get(edge.targetId) : undefined;
    if (!sourceBlock || !targetBlock) continue;
    const marker = edgeMarker(edge);
    modelEdges.push({
      id: edge.id,
      targetObjectId: semanticId(edge.targetObjectId),
      sourceBlock,
      targetBlock,
      sourcePort: edge.sourceId && portIds.has(edge.sourceId)
        ? edge.sourceId
        : undefined,
      targetPort: edge.targetId && portIds.has(edge.targetId)
        ? edge.targetId
        : undefined,
      sourceRow: edge.sourceId ? anchorRow.get(edge.sourceId) : undefined,
      targetRow: edge.targetId ? anchorRow.get(edge.targetId) : undefined,
      label: edge.label?.trim() || undefined,
      beginLabel: edge.beginLabel?.trim() || undefined,
      endLabel: edge.endLabel?.trim() || undefined,
      marker,
      decoration: edgeDecoration(edge, marker),
      ...(edge.faded && { faded: true }),
      routing: edge.routingPoints?.filter((point) =>
        finite(point.x) && finite(point.y)
      ),
    });
  }
  return { blocks, edges: modelEdges };
}

// ── Text measurement and fitting ────────────────────────────────────────────

export interface FontSpec {
  readonly size: number;
  readonly weight?: number;
  readonly mono?: boolean;
  /** Letter spacing in em. */
  readonly spacing?: number;
}
export type TextMeasure = (text: string, font: FontSpec) => number;

export const FONTS = {
  name: { size: 13, weight: 600 },
  qualifier: { size: 11 },
  pill: { size: 9.5, weight: 600, mono: true, spacing: 0.04 },
  title: { size: 10, weight: 600, spacing: 0.06 },
  row: { size: 12 },
  more: { size: 11 },
  port: { size: 10.5 },
  edgeLabel: { size: 11 },
} as const satisfies Record<string, FontSpec>;

/** Deterministic width estimate (tests, and before the canvas exists). */
export const approximateMeasure: TextMeasure = (text, font) =>
  text.length * font.size * ((font.mono ? 0.6 : 0.55) + (font.spacing ?? 0));

const ELLIPSIS = "…";

/** One line, cut with an ellipsis at `maxWidth`. */
export function ellipsize(
  text: string,
  maxWidth: number,
  width: (text: string) => number,
): string {
  if (width(text) <= maxWidth) return text;
  if (width(ELLIPSIS) > maxWidth) return "";
  let low = 0, high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (width(text.slice(0, middle).trimEnd() + ELLIPSIS) <= maxWidth) {
      low = middle;
    } else high = middle - 1;
  }
  return text.slice(0, low).trimEnd() + ELLIPSIS;
}

/** The last camelCase or punctuation boundary at or before `max`, else `max`. */
export function naturalBreak(word: string, max: number): number {
  for (let index = Math.min(max, word.length - 1); index >= 3; index--) {
    const before = word[index - 1], after = word[index];
    if (
      (/[a-z0-9]/.test(before) && /[A-Z]/.test(after)) ||
      /[_\-.:/\]]/.test(before)
    ) return index;
  }
  return max;
}

/**
 * Greedy word wrap into at most `maxLines`; the first line may be narrower
 * (a pill sits before it). Words wider than a line break by characters; the
 * last line ends with an ellipsis when text remains.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  width: (text: string) => number,
  firstLineWidth = maxWidth,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  if (maxLines < 1 || !words.length) return lines;
  const limit = () => lines.length ? maxWidth : firstLineWidth;
  let current = "";
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    const candidate = current ? `${current} ${word}` : word;
    if (width(candidate) <= limit()) {
      current = candidate;
      index++;
      continue;
    }
    if (current) {
      if (lines.length === maxLines - 1) break;
      lines.push(current);
      current = "";
      continue;
    }
    // A single word wider than the line: split it, at a camelCase or
    // punctuation boundary when one fits ("Power|Interface").
    let cut = 1;
    while (cut < word.length && width(word.slice(0, cut + 1)) <= limit()) {
      cut++;
    }
    cut = naturalBreak(word, cut);
    if (lines.length === maxLines - 1) {
      current = word;
      index++;
      break;
    }
    lines.push(word.slice(0, cut));
    words[index] = word.slice(cut);
  }
  const rest = words.slice(index).join(" ");
  const last = rest ? `${current} ${rest}`.trim() : current;
  if (last) lines.push(ellipsize(last, limit(), width));
  return lines.filter(Boolean);
}

// ── Block metrics and content ───────────────────────────────────────────────

export const BLOCK = {
  minWidth: 240,
  maxWidth: 340,
  padX: 12,
  padTop: 9,
  nameLine: 17,
  maxNameLines: 2,
  qualifierLine: 14,
  headerBottom: 8,
  pillHeight: 16,
  pillPadX: 5,
  pillGap: 7,
  sectionTitle: 22,
  row: 20,
  maxRows: 6,
  bottom: 6,
  minHeight: 48,
  port: 10,
  portGap: 18,
  portLabelMax: 150,
  radius: 8,
  control: 28,
  /** Region (free-form compartment) title band and inner padding. */
  regionTitle: 24,
  regionPad: 16,
  /** Smallest drawn region when it has no authored size. */
  regionMin: 64,
  /** Caption line under a control node. */
  caption: 14,
} as const;

export interface ContentRow {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly text: string;
  readonly title: string;
  /** Top of the row, relative to the block. */
  readonly y: number;
}
export interface ContentSection {
  readonly id: string;
  readonly title: string;
  /** Top of the section (its hairline), relative to the block. */
  readonly y: number;
  readonly rows: readonly ContentRow[];
  /** "+N more" line: hidden rows of this section. */
  readonly more?: { readonly count: number; readonly y: number };
  /** Containers: the section's band, from `y` (else it ends after its rows). */
  readonly height?: number;
}
/** A free-form compartment band of a container, relative to the block. */
export interface ContentRegion {
  readonly id: string;
  readonly title: string;
  readonly y: number;
  readonly height: number;
}
export interface BlockContent {
  readonly pillWidth: number;
  readonly nameLines: readonly string[];
  readonly qualifier?: string;
  readonly headerHeight: number;
  /** Containers: where the header starts in its band (centered). */
  readonly headerTop: number;
  readonly sections: readonly ContentSection[];
  readonly regions: readonly ContentRegion[];
  /** Height the content needs; authored blocks may be shorter or taller. */
  readonly height: number;
}

const width = (measure: TextMeasure, font: FontSpec) => (text: string) =>
  measure(text, font);

export function pillWidth(marker: string | undefined, measure: TextMeasure) {
  return marker
    ? Math.ceil(measure(marker, FONTS.pill) + BLOCK.pillPadX * 2)
    : 0;
}

function qualifierText(block: ModelBlock) {
  return block.qualifiers.length
    ? block.qualifiers.map((value) => `«${value}»`).join(" ")
    : undefined;
}

/** Content-driven size for blocks without an authored geometry. */
export function preferredBlockSize(
  block: ModelBlock,
  measure: TextMeasure,
): { width: number; height: number } {
  if (block.shape !== "card" && block.shape !== "frame") {
    return block.shape === "bar"
      ? { width: 60, height: 8 }
      : { width: BLOCK.control, height: BLOCK.control };
  }
  if (isContainer(block)) {
    // The header and list sections; regions at their smallest.
    const width = containerWidth(block, measure);
    return {
      width,
      height: compartmentSlots(block, width, measure, () => BLOCK.regionMin)
        .height,
    };
  }
  const pill = pillWidth(block.marker, measure);
  const header = BLOCK.padX * 2 + (pill ? pill + BLOCK.pillGap : 0) +
    measure(block.name, FONTS.name);
  let content = header;
  const qualifier = qualifierText(block);
  if (qualifier) {
    content = Math.max(
      content,
      BLOCK.padX * 2 + (pill ? pill + BLOCK.pillGap : 0) +
        measure(qualifier, FONTS.qualifier),
    );
  }
  for (const section of block.sections) {
    content = Math.max(
      content,
      BLOCK.padX * 2 + measure(section.title.toUpperCase(), FONTS.title),
    );
    for (const row of section.rows.slice(0, BLOCK.maxRows)) {
      content = Math.max(
        content,
        BLOCK.padX * 2 + 4 + measure(row.text, FONTS.row),
      );
    }
  }
  const blockWidth = Math.round(
    Math.min(BLOCK.maxWidth, Math.max(BLOCK.minWidth, content)),
  );
  const laid = layoutBlockContent(block, blockWidth, undefined, measure);
  const perSide = new Map<PortSide, number>();
  for (const port of block.ports) {
    perSide.set(port.side, (perSide.get(port.side) ?? 0) + 1);
  }
  const portHeight = Math.max(
    perSide.get("west") ?? 0,
    perSide.get("east") ?? 0,
  ) * BLOCK.portGap;
  return {
    width: blockWidth,
    height: Math.max(
      BLOCK.minHeight,
      laid.height,
      portHeight ? laid.headerHeight + portHeight + 6 : 0,
    ),
  };
}

/**
 * Header (pill, wrapped name, qualifiers) then titled sections with at most
 * six rows each. With an authored `height`, rows that do not fit fold into
 * the "+N more" line of their section.
 */
export function layoutBlockContent(
  block: ModelBlock,
  blockWidth: number,
  height: number | undefined,
  measure: TextMeasure,
): BlockContent {
  const pill = pillWidth(block.marker, measure);
  const nameX = BLOCK.padX + (pill ? pill + BLOCK.pillGap : 0);
  const nameWidth = Math.max(24, blockWidth - nameX - BLOCK.padX);
  const titled = block.shape === "card" || block.shape === "frame";
  const nameLines = titled
    ? wrapText(
      block.name,
      nameWidth,
      block.shape === "frame" ? 1 : BLOCK.maxNameLines,
      width(measure, FONTS.name),
    )
    : [];
  const qualifier = qualifierText(block);
  const headerHeight = titled
    ? BLOCK.padTop + Math.max(1, nameLines.length) * BLOCK.nameLine +
      (qualifier ? BLOCK.qualifierLine : 0) + BLOCK.headerBottom
    : 0;
  const limit = height === undefined ? Infinity : height - BLOCK.bottom;
  const rowWidth = blockWidth - BLOCK.padX * 2 - 4;
  const rowFit = width(measure, FONTS.row);
  const sections: ContentSection[] = [];
  let y = headerHeight;
  for (const section of block.sections) {
    if (block.shape !== "card") break;
    const top = y;
    const titled = !!section.title;
    if (titled) y += BLOCK.sectionTitle;
    else y += 4;
    if (y + BLOCK.row > limit) {
      y = top;
      break;
    }
    const rows: ContentRow[] = [];
    let more: ContentSection["more"];
    for (const [index, row] of section.rows.entries()) {
      const remaining = section.rows.length - index;
      const capped = index === BLOCK.maxRows && remaining > 0;
      const noRoom = y + BLOCK.row * (remaining > 1 ? 2 : 1) > limit &&
        y + BLOCK.row <= limit && remaining > 1;
      if (capped || noRoom) {
        more = { count: remaining, y };
        y += BLOCK.row;
        break;
      }
      if (y + BLOCK.row > limit) break;
      rows.push({
        id: row.id,
        targetObjectId: row.targetObjectId,
        text: ellipsize(row.text, rowWidth, rowFit),
        title: row.title,
        y,
      });
      y += BLOCK.row;
    }
    sections.push({ id: section.id, title: section.title, y: top, rows, more });
  }
  return {
    pillWidth: pill,
    nameLines,
    qualifier,
    headerHeight,
    headerTop: 0,
    sections,
    regions: [],
    height: Math.max(BLOCK.minHeight, y + (sections.length ? BLOCK.bottom : 0)),
  };
}

/** Header width of a container: its name on one line, within bounds. */
function containerWidth(block: ModelBlock, measure: TextMeasure): number {
  const pill = pillWidth(block.marker, measure);
  let content = BLOCK.padX * 2 + (pill ? pill + BLOCK.pillGap : 0) +
    measure(block.name, FONTS.name);
  for (const section of block.sections) {
    for (const row of section.rows.slice(0, BLOCK.maxRows)) {
      content = Math.max(
        content,
        BLOCK.padX * 2 + 4 + measure(row.text, FONTS.row),
      );
    }
  }
  return Math.round(
    Math.min(BLOCK.maxWidth * 1.4, Math.max(BLOCK.minWidth, content)),
  );
}

/** Height a list section needs for its title and (capped) rows. */
function sectionHeight(section: ModelSection): number {
  const shown = Math.min(section.rows.length, BLOCK.maxRows + 1);
  return (section.title ? BLOCK.sectionTitle : 4) + shown * BLOCK.row +
    BLOCK.bottom;
}

export interface CompartmentSlot {
  readonly id: string;
  readonly region: boolean;
  /** Top of the band, relative to the block. */
  readonly y: number;
  readonly height: number;
}

/**
 * A container's compartments stacked in model order under its header:
 * sections at the height their rows need, regions at the height `regionHeight`
 * gives them (the nested layout). Used where SysON authored no geometry
 * (fallback grid, Auto layout).
 */
export function compartmentSlots(
  block: ModelBlock,
  blockWidth: number,
  measure: TextMeasure,
  regionHeight: (region: ModelRegion) => number,
): { slots: CompartmentSlot[]; headerHeight: number; height: number } {
  const header = layoutBlockContent(
    { ...block, sections: [] },
    blockWidth,
    undefined,
    measure,
  ).headerHeight;
  const slots: CompartmentSlot[] = [];
  let y = header;
  const ordered = [
    ...block.sections.map((section) => ({
      id: section.id,
      order: section.order,
      region: false,
      height: sectionHeight(section),
    })),
    ...block.regions.map((region) => ({
      id: region.id,
      order: region.order,
      region: true,
      height: Math.max(BLOCK.regionMin, regionHeight(region)),
    })),
  ].sort((a, b) => a.order - b.order);
  for (const { id, region, height } of ordered) {
    slots.push({ id, region, y, height });
    y += height;
  }
  return { slots, headerHeight: header, height: Math.max(BLOCK.minHeight, y) };
}

/**
 * A container's content in its rectangle: the header centered in the band
 * above the first compartment, then each compartment where SysON put it
 * (`slots` overrides, e.g. for the Auto layout). Rows that do not fit their
 * section fold into its "+N more" line.
 */
export function layoutContainerContent(
  block: ModelBlock,
  rect: DiagramRect,
  measure: TextMeasure,
  slots?: readonly CompartmentSlot[],
): BlockContent {
  const head = layoutBlockContent(
    { ...block, sections: [] },
    rect.width,
    undefined,
    measure,
  );
  const placed = new Map<string, { y: number; height: number }>();
  if (slots) {
    for (const slot of slots) placed.set(slot.id, slot);
  } else {
    // Authored compartments; the others stack after the last placed one.
    const stacked = compartmentSlots(block, rect.width, measure, () =>
      BLOCK.regionMin).slots;
    let cursor = head.headerHeight;
    for (const slot of stacked) {
      const authored = block.sections.find((section) => section.id === slot.id)
        ?.authored ??
        block.regions.find((region) => region.id === slot.id)?.authored;
      const band = authored
        ? { y: authored.y - rect.y, height: authored.height }
        : { y: cursor, height: slot.height };
      placed.set(slot.id, band);
      cursor = band.y + band.height;
    }
  }
  const tops = [...placed.values()].map((band) => band.y);
  const band = tops.length ? Math.min(...tops) : rect.height;
  const headerTop = block.shape === "frame"
    ? 0
    : Math.max(0, Math.min(24, (band - head.headerHeight) / 2));
  const rowWidth = rect.width - BLOCK.padX * 2 - 4;
  const rowFit = width(measure, FONTS.row);
  const sections: ContentSection[] = [];
  for (const section of block.sections) {
    const slot = placed.get(section.id);
    if (!slot) continue;
    const limit = slot.y + slot.height - BLOCK.bottom + 2;
    let y = slot.y + (section.title ? BLOCK.sectionTitle : 4);
    const rows: ContentRow[] = [];
    let more: ContentSection["more"];
    for (const [index, row] of section.rows.entries()) {
      const remaining = section.rows.length - index;
      const lastFits = y + BLOCK.row <= limit;
      const roomForAll = y + BLOCK.row * remaining <= limit;
      if (
        (index === BLOCK.maxRows && remaining > 0) ||
        (!roomForAll && remaining > 1 && y + BLOCK.row * 2 > limit && lastFits)
      ) {
        more = { count: remaining, y };
        break;
      }
      if (!lastFits) break;
      rows.push({
        id: row.id,
        targetObjectId: row.targetObjectId,
        text: ellipsize(row.text, rowWidth, rowFit),
        title: row.title,
        y,
      });
      y += BLOCK.row;
    }
    sections.push({
      id: section.id,
      title: section.title,
      y: slot.y,
      rows,
      more,
      height: slot.height,
    });
  }
  // A frame's region is everything under its title tab.
  const regions: ContentRegion[] = block.shape === "frame"
    ? block.regions.map((region) => ({
      id: region.id,
      title: "",
      y: head.headerHeight,
      height: Math.max(0, rect.height - head.headerHeight),
    }))
    : block.regions.flatMap((region) => {
      const slot = placed.get(region.id);
      return slot ? [{ id: region.id, title: region.title, ...slot }] : [];
    });
  return {
    ...head,
    headerTop,
    sections,
    regions,
    height: rect.height,
  };
}

/** Content of any drawn block: containers by compartment, others stacked. */
export function blockContent(
  block: ModelBlock,
  rect: DiagramRect,
  authored: boolean,
  measure: TextMeasure,
  slots?: readonly CompartmentSlot[],
): BlockContent {
  return isContainer(block)
    ? layoutContainerContent(block, rect, measure, slots)
    : layoutBlockContent(
      block,
      rect.width,
      authored ? rect.height : undefined,
      measure,
    );
}

// ── Scene ───────────────────────────────────────────────────────────────────

export interface ScenePort {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly label: string;
  readonly side: PortSide;
  readonly direction?: "in" | "out";
  readonly rect: DiagramRect;
  /** North/south labels that would overlap stack away from the block. */
  readonly labelRow?: number;
}
export interface SceneBlock {
  readonly block: ModelBlock;
  readonly rect: DiagramRect;
  readonly content: BlockContent;
  readonly ports: readonly ScenePort[];
}
export interface SceneEdgeLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** The center label is placed clear of blocks; end labels stay by their end. */
  readonly role?: "center" | "begin" | "end";
}
export interface SceneEdge {
  readonly edge: ModelEdge;
  readonly points: readonly DiagramPoint[];
  readonly labels: readonly SceneEdgeLabel[];
}
export type DiagramLayoutMode = "syson" | "auto";
export interface DiagramScene {
  readonly mode: DiagramLayoutMode;
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly SceneBlock[];
  readonly edges: readonly SceneEdge[];
}

export const SCENE_PADDING = 40;
const GRID_GAP = { x: 72, y: 56 };

/** Connected components of blocks, largest first, model order otherwise. */
export function connectedComponents(
  ids: readonly string[],
  links: readonly (readonly [string, string])[],
): string[][] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let current = id;
    while (parent.get(current) !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  for (const [a, b] of links) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...groups.values()].sort((a, b) =>
    b.length - a.length || order.get(a[0])! - order.get(b[0])!
  );
}

/**
 * Layers of one component by longest path from its sources (cycles broken
 * at the earliest blocked block), each layer ordered by its parents.
 */
export function componentLayers(
  ids: readonly string[],
  links: readonly (readonly [string, string])[],
): string[][] {
  const members = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const incoming = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [source, target] of links) {
    if (!members.has(source) || !members.has(target) || source === target) {
      continue;
    }
    outgoing.get(source)!.push(target);
    incoming.get(target)!.push(source);
  }
  const remaining = new Map(ids.map((id) => [id, incoming.get(id)!.length]));
  const layer = new Map(ids.map((id) => [id, 0]));
  const done = new Set<string>();
  const queue = ids.filter((id) => remaining.get(id) === 0);
  while (done.size < ids.length) {
    if (!queue.length) {
      // A cycle: release the unplaced block with the fewest open inputs.
      const next = ids.filter((id) =>
        !done.has(id)
      ).sort((a, b) => remaining.get(a)! - remaining.get(b)!)[0];
      queue.push(next);
    }
    const id = queue.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    for (const target of outgoing.get(id)!) {
      if (done.has(target)) continue;
      layer.set(target, Math.max(layer.get(target)!, layer.get(id)! + 1));
      remaining.set(target, remaining.get(target)! - 1);
      if (remaining.get(target) === 0) queue.push(target);
    }
  }
  const layers: string[][] = [];
  for (const id of ids) {
    (layers[layer.get(id)!] ??= []).push(id);
  }
  const position = new Map<string, number>();
  return layers.filter(Boolean).map((list, depth) => {
    const ordered = depth === 0 ? list : [...list].sort((a, b) => {
      const center = (id: string) => {
        const parents = incoming.get(id)!.filter((parent) =>
          position.has(parent)
        );
        return parents.length
          ? parents.reduce((sum, parent) => sum + position.get(parent)!, 0) /
            parents.length
          : Infinity;
      };
      return center(a) - center(b);
    });
    ordered.forEach((id, index) => position.set(id, index / ordered.length));
    return ordered;
  });
}

/**
 * Grid cells for blocks SysON never placed: the largest component as
 * layered rows (sources on top), then the smaller components side by side
 * in bands, then the isolated blocks. Rows wrap at `columns`.
 */
export function fallbackCells(
  ids: readonly string[],
  links: readonly (readonly [string, string])[],
  columns: number,
): Map<string, { row: number; column: number }> {
  const cells = new Map<string, { row: number; column: number }>();
  const components = connectedComponents(ids, links);
  const wrap = (layers: string[][]) =>
    layers.flatMap((layer) => {
      const rows: string[][] = [];
      for (let start = 0; start < layer.length; start += columns) {
        rows.push(layer.slice(start, start + columns));
      }
      return rows;
    });
  let row = 0;
  // Bands of components that share rows, left to right.
  let band: string[][][] = [];
  let bandWidth = 0;
  const flush = () => {
    let column = 0;
    let height = 0;
    for (const rows of band) {
      const width = Math.max(...rows.map((list) => list.length));
      rows.forEach((list, index) => {
        const offset = Math.floor((width - list.length) / 2);
        list.forEach((id, position) =>
          cells.set(id, {
            row: row + index,
            column: column + offset + position,
          })
        );
      });
      column += width;
      height = Math.max(height, rows.length);
    }
    row += height;
    band = [];
    bandWidth = 0;
  };
  const singles = components.filter((component) => component.length === 1)
    .map((component) => component[0]);
  for (const component of components) {
    if (component.length === 1) continue;
    const rows = wrap(componentLayers(component, links));
    const width = Math.max(...rows.map((list) => list.length));
    if (band.length && bandWidth + width > columns) flush();
    band.push(rows);
    bandWidth += width;
    if (bandWidth >= columns) flush();
  }
  if (band.length) flush();
  for (let start = 0; start < singles.length; start += columns) {
    singles.slice(start, start + columns).forEach((id, column) =>
      cells.set(id, { row, column })
    );
    row++;
  }
  return cells;
}

/** Columns for a roughly 3:2 grid of `count` blocks. */
export function gridColumns(count: number): number {
  return Math.max(1, Math.min(8, Math.round(Math.sqrt(count * 1.15))));
}

/** Ports along one side when no geometry was authored. */
function placePorts(
  block: ModelBlock,
  rect: DiagramRect,
  headerHeight: number,
): ScenePort[] {
  const counters = new Map<PortSide, number>();
  return block.ports.map((port) => {
    if (port.authored) {
      return {
        id: port.id,
        targetObjectId: port.targetObjectId,
        label: port.label,
        side: port.side,
        direction: port.direction,
        rect: port.authored,
      };
    }
    const index = counters.get(port.side) ?? 0;
    counters.set(port.side, index + 1);
    const half = BLOCK.port / 2;
    const along = headerHeight + 6 + index * BLOCK.portGap;
    const vertical = port.side === "west" || port.side === "east";
    return {
      id: port.id,
      targetObjectId: port.targetObjectId,
      label: port.label,
      side: port.side,
      direction: port.direction,
      rect: vertical
        ? {
          x: port.side === "west" ? rect.x - half : rect.x + rect.width - half,
          y: rect.y + Math.min(along, rect.height - BLOCK.port - 2),
          width: BLOCK.port,
          height: BLOCK.port,
        }
        : {
          x: rect.x + Math.min(BLOCK.padX + index * 24, rect.width - 12),
          y: port.side === "north"
            ? rect.y - half
            : rect.y + rect.height - half,
          width: BLOCK.port,
          height: BLOCK.port,
        },
    };
  });
}

/** Grid placement of `ids` (layered by `links`), relative to 0,0. */
function gridPlacement(
  ids: readonly string[],
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  links: readonly (readonly [string, string])[],
  gap: { x: number; y: number } = GRID_GAP,
): { positions: Map<string, DiagramPoint>; width: number; height: number } {
  const cells = fallbackCells(ids, links, gridColumns(ids.length));
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  for (const [id, cell] of cells) {
    const size = sizes.get(id)!;
    columnWidths[cell.column] = Math.max(
      columnWidths[cell.column] ?? 0,
      size.width,
    );
    rowHeights[cell.row] = Math.max(rowHeights[cell.row] ?? 0, size.height);
  }
  const offsets = (values: number[], step: number) => {
    const starts: number[] = [];
    let position = 0;
    for (let index = 0; index < values.length; index++) {
      starts.push(position);
      position += (values[index] ?? 0) + (values[index] ? step : 0);
    }
    return {
      starts,
      total: Math.max(0, position - (values.length ? step : 0)),
    };
  };
  const columns = offsets(columnWidths, gap.x);
  const rows = offsets(rowHeights, gap.y);
  const positions = new Map<string, DiagramPoint>();
  for (const [id, cell] of cells) {
    const size = sizes.get(id)!;
    positions.set(id, {
      x: columns.starts[cell.column] +
        ((columnWidths[cell.column] ?? 0) - size.width) / 2,
      y: rows.starts[cell.row],
    });
  }
  return { positions, width: columns.total, height: rows.total };
}

const NESTED_GAP = { x: 48, y: 44 };

/**
 * SysON layout: authored positions. Blocks SysON never placed get a tidy
 * grid: top-level ones under the authored drawing, nested ones inside their
 * region (a container without geometry grows around its grid).
 */
export function sysonScene(
  model: DiagramModel,
  measure: TextMeasure,
): DiagramScene {
  const byId = new Map(model.blocks.map((block) => [block.id, block]));
  const kids = new Map<string | undefined, ModelBlock[]>();
  const regionOf = new Map<string, ModelRegion>();
  for (const block of model.blocks) {
    const list = kids.get(block.parent) ?? [];
    list.push(block);
    kids.set(block.parent, list);
    for (const region of block.regions) {
      for (const id of region.children) regionOf.set(id, region);
    }
  }
  /** The sibling under `parent` that holds `id` (itself or an ancestor). */
  const liftTo = (id: string, parent: string | undefined) => {
    let block = byId.get(id);
    for (
      let depth = 0;
      block && block.parent !== parent && depth < 64;
      depth++
    ) {
      block = block.parent ? byId.get(block.parent) : undefined;
    }
    return block?.parent === parent ? block?.id : undefined;
  };
  const linksAmong = (parent: string | undefined) =>
    model.edges.flatMap((edge) => {
      const a = liftTo(edge.sourceBlock, parent);
      const b = liftTo(edge.targetBlock, parent);
      return a && b && a !== b ? [[a, b] as const] : [];
    });

  // Sizes of blocks SysON never placed, bottom-up; free children of each
  // container get grid offsets inside its region.
  const sizes = new Map<string, { width: number; height: number }>();
  const offsets = new Map<string, DiagramPoint>();
  const regionHeights = new Map<string, number>();
  const gridChildren = (parent: string) => {
    const free = (kids.get(parent) ?? []).filter((child) => !child.authored);
    if (!free.length) return undefined;
    for (const child of free) sizeOf(child);
    const grid = gridPlacement(
      free.map((child) => child.id),
      sizes,
      linksAmong(parent),
      NESTED_GAP,
    );
    for (const [id, point] of grid.positions) offsets.set(id, point);
    return grid;
  };
  const sizeOf = (block: ModelBlock): { width: number; height: number } => {
    const known = sizes.get(block.id);
    if (known) return known;
    let size = preferredBlockSize(block, measure);
    if (isContainer(block) && !block.authored) {
      const grid = gridChildren(block.id);
      const regionHeight = grid
        ? grid.height + BLOCK.regionTitle + BLOCK.regionPad
        : BLOCK.regionMin;
      regionHeights.set(block.id, regionHeight);
      const width = Math.max(
        size.width,
        (grid?.width ?? 0) + BLOCK.regionPad * 2,
      );
      size = {
        width,
        height: compartmentSlots(block, width, measure, () => regionHeight)
          .height,
      };
    }
    sizes.set(block.id, size);
    return size;
  };

  const rects = new Map<string, DiagramRect>();
  let authoredBottom = -Infinity, authoredLeft = Infinity;
  for (const block of kids.get(undefined) ?? []) {
    if (!block.authored) continue;
    rects.set(block.id, block.authored);
    authoredBottom = Math.max(
      authoredBottom,
      block.authored.y + block.authored.height,
    );
    authoredLeft = Math.min(authoredLeft, block.authored.x);
  }
  const freeRoots = (kids.get(undefined) ?? []).filter((block) =>
    !block.authored
  );
  if (freeRoots.length) {
    for (const block of freeRoots) sizeOf(block);
    const grid = gridPlacement(
      freeRoots.map((block) => block.id),
      sizes,
      linksAmong(undefined),
    );
    const originX = Number.isFinite(authoredLeft) ? authoredLeft : 0;
    const originY = Number.isFinite(authoredBottom) ? authoredBottom + 96 : 0;
    for (const [id, point] of grid.positions) {
      rects.set(id, {
        x: originX + point.x,
        y: originY + point.y,
        ...sizes.get(id)!,
      });
    }
  }
  // Nested blocks, parents first: authored, else at their grid offset in
  // the region (under the authored children it already holds).
  const gridded = new Set<string>();
  for (const block of model.blocks) {
    if (!block.parent) continue;
    if (block.authored) {
      rects.set(block.id, block.authored);
      continue;
    }
    const parent = byId.get(block.parent)!;
    const parentRect = rects.get(parent.id)!;
    if (!gridded.has(parent.id)) {
      gridded.add(parent.id);
      if (parent.authored) gridChildren(parent.id);
    }
    const region = regionOf.get(block.id);
    let origin: DiagramPoint;
    if (parent.authored && region?.authored) {
      const placed = region.children.flatMap((id) => {
        const child = byId.get(id);
        return child?.authored
          ? [child.authored.y + child.authored.height]
          : [];
      });
      origin = {
        x: region.authored.x + BLOCK.regionPad,
        y: placed.length
          ? Math.max(...placed) + NESTED_GAP.y
          : region.authored.y + BLOCK.regionTitle,
      };
    } else {
      const slots = compartmentSlots(
        parent,
        parentRect.width,
        measure,
        () => regionHeights.get(parent.id) ?? BLOCK.regionMin,
      );
      const slot = slots.slots.find((item) => item.id === region?.id) ??
        { y: slots.headerHeight };
      origin = {
        x: parentRect.x + BLOCK.regionPad,
        y: parentRect.y + slot.y + BLOCK.regionTitle,
      };
    }
    const offset = offsets.get(block.id) ?? { x: 0, y: 0 };
    rects.set(block.id, {
      x: origin.x + offset.x,
      y: origin.y + offset.y,
      ...sizeOf(block),
    });
  }

  // A placed container grows around what it now holds (blocks SysON never
  // placed land under its authored children): children first, so the
  // growth reaches every ancestor. Bands after the region move down.
  const grown = new Map<string, Map<string, number>>();
  for (let index = model.blocks.length - 1; index >= 0; index--) {
    const child = model.blocks[index];
    const parent = child.parent ? byId.get(child.parent) : undefined;
    const region = regionOf.get(child.id);
    if (!parent?.authored || !region) continue;
    const box = rects.get(child.id)!, outer = rects.get(parent.id)!;
    const band = parent.shape === "frame" || !region.authored
      ? { y: outer.y, height: outer.height }
      : {
        y: region.authored.y,
        height: region.authored.height +
          (grown.get(parent.id)?.get(region.id) ?? 0),
      };
    const extra = box.y + box.height + BLOCK.regionPad - (band.y + band.height);
    const wider = box.x + box.width + BLOCK.regionPad - (outer.x + outer.width);
    if (extra <= 0.5 && wider <= 0.5) continue;
    const added = Math.max(0, extra);
    const bands = grown.get(parent.id) ?? new Map<string, number>();
    bands.set(region.id, (bands.get(region.id) ?? 0) + added);
    grown.set(parent.id, bands);
    rects.set(parent.id, {
      ...outer,
      width: outer.width + Math.max(0, wider),
      height: outer.height + added,
    });
  }
  /** A grown container's compartments: authored, shifted under the growth. */
  const grownSlots = (block: ModelBlock, rect: DiagramRect) => {
    const extra = grown.get(block.id);
    if (!extra || block.shape === "frame") return undefined;
    const origin = block.authored!;
    const bands = [
      ...block.sections.map((item) => ({ ...item, region: false })),
      ...block.regions.map((item) => ({ ...item, region: true })),
    ].filter((item) => item.authored).sort((a, b) =>
      a.authored!.y - b.authored!.y
    );
    let shift = 0;
    return bands.map((item): CompartmentSlot => {
      const added = extra.get(item.id) ?? 0;
      const slot = {
        id: item.id,
        region: item.region,
        y: item.authored!.y - origin.y + shift,
        height: item.authored!.height + added,
      };
      shift += added;
      return slot;
    }).filter((slot) => slot.y < rect.height);
  };

  const blocks = model.blocks.map((block) => {
    const rect = rects.get(block.id)!;
    const slots = isContainer(block) && !block.authored
      ? compartmentSlots(
        block,
        rect.width,
        measure,
        () => regionHeights.get(block.id) ?? BLOCK.regionMin,
      ).slots
      : isContainer(block)
      ? grownSlots(block, rect)
      : undefined;
    const content = blockContent(block, rect, !!block.authored, measure, slots);
    return {
      block,
      rect,
      content,
      ports: placePorts(block, rect, content.headerHeight),
    };
  });
  const edges = routeSceneEdges(blocks, model.edges);
  return normalizeScene("syson", blocks, edges, measure);
}

// ── Orthogonal routing for SysON layout ─────────────────────────────────────

type Direction = DiagramPoint;
const DIRECTIONS: Record<PortSide, Direction> = {
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
};

/** Remove repeated and collinear points. */
export function simplifyRoute(points: readonly DiagramPoint[]): DiagramPoint[] {
  const out: DiagramPoint[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (
      last && Math.abs(last.x - point.x) < 0.5 &&
      Math.abs(last.y - point.y) < 0.5
    ) {
      continue;
    }
    out.push(point);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const collinear =
        (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) ||
        (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/**
 * Orthogonal connector between two anchors leaving in given directions:
 * straight when aligned, one bend in the middle channel otherwise, stubs
 * around the blocks when the anchors face away from each other.
 */
export function orthogonalConnector(
  start: DiagramPoint,
  startDirection: Direction,
  end: DiagramPoint,
  endDirection: Direction,
  channel?: number,
  stub = 16,
): DiagramPoint[] {
  const s = {
    x: start.x + startDirection.x * stub,
    y: start.y + startDirection.y * stub,
  };
  const e = {
    x: end.x + endDirection.x * stub,
    y: end.y + endDirection.y * stub,
  };
  const vertical = (direction: Direction) => direction.y !== 0;
  if (vertical(startDirection) && vertical(endDirection)) {
    const forward = (end.y - start.y) * startDirection.y > 0 &&
      (start.y - end.y) * endDirection.y > 0;
    if (forward) {
      const middle = channel ?? (start.y + end.y) / 2;
      return simplifyRoute([start, { x: start.x, y: middle }, {
        x: end.x,
        y: middle,
      }, end]);
    }
    // Aligned anchors facing away from each other: go around, not through.
    const middle = Math.abs(s.x - e.x) < 8
      ? Math.max(s.x, e.x) + stub * 2
      : (s.x + e.x) / 2;
    return simplifyRoute([
      start,
      s,
      { x: middle, y: s.y },
      {
        x: middle,
        y: e.y,
      },
      e,
      end,
    ]);
  }
  if (!vertical(startDirection) && !vertical(endDirection)) {
    const forward = (end.x - start.x) * startDirection.x > 0 &&
      (start.x - end.x) * endDirection.x > 0;
    if (forward) {
      const middle = channel ?? (start.x + end.x) / 2;
      return simplifyRoute([start, { x: middle, y: start.y }, {
        x: middle,
        y: end.y,
      }, end]);
    }
    const middle = Math.abs(s.y - e.y) < 8
      ? Math.min(s.y, e.y) - stub * 2
      : (s.y + e.y) / 2;
    return simplifyRoute([
      start,
      s,
      { x: s.x, y: middle },
      {
        x: e.x,
        y: middle,
      },
      e,
      end,
    ]);
  }
  // One horizontal, one vertical end: a single bend when it reads forward.
  const corner = vertical(startDirection)
    ? { x: start.x, y: end.y }
    : { x: end.x, y: start.y };
  const towardsCorner = (point: DiagramPoint, direction: Direction) =>
    (corner.x - point.x) * direction.x + (corner.y - point.y) * direction.y > 0;
  if (
    towardsCorner(start, startDirection) && towardsCorner(end, endDirection)
  ) {
    return simplifyRoute([start, corner, end]);
  }
  const bend = vertical(startDirection)
    ? { x: e.x, y: s.y }
    : { x: s.x, y: e.y };
  return simplifyRoute([start, s, bend, e, end]);
}

interface Attachment {
  readonly edge: number;
  readonly end: "source" | "target";
  readonly block: SceneBlock;
  readonly side: PortSide;
  /** Coordinate of the other end along the side, for ordering. */
  readonly order: number;
}

function center(rect: DiagramRect): DiagramPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Side of `rect` that faces `other`, by the larger normalized gap. */
function facingSide(
  rect: DiagramRect,
  other: DiagramRect,
): PortSide | undefined {
  const gapBelow = other.y - (rect.y + rect.height);
  const gapAbove = rect.y - (other.y + other.height);
  const gapRight = other.x - (rect.x + rect.width);
  const gapLeft = rect.x - (other.x + other.width);
  const best = Math.max(gapBelow, gapAbove, gapRight, gapLeft);
  if (best <= 0) return undefined;
  if (best === gapBelow) return "south";
  if (best === gapAbove) return "north";
  return best === gapRight ? "east" : "west";
}

const OPPOSITE: Record<PortSide, PortSide> = {
  west: "east",
  east: "west",
  north: "south",
  south: "north",
};

function portAnchor(port: ScenePort): DiagramPoint {
  const c = center(port.rect);
  const half = port.rect.width / 2;
  const d = DIRECTIONS[port.side];
  return { x: c.x + d.x * half, y: c.y + d.y * half };
}

/** Routes for the SysON layout: authored bends, else orthogonal connectors. */
export function routeSceneEdges(
  blocks: readonly SceneBlock[],
  edges: readonly ModelEdge[],
): SceneEdge[] {
  const byId = new Map(blocks.map((block) => [block.block.id, block]));
  const ports = new Map<string, ScenePort>();
  for (const block of blocks) {
    for (const port of block.ports) ports.set(port.id, port);
  }
  const attachments: Attachment[] = [];
  const plans = edges.map((edge, index) => {
    const source = byId.get(edge.sourceBlock)!;
    const target = byId.get(edge.targetBlock)!;
    const sourcePort = edge.sourcePort ? ports.get(edge.sourcePort) : undefined;
    const targetPort = edge.targetPort ? ports.get(edge.targetPort) : undefined;
    const sourceBox = sourcePort?.rect ?? source.rect;
    const targetBox = targetPort?.rect ?? target.rect;
    let sourceSide = sourcePort?.side;
    let targetSide = targetPort?.side;
    if (!sourceSide || !targetSide) {
      const facing = facingSide(sourceBox, targetBox);
      sourceSide ??= facing ?? "south";
      targetSide ??= facing ? OPPOSITE[facing] : "north";
    }
    if (!sourcePort && source !== target) {
      attachments.push({
        edge: index,
        end: "source",
        block: source,
        side: sourceSide,
        order: sourceSide === "west" || sourceSide === "east"
          ? center(targetBox).y
          : center(targetBox).x,
      });
    }
    if (!targetPort && source !== target) {
      attachments.push({
        edge: index,
        end: "target",
        block: target,
        side: targetSide,
        order: targetSide === "west" || targetSide === "east"
          ? center(sourceBox).y
          : center(sourceBox).x,
      });
    }
    return {
      edge,
      source,
      target,
      sourcePort,
      targetPort,
      sourceSide,
      targetSide,
      start: sourcePort ? portAnchor(sourcePort) : undefined,
      end: targetPort ? portAnchor(targetPort) : undefined,
    };
  });

  // Spread the anchors sharing a block side so parallel edges stay apart.
  const groups = new Map<string, Attachment[]>();
  for (const attachment of attachments) {
    const key = `${attachment.block.block.id}:${attachment.side}`;
    const list = groups.get(key) ?? [];
    list.push(attachment);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.order - b.order || a.edge - b.edge);
    const { rect } = list[0].block;
    const vertical = list[0].side === "west" || list[0].side === "east";
    const length = vertical ? rect.height : rect.width;
    const margin = Math.min(18, length / 4);
    list.forEach((attachment, index) => {
      const offset = margin +
        (length - margin * 2) * (index + 1) / (list.length + 1);
      const point = vertical
        ? {
          x: attachment.side === "west" ? rect.x : rect.x + rect.width,
          y: rect.y + offset,
        }
        : {
          x: rect.x + offset,
          y: attachment.side === "north" ? rect.y : rect.y + rect.height,
        };
      const plan = plans[attachment.edge];
      if (attachment.end === "source") plan.start = point;
      else plan.end = point;
    });
  }

  // Channel lanes: the bend runs just before the block it enters from above
  // (or from the left), so connectors into one grid row share a channel and
  // get distinct lanes instead of drawing over each other.
  const lanes = new Map<string, number[]>();
  const channelOf = plans.map((plan) => {
    const { start, end } = plan;
    if (!start || !end) return undefined;
    const isVertical = (side: PortSide) => side === "south" || side === "north";
    const vertical = isVertical(plan.sourceSide);
    if (vertical !== isVertical(plan.targetSide)) return undefined;
    const near = vertical ? "north" : "west";
    const entry = plan.targetSide === near
      ? end
      : plan.sourceSide === near
      ? start
      : undefined;
    if (!entry) return undefined;
    const other = entry === end ? start : end;
    const distance = vertical ? entry.y - other.y : entry.x - other.x;
    if (distance <= 12) return undefined;
    const gap = vertical ? GRID_GAP.y : GRID_GAP.x;
    const middle = (vertical ? entry.y : entry.x) -
      Math.min(gap / 2, distance / 2);
    return {
      key: `${vertical ? "h" : "v"}:${Math.round(middle / 4)}`,
      middle,
      vertical,
      low: (vertical ? other.y : other.x) + 6,
      high: (vertical ? entry.y : entry.x) - 6,
    };
  });
  plans.forEach((_, index) => {
    const channel = channelOf[index];
    if (!channel) return;
    const list = lanes.get(channel.key) ?? [];
    list.push(index);
    lanes.set(channel.key, list);
  });
  const laneMiddle = new Map<number, number>();
  for (const list of lanes.values()) {
    const ordered = [...list].sort((a, b) => {
      const pa = plans[a].start!, pb = plans[b].start!;
      return channelOf[a]!.vertical ? pa.x - pb.x : pa.y - pb.y;
    });
    const step = Math.min(6, 36 / ordered.length);
    ordered.forEach((planIndex, laneIndex) => {
      const channel = channelOf[planIndex]!;
      const lane = channel.middle +
        (laneIndex - (ordered.length - 1) / 2) * step;
      laneMiddle.set(
        planIndex,
        Math.min(channel.high, Math.max(channel.low, lane)),
      );
    });
  }

  return plans.map((plan, index) => {
    const { edge } = plan;
    let points: DiagramPoint[];
    const routing = edge.routing ?? [];
    if (routing.length) {
      // SysON's bends, attached on the side facing them, kept orthogonal.
      const first = routing[0], last = routing.at(-1)!;
      const start = plan.sourcePort
        ? {
          point: portAnchor(plan.sourcePort),
          vertical: isVerticalSide(plan.sourcePort.side),
        }
        : anchorToward(plan.source.rect, first);
      const end = plan.targetPort
        ? {
          point: portAnchor(plan.targetPort),
          vertical: isVerticalSide(plan.targetPort.side),
        }
        : anchorToward(plan.target.rect, last);
      points = orthogonalize(
        [start.point, ...routing, end.point],
        start.vertical,
        end.vertical,
      );
    } else if (
      plan.source === plan.target && !plan.sourcePort && !plan.targetPort
    ) {
      const rect = plan.source.rect;
      const x = rect.x + rect.width, y = rect.y + Math.min(24, rect.height / 3);
      points = [
        { x, y },
        { x: x + 20, y },
        { x: x + 20, y: y + 20 },
        { x, y: y + 20 },
      ];
    } else {
      points = orthogonalConnector(
        plan.start ?? center(plan.source.rect),
        DIRECTIONS[plan.sourceSide],
        plan.end ?? center(plan.target.rect),
        DIRECTIONS[plan.targetSide],
        laneMiddle.get(index),
      );
    }
    return { edge, points, labels: edgeLabels(edge, points) };
  });
}

const isVerticalSide = (side: PortSide) => side === "north" || side === "south";

/**
 * Where an edge leaves `box` toward a bend: straight above or below it when
 * the bend is within the box's width, beside it when within its height,
 * else from the middle of the side with the larger gap. `vertical` tells
 * which way the first segment runs.
 */
export function anchorToward(
  box: DiagramRect,
  toward: DiagramPoint,
): { point: DiagramPoint; vertical: boolean } {
  const right = box.x + box.width, bottom = box.y + box.height;
  const inset = Math.min(6, box.width / 4, box.height / 4);
  if (toward.x >= box.x + inset && toward.x <= right - inset) {
    return {
      point: { x: toward.x, y: toward.y < box.y ? box.y : bottom },
      vertical: true,
    };
  }
  if (toward.y >= box.y + inset && toward.y <= bottom - inset) {
    return {
      point: { x: toward.x < box.x ? box.x : right, y: toward.y },
      vertical: false,
    };
  }
  const c = center(box);
  const dx = Math.abs(toward.x - c.x) - box.width / 2;
  const dy = Math.abs(toward.y - c.y) - box.height / 2;
  return dy >= dx
    ? { point: { x: c.x, y: toward.y < c.y ? box.y : bottom }, vertical: true }
    : { point: { x: toward.x < c.x ? box.x : right, y: c.y }, vertical: false };
}

/**
 * Orthogonal polyline through `points`: an elbow between two points that
 * are not aligned. The first segment runs as `startVertical` says, the last
 * as `endVertical` says, the ones between turn at each elbow.
 */
export function orthogonalize(
  points: readonly DiagramPoint[],
  startVertical: boolean,
  endVertical: boolean,
): DiagramPoint[] {
  const out: DiagramPoint[] = [];
  let vertical = startVertical;
  points.forEach((point, index) => {
    const previous = out.at(-1);
    if (!previous) {
      out.push(point);
      return;
    }
    const aligned = Math.abs(previous.x - point.x) < 0.5 ||
      Math.abs(previous.y - point.y) < 0.5;
    if (!aligned) {
      const last = index === points.length - 1;
      // The last elbow makes the final segment enter as `endVertical` says.
      const firstLeg = last ? !endVertical : vertical;
      out.push(
        firstLeg
          ? { x: previous.x, y: point.y }
          : { x: point.x, y: previous.y },
      );
    }
    out.push(point);
    const tail = out.slice(-2);
    vertical = Math.abs(tail[0].x - tail[1].x) < 0.5 ? false : true;
  });
  return simplifyRoute(out);
}

/** Point at `fraction` of the polyline length. */
export function pointAlong(
  points: readonly DiagramPoint[],
  fraction: number,
): DiagramPoint {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y)
  );
  let remaining = lengths.reduce((sum, value) => sum + value, 0) * fraction;
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length || index === lengths.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t,
      };
    }
    remaining -= length;
  }
  return points.at(-1)!;
}

/**
 * The middle of the longest segment: on a routed edge that is the run in
 * open space, not a short stub against a block.
 */
export function labelPoint(points: readonly DiagramPoint[]): DiagramPoint {
  let best = -1, at = pointAlong(points, 0.5);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > best + 0.5) {
      best = length;
      at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return at;
}

function edgeLabels(
  edge: ModelEdge,
  points: readonly DiagramPoint[],
): SceneEdgeLabel[] {
  if (points.length < 2) return [];
  const labels: SceneEdgeLabel[] = [];
  if (edge.label) {
    labels.push({ text: edge.label, ...labelPoint(points), role: "center" });
  }
  if (edge.beginLabel) {
    labels.push({
      text: edge.beginLabel,
      ...pointAlong(points, 0.12),
      role: "begin",
    });
  }
  if (edge.endLabel) {
    labels.push({
      text: edge.endLabel,
      ...pointAlong(points, 0.88),
      role: "end",
    });
  }
  return labels;
}

export const PORT_LABEL_LINE = 13;

/**
 * Rows for the labels of ports on a north or south side: each label takes
 * the row nearest the block where it overlaps no label already placed.
 */
export function stackPortLabels(
  ports: readonly ScenePort[],
  measure: TextMeasure,
): ScenePort[] {
  const rows = new Map<string, number>();
  for (const side of ["north", "south"] as const) {
    const placed: { left: number; right: number; row: number }[] = [];
    const along = ports.filter((port) => port.side === side && port.label)
      .sort((a, b) => center(a.rect).x - center(b.rect).x);
    for (const port of along) {
      const half =
        Math.min(BLOCK.portLabelMax, measure(port.label, FONTS.port)) /
          2 + 4;
      const x = center(port.rect).x;
      let row = 0;
      while (
        placed.some((label) =>
          label.row === row && label.left < x + half && x - half < label.right
        )
      ) row++;
      placed.push({ left: x - half, right: x + half, row });
      if (row) rows.set(port.id, row);
    }
  }
  return ports.map((port) =>
    rows.has(port.id) ? { ...port, labelRow: rows.get(port.id) } : port
  );
}

/** Port label box (outside the block), for bounds. */
export function portLabelBox(
  port: ScenePort,
  measure: TextMeasure,
): DiagramRect | undefined {
  if (!port.label) return undefined;
  const textWidth = Math.min(
    BLOCK.portLabelMax,
    measure(port.label, FONTS.port),
  );
  const c = center(port.rect);
  const height = 13;
  const stack = (port.labelRow ?? 0) * PORT_LABEL_LINE;
  switch (port.side) {
    case "west":
      return {
        x: port.rect.x - 4 - textWidth,
        y: c.y - height - 1,
        width: textWidth,
        height,
      };
    case "east":
      return {
        x: port.rect.x + port.rect.width + 4,
        y: c.y - height - 1,
        width: textWidth,
        height,
      };
    case "north":
      return {
        x: c.x - textWidth / 2,
        y: port.rect.y - 4 - height - stack,
        width: textWidth,
        height,
      };
    case "south":
      return {
        x: c.x - textWidth / 2,
        y: port.rect.y + port.rect.height + 4 + stack,
        width: textWidth,
        height,
      };
  }
}

export const EDGE_LABEL_HEIGHT = 18;

const overlaps = (a: DiagramRect, b: DiagramRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** What an edge label must not cover: blocks, headers, list sections. */
function labelObstacles(blocks: readonly SceneBlock[]): DiagramRect[] {
  const boxes: DiagramRect[] = [];
  for (const { block, rect, content, ports } of blocks) {
    if (!isContainer(block)) boxes.push(rect);
    else {
      const tops = [
        ...content.sections.map((section) => section.y),
        ...content.regions.map((region) => region.y),
      ];
      const band = tops.length ? Math.min(...tops) : content.headerHeight;
      boxes.push({ ...rect, height: Math.min(rect.height, band) });
      for (const section of content.sections) {
        boxes.push({
          x: rect.x,
          y: rect.y + section.y,
          width: rect.width,
          height: section.height ??
            (section.rows.length + 1) * BLOCK.row,
        });
      }
    }
    for (const port of ports) boxes.push(port.rect);
  }
  return boxes;
}

/**
 * Center labels where they cover no block and no other label: along the
 * longest segments first, on the line, then beside it. A label with no free
 * spot keeps the middle of the longest segment.
 */
export function placeEdgeLabels(
  blocks: readonly SceneBlock[],
  edges: readonly SceneEdge[],
  measure: TextMeasure,
): SceneEdge[] {
  const taken = labelObstacles(blocks);
  return edges.map((item) => {
    if (!item.labels.some((label) => label.role === "center")) return item;
    const labels = item.labels.map((label) => {
      if (label.role !== "center") return label;
      const width = measure(label.text, FONTS.edgeLabel) + 12;
      const h = EDGE_LABEL_HEIGHT;
      const box = (x: number, y: number) => ({
        x: x - width / 2,
        y: y - h / 2,
        width,
        height: h,
      });
      const segments = item.points.slice(1).map((point, index) => ({
        a: item.points[index],
        b: point,
        length: Math.hypot(
          point.x - item.points[index].x,
          point.y - item.points[index].y,
        ),
      })).sort((p, q) => q.length - p.length);
      for (const { a, b, length } of segments) {
        if (length < 12) continue;
        const vertical = Math.abs(a.x - b.x) < 0.5;
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const spots = vertical
            ? [m, { x: m.x + width / 2 + 5, y: m.y }, {
              x: m.x - width / 2 - 5,
              y: m.y,
            }]
            : [m, { x: m.x, y: m.y - h / 2 - 3 }, {
              x: m.x,
              y: m.y + h / 2 + 3,
            }];
          for (const spot of spots) {
            const candidate = box(spot.x, spot.y);
            if (!taken.some((other) => overlaps(candidate, other))) {
              taken.push(candidate);
              return { ...label, x: spot.x, y: spot.y };
            }
          }
        }
      }
      taken.push(box(label.x, label.y));
      return label;
    });
    return { ...item, labels };
  });
}

/** Shift everything so the drawing starts at `SCENE_PADDING` from 0,0. */
export function normalizeScene(
  mode: DiagramLayoutMode,
  laid: readonly SceneBlock[],
  routed: readonly SceneEdge[],
  measure: TextMeasure,
): DiagramScene {
  let edges = routed;
  const blocks = laid.map((block) =>
    block.ports.some((port) => port.side === "north" || port.side === "south")
      ? { ...block, ports: stackPortLabels(block.ports, measure) }
      : block
  );
  edges = placeEdgeLabels(blocks, edges, measure);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (rect: DiagramRect | undefined) => {
    if (!rect) return;
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  };
  for (const block of blocks) {
    include(block.rect);
    for (const port of block.ports) {
      include(port.rect);
      include(portLabelBox(port, measure));
    }
  }
  for (const edge of edges) {
    for (const point of edge.points) {
      include({ x: point.x, y: point.y, width: 0, height: 0 });
    }
    for (const label of edge.labels) {
      const width = measure(label.text, FONTS.edgeLabel) + 12;
      include({ x: label.x - width / 2, y: label.y - 9, width, height: 18 });
    }
  }
  if (!Number.isFinite(left)) {
    left =
      top =
      right =
      bottom =
        0;
  }
  const dx = SCENE_PADDING - left, dy = SCENE_PADDING - top;
  const move = (rect: DiagramRect): DiagramRect => ({
    ...rect,
    x: rect.x + dx,
    y: rect.y + dy,
  });
  const shift = (point: DiagramPoint) => ({ x: point.x + dx, y: point.y + dy });
  return {
    mode,
    width: Math.ceil(right - left + SCENE_PADDING * 2),
    height: Math.ceil(bottom - top + SCENE_PADDING * 2),
    blocks: blocks.map((block) => ({
      ...block,
      rect: move(block.rect),
      ports: block.ports.map((port) => ({ ...port, rect: move(port.rect) })),
    })),
    edges: edges.map((edge) => ({
      ...edge,
      points: edge.points.map(shift),
      labels: edge.labels.map((label) => ({ ...label, ...shift(label) })),
    })),
  };
}

// ── Geometry for gestures, overlays and the mini-map ────────────────────────

export interface SceneEntry {
  readonly id: string;
  readonly targetId: string;
  readonly kind?: string;
  readonly rect: DiagramRect;
}

/** Semantic members of the scene with their diagram rectangles. */
export function sceneEntries(scene: DiagramScene): SceneEntry[] {
  const entries: SceneEntry[] = [];
  for (const { block, rect, content, ports } of scene.blocks) {
    if (block.targetObjectId) {
      entries.push({
        id: block.id,
        targetId: block.targetObjectId,
        kind: "node",
        rect,
      });
    }
    for (const section of content.sections) {
      for (const row of section.rows) {
        if (!row.targetObjectId) continue;
        entries.push({
          id: row.id,
          targetId: row.targetObjectId,
          kind: "compartment",
          rect: {
            x: rect.x + 4,
            y: rect.y + row.y,
            width: rect.width - 8,
            height: BLOCK.row,
          },
        });
      }
    }
    for (const port of ports) {
      if (!port.targetObjectId) continue;
      entries.push({
        id: port.id,
        targetId: port.targetObjectId,
        kind: "port",
        rect: port.rect,
      });
    }
  }
  for (const { edge, points } of scene.edges) {
    if (!edge.targetObjectId || !points.length) continue;
    const xs = points.map((point) => point.x),
      ys = points.map((point) => point.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    entries.push({
      id: edge.id,
      targetId: edge.targetObjectId,
      rect: {
        x,
        y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      },
    });
  }
  return entries;
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Orthogonal polyline as an SVG path with rounded corners (§2: 6 px). */
export function roundedPath(
  points: readonly DiagramPoint[],
  radius = 6,
): string {
  if (points.length < 2) return "";
  const p = (point: DiagramPoint) => `${round2(point.x)} ${round2(point.y)}`;
  let d = `M${p(points[0])}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1],
      corner = points[index],
      next = points[index + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      d += ` L${p(corner)}`;
      continue;
    }
    const before = {
      x: corner.x - (corner.x - previous.x) / inLength * r,
      y: corner.y - (corner.y - previous.y) / inLength * r,
    };
    const after = {
      x: corner.x + (next.x - corner.x) / outLength * r,
      y: corner.y + (next.y - corner.y) / outLength * r,
    };
    d += ` L${p(before)} Q${p(corner)} ${p(after)}`;
  }
  return `${d} L${p(points.at(-1)!)}`;
}

export interface MarkerShape {
  readonly d: string;
  /** `line`: filled with the edge color; `panel`: hollow; `none`: open. */
  readonly fill: "line" | "panel" | "none";
}

function endDirection(
  points: readonly DiagramPoint[],
  atStart: boolean,
): { tip: DiagramPoint; direction: DiagramPoint } | undefined {
  const ordered = atStart ? [...points].reverse() : points;
  const tip = ordered.at(-1)!;
  for (let index = ordered.length - 2; index >= 0; index--) {
    const from = ordered[index];
    const length = Math.hypot(tip.x - from.x, tip.y - from.y);
    if (length > 0.01) {
      return {
        tip,
        direction: {
          x: (tip.x - from.x) / length,
          y: (tip.y - from.y) / length,
        },
      };
    }
  }
  return undefined;
}

/** Shapes of one edge end, tip on the end point (or `outward` from it). */
function tipShapes(
  end: EdgeTip,
  points: readonly DiagramPoint[],
  atStart: boolean,
  size: number,
): MarkerShape[] {
  if (end.shape === "none" || points.length < 2) return [];
  const found = endDirection(points, atStart);
  if (!found) return [];
  let { tip, direction } = found;
  const length = end.shape === "arrow"
    ? size * 1.1
    : end.shape.includes("ircle")
    ? size * 0.9
    : end.shape.includes("iamond")
    ? size * 1.8
    : size * 1.3;
  if (end.outward) {
    tip = { x: tip.x - direction.x * length, y: tip.y - direction.y * length };
    direction = { x: -direction.x, y: -direction.y };
  }
  const normal = { x: -direction.y, y: direction.x };
  const point = (back: number, side: number) => ({
    x: tip.x - direction.x * back + normal.x * side,
    y: tip.y - direction.y * back + normal.y * side,
  });
  const at = (back: number, side: number) => {
    const p = point(back, side);
    return `${round2(p.x)} ${round2(p.y)}`;
  };
  const p = `${round2(tip.x)} ${round2(tip.y)}`;
  const triangle = `M${p} L${at(size * 1.3, size * 0.75)} L${
    at(size * 1.3, -size * 0.75)
  } Z`;
  const dot = (back: number, side: number, r: number) => {
    const c = point(back, side);
    return `M${round2(c.x - r)} ${round2(c.y)} a${r} ${r} 0 1 0 ${
      round2(r * 2)
    } 0 a${r} ${r} 0 1 0 ${round2(-r * 2)} 0`;
  };
  switch (end.shape) {
    case "arrow":
      return [{
        d: `M${at(size * 1.1, size * 0.6)} L${p} L${
          at(size * 1.1, -size * 0.6)
        }`,
        fill: "none",
      }];
    case "triangle":
      return [{ d: triangle, fill: "panel" }];
    case "filledTriangle":
      return [{
        d: `M${p} L${at(size * 1.1, size * 0.55)} L${
          at(size * 1.1, -size * 0.55)
        } Z`,
        fill: "line",
      }];
    case "diamond":
    case "filledDiamond":
      return [{
        d: `M${p} L${at(size * 0.9, size * 0.55)} L${at(size * 1.8, 0)} L${
          at(size * 0.9, -size * 0.55)
        } Z`,
        fill: end.shape === "diamond" ? "panel" : "line",
      }];
    case "circle":
    case "filledCircle":
      return [{
        d: dot(size * 0.45, 0, size * 0.45),
        fill: end.shape === "circle" ? "panel" : "line",
      }];
    case "crossedCircle": {
      const r = size * 0.45;
      return [{ d: dot(r, 0, r), fill: "panel" }, {
        d: `M${at(0, 0)} L${at(r * 2, 0)} M${at(r, r)} L${at(r, -r)}`,
        fill: "none",
      }];
    }
    case "triangleBar":
      return [{ d: triangle, fill: "panel" }, {
        d: `M${at(size * 1.3 + 3, size * 0.75)} L${
          at(size * 1.3 + 3, -size * 0.75)
        }`,
        fill: "none",
      }];
    case "triangleDots":
    case "triangle4Dots": {
      const back = size * 1.3 + 3.5;
      const sides = end.shape === "triangleDots"
        ? [size * 0.35, -size * 0.35]
        : [size * 0.6, size * 0.2, -size * 0.2, -size * 0.6];
      return [{ d: triangle, fill: "panel" }, {
        d: sides.map((side) => dot(back, side, 1.1)).join(" "),
        fill: "line",
      }];
    }
  }
}

/** Both ends of an edge, from its decoration (SysON's style or the type). */
export function edgeDecorationShapes(
  decoration: EdgeDecoration,
  points: readonly DiagramPoint[],
  size: number,
): MarkerShape[] {
  return [
    ...tipShapes(decoration.source, points, true, size),
    ...tipShapes(decoration.target, points, false, size),
  ];
}

/**
 * Edge decorations (§2) read from the type when SysON's style is missing:
 * hollow triangle for specialization, open arrow for dependency-like links
 * (the line is dashed), filled diamond on the owner (source) side for
 * composition, small solid arrow for flows.
 */
export function edgeMarkerShapes(
  marker: EdgeMarker,
  points: readonly DiagramPoint[],
  size: number,
): MarkerShape[] {
  return edgeDecorationShapes(edgeDecoration({}, marker), points, size);
}

// ── Constant on-screen text below full detail (§3) ─────────────────────────

/** Screen sizes for the header and tint levels: never below 10 px. */
export const SCREEN_TEXT = {
  name: { size: 12, weight: 600 } as FontSpec,
  /** Tinted rectangles (< 0.3): a little smaller to keep more of the name. */
  tint: { size: 11, weight: 600 } as FontSpec,
  tintLine: 13,
  pill: { size: 10, weight: 600, mono: true, spacing: 0.04 } as FontSpec,
  hint: { size: 10 } as FontSpec,
  line: 15,
  pillHeight: 15,
  pillPadX: 4,
  pillGap: 5,
} as const;

export interface ScreenHeader {
  /** Where the kind pill goes: before the name, on its own line, or nowhere. */
  readonly pill: "inline" | "line" | "none";
  readonly pillWidth: number;
  readonly nameLines: readonly string[];
  readonly hint: boolean;
}

/**
 * Fit a block's header into its on-screen box (pixels). The name comes
 * first: whole if any arrangement allows it, the pill only when it leaves
 * the name whole, the "N items" hint only in a spare line.
 */
export function fitScreenHeader(
  name: string,
  marker: string | undefined,
  hint: string,
  box: { readonly width: number; readonly lines: number },
  measure: TextMeasure,
  font: FontSpec = SCREEN_TEXT.name,
): ScreenHeader {
  const nameWidth = (text: string) => measure(text, font);
  const inner = box.width;
  const lines = Math.max(1, box.lines);
  const pillWidth = marker
    ? Math.ceil(measure(marker, SCREEN_TEXT.pill) + SCREEN_TEXT.pillPadX * 2)
    : 0;
  const words = name.split(/\s+/).filter(Boolean).join(" ");
  // Whole means every word kept and no word cut across two lines.
  const whole = (maxLines: number, first: number) => {
    if (maxLines < 1 || first < 12) return undefined;
    const all = wrapText(name, inner, 64, nameWidth, first);
    return all.length <= maxLines && all.join(" ") === words ? all : undefined;
  };
  let pill: ScreenHeader["pill"] = "none";
  let nameLines: string[] | undefined;
  if (pillWidth) {
    nameLines = whole(lines, inner - pillWidth - SCREEN_TEXT.pillGap);
    if (nameLines) pill = "inline";
    else if (pillWidth <= inner) {
      nameLines = whole(lines - 1, inner);
      if (nameLines) pill = "line";
    }
  }
  nameLines ??= whole(lines, inner);
  if (!nameLines) {
    // Nothing keeps the name whole: a tall block still shows its kind.
    if (pillWidth && pillWidth <= inner && lines >= 3) pill = "line";
    nameLines = wrapText(
      name,
      inner,
      lines - (pill === "line" ? 1 : 0),
      nameWidth,
    );
  }
  const used = nameLines.length + (pill === "line" ? 1 : 0);
  return {
    pill,
    pillWidth,
    nameLines,
    hint: !!hint && used < lines && measure(hint, SCREEN_TEXT.hint) <= inner,
  };
}
