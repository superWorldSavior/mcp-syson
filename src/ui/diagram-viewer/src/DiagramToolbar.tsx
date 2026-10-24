import { Button, Toolbar } from "@mcpview/components/preact/components";
const paths = {
  select: "M4 3l15 10-7 1-4 7z",
  pan:
    "M8 11V6a1.5 1.5 0 013 0v5-7a1.5 1.5 0 013 0v7-5a1.5 1.5 0 013 0v6-2a1.5 1.5 0 013 0v5c0 5-3 7-7 7-3 0-5-2-7-5l-2-3a1.5 1.5 0 012-2l2 2",
  minus: "M5 12h14",
  plus: "M5 12h14M12 5v14",
  fit: "M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M8 8h8v8H8z",
};
export function DiagramToolbar({
  mode,
  scale,
  labels,
  onMode,
  onZoom,
  onFit,
}: {
  mode: "select" | "pan";
  scale: number;
  labels: {
    toolbar: string;
    select: string;
    pan: string;
    minus: string;
    plus: string;
    fit: string;
  };
  onMode: (mode: "select" | "pan") => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
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
  ) => (
    <Button
      className="syson-diagram-iconbutton"
      title={label}
      pressed={pressed}
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
      onKeyDown={(event) => event.stopPropagation()}
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
      </Toolbar>
    </div>
  );
}
