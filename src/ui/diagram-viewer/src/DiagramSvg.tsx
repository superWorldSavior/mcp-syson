/**
 * The client-drawn diagram (syson-diagram-design.md §1–§3). Three layers:
 * container bodies (frames and the wells of their free-form regions), then
 * edges, then blocks. Lines pass over a container's empty regions but under
 * every block, header and row, never over their text. Groups keep the
 * gesture contract: `g[data-node-id]` / `g[data-edge-id]` with
 * `data-target-object-id`, focusable buttons for semantic members only.
 *
 * Below the full level of detail, names are drawn at a constant on-screen
 * size: font sizes and line breaks follow the zoom, positions do not.
 */
import { Component, createRef, type JSX } from "preact";
import type { DiagramContextState, DiagramRect } from "./diagram-model.ts";
import {
  BLOCK,
  type DiagramDetail,
  type DiagramScene,
  edgeDecorationShapes,
  ellipsize,
  fitScreenHeader,
  FONTS,
  isContainer,
  PORT_LABEL_LINE,
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
/** Title tab of a view frame: its slanted corner. */
const TAB_CUT = 8;

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

/** Height of a container's header band: down to its first compartment. */
function headBand(item: SceneBlock): number {
  const { block, rect, content } = item;
  if (block.shape === "frame") return content.headerHeight;
  const tops = [
    ...content.sections.map((section) => section.y),
    ...content.regions.map((region) => region.y),
  ];
  return Math.max(
    content.headerHeight,
    Math.min(rect.height, tops.length ? Math.min(...tops) : rect.height),
  );
}

/** Width of a frame's title tab: its pill and one-line name. */
function tabWidth(item: SceneBlock, props: DiagramSvgProps): number {
  const { rect, content } = item;
  const name = content.nameLines[0] ?? "";
  const wanted = BLOCK.padX * 2 + TAB_CUT +
    (content.pillWidth ? content.pillWidth + BLOCK.pillGap : 0) +
    props.measure(name, FONTS.name);
  return Math.min(rect.width, Math.max(120, wanted));
}

function fullHeader(item: SceneBlock, props: DiagramSvgProps) {
  const { block, rect, content } = item;
  const container = isContainer(block);
  const pillX = rect.x + BLOCK.padX;
  const nameX = pillX +
    (content.pillWidth ? content.pillWidth + BLOCK.pillGap : 0);
  // A header-only card centers its header in the slack it has; a container
  // centers it in its header band.
  const slack = rect.height - content.headerHeight;
  const offset = container
    ? content.headerTop
    : !content.sections.length && slack > 0 && slack < 40
    ? slack / 2
    : 0;
  const firstBaseline = rect.y + offset + BLOCK.padTop + 12.5;
  const nameWidth = block.shape === "frame"
    ? tabWidth(item, props) - (nameX - rect.x) - BLOCK.padX - TAB_CUT
    : Infinity;
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
          {Number.isFinite(nameWidth)
            ? ellipsize(
              line,
              nameWidth,
              (value) => props.measure(value, FONTS.name),
            )
            : line}
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

/** Header-only and tint levels: text at a constant on-screen size in `box`. */
function screenText(
  item: SceneBlock,
  props: DiagramSvgProps,
  withPill: boolean,
  box: DiagramRect = item.rect,
  center = !withPill,
) {
  const { block } = item;
  const k = 1 / props.scale;
  const width = box.width * props.scale, height = box.height * props.scale;
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
    withPill && block.rowCount > 0 && !isContainer(block)
      ? props.labels.items(block.rowCount)
      : "",
    { width: inner, lines },
    props.measure,
    font,
  );
  const x = box.x + pad * k;
  const used = header.nameLines.length + (header.pill === "line" ? 1 : 0);
  // Tinted blocks center their name; cards read from the top unless the
  // name alone nearly fills them, then it is centered too.
  const fills = !header.hint && height - used * line < pad * 2;
  const top = !center && !fills
    ? box.y + pad * k
    : box.y + (height - used * line) / 2 * k;
  // The hint sits at the bottom, never over the name.
  const hintY = Math.max(
    box.y + box.height - (pad + 6) * k,
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
          rx={Math.min(3, rect.height / 2)}
        />
      );
  }
}

/** Name under a fork, join or decision (SysON draws it outside). */
function Caption(
  { item, props }: { item: SceneBlock; props: DiagramSvgProps },
) {
  const { rect, block } = item;
  if (!block.caption) return null;
  const full = props.detail === "full";
  const k = full ? 1 : 1 / props.scale;
  const size = full ? FONTS.port.size + 0.5 : SCREEN.hint.size;
  if (props.detail === "tint") return null;
  return (
    <text
      className="syson-control-caption"
      x={rect.x + rect.width / 2}
      y={rect.y + rect.height + 4 * k}
      font-size={size * k}
      text-anchor="middle"
      dominant-baseline="hanging"
    >
      {ellipsize(
        block.caption,
        Math.max(rect.width * 1.8, 120),
        (value) => props.measure(value, { size: FONTS.port.size + 0.5 }),
      )}
    </text>
  );
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
  const stack = (port.labelRow ?? 0) * PORT_LABEL_LINE;
  const label = port.side === "west"
    ? { x: rect.x - 4, y: cy - 7, anchor: "end" }
    : port.side === "east"
    ? { x: rect.x + rect.width + 4, y: cy - 7, anchor: "start" }
    : port.side === "north"
    ? { x: cx, y: rect.y - 5 - stack, anchor: "middle" }
    : { x: cx, y: rect.y + rect.height + 12 + stack, anchor: "middle" };
  // Parameter direction: a chevron pointing into (in) or out of the block.
  const inward = { west: 1, east: -1, north: 1, south: -1 }[port.side];
  const vertical = port.side === "north" || port.side === "south";
  const sign = port.direction === "in" ? inward : -inward;
  const h = rect.width * 0.22;
  const chevron = port.direction
    ? vertical
      ? `M${cx - h * 1.3} ${cy - sign * h} L${cx} ${cy + sign * h} L${
        cx + h * 1.3
      } ${cy - sign * h}`
      : `M${cx - sign * h} ${cy - h * 1.3} L${cx + sign * h} ${cy} L${
        cx - sign * h
      } ${cy + h * 1.3}`
    : undefined;
  return (
    <g
      className="syson-port"
      data-node-id={port.id}
      data-direction={port.direction}
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
      {chevron && <path className="syson-port-glyph" d={chevron} />}
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

/** Rows of the list sections, at full detail. */
function Sections(
  { item, props, opaque }: {
    item: SceneBlock;
    props: DiagramSvgProps;
    opaque: boolean;
  },
) {
  const { rect, content } = item;
  return (
    <>
      {content.sections.map((section) => {
        const bottom = section.height !== undefined
          ? section.y + section.height
          : (section.more?.y ?? section.rows.at(-1)?.y ?? section.y) +
            BLOCK.row;
        return (
          <g key={section.id} className="syson-section">
            {opaque && (
              <rect
                className="syson-section-band"
                x={rect.x + 1}
                y={rect.y + section.y}
                width={rect.width - 2}
                height={Math.max(0, Math.min(bottom, rect.height) - section.y)}
              />
            )}
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
        );
      })}
    </>
  );
}

/** Bottom layer: a container's frame and the wells of its regions. */
function ContainerBody(
  { item, props }: { item: SceneBlock; props: DiagramSvgProps },
) {
  const { block, rect, content } = item;
  const frame = block.shape === "frame";
  const tint = props.detail === "tint";
  return (
    <g
      className="syson-block-layer syson-container-body"
      data-container-id={block.id}
      data-kind-tone={block.tone}
      data-frame={frame ? "true" : undefined}
      data-faded={block.faded ? "true" : undefined}
    >
      <rect
        className={frame ? "syson-frame" : "syson-block-card"}
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={frame ? 10 : BLOCK.radius}
      />
      {!frame && !tint && content.regions.map((region) => (
        <rect
          key={region.id}
          className="syson-region"
          x={rect.x + 1}
          y={rect.y + region.y}
          width={rect.width - 2}
          height={Math.max(
            0,
            Math.min(region.height, rect.height - region.y - 1),
          )}
          rx={region.y + region.height >= rect.height - 1
            ? BLOCK.radius - 1
            : 0}
        />
      ))}
    </g>
  );
}

/** Top layer of a container: header, list sections, region titles, ports. */
function ContainerChrome(
  { item, props }: { item: SceneBlock; props: DiagramSvgProps },
) {
  const { block, rect, content, ports } = item;
  const detail = props.detail;
  const frame = block.shape === "frame";
  const band = headBand(item);
  const tab = frame ? tabWidth(item, props) : rect.width;
  const head: DiagramRect = {
    x: rect.x,
    y: rect.y,
    width: tab,
    height: Math.min(band, rect.height),
  };
  const k = detail === "full" ? 1 : 1 / props.scale;
  return (
    <g
      className="syson-block-layer"
      data-block-id={block.id}
      data-container="true"
      data-frame={frame ? "true" : undefined}
      data-kind-tone={block.tone}
      data-definition={block.definition ? "true" : undefined}
      data-faded={block.faded ? "true" : undefined}
    >
      <g
        className="syson-block"
        data-node-id={block.id}
        {...memberAttributes(block.id, block.targetObjectId, props, block.name)}
      >
        <title>{block.title}</title>
        <rect
          className="syson-container-outline"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={frame ? 10 : BLOCK.radius}
        />
        {frame
          ? (
            <path
              className="syson-frame-tab"
              d={`M${rect.x} ${rect.y + head.height} V${
                rect.y + 10
              } Q${rect.x} ${rect.y} ${rect.x + 10} ${rect.y} H${
                rect.x + tab
              } V${rect.y + head.height - TAB_CUT} L${rect.x + tab - TAB_CUT} ${
                rect.y + head.height
              } Z`}
            />
          )
          : (
            <>
              <path
                className="syson-container-head"
                d={`M${rect.x} ${rect.y + head.height} V${
                  rect.y + BLOCK.radius
                } Q${rect.x} ${rect.y} ${rect.x + BLOCK.radius} ${rect.y} H${
                  rect.x + rect.width - BLOCK.radius
                } Q${rect.x + rect.width} ${rect.y} ${rect.x + rect.width} ${
                  rect.y + BLOCK.radius
                } V${rect.y + head.height} Z`}
              />
              {detail !== "tint" && (
                <rect
                  className="syson-block-accent"
                  x={rect.x + 1.5 * k}
                  y={rect.y + Math.min(6, head.height / 4)}
                  width={3 * k}
                  height={Math.max(
                    0,
                    head.height - Math.min(12, head.height / 2),
                  )}
                  rx={1.5 * k}
                />
              )}
            </>
          )}
        {detail === "full" && fullHeader(item, props)}
        {detail === "header" && screenText(item, props, true, head, false)}
        {detail === "tint" &&
          screenText(item, props, false, {
            ...head,
            height: Math.max(head.height, 18 / props.scale),
          }, false)}
      </g>
      {detail === "full" && <Sections item={item} props={props} opaque />}
      {detail !== "tint" &&
        content.regions.map((region) =>
          region.title && region.y > 0
            ? (
              <g key={region.id} className="syson-region-head">
                <line
                  className="syson-section-rule"
                  x1={rect.x + 1}
                  x2={rect.x + rect.width - 1}
                  y1={rect.y + region.y}
                  y2={rect.y + region.y}
                />
                {detail === "full" && (
                  <text
                    className="syson-section-title"
                    x={rect.x + BLOCK.padX}
                    y={rect.y + region.y + 15}
                    font-size={FONTS.title.size}
                  >
                    {region.title.toUpperCase()}
                  </text>
                )}
              </g>
            )
            : null
        )}
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

function Block({ item, props }: { item: SceneBlock; props: DiagramSvgProps }) {
  const { block, rect, ports } = item;
  if (isContainer(block)) return <ContainerChrome item={item} props={props} />;
  const detail = props.detail;
  const k = detail === "full" ? 1 : 1 / props.scale;
  const card = block.shape === "card";
  return (
    <g
      className="syson-block-layer"
      data-block-id={block.id}
      data-kind-tone={block.tone}
      data-definition={block.definition ? "true" : undefined}
      data-faded={block.faded ? "true" : undefined}
    >
      <g
        className="syson-block"
        data-node-id={block.id}
        {...memberAttributes(block.id, block.targetObjectId, props, block.name)}
      >
        <title>{block.title || block.caption}</title>
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
        {card && detail === "full" && fullHeader(item, props)}
        {card && detail === "header" && screenText(item, props, true)}
        {card && detail === "tint" && screenText(item, props, false)}
      </g>
      {!card && <Caption item={item} props={props} />}
      {card && detail === "full" && (
        <Sections item={item} props={props} opaque={false} />
      )}
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
  const shapes = edgeDecorationShapes(edge.decoration, points, size);
  const label = props.labels.member(edge.id) || edge.label || "";
  return (
    <g
      className="syson-edge"
      data-edge-id={edge.id}
      data-ends={`${edge.sourceBlock} ${edge.targetBlock}`}
      data-marker={edge.marker}
      data-faded={edge.faded ? "true" : undefined}
      {...memberAttributes(edge.id, edge.targetObjectId, props, label)}
    >
      {label && <title>{label}</title>}
      <path className="syson-edge-hit" d={d} />
      <path
        className="syson-edge-line"
        d={d}
        data-line={edge.decoration.line === "solid"
          ? undefined
          : edge.decoration.line}
      />
      {shapes.map((shape, index) => (
        <path
          key={index}
          className="syson-edge-marker"
          data-fill={shape.fill}
          d={shape.d}
        />
      ))}
    </g>
  );
}

/**
 * Edge labels sit above the blocks (they were placed clear of them): a
 * label is never hidden. Clicking one selects its edge; the edge itself
 * stays the single focus stop.
 */
function EdgeLabels(
  { item, props }: { item: SceneEdge; props: DiagramSvgProps },
) {
  const { edge } = item;
  if (!item.labels.length) return null;
  return (
    <g
      className="syson-edge-labels"
      data-edge-id={edge.id}
      data-label-for={edge.id}
      data-context-state={edge.targetObjectId
        ? props.states.get(edge.targetObjectId) ?? "none"
        : undefined}
    >
      {item.labels.map((text, index) => {
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
    const containers = scene.blocks.filter((item) => isContainer(item.block));
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
        {containers.length > 0 && (
          <g className="syson-diagram-containers">
            {containers.map((item) => (
              <ContainerBody key={item.block.id} item={item} props={props} />
            ))}
          </g>
        )}
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
        {props.detail === "full" && (
          <g className="syson-diagram-labels">
            {scene.edges.map((item) => (
              <EdgeLabels key={item.edge.id} item={item} props={props} />
            ))}
          </g>
        )}
      </svg>
    );
  }
}
