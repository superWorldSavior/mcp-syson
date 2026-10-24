/**
 * The client-drawn diagram (syson-diagram-design.md §1–§3). Edges are drawn
 * first so lines pass under blocks, never over their text. Groups keep the
 * gesture contract: `g[data-node-id]` / `g[data-edge-id]` with
 * `data-target-object-id`, focusable buttons for semantic members only.
 *
 * Below the full level of detail, names are drawn at a constant on-screen
 * size: font sizes and line breaks follow the zoom, positions do not.
 */
import { Component, createRef, type JSX } from "preact";
import type { DiagramContextState } from "./diagram-model.ts";
import {
  BLOCK,
  type DiagramDetail,
  type DiagramScene,
  edgeMarkerShapes,
  ellipsize,
  fitScreenHeader,
  FONTS,
  roundedPath,
  type SceneBlock,
  type SceneEdge,
  type ScenePort,
  SCREEN_TEXT,
  type TextMeasure,
} from "./diagram-scene.ts";

export interface DiagramSvgLabels {
  readonly items: (count: number) => string;
  readonly more: (count: number) => string;
  /** Accessible name of a semantic member (graphical id → label). */
  readonly member: (id: string) => string | undefined;
}

export interface DiagramSvgProps {
  readonly scene: DiagramScene;
  readonly detail: DiagramDetail;
  readonly scale: number;
  /** Context state by semantic id (kit `data-context-state`). */
  readonly states: ReadonlyMap<string, DiagramContextState>;
  /** Semantic ids the user wants in context. */
  readonly desired: ReadonlySet<string>;
  /** Changes whenever `states` or `desired` change. */
  readonly stateKey: string;
  readonly measure: TextMeasure;
  /** A new object whenever the wording changes (locale, member labels). */
  readonly labels: DiagramSvgLabels;
}

const SCREEN = SCREEN_TEXT;
const SCREEN_PAD = 7;

type Attributes = Record<string, string | number | undefined>;

function memberAttributes(
  graphicalId: string,
  targetObjectId: string | undefined,
  props: DiagramSvgProps,
  fallbackLabel: string,
): Attributes {
  if (!targetObjectId) return {};
  const desired = props.desired.has(targetObjectId);
  return {
    "data-target-object-id": targetObjectId,
    tabIndex: 0,
    role: "button",
    "aria-label": props.labels.member(graphicalId) || fallbackLabel ||
      targetObjectId,
    "aria-pressed": String(desired),
    "data-selected": String(desired),
    "data-context-state": props.states.get(targetObjectId) ?? "none",
  };
}

function Pill(
  { x, y, width, height, marker, fontSize }: {
    x: number;
    y: number;
    width: number;
    height: number;
    marker: string;
    fontSize: number;
  },
) {
  return (
    <>
      <rect
        className="syson-pill-box"
        x={x}
        y={y}
        width={width}
        height={height}
        rx={Math.min(4, height / 4)}
      />
      <text
        className="syson-pill-text"
        x={x + width / 2}
        y={y + height / 2}
        font-size={fontSize}
        text-anchor="middle"
        dominant-baseline="central"
      >
        {marker}
      </text>
    </>
  );
}

function fullHeader(item: SceneBlock) {
  const { block, rect, content } = item;
  const pillX = rect.x + BLOCK.padX;
  const nameX = pillX +
    (content.pillWidth ? content.pillWidth + BLOCK.pillGap : 0);
  // A header-only card centers its header in the little slack it has.
  const slack = rect.height - content.headerHeight;
  const offset = !content.sections.length && slack > 0 && slack < 24
    ? slack / 2
    : 0;
  const firstBaseline = rect.y + offset + BLOCK.padTop + 12.5;
  return (
    <>
      {block.marker && (
        <Pill
          x={pillX}
          y={rect.y + offset + BLOCK.padTop +
            (BLOCK.nameLine - BLOCK.pillHeight) / 2}
          width={content.pillWidth}
          height={BLOCK.pillHeight}
          marker={block.marker}
          fontSize={FONTS.pill.size}
        />
      )}
      {content.nameLines.map((line, index) => (
        <text
          key={index}
          className="syson-block-name"
          x={nameX}
          y={firstBaseline + index * BLOCK.nameLine}
          font-size={FONTS.name.size}
        >
          {line}
        </text>
      ))}
      {content.qualifier && (
        <text
          className="syson-block-qualifier"
          x={nameX}
          y={firstBaseline + content.nameLines.length * BLOCK.nameLine - 2}
          font-size={FONTS.qualifier.size}
        >
          {content.qualifier}
        </text>
      )}
    </>
  );
}

/** Header-only and tint levels: text at a constant on-screen size. */
function screenText(
  item: SceneBlock,
  props: DiagramSvgProps,
  withPill: boolean,
) {
  const { block, rect } = item;
  const k = 1 / props.scale;
  const width = rect.width * props.scale, height = rect.height * props.scale;
  const font = withPill ? SCREEN.name : SCREEN.tint;
  const line = withPill ? SCREEN.line : SCREEN.tintLine;
  const pad = withPill ? SCREEN_PAD : 4;
  const inner = width - pad * 2;
  // Very flat tinted blocks still carry one centered line.
  if (inner < 18 || height < 8) return null;
  const lines = Math.max(1, Math.floor((height - pad * 2 + 3) / line));
  const header = fitScreenHeader(
    block.name,
    withPill ? block.marker : undefined,
    withPill && block.rowCount > 0 ? props.labels.items(block.rowCount) : "",
    { width: inner, lines },
    props.measure,
    font,
  );
  const x = rect.x + pad * k;
  const used = header.nameLines.length + (header.pill === "line" ? 1 : 0);
  // Tinted blocks center their name; cards read from the top unless the
  // name alone nearly fills them, then it is centered too.
  const fills = !header.hint && height - used * line < pad * 2;
  const top = withPill && !fills
    ? rect.y + pad * k
    : rect.y + (height - used * line) / 2 * k;
  // The hint sits at the bottom, never over the name.
  const hintY = Math.max(
    rect.y + rect.height - (pad + 6) * k,
    top + (used * line + line / 2) * k,
  );
  const lineAt = (index: number) => top + (index * line + line / 2) * k;
  const nameStart = header.pill === "line" ? 1 : 0;
  return (
    <>
      {header.pill !== "none" && (
        <Pill
          x={x}
          y={lineAt(0) - SCREEN.pillHeight / 2 * k}
          width={header.pillWidth * k}
          height={SCREEN.pillHeight * k}
          marker={block.marker!}
          fontSize={SCREEN.pill.size * k}
        />
      )}
      {header.nameLines.map((text, index) => (
        <text
          key={index}
          className="syson-block-name"
          x={index === 0 && header.pill === "inline"
            ? x + (header.pillWidth + SCREEN.pillGap) * k
            : x}
          y={lineAt(index + nameStart)}
          font-size={font.size * k}
          dominant-baseline="central"
        >
          {text}
        </text>
      ))}
      {header.hint && (
        <text
          className="syson-block-hint"
          x={x}
          y={hintY}
          font-size={SCREEN.hint.size * k}
          dominant-baseline="central"
        >
          {props.labels.items(block.rowCount)}
        </text>
      )}
    </>
  );
}

function controlShape(item: SceneBlock) {
  const { rect, block } = item;
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  switch (block.shape) {
    case "decision":
      return (
        <polygon
          className="syson-control"
          points={`${cx},${rect.y} ${rect.x + rect.width},${cy} ${cx},${
            rect.y + rect.height
          } ${rect.x},${cy}`}
        />
      );
    case "start":
      return (
        <ellipse
          className="syson-control"
          data-fill="solid"
          cx={cx}
          cy={cy}
          rx={rect.width / 2}
          ry={rect.height / 2}
        />
      );
    case "done":
      return (
        <>
          <ellipse
            className="syson-control"
            cx={cx}
            cy={cy}
            rx={rect.width * 0.45}
            ry={rect.height * 0.45}
          />
          <ellipse
            className="syson-control"
            data-fill="solid"
            cx={cx}
            cy={cy}
            rx={rect.width * 0.3}
            ry={rect.height * 0.3}
          />
        </>
      );
    default:
      return (
        <rect
          className="syson-control"
          data-fill="solid"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={2}
        />
      );
  }
}

function Port(
  { port, props, showLabel }: {
    port: ScenePort;
    props: DiagramSvgProps;
    showLabel: boolean;
  },
) {
  const { rect } = port;
  const cy = rect.y + rect.height / 2, cx = rect.x + rect.width / 2;
  const text = showLabel && port.label
    ? ellipsize(
      port.label,
      BLOCK.portLabelMax,
      (value) => props.measure(value, FONTS.port),
    )
    : "";
  const label = port.side === "west"
    ? { x: rect.x - 4, y: cy - 7, anchor: "end" }
    : port.side === "east"
    ? { x: rect.x + rect.width + 4, y: cy - 7, anchor: "start" }
    : port.side === "north"
    ? { x: cx, y: rect.y - 5, anchor: "middle" }
    : { x: cx, y: rect.y + rect.height + 12, anchor: "middle" };
  return (
    <g
      className="syson-port"
      data-node-id={port.id}
      {...memberAttributes(port.id, port.targetObjectId, props, port.label)}
    >
      <title>{port.label}</title>
      <rect
        className="syson-port-box"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={1.5}
      />
      {text && (
        <text
          className="syson-port-label"
          x={label.x}
          y={label.y}
          font-size={FONTS.port.size}
          text-anchor={label.anchor}
        >
          {text}
        </text>
      )}
    </g>
  );
}

function Block({ item, props }: { item: SceneBlock; props: DiagramSvgProps }) {
  const { block, rect, content, ports } = item;
  const detail = props.detail;
  const k = detail === "full" ? 1 : 1 / props.scale;
  const card = block.shape === "card";
  return (
    <g
      className="syson-block-layer"
      data-block-id={block.id}
      data-kind-tone={block.tone}
      data-definition={block.definition ? "true" : undefined}
    >
      <g
        className="syson-block"
        data-node-id={block.id}
        {...memberAttributes(block.id, block.targetObjectId, props, block.name)}
      >
        <title>{block.title}</title>
        {!card ? controlShape(item) : detail === "tint"
          ? (
            <rect
              className="syson-block-tint"
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={BLOCK.radius}
            />
          )
          : (
            <>
              <rect
                className="syson-block-shadow"
                x={rect.x}
                y={rect.y + 1.5 * k}
                width={rect.width}
                height={rect.height}
                rx={BLOCK.radius}
              />
              <rect
                className="syson-block-card"
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={BLOCK.radius}
              />
              <rect
                className="syson-block-accent"
                x={rect.x + 1.5 * k}
                y={rect.y + Math.min(6, rect.height / 4)}
                width={3 * k}
                height={Math.max(
                  0,
                  rect.height - Math.min(12, rect.height / 2),
                )}
                rx={1.5 * k}
              />
            </>
          )}
        {card && detail === "full" && fullHeader(item)}
        {card && detail === "header" && screenText(item, props, true)}
        {card && detail === "tint" && screenText(item, props, false)}
      </g>
      {card && detail === "full" &&
        content.sections.map((section) => (
          <g key={section.id} className="syson-section">
            <line
              className="syson-section-rule"
              x1={rect.x + 1}
              x2={rect.x + rect.width - 1}
              y1={rect.y + section.y}
              y2={rect.y + section.y}
            />
            {section.title && (
              <text
                className="syson-section-title"
                x={rect.x + BLOCK.padX}
                y={rect.y + section.y + 15}
                font-size={FONTS.title.size}
              >
                {section.title.toUpperCase()}
              </text>
            )}
            {section.rows.map((row) => (
              <g
                key={row.id}
                className="syson-row"
                data-node-id={row.id}
                {...memberAttributes(
                  row.id,
                  row.targetObjectId,
                  props,
                  row.text,
                )}
              >
                <title>{row.title}</title>
                <rect
                  className="syson-row-hit"
                  x={rect.x + 4}
                  y={rect.y + row.y}
                  width={rect.width - 8}
                  height={BLOCK.row}
                  rx={4}
                />
                <text
                  className="syson-row-text"
                  x={rect.x + BLOCK.padX + 4}
                  y={rect.y + row.y + 14}
                  font-size={FONTS.row.size}
                >
                  {row.text}
                </text>
              </g>
            ))}
            {section.more && (
              <text
                className="syson-row-more"
                x={rect.x + BLOCK.padX + 4}
                y={rect.y + section.more.y + 14}
                font-size={FONTS.more.size}
              >
                {props.labels.more(section.more.count)}
              </text>
            )}
          </g>
        ))}
      {detail !== "tint" &&
        ports.map((port) => (
          <Port
            key={port.id}
            port={port}
            props={props}
            showLabel={detail === "full"}
          />
        ))}
    </g>
  );
}

function Edge({ item, props }: { item: SceneEdge; props: DiagramSvgProps }) {
  const { edge, points } = item;
  if (points.length < 2) return null;
  const d = roundedPath(points, 6);
  // Markers keep ~8 px on screen when zoomed out.
  const size = 8 / Math.min(1, props.scale);
  const shapes = edgeMarkerShapes(edge.marker, points, size);
  const label = props.labels.member(edge.id) || edge.label || "";
  return (
    <g
      className="syson-edge"
      data-edge-id={edge.id}
      data-ends={`${edge.sourceBlock} ${edge.targetBlock}`}
      data-marker={edge.marker}
      {...memberAttributes(edge.id, edge.targetObjectId, props, label)}
    >
      {label && <title>{label}</title>}
      <path className="syson-edge-hit" d={d} />
      <path
        className="syson-edge-line"
        d={d}
        data-dashed={edge.marker === "dependency" ? "true" : undefined}
      />
      {shapes.map((shape, index) => (
        <path
          key={index}
          className="syson-edge-marker"
          data-fill={shape.fill}
          d={shape.d}
        />
      ))}
      {props.detail === "full" &&
        item.labels.map((text, index) => {
          const width = props.measure(text.text, FONTS.edgeLabel) + 12;
          return (
            <g key={index} className="syson-edge-label">
              <rect
                x={text.x - width / 2}
                y={text.y - 9}
                width={width}
                height={18}
                rx={9}
              />
              <text
                x={text.x}
                y={text.y}
                font-size={FONTS.edgeLabel.size}
                text-anchor="middle"
                dominant-baseline="central"
              >
                {text.text}
              </text>
            </g>
          );
        })}
    </g>
  );
}

/**
 * Re-renders only when the scene, the level of detail, the zoom (below full
 * detail, or for marker sizes), context states or wording change: pan frames
 * never diff the drawing.
 */
export class DiagramSvg extends Component<DiagramSvgProps> {
  private readonly root = createRef<SVGSVGElement>();
  private hovered?: string;

  override shouldComponentUpdate(next: DiagramSvgProps) {
    const current = this.props;
    return next.scene !== current.scene || next.detail !== current.detail ||
      next.scale !== current.scale || next.stateKey !== current.stateKey ||
      next.measure !== current.measure || next.labels !== current.labels;
  }

  override componentDidUpdate(previous: DiagramSvgProps) {
    if (previous.scene !== this.props.scene) this.hovered = undefined;
  }

  /** Hover lifts the block and highlights its incident edges (accent). */
  private hover(id: string | undefined) {
    if (id === this.hovered) return;
    const svg = this.root.current;
    if (!svg) return;
    for (const element of svg.querySelectorAll("[data-hover],[data-hot]")) {
      element.removeAttribute("data-hover");
      element.removeAttribute("data-hot");
    }
    this.hovered = id;
    if (!id) return;
    const escaped = CSS.escape(id);
    svg.querySelector(`g[data-block-id="${escaped}"]`)?.setAttribute(
      "data-hover",
      "true",
    );
    for (const edge of svg.querySelectorAll(`g[data-ends~="${escaped}"]`)) {
      edge.setAttribute("data-hot", "true");
    }
  }

  private readonly onPointerOver = (
    event: JSX.TargetedPointerEvent<SVGSVGElement>,
  ) => {
    const target = event.target instanceof Element
      ? event.target.closest("g[data-block-id]")
      : null;
    this.hover(target?.getAttribute("data-block-id") ?? undefined);
  };

  private readonly onPointerLeave = () => this.hover(undefined);

  override render() {
    const props = this.props;
    const { scene } = props;
    return (
      <svg
        ref={this.root}
        className="syson-diagram-svg"
        xmlns="http://www.w3.org/2000/svg"
        width={scene.width}
        height={scene.height}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        data-detail={props.detail}
        data-layout={scene.mode}
        onPointerOver={this.onPointerOver}
        onPointerLeave={this.onPointerLeave}
      >
        <g className="syson-diagram-edges">
          {scene.edges.map((item) => (
            <Edge key={item.edge.id} item={item} props={props} />
          ))}
        </g>
        <g className="syson-diagram-blocks">
          {scene.blocks.map((item) => (
            <Block key={item.block.id} item={item} props={props} />
          ))}
        </g>
      </svg>
    );
  }
}
