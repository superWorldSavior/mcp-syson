import { Button, Toolbar } from "@mcpview/components/preact/components";
import { useEffect, useId, useRef, useState } from "preact/hooks";
const paths = {
  select: "M4 3l15 10-7 1-4 7z",
  pan:
    "M8 11V6a1.5 1.5 0 013 0v5-7a1.5 1.5 0 013 0v7-5a1.5 1.5 0 013 0v6-2a1.5 1.5 0 013 0v5c0 5-3 7-7 7-3 0-5-2-7-5l-2-3a1.5 1.5 0 012-2l2 2",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  fit: "M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 8h8v8H8z",
  selection:
    "M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z",
  minimap: "M3 5h18v14H3zM13 12h5v4h-5z",
};
export function DiagramToolbar({
  mode,
  scale,
  selectedCount,
  minimap,
  labels,
  help,
  onMode,
  onZoom,
  onFit,
  onZoomToSelection,
  onMinimap,
}: {
  mode: "select" | "pan";
  scale: number;
  /** Selected elements present in this diagram; 0 disables zoom to selection. */
  selectedCount: number;
  minimap: boolean;
  labels: {
    toolbar: string;
    select: string;
    pan: string;
    minus: string;
    plus: string;
    fit: string;
    zoomToSelection: string;
    selectedCount: string;
    minimap: string;
    help: string;
    helpTitle: string;
  };
  /** Gesture reminders shown by the « ? » popover (formerly a permanent line). */
  help: readonly string[];
  onMode: (mode: "select" | "pan") => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onZoomToSelection: () => void;
  onMinimap: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const helpButton = useRef<HTMLButtonElement>(null);
  const helpRoot = useRef<HTMLSpanElement>(null);
  const helpId = useId();
  useEffect(() => {
    if (!helpOpen) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !helpRoot.current?.contains(event.target)
      ) setHelpOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [helpOpen]);
  const icon = (kind: keyof typeof paths) => (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
  const control = (
    kind: keyof typeof paths,
    label: string,
    action: () => void,
    pressed?: boolean,
    disabled?: boolean,
  ) => (
    <Button
      className="syson-diagram-iconbutton"
      title={label}
      pressed={pressed}
      disabled={disabled}
      onClick={action}
    >
      {icon(kind)}
      <span className="syson-diagram-sr-only">{label}</span>
    </Button>
  );
  return (
    <div
      className="syson-diagram-floating-tools"
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && helpOpen) {
          event.preventDefault();
          setHelpOpen(false);
          helpButton.current?.focus();
        }
      }}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <Toolbar label={labels.toolbar}>
        {control("select", labels.select, () =>
          onMode("select"), mode === "select")}
        {control("pan", labels.pan, () =>
          onMode("pan"), mode === "pan")}
        <span className="syson-diagram-toolseparator" aria-hidden="true" />
        {control("minus", labels.minus, () =>
          onZoom(0.8))}
        <span className="syson-diagram-zoom">{Math.round(scale * 100)}%</span>
        {control("plus", labels.plus, () =>
          onZoom(1.2))}
        {control("fit", labels.fit, onFit)}
        {control(
          "selection",
          labels.zoomToSelection,
          onZoomToSelection,
          undefined,
          selectedCount === 0,
        )}
        <span className="syson-diagram-count" aria-live="polite">
          {selectedCount > 0 && (
            <>
              <span aria-hidden="true">{selectedCount}</span>
              <span className="syson-diagram-sr-only">
                {labels.selectedCount}
              </span>
            </>
          )}
        </span>
        <span className="syson-diagram-toolseparator" aria-hidden="true" />
        {control("minimap", labels.minimap, onMinimap, minimap)}
        <span className="syson-diagram-help" ref={helpRoot}>
          <button
            ref={helpButton}
            type="button"
            className="mcp-view-button syson-diagram-iconbutton syson-diagram-help-button"
            aria-expanded={helpOpen ? "true" : "false"}
            aria-controls={helpId}
            aria-label={labels.help}
            title={labels.help}
            onClick={() => setHelpOpen(!helpOpen)}
          >
            <span aria-hidden="true">?</span>
          </button>
          <div
            id={helpId}
            className="syson-diagram-help-popover"
            role="note"
            aria-label={labels.helpTitle}
            hidden={!helpOpen}
          >
            <p className="syson-diagram-help-title">{labels.helpTitle}</p>
            <ul>
              {help.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        </span>
      </Toolbar>
    </div>
  );
}
