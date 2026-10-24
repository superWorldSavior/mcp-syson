/**
 * Overview of the whole diagram in the canvas corner: primary blocks as
 * shapes, the current selection in accent and the visible area as a frame.
 * A press or a drag inside it centers the canvas on that point.
 */
import { useRef } from "preact/hooks";
import {
  type DiagramPoint,
  type DiagramRect,
  minimapSize,
} from "./diagram-model.ts";

const BOX = { width: 168, height: 140 };

export function DiagramMinimap(
  { label, bounds, blocks, selectedIds, viewport, onCenter }: {
    readonly label: string;
    readonly bounds: DiagramRect;
    readonly blocks: readonly {
      readonly id: string;
      readonly targetId: string;
      readonly rect: DiagramRect;
    }[];
    readonly selectedIds: ReadonlySet<string>;
    readonly viewport: DiagramRect;
    readonly onCenter: (point: DiagramPoint) => void;
  },
) {
  const pointer = useRef<number>();
  const size = minimapSize(bounds, BOX);
  if (!size) return null;
  const toDiagram = (event: PointerEvent, svg: SVGSVGElement): DiagramPoint => {
    const box = svg.getBoundingClientRect();
    return {
      x: bounds.x + (event.clientX - box.left) / box.width * bounds.width,
      y: bounds.y + (event.clientY - box.top) / box.height * bounds.height,
    };
  };
  // Clamp the frame to the drawn bounds so a far pan still reads as an edge.
  const frame = {
    x: Math.max(bounds.x, viewport.x),
    y: Math.max(bounds.y, viewport.y),
    right: Math.min(bounds.x + bounds.width, viewport.x + viewport.width),
    bottom: Math.min(bounds.y + bounds.height, viewport.y + viewport.height),
  };
  const stop = (event: Event) => event.stopPropagation();
  return (
    <div
      className="syson-diagram-minimap"
      role="group"
      aria-label={label}
      title={label}
      onPointerDown={stop}
      onWheel={stop}
      onClick={stop}
      onDblClick={stop}
      onKeyDown={stop}
      onKeyUp={stop}
    >
      <svg
        aria-hidden="true"
        width={size.width}
        height={size.height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio="none"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          onCenter(toDiagram(event, event.currentTarget));
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return;
          event.stopPropagation();
          onCenter(toDiagram(event, event.currentTarget));
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          pointer.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          pointer.current = undefined;
        }}
      >
        <rect
          className="syson-diagram-minimap-frame"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
        />
        {blocks.map((block) => (
          <rect
            key={block.id}
            className="syson-diagram-minimap-block"
            data-selected={selectedIds.has(block.targetId) ? "true" : undefined}
            x={block.rect.x}
            y={block.rect.y}
            width={block.rect.width}
            height={block.rect.height}
          />
        ))}
        {frame.right > frame.x && frame.bottom > frame.y && (
          <rect
            className="syson-diagram-minimap-viewport"
            x={frame.x}
            y={frame.y}
            width={frame.right - frame.x}
            height={frame.bottom - frame.y}
          />
        )}
      </svg>
    </div>
  );
}
