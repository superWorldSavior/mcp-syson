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
}
export interface SnapshotNode {
  readonly id: string;
  readonly label?: string;
  readonly targetObjectId?: string;
  readonly type?: string;
  readonly kind?: string;
  readonly parentId?: string;
  readonly hasLayout?: boolean;
  readonly outsideLabels?: readonly string[];
  readonly style?: SnapshotNodeStyle;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
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
  readonly routingPoints?: readonly DiagramPoint[];
}

/** Native styles the client renderer draws; anything else keeps the server SVG. */
const KNOWN_STYLES = new Set([
  "RectangularNodeStyle",
  "EllipseNodeStyle",
  "ImageNodeStyle",
  "IconLabelNodeStyle",
]);

/**
 * The viewer draws the diagram itself when the snapshot carries structured
 * nodes it understands. Recorded sessions without nodes, a native style this
 * renderer does not know, or connections drawn inside one block (nested
 * parts wired together, which blocks with rows cannot show) keep the
 * sanitized server SVG.
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
  const root = (id: string | undefined) => {
    let node = id ? byId.get(id) : undefined;
    for (let depth = 0; node?.parentId && byId.has(node.parentId); depth++) {
      if (depth > 64) return undefined;
      node = byId.get(node.parentId);
    }
    return node?.id;
  };
  for (const edge of (snapshot.edges ?? []) as SnapshotEdge[]) {
    if (!edge || edge.sourceId === edge.targetId) continue;
    const source = root(edge.sourceId);
    if (source && source === root(edge.targetId)) return false;
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
export type BlockShape = "card" | "start" | "done" | "decision" | "bar";

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
}
export interface ModelPort {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly label: string;
  readonly side: PortSide;
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
  readonly ports: readonly ModelPort[];
  readonly rowCount: number;
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
  readonly routing?: readonly DiagramPoint[];
}
export interface DiagramModel {
  readonly blocks: readonly ModelBlock[];
  readonly edges: readonly ModelEdge[];
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const semanticId = (value?: string) => value?.trim() ? value : undefined;

function controlShape(node: SnapshotNode): BlockShape {
  const image = node.style?.kind === "ImageNodeStyle"
    ? /(?:^|\/)images\/(decision|merge|start|done)_action\.svg$/.exec(
      node.style.imageURL ?? "",
    )?.[1]
    : undefined;
  if (image === "decision" || image === "merge") return "decision";
  if (image === "start") return "start";
  if (image === "done") return "done";
  const background = node.style?.background?.toLowerCase();
  if (
    !node.label?.trim() && !node.outsideLabels?.some((label) => label.trim()) &&
    (background === "black" || background === "#000" ||
      background === "#000000")
  ) return node.style?.kind === "EllipseNodeStyle" ? "start" : "bar";
  return "card";
}

/**
 * Structure the snapshot: top-level nodes become blocks; their decorative
 * compartments (same semantic target as the block) become titled sections
 * whose children are rows; border nodes become ports. Every descendant maps
 * to its block so edges always find an endpoint that is drawn.
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
  for (const root of roots) {
    claim(root, root.id);
    const parsed = parseNodeLabel(root.label, root.outsideLabels);
    const { kind, qualifiers } = blockKind(parsed.stereotypes, root.style);
    const info = kind ? kindInfo(kind) : undefined;
    const rootRect = authoredRect(root);
    const sections: ModelSection[] = [];
    const ports: ModelPort[] = [];
    let loose: ModelRow[] | undefined;

    const decorative = (node: SnapshotNode, parent: SnapshotNode) =>
      node.kind === "compartment" &&
      sameDiagramElement(node.targetObjectId, parent.targetObjectId);
    const toRow = (node: SnapshotNode): ModelRow => {
      claim(node, root.id, node.id);
      const label = parseNodeLabel(node.label, node.outsideLabels);
      const source = node.label?.trim()
        ? node.label
        : (node.outsideLabels ?? []).join(" ");
      return {
        id: node.id,
        targetObjectId: semanticId(node.targetObjectId),
        text: label.stereotypes.length ? label.name : rowText(source),
        title: source.replace(/\s+/g, " ").trim(),
      };
    };
    const collectRows = (section: SnapshotNode, depth = 0): ModelRow[] => {
      const rows: ModelRow[] = [];
      for (const child of children.get(section.id) ?? []) {
        if (child.kind === "port") continue;
        if (decorative(child, section) && depth < 8) {
          rows.push(...collectRows(child, depth + 1));
        } else rows.push(toRow(child));
      }
      return rows.filter((row) => row.text);
    };

    for (const child of children.get(root.id) ?? []) {
      if (child.kind === "port") {
        portIds.add(child.id);
        const rect = authoredRect(child);
        const label = (child.label?.trim() ? child.label : "") ||
          (child.outsideLabels ?? []).filter(Boolean).join(" ");
        let side: PortSide = incoming.has(child.id) && !outgoing.has(child.id)
          ? "west"
          : "east";
        if (rect && rootRect) {
          const distances: [PortSide, number][] = [
            ["west", Math.abs(rect.x + rect.width / 2 - rootRect.x)],
            [
              "east",
              Math.abs(rect.x + rect.width / 2 - rootRect.x - rootRect.width),
            ],
            ["north", Math.abs(rect.y + rect.height / 2 - rootRect.y)],
            [
              "south",
              Math.abs(rect.y + rect.height / 2 - rootRect.y - rootRect.height),
            ],
          ];
          side = distances.sort((a, b) => a[1] - b[1])[0][0];
        }
        ports.push({
          id: child.id,
          targetObjectId: semanticId(child.targetObjectId),
          label: label.replace(/\s+/g, " ").trim(),
          side,
          authored: rect && rootRect ? rect : undefined,
        });
        loose = undefined;
      } else if (decorative(child, root)) {
        loose = undefined;
        const rows = collectRows(child);
        if (rows.length) {
          sections.push({
            id: child.id,
            title: parseNodeLabel(child.label).name,
            rows,
          });
        }
      } else {
        const row = toRow(child);
        if (!row.text) continue;
        if (!loose) {
          loose = [];
          sections.push({ id: `${child.id}:rows`, title: "", rows: loose });
        }
        loose.push(row);
      }
    }
    blocks.push({
      id: root.id,
      targetObjectId: semanticId(root.targetObjectId),
      name: parsed.name,
      title: (root.label?.trim() ? root.label : parsed.name).replace(
        /\s+/g,
        " ",
      ).trim(),
      qualifiers,
      kind,
      marker: info?.marker,
      tone: info?.tone ?? "neutral",
      definition: info?.definition ?? false,
      shape: controlShape(root),
      sections,
      ports,
      rowCount: sections.reduce((sum, section) => sum + section.rows.length, 0),
      authored: rootRect ?? undefined,
    });
  }

  const modelEdges: ModelEdge[] = [];
  for (const edge of edges) {
    const sourceBlock = edge.sourceId ? owner.get(edge.sourceId) : undefined;
    const targetBlock = edge.targetId ? owner.get(edge.targetId) : undefined;
    if (!sourceBlock || !targetBlock) continue;
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
      marker: edgeMarker(edge),
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
}
export interface BlockContent {
  readonly pillWidth: number;
  readonly nameLines: readonly string[];
  readonly qualifier?: string;
  readonly headerHeight: number;
  readonly sections: readonly ContentSection[];
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
  if (block.shape !== "card") {
    return block.shape === "bar"
      ? { width: 60, height: 8 }
      : { width: BLOCK.control, height: BLOCK.control };
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
  const nameLines = block.shape === "card"
    ? wrapText(
      block.name,
      nameWidth,
      BLOCK.maxNameLines,
      width(measure, FONTS.name),
    )
    : [];
  const qualifier = qualifierText(block);
  const headerHeight = block.shape === "card"
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
    sections,
    height: Math.max(BLOCK.minHeight, y + (sections.length ? BLOCK.bottom : 0)),
  };
}

// ── Scene ───────────────────────────────────────────────────────────────────

export interface ScenePort {
  readonly id: string;
  readonly targetObjectId?: string;
  readonly label: string;
  readonly side: PortSide;
  readonly rect: DiagramRect;
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

/** SysON layout: authored positions; a tidy grid for blocks SysON never placed. */
export function sysonScene(
  model: DiagramModel,
  measure: TextMeasure,
): DiagramScene {
  const rects = new Map<string, DiagramRect>();
  let authoredBottom = -Infinity, authoredLeft = Infinity;
  for (const block of model.blocks) {
    if (!block.authored) continue;
    rects.set(block.id, block.authored);
    authoredBottom = Math.max(
      authoredBottom,
      block.authored.y + block.authored.height,
    );
    authoredLeft = Math.min(authoredLeft, block.authored.x);
  }
  const free = model.blocks.filter((block) => !block.authored);
  if (free.length) {
    const sizes = new Map(
      free.map((block) => [block.id, preferredBlockSize(block, measure)]),
    );
    const links = model.edges.map((edge) =>
      [edge.sourceBlock, edge.targetBlock] as const
    );
    const cells = fallbackCells(
      free.map((block) => block.id),
      links,
      gridColumns(free.length),
    );
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
    const offsets = (values: number[], gap: number) => {
      const starts: number[] = [];
      let position = 0;
      for (let index = 0; index < values.length; index++) {
        starts.push(position);
        position += (values[index] ?? 0) + (values[index] ? gap : 0);
      }
      return starts;
    };
    const columnX = offsets(columnWidths, GRID_GAP.x);
    const rowY = offsets(rowHeights, GRID_GAP.y);
    const originX = Number.isFinite(authoredLeft) ? authoredLeft : 0;
    const originY = Number.isFinite(authoredBottom) ? authoredBottom + 96 : 0;
    for (const [id, cell] of cells) {
      const size = sizes.get(id)!;
      rects.set(id, {
        x: originX + columnX[cell.column] +
          ((columnWidths[cell.column] ?? 0) - size.width) / 2,
        y: originY + rowY[cell.row],
        ...size,
      });
    }
  }
  const blocks = model.blocks.map((block) => {
    const rect = rects.get(block.id)!;
    const content = layoutBlockContent(
      block,
      rect.width,
      block.authored ? rect.height : undefined,
      measure,
    );
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
      const first = routing[0], last = routing.at(-1)!;
      const startBox = plan.sourcePort?.rect ?? plan.source.rect;
      const endBox = plan.targetPort?.rect ?? plan.target.rect;
      points = simplifyRoute([
        plan.sourcePort
          ? portAnchor(plan.sourcePort)
          : clipToBox(startBox, first),
        ...routing,
        plan.targetPort ? portAnchor(plan.targetPort) : clipToBox(endBox, last),
      ]);
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

/** Point where the segment from the box center to `toward` leaves the box. */
function clipToBox(box: DiagramRect, toward: DiagramPoint): DiagramPoint {
  const c = center(box);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const scale = Math.min(
    dx ? box.width / 2 / Math.abs(dx) : Infinity,
    dy ? box.height / 2 / Math.abs(dy) : Infinity,
  );
  return { x: c.x + dx * Math.min(1, scale), y: c.y + dy * Math.min(1, scale) };
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

function edgeLabels(
  edge: ModelEdge,
  points: readonly DiagramPoint[],
): SceneEdgeLabel[] {
  if (points.length < 2) return [];
  const labels: SceneEdgeLabel[] = [];
  if (edge.label) labels.push({ text: edge.label, ...pointAlong(points, 0.5) });
  if (edge.beginLabel) {
    labels.push({ text: edge.beginLabel, ...pointAlong(points, 0.12) });
  }
  if (edge.endLabel) {
    labels.push({ text: edge.endLabel, ...pointAlong(points, 0.88) });
  }
  return labels;
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
        y: port.rect.y - 4 - height,
        width: textWidth,
        height,
      };
    case "south":
      return {
        x: c.x - textWidth / 2,
        y: port.rect.y + port.rect.height + 4,
        width: textWidth,
        height,
      };
  }
}

/** Shift everything so the drawing starts at `SCENE_PADDING` from 0,0. */
export function normalizeScene(
  mode: DiagramLayoutMode,
  blocks: readonly SceneBlock[],
  edges: readonly SceneEdge[],
  measure: TextMeasure,
): DiagramScene {
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

/**
 * Edge decorations (§2): hollow triangle for specialization, open arrow for
 * dependency-like links (the line is dashed), filled diamond on the owner
 * (source) side for composition, small solid arrow for flows.
 */
export function edgeMarkerShapes(
  marker: EdgeMarker,
  points: readonly DiagramPoint[],
  size: number,
): MarkerShape[] {
  if (marker === "none" || points.length < 2) return [];
  const atStart = marker === "composition";
  const end = endDirection(points, atStart);
  if (!end) return [];
  const { tip, direction } = end;
  const normal = { x: -direction.y, y: direction.x };
  const at = (back: number, side: number) =>
    `${round2(tip.x - direction.x * back + normal.x * side)} ${
      round2(tip.y - direction.y * back + normal.y * side)
    }`;
  const p = `${round2(tip.x)} ${round2(tip.y)}`;
  switch (marker) {
    case "specialization":
      return [{
        d: `M${p} L${at(size * 1.3, size * 0.75)} L${
          at(size * 1.3, -size * 0.75)
        } Z`,
        fill: "panel",
      }];
    case "dependency":
      return [{
        d: `M${at(size * 1.1, size * 0.6)} L${p} L${
          at(size * 1.1, -size * 0.6)
        }`,
        fill: "none",
      }];
    case "composition":
      return [{
        d: `M${p} L${at(size * 0.9, size * 0.55)} L${at(size * 1.8, 0)} L${
          at(size * 0.9, -size * 0.55)
        } Z`,
        fill: "line",
      }];
    case "flow":
      return [{
        d: `M${p} L${at(size, size * 0.5)} L${at(size, -size * 0.5)} Z`,
        fill: "line",
      }];
  }
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
