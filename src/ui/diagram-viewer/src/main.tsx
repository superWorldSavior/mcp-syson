/** Small composable SysON diagram components with a standalone default surface. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  Button,
  Card,
  ElementIdent,
  ElementProvenance,
  ElementReading,
  KeyValueList,
  PathBar,
  SemanticElement,
  SemanticList,
  StateMessage,
} from "@mcpview/components/preact/components";
import type { ComponentChildren } from "preact";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import {
  defaultComponentSurface,
  recordedProjectionDigest,
  sysmlRef,
  VIEWER_COMPONENT_KEYS,
  VIEWER_DEFAULT_SURFACE_KEYS,
} from "../../shared/component-catalog";
import {
  definePreactComponent,
  startSysonViewerApp,
  type SurfaceAppContext,
  surfaceLabel,
  sysonMessages,
  type SysonViewData,
} from "../../shared/preact-surface";
import { isDiagramSnapshot } from "../../shared/recorded-content";
import { DiagramMinimap } from "./DiagramMinimap";
import { DiagramToolbar } from "./DiagramToolbar";
import { diagramMessages } from "./diagram-messages";
import { diagramViewerMessages } from "./messages";
import { ViewMenu } from "./ViewMenu";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { useSysonSelection } from "../../shared/selection-hooks";
import {
  KindMark,
  TechnicalDetails,
  ViewerHeader,
} from "../../shared/viewer-ui";
import { kindInfo } from "../../shared/sysml-kind";
import { createDiagramGesture } from "./diagram-gesture";
import { createSelectionGesture } from "../../shared/selection-gesture";
import {
  acceptsDiagramSpace,
  centerDiagramPoint,
  createDiagramPanState,
  type DiagramContextState,
  diagramNavigationAllowed,
  type DiagramRect,
  diagramRectToCanvas,
  diagramTitle,
  type DiagramTransform,
  dragCrossedThreshold,
  fitDiagram,
  frameDiagramRegion,
  marqueeDiagramMembers,
  openingDiagramView,
  openingFocus,
  plainElementName,
  pointerToDiagram,
  readableDiagramMembers,
  rectangleBetween,
  rectsIntersect,
  semanticDiagramMember,
  syncDiagramSelection,
  toolContent,
  unionDiagramRects,
  uniqueSemanticMembers,
  visibleDiagramRect,
  whollyEnclosed,
  zoomDiagram,
} from "./diagram-model";
import { sanitizeDiagramSvg } from "./sanitize-svg";
import { DiagramSvg, type DiagramSvgLabels } from "./DiagramSvg";
import {
  buildDiagramModel,
  clientRenderable,
  type DiagramLayoutMode,
  type DiagramModel,
  type DiagramScene,
  levelOfDetail,
  preferredBlockSize,
  sceneEntries,
  type SnapshotEdge,
  type SnapshotNode,
  sysonScene,
  type TextMeasure,
} from "./diagram-scene";
import { elkGraph, type ElkNode, sceneFromElk } from "./diagram-elk";
import { type ElkEngineKind, runElkLayout } from "./elk-runner";
import { useTextMeasure } from "./text-measure";
import "../../global.css";
import "./viewer.css";

interface DiagramNode {
  id: string;
  label: string;
  targetObjectId?: string;
  type?: string;
  kind?: string;
  parentId?: string;
  outsideLabels?: string[];
  sourceId?: string;
  targetId?: string;
}

/** Layout choice and the last ELK answer, per diagram, for the App session. */
interface RetainedLayout {
  mode: DiagramLayoutMode;
  auto?: {
    readonly key: string;
    readonly graph: ElkNode;
    readonly ms: number;
    readonly engine: ElkEngineKind;
  };
}
const retainedLayouts = new WeakMap<object, Map<string, RetainedLayout>>();
function retainedLayout(app: object, diagramId: string): RetainedLayout {
  let diagrams = retainedLayouts.get(app);
  if (!diagrams) {
    diagrams = new Map();
    retainedLayouts.set(app, diagrams);
  }
  let entry = diagrams.get(diagramId);
  if (!entry) {
    entry = { mode: "syson" };
    diagrams.set(diagramId, entry);
  }
  return entry;
}

type AutoLayoutState =
  | { readonly status: "running"; readonly key: string }
  | { readonly status: "failed"; readonly key: string }
  | {
    readonly status: "done";
    readonly key: string;
    readonly scene: DiagramScene;
    readonly ms: number;
    readonly engine: ElkEngineKind;
  };

/**
 * Auto layout (syson-diagram-design.md §4): ELK is loaded and run only once
 * « Auto » is chosen; the SysON layout stays on screen until the answer
 * arrives, and a failure falls back to it with a quiet status line.
 */
function useAutoLayout(
  app: object,
  diagramId: string,
  model: DiagramModel | undefined,
  measure: TextMeasure,
) {
  const retained = retainedLayout(app, diagramId);
  const [mode, setModeState] = useState<DiagramLayoutMode>(retained.mode);
  useEffect(() => {
    setModeState(retainedLayout(app, diagramId).mode);
  }, [app, diagramId]);
  const setMode = (next: DiagramLayoutMode) => {
    retainedLayout(app, diagramId).mode = next;
    setModeState(next);
  };
  const [state, setState] = useState<AutoLayoutState>();
  const input = useMemo(() => {
    if (!model || mode !== "auto") return undefined;
    const sizes = new Map(
      model.blocks.map((
        block,
      ) => [block.id, preferredBlockSize(block, measure)]),
    );
    const graph = elkGraph(model, sizes, measure);
    return { graph, key: JSON.stringify(graph) };
  }, [model, measure, mode]);
  useEffect(() => {
    if (!input || !model) return;
    const entry = retainedLayout(app, diagramId);
    const settle = (
      run: { graph: ElkNode; ms: number; engine: ElkEngineKind },
    ) => {
      const scene = sceneFromElk(model, run.graph, measure);
      entry.auto = { key: input.key, ...run };
      setState({ status: "done", key: input.key, scene, ...run });
    };
    if (entry.auto?.key === input.key) {
      try {
        settle(entry.auto);
        return;
      } catch {
        entry.auto = undefined;
      }
    }
    let current = true;
    setState({ status: "running", key: input.key });
    void runElkLayout(input.graph).then((run) => {
      if (current) settle(run);
    }).catch((error) => {
      if (!current) return;
      console.warn("[diagram-viewer] Auto layout failed", error);
      setState({ status: "failed", key: input.key });
      setMode("syson");
    });
    return () => {
      current = false;
    };
  }, [input]);
  const scene = mode === "auto" && state?.status === "done" &&
      state.key === input?.key
    ? state.scene
    : undefined;
  return {
    mode,
    setMode: (next: DiagramLayoutMode) => {
      if (next === "auto" && state?.status === "failed") setState(undefined);
      setMode(next);
    },
    scene,
    running: mode === "auto" && state?.status === "running",
    failed: mode === "syson" && state?.status === "failed",
    ms: state?.status === "done" ? state.ms : undefined,
    engine: state?.status === "done" ? state.engine : undefined,
  };
}

interface DiagramSnapshot extends Record<string, unknown> {
  diagramId: string;
  diagramLabel: string;
  nodeCount: number;
  edgeCount: number;
  editingContextId?: string;
  targetObjectId?: string;
  metadata?: { kind?: string; description?: { id: string; label: string } };
  nodes: DiagramNode[];
  edges?: DiagramNode[];
  svg: string;
  renderer: "local" | "external";
  rendererWarning?: string;
}

/** Semantic SVG groups measured once per admitted SVG, in diagram coordinates. */
interface DiagramGeometry {
  readonly bounds: DiagramRect;
  readonly entries: readonly {
    readonly id: string;
    readonly targetId: string;
    readonly kind?: string;
    readonly rect: DiagramRect;
  }[];
}

const sessions = new WeakMap<
  object,
  { source: DiagramSnapshot; data: DiagramSnapshot; listeners: Set<() => void> }
>();
function useDiagram(
  context: SurfaceAppContext<DiagramSnapshot>,
  source: DiagramSnapshot,
) {
  let session = sessions.get(context.app);
  if (!session || session.source !== source) {
    session = { source, data: source, listeners: new Set() };
    sessions.set(context.app, session);
  }
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh((value) => value + 1);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }, [session]);
  return {
    data: session.data,
    setData: (data: DiagramSnapshot) => {
      session.data = data;
      for (const listener of session.listeners) listener();
    },
  };
}
function DiagramPart(
  { source, context, part }: {
    source: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
    part: "summary" | "visual" | "elements" | "identity";
  },
) {
  const { data, setData } = useDiagram(context, source);
  if (part === "summary") return <Summary data={data} context={context} />;
  if (part === "elements") return <Elements data={data} context={context} />;
  if (part === "identity") return <Identity data={data} context={context} />;
  return <Visual data={data} context={context} onSwitch={setData} />;
}

function liveNavigation(
  context: SurfaceAppContext<DiagramSnapshot>,
  data: DiagramSnapshot,
) {
  return diagramNavigationAllowed({
    recorded: !!context.state.currentData?.recorded,
    serverTools: !!context.capabilities.serverTools,
    editingContextId: data.editingContextId,
  });
}

/**
 * Name of the element a representation shows ("Batmobile"): from the
 * snapshot when it draws that element, else one live read cached per
 * editing context, never in a recorded session.
 */
const targetLabels = new Map<string, Promise<string | undefined>>();
function useTargetLabel(
  context: SurfaceAppContext<DiagramSnapshot>,
  data: DiagramSnapshot,
): { label?: string; pending: boolean } {
  const drawn = useMemo(() => {
    if (!data.targetObjectId) return undefined;
    const node = data.nodes.find((node) =>
      node.targetObjectId === data.targetObjectId && node.kind === "node"
    );
    return plainElementName(node?.label || node?.outsideLabels?.join(" ")) ||
      undefined;
  }, [data.nodes, data.targetObjectId]);
  const key = !drawn && data.targetObjectId && liveNavigation(context, data)
    ? JSON.stringify([data.editingContextId, data.targetObjectId])
    : undefined;
  const [resolved, setResolved] = useState<{ key: string; label?: string }>();
  useEffect(() => {
    if (!key) return;
    let current = true;
    let request = targetLabels.get(key);
    if (!request) {
      request = context.callTool("syson_element_get", {
        editing_context_id: data.editingContextId,
        element_id: data.targetObjectId,
      }).then((result) => {
        const content = toolContent(result);
        return typeof content.label === "string"
          ? plainElementName(content.label) || undefined
          : undefined;
      }).catch(() => {
        targetLabels.delete(key);
        return undefined;
      });
      targetLabels.set(key, request);
    }
    void request.then((label) => {
      if (current) setResolved({ key, label });
    });
    return () => {
      current = false;
    };
  }, [key]);
  if (drawn) return { label: drawn, pending: false };
  if (!key) return { pending: false };
  return resolved?.key === key
    ? { label: resolved.label, pending: false }
    : { pending: true };
}

/** The host's declared height (`containerDimensions`), when it gives one. */
function declaredHeight(context: SurfaceAppContext<DiagramSnapshot>) {
  const dimensions = (context.hostContext as {
    containerDimensions?: { height?: unknown; maxHeight?: unknown };
  } | undefined)?.containerDimensions;
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : undefined;
  return positive(dimensions?.height) ?? positive(dimensions?.maxHeight);
}

/**
 * Canvas height that fills what the host declares below the header and
 * above the footer (syson-ux-design.md §2). Without a declared height the
 * stylesheet's responsive height applies and the host auto-resizes.
 */
function useCanvasHeight(
  canvasRef: { readonly current: HTMLElement | null },
  declared: number | undefined,
  minimum = 240,
) {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!declared) {
      setHeight(undefined);
      return;
    }
    let frame = 0;
    const measure = () => {
      const canvas = canvasRef.current;
      const body = canvas?.ownerDocument.body;
      if (!canvas || !body || canvas.hidden || !canvas.isConnected) return;
      const box = canvas.getBoundingClientRect();
      const page = body.getBoundingClientRect();
      const next = Math.max(
        minimum,
        Math.floor(
          declared - (box.top - page.top) - (page.bottom - box.bottom),
        ),
      );
      setHeight((current) => current === next ? current : next);
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [declared]);
  return height;
}

function measureDiagram(
  container: HTMLElement,
  members: readonly DiagramNode[],
): DiagramGeometry | undefined {
  const stage = container.querySelector<HTMLElement>(".syson-diagram-stage");
  const svg = stage?.querySelector(":scope > svg");
  if (!stage || !svg || !stage.offsetWidth) return undefined;
  const origin = stage.getBoundingClientRect();
  const scale = origin.width / stage.offsetWidth;
  if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
  const toDiagram = (rect: DOMRect): DiagramRect => ({
    x: (rect.left - origin.left) / scale,
    y: (rect.top - origin.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  const entries: DiagramGeometry["entries"][number][] = [];
  for (
    const group of stage.querySelectorAll<SVGGElement>(
      "g[data-node-id],g[data-edge-id]",
    )
  ) {
    const id = group.getAttribute("data-node-id") ||
      group.getAttribute("data-edge-id");
    const member = id ? byId.get(id) : undefined;
    if (!id || !member?.targetObjectId) continue;
    entries.push({
      id,
      targetId: member.targetObjectId,
      kind: member.kind,
      rect: toDiagram(group.getBoundingClientRect()),
    });
  }
  return { bounds: toDiagram(svg.getBoundingClientRect()), entries };
}

function useDetail(
  context: SurfaceAppContext<DiagramSnapshot>,
  data: DiagramSnapshot,
  rootLabel: string,
) {
  const t = sysonMessages(context.hostContext.locale);
  const dt = diagramMessages(context.hostContext.locale);
  const m = diagramViewerMessages(context.hostContext.locale);
  const [detail, setDetail] = useState<DiagramNode>();
  const [content, setContent] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  const epoch = useRef(0);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    epoch.current++;
    setDetail(undefined);
    setContent(undefined);
    setError(undefined);
  }, [data.diagramId]);
  const open = async (member: DiagramNode) => {
    const request = ++epoch.current;
    setDetail(member);
    setContent(undefined);
    setError(undefined);
    if (
      context.state.currentData?.recorded ||
      !context.capabilities.serverTools || !data.editingContextId
    ) return;
    try {
      const result = toolContent(
        await context.callTool("syson_element_get", {
          editing_context_id: data.editingContextId,
          element_id: member.targetObjectId,
        }),
      );
      if (request === epoch.current) setContent(result);
    } catch (error) {
      if (request === epoch.current) setError(String(error));
    }
  };
  const close = () => {
    epoch.current++;
    setDetail(undefined);
  };
  const pathBar = detail && (
    <PathBar
      label={dt("Diagram path")}
      items={[{ id: data.diagramId, label: rootLabel }, {
        id: detail.targetObjectId!,
        label: plainElementName(detail.label) || dt("Element"),
      }]}
      currentId={detail.targetObjectId!}
      onSelect={(id) => {
        if (id === data.diagramId) close();
      }}
    />
  );
  const kind = typeof content?.kind === "string" ? content.kind : undefined;
  const label = typeof content?.label === "string" && content.label.trim()
    ? content.label
    : detail?.label || dt("Element");
  // Identity first, technique after (syson-ux-design.md §1.2): the element
  // id lives only under Technical details.
  const sheet = detail && (
    <section
      ref={sheetRef}
      className="syson-diagram-detail"
      tabIndex={-1}
      aria-label={m("elementDetails")}
    >
      <SemanticElement
        reference={sysmlRef("element", detail.targetObjectId!)}
        density="card"
        ident={
          <ElementIdent
            marker={kind ? <KindMark kind={kind} /> : undefined}
            label={label}
            detail={kind ? kindInfo(kind).name : undefined}
          />
        }
        provenance={
          <ElementProvenance
            label={m("diagramView")}
            value={rootLabel}
          />
        }
      />
      {error && (
        <StateMessage tone="warning" title={dt("Element details")}>
          {error}
        </StateMessage>
      )}
      {!content && !error && (
        <p className="syson-status" role="status">
          {context.state.currentData?.recorded
            ? dt("Recorded element identity; live details are unavailable.")
            : !context.capabilities.serverTools || !data.editingContextId
            ? dt("Live element details are unavailable in this host.")
            : dt("Loading element details…")}
        </p>
      )}
      <TechnicalDetails
        label={t("technicalDetails")}
        idLabel={t("elementId")}
        id={detail.targetObjectId!}
        copyLabel={t("copyId")}
        copiedLabel={t("copied")}
      />
    </section>
  );
  return { open, close, detail, pathBar, sheet, sheetRef };
}

/** One panel opened from the header menu, closed by its button or Escape. */
function DiagramPanel(
  { title, closeLabel, focusToken, onClose, children }: {
    title: string;
    closeLabel: string;
    focusToken: number;
    onClose: () => void;
    children: ComponentChildren;
  },
) {
  const ref = useRef<HTMLElement>(null);
  const headingId = useId();
  useEffect(() => {
    ref.current?.focus();
  }, [focusToken]);
  return (
    <section
      ref={ref}
      className="syson-diagram-panel"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="syson-diagram-panel-head">
        <h3 id={headingId} className="syson-diagram-panel-title">{title}</h3>
        <button
          type="button"
          className="syson-diagram-panel-close"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {children}
    </section>
  );
}

/** « Browse existing views », moved from a disclosure above the canvas. */
function ViewsPanel(
  { data, context, onSwitch }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
    onSwitch: (data: DiagramSnapshot) => void;
  },
) {
  const dt = diagramMessages(context.hostContext.locale);
  const m = diagramViewerMessages(context.hostContext.locale);
  const [views, setViews] = useState<
    {
      id: string;
      label: string;
      kind?: string;
      description?: { label: string };
    }[]
  >([]);
  const [types, setTypes] = useState<
    { id: string; label: string; category: string }[]
  >([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const live = liveNavigation(context, data);
  const load = async () => {
    if (!live) return;
    const epoch = ++request.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = toolContent(
        await context.callTool("syson_diagram_list", {
          editing_context_id: data.editingContextId,
        }),
      );
      if (epoch !== request.current) return;
      setViews(
        Array.isArray(result.representations) ? result.representations : [],
      );
      if (data.targetObjectId) {
        const available = toolContent(
          await context.callTool("syson_diagram_types", {
            editing_context_id: data.editingContextId,
            element_id: data.targetObjectId,
          }),
        );
        if (epoch === request.current) {
          setTypes(
            Array.isArray(available.availableTypes)
              ? available.availableTypes
              : [],
          );
        }
      }
    } catch (error) {
      if (epoch === request.current) setError(String(error));
    } finally {
      if (epoch === request.current) setBusy(false);
    }
  };
  // Opening the panel is the request to browse: list right away, read-only.
  useEffect(() => {
    request.current++;
    setViews([]);
    setTypes([]);
    setError(undefined);
    setBusy(false);
    void load();
    return () => {
      request.current++;
    };
  }, [data.editingContextId, data.diagramId, live]);
  const select = async (id: string) => {
    if (!live || id === data.diagramId) return;
    const view = views.find((view) => view.id === id);
    if (!view) return;
    if (!/diagram/i.test(view.kind || "")) {
      setError(
        dt(
          "This representation needs a table or dedicated viewer; no SVG snapshot was requested.",
        ),
      );
      return;
    }
    const epoch = ++request.current;
    setBusy(true);
    setError(undefined);
    try {
      const result = toolContent(
        await context.callTool("syson_diagram_snapshot", {
          editing_context_id: data.editingContextId,
          diagram_id: id,
        }),
      );
      if (epoch === request.current) {
        if (!isDiagramSnapshot(result)) {
          throw new Error("Invalid diagram snapshot");
        }
        onSwitch(result as DiagramSnapshot);
      }
    } catch (error) {
      if (epoch === request.current) setError(String(error));
    } finally {
      if (epoch === request.current) setBusy(false);
    }
  };
  return (
    <>
      <p className="syson-status">
        {m("currentView", {
          view: `${data.diagramLabel} · ${
            data.metadata?.description?.label || dt("Diagram")
          }`,
        })}
      </p>
      {!live && (
        <p className="syson-status" role="status">
          {context.state.currentData?.recorded
            ? dt("Recorded view: live navigation is unavailable.")
            : dt("Live view navigation is unavailable in this host.")}
        </p>
      )}
      {live && busy && (
        <p className="syson-status" role="status">{dt("Loading…")}</p>
      )}
      {!!views.length && (
        <label className="syson-diagram-field">
          <span>{dt("Existing view")}</span>
          <select
            className="syson-diagram-select"
            disabled={busy}
            value={data.diagramId}
            onChange={(event) => void select(event.currentTarget.value)}
          >
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.label} ·{" "}
                {view.description?.label || view.kind || dt("Representation")}
              </option>
            ))}
          </select>
        </label>
      )}
      {!!types.length && (
        <p className="syson-status">
          {dt("Available native types (no view created):")} {types.map((type) =>
            `${type.label}${
              type.category === "table"
                ? ` ${dt("(table viewer required)")}`
                : ""
            }`
          ).join(" · ")}
        </p>
      )}
      {error && (
        <StateMessage tone="warning" title={dt("View navigation")}>
          {error}
        </StateMessage>
      )}
      {live && error && !busy && (
        <div>
          <Button onClick={() => void load()}>{m("retry")}</Button>
        </div>
      )}
    </>
  );
}

/** « Rendering details », moved from a disclosure above the canvas. */
function RenderingPanel(
  { data, context, drawing }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
    drawing?: { mode: DiagramLayoutMode; ms?: number };
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const dt = diagramMessages(context.hostContext.locale);
  const m = diagramViewerMessages(context.hostContext.locale);
  return (
    <>
      <KeyValueList
        layout="facts"
        items={[
          {
            id: "drawing",
            label: m("drawing"),
            value: drawing ? m("drawingViewer") : m("drawingServer"),
          },
          ...(drawing
            ? [{
              id: "layout",
              label: m("layout"),
              value: drawing.mode === "auto" && drawing.ms !== undefined
                ? m("layoutAutoFact", { ms: Math.round(drawing.ms) })
                : m("layoutSysonFact"),
            }]
            : []),
          {
            id: "renderer",
            label: t("renderer"),
            value: data.renderer === "external" ? t("krokiSvg") : t("localSvg"),
          },
          {
            id: "representation",
            label: m("representation"),
            value: data.metadata?.description?.label || dt("Diagram"),
          },
          { id: "nodes", label: t("nodes"), value: String(data.nodeCount) },
          { id: "edges", label: t("edges"), value: String(data.edgeCount) },
        ]}
      />
      {data.rendererWarning && (
        <StateMessage
          tone={/failed|unavailable|rejected/i.test(data.rendererWarning)
            ? "warning"
            : "neutral"}
          title={t("renderer")}
        >
          {/disabled/i.test(data.rendererWarning) &&
              !/failed/i.test(data.rendererWarning)
            ? dt("Rendered locally.")
            : data.rendererWarning}
        </StateMessage>
      )}
    </>
  );
}

function Summary(
  { data, context }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  return (
    <SemanticElement
      reference={sysmlRef("diagram", data.diagramId)}
      density="card"
      ident={
        <ElementIdent
          label={data.diagramLabel || t("diagramFallback")}
          detail={data.metadata?.description?.label}
        />
      }
      reading={[
        <ElementReading
          key="nodes"
          label={t("nodes")}
          value={String(data.nodeCount)}
        />,
        <ElementReading
          key="edges"
          label={t("edges")}
          value={String(data.edgeCount)}
        />,
      ]}
      provenance={
        <ElementProvenance
          label={t("renderer")}
          value={data.renderer === "external" ? t("krokiSvg") : t("localSvg")}
        />
      }
    />
  );
}

function Visual(
  { data, context, onSwitch }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
    onSwitch: (data: DiagramSnapshot) => void;
  },
) {
  const locale = context.hostContext.locale;
  const t = sysonMessages(locale);
  const dt = diagramMessages(locale);
  const m = diagramViewerMessages(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const pointerStart = useRef({ x: 0, y: 0 });
  const [mode, setMode] = useState<"select" | "pan">("select");
  const panState = useRef(createDiagramPanState());
  const [, refreshPan] = useState(0);
  const activeMode = panState.current.effective(mode);
  const resetPan = () => {
    panState.current.reset();
    refreshPan((value) => value + 1);
  };
  const [marquee, setMarquee] = useState<
    { x: number; y: number; width: number; height: number }
  >();
  const suppressClick = useRef(false);
  const pressedMember = useRef<DiagramNode>();
  const pressedMode = useRef<"select" | "pan">("select");
  const cancelDrag = () => {
    activePointer.current = undefined;
    setDragging(false);
    setMarquee(undefined);
    panState.current.end();
  };
  const activePointer = useRef<number>();
  const transformRef = useRef({ scale, translate });
  transformRef.current = { scale, translate };
  // "open" and "fit" follow canvas resizes; any user pan or zoom pins the view.
  const viewMode = useRef<"open" | "fit" | "user">("open");
  const [geometry, setGeometry] = useState<DiagramGeometry>();
  const geometryRef = useRef<DiagramGeometry>();
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [panel, setPanel] = useState<
    { id: "views" | "rendering"; n: number }
  >();
  const [minimapChoice, setMinimapChoice] = useState<boolean>();
  const [focusedId, setFocusedId] = useState<string>();
  const inspected = useRef<string>();
  const detailWasOpen = useRef(false);

  useEffect(() => {
    const release = (event: KeyboardEvent) => {
      if (event.key === " ") {
        panState.current.release();
        refreshPan((value) => value + 1);
      }
    };
    const blur = () => {
      resetPan();
      cancelDrag();
      suppressClick.current = true;
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const members = useMemo(
    () =>
      readableDiagramMembers(data.nodes, data.edges || [], {
        element: dt("Element"),
        relationship: dt("Relationship"),
      }),
    [data.nodes, data.edges, locale],
  );
  const membersRef = useRef(members);
  membersRef.current = members;
  // The viewer draws from the structured nodes (syson-diagram-design.md §1);
  // the sanitized server SVG stays the fallback for what it cannot draw.
  const measureText = useTextMeasure();
  const drawable = useMemo(() => clientRenderable(data), [
    data.nodes,
    data.edges,
  ]);
  const model = useMemo(
    () =>
      drawable
        ? buildDiagramModel(
          data.nodes as SnapshotNode[],
          (data.edges ?? []) as SnapshotEdge[],
        )
        : undefined,
    [drawable, data.nodes, data.edges],
  );
  const sysonLayout = useMemo(
    () => model ? sysonScene(model, measureText) : undefined,
    [model, measureText],
  );
  const auto = useAutoLayout(
    context.app,
    data.diagramId,
    model,
    measureText,
  );
  const scene = auto.scene ?? sysonLayout;
  const sceneShape = useMemo<DiagramGeometry | undefined>(
    () =>
      scene
        ? {
          bounds: { x: 0, y: 0, width: scene.width, height: scene.height },
          entries: sceneEntries(scene),
        }
        : undefined,
    [scene],
  );
  const sceneShapeRef = useRef(sceneShape);
  sceneShapeRef.current = sceneShape;
  // Admission is pure per SVG and identity table: never re-parse on pan frames.
  const admitted = useMemo(
    () =>
      !drawable && data.svg
        ? sanitizeDiagramSvg(data.svg, members, [])
        : undefined,
    [drawable, data.svg, members],
  );
  const markup = admitted?.status === "available" ? admitted.markup : undefined;
  /** What the stage draws: the client scene, else the admitted server SVG. */
  const surface: DiagramScene | string | undefined = scene ?? markup;

  const apply = useCallback((next: DiagramTransform) => {
    setScale(next.scale);
    setTranslate({ x: next.x, y: next.y });
  }, []);
  const canvasViewport = () => {
    const container = containerRef.current;
    return container && container.clientWidth && container.clientHeight
      ? { width: container.clientWidth, height: container.clientHeight }
      : undefined;
  };
  /**
   * Frame below the floating toolbar so the first row of blocks is never
   * hidden under it (the toolbar keeps the canvas top-left corner).
   */
  const belowToolbar = (
    size: { width: number; height: number },
    frame: (area: { width: number; height: number }) => DiagramTransform,
  ): DiagramTransform => {
    const tools = containerRef.current?.querySelector<HTMLElement>(
      ".syson-diagram-floating-tools",
    );
    const inset = tools
      ? Math.max(0, tools.offsetTop + tools.offsetHeight - 16)
      : 0;
    if (!inset || size.height - inset < 160) return frame(size);
    const next = frame({ width: size.width, height: size.height - inset });
    return { ...next, y: next.y + inset };
  };
  /** Explicit Fit (button, 0, F): always the whole diagram. */
  const fit = useCallback(() => {
    const shape = geometryRef.current, size = canvasViewport();
    if (!shape || !size) return;
    viewMode.current = "fit";
    apply(belowToolbar(size, (area) => fitDiagram(shape.bounds, area)));
  }, [apply]);
  /** Opening view: fit, or the legibility floor on the first primary block. */
  const showOpening = useCallback(() => {
    const shape = geometryRef.current, size = canvasViewport();
    if (!shape || !size) return;
    viewMode.current = "open";
    apply(
      belowToolbar(
        size,
        (area) =>
          openingDiagramView(shape.bounds, area, openingFocus(shape.entries)),
      ),
    );
  }, [apply]);
  const measure = useCallback(() => {
    const container = containerRef.current;
    const next = sceneShapeRef.current ??
      (container ? measureDiagram(container, membersRef.current) : undefined);
    geometryRef.current = next;
    setGeometry(next);
    return next;
  }, []);
  useLayoutEffect(() => {
    viewMode.current = "open";
    geometryRef.current = undefined;
    setGeometry(undefined);
    const container = containerRef.current;
    if (!container || !surface) return;
    if (measure()) showOpening();
    const observer = new ResizeObserver(() => {
      const size = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      // Hidden behind the detail sheet: keep the view for the way back.
      if (!size.width || !size.height) return;
      setCanvasSize((current) =>
        current.width === size.width && current.height === size.height
          ? current
          : size
      );
      if (!geometryRef.current && !measure()) return;
      if (viewMode.current === "open") showOpening();
      else if (viewMode.current === "fit") fit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [surface, measure, showOpening, fit]);

  const { controller, snapshot } = useSysonSelection(
    context,
    data.editingContextId || data.diagramId,
    data.editingContextId,
  );
  const target = useTargetLabel(context, data);
  const representation = data.metadata?.description?.label;
  const title = diagramTitle({
    representation,
    name: target.pending && representation ? undefined : data.diagramLabel,
    target: target.label,
    fallback: t("diagramFallback"),
  });
  const { open, detail, pathBar, sheet, sheetRef } = useDetail(
    context,
    data,
    title,
  );
  const inspect = (member: DiagramNode) => {
    inspected.current = member.id;
    return open(member);
  };
  // The sheet takes the canvas place; the way back restores focus to the
  // inspected element, with zoom, pan and selection untouched.
  useEffect(() => {
    if (detail) {
      detailWasOpen.current = true;
      sheetRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!detailWasOpen.current) return;
    detailWasOpen.current = false;
    const container = containerRef.current;
    const id = inspected.current && CSS.escape(inspected.current);
    const group = id
      ? container?.querySelector<SVGGElement>(
        `g[data-node-id="${id}"],g[data-edge-id="${id}"]`,
      )
      : null;
    (group ?? container)?.focus({ preventScroll: true });
  }, [detail]);
  const canvasHeight = useCanvasHeight(containerRef, declaredHeight(context));

  const memberAt = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return undefined;
    const group = target.closest("[data-node-id], [data-edge-id]");
    return semanticDiagramMember(
      members,
      group?.getAttribute("data-node-id") ||
        group?.getAttribute("data-edge-id") || null,
    );
  };
  const gestureFor = (member: DiagramNode) =>
    createDiagramGesture(controller, {
      reference: sysmlRef(
        "element",
        member.targetObjectId!,
        recordedProjectionDigest(context),
      ),
      label: member.label || dt("Element"),
    }, () =>
      inspect(member), mode);

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }) => {
      const container = containerRef.current;
      if (!container) return;
      const current = transformRef.current;
      const next = zoomDiagram(
        current.scale,
        current.translate,
        factor,
        anchor ||
          { x: container.clientWidth / 2, y: container.clientHeight / 2 },
      );
      viewMode.current = "user";
      setScale(next.scale);
      setTranslate({ x: next.x, y: next.y });
    },
    [],
  );

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    if (activePointer.current !== undefined) return;
    const container = containerRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    zoomBy(event.deltaY > 0 ? 0.9 : 1.1, {
      x: event.clientX - bounds.left - container.clientLeft,
      y: event.clientY - bounds.top - container.clientTop,
    });
  }, [zoomBy]);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [handleWheel, surface]);

  // Kit context states: confirmed solid, pending intent dashed.
  const states = new Map<string, DiagramContextState>();
  for (const item of [...snapshot.items, ...snapshot.desired]) {
    if (states.has(item.reference.id)) continue;
    const state = controller.selectionState(item);
    if (state !== "none") states.set(item.reference.id, state);
  }
  const stateKey = [...states].map(([id, state]) => `${id}:${state}`).join(
    "|",
  );
  const desiredIds = new Set(snapshot.desired.map((item) => item.reference.id));
  const presentIds = useMemo(
    () => new Set(members.map((member) => member.targetObjectId!)),
    [members],
  );
  const selectedHere = [...desiredIds].filter((id) => presentIds.has(id))
    .length;
  // The client drawing renders these states itself; this patches the server SVG.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !markup) return;
    const groups = container.querySelectorAll<SVGGElement>(
      "g[data-node-id],g[data-edge-id]",
    );
    syncDiagramSelection(groups, members, [...desiredIds], states);
    for (const group of groups) {
      if (group.hasAttribute("data-context-state")) {
        group.classList.add("mcp-view-context-selection");
      }
    }
  }, [markup, members, stateKey]);

  const zoomToSelection = () => {
    const shape = geometryRef.current, size = canvasViewport();
    if (!shape || !size) return;
    const selected = shape.entries.filter((entry) =>
      desiredIds.has(entry.targetId)
    );
    // An edge often stands for its owner block (same semantic element):
    // frame that block, not the edge's whole route.
    const shapes = new Set(
      selected.filter((entry) => entry.kind !== undefined).map((entry) =>
        entry.targetId
      ),
    );
    const region = unionDiagramRects(
      selected.filter((entry) =>
        entry.kind !== undefined || !shapes.has(entry.targetId)
      ).map((entry) => entry.rect),
    );
    const next = region && frameDiagramRegion(region, size);
    if (!next) return;
    viewMode.current = "user";
    apply(next);
  };

  const transform = { scale, x: translate.x, y: translate.y };
  const visible = { x: 0, y: 0, ...canvasSize };
  const overlay = (rect: DiagramRect) => {
    const box = diagramRectToCanvas(rect, transform);
    const width = Math.max(box.width + 8, 12);
    const height = Math.max(box.height + 8, 12);
    return {
      x: box.x + box.width / 2 - width / 2,
      y: box.y + box.height / 2 - height / 2,
      width,
      height,
    };
  };
  // Level of detail (§3): rows below full detail, ports in tint, are not drawn.
  const lod = scene ? levelOfDetail(scale) : "full";
  // Edges show their selection in the drawing (accent stroke), not as a box.
  const drawn = (entry: { kind?: string }) =>
    !scene ||
    (entry.kind === "compartment"
      ? lod === "full"
      : entry.kind === "port"
      ? lod !== "tint"
      : entry.kind !== undefined);
  // Screen-space outlines keep a 3px width whatever the zoom.
  const selectionBoxes = geometry
    ? geometry.entries.flatMap((entry) => {
      const state = states.get(entry.targetId);
      if (!state || !drawn(entry)) return [];
      const box = overlay(entry.rect);
      return !canvasSize.width || rectsIntersect(box, visible)
        ? [{ id: entry.id, state, box }]
        : [];
    })
    : [];
  const focused = focusedId
    ? geometry?.entries.find((entry) => entry.id === focusedId)
    : undefined;
  const focusBox = focused && drawn(focused) && overlay(focused.rect);
  const memberLabels = useMemo(
    () => new Map(members.map((member) => [member.id, member.label])),
    [members],
  );
  const svgLabels = useMemo<DiagramSvgLabels>(() => ({
    items: (count) => count === 1 ? m("itemsOne") : m("itemsMany", { count }),
    more: (count) => m("moreRows", { count }),
    member: (id) => memberLabels.get(id),
  }), [locale, memberLabels]);
  const blocks = useMemo(
    () => geometry?.entries.filter((entry) => entry.kind === "node") ?? [],
    [geometry],
  );
  const minimapOn = minimapChoice ??
    (canvasSize.width >= 640 && canvasSize.height >= 380);
  const help = [
    m("helpClick"),
    m("helpOpen"),
    m("helpRectangle"),
    m("helpPan"),
    m("helpZoom"),
    m("helpFit"),
  ];
  const closePanel = () => {
    setPanel(undefined);
    menuTrigger.current?.focus();
  };

  const header = (
    <ViewerHeader
      title={title}
      actions={
        <ViewMenu
          label={m("moreOptions")}
          triggerRef={menuTrigger}
          choice={model
            ? {
              label: m("layout"),
              value: auto.mode,
              options: [
                { id: "syson", label: m("layoutSyson") },
                { id: "auto", label: m("layoutAuto") },
              ],
              onChange: (id) => auto.setMode(id as DiagramLayoutMode),
            }
            : undefined}
          items={[
            { id: "views", label: m("browseViews") },
            { id: "rendering", label: m("renderingDetails") },
          ]}
          onSelect={(id) =>
            setPanel((current) => ({
              id: id as "views" | "rendering",
              n: (current?.n ?? 0) + 1,
            }))}
        />
      }
      basket={
        <SelectionBasket
          context={context}
          controller={controller}
          snapshot={snapshot}
        />
      }
      below={pathBar}
    />
  );
  const panels = panel && (
    <DiagramPanel
      title={panel.id === "views" ? m("browseViews") : m("renderingDetails")}
      closeLabel={m("closePanel")}
      focusToken={panel.n}
      onClose={closePanel}
    >
      {panel.id === "views"
        ? (
          <ViewsPanel
            data={data}
            context={context}
            onSwitch={(next) => {
              setPanel(undefined);
              onSwitch(next);
              containerRef.current?.focus({ preventScroll: true });
            }}
          />
        )
        : (
          <RenderingPanel
            data={data}
            context={context}
            drawing={scene
              ? { mode: scene.mode, ms: auto.scene ? auto.ms : undefined }
              : undefined}
          />
        )}
    </DiagramPanel>
  );

  if (!scene && (!data.svg || !admitted)) {
    return (
      <section className="syson-viewer syson-diagram-viewer">
        {header}
        {panels}
        <StateMessage title={t("noDiagram")}>
          {t("noDiagramContent")}
        </StateMessage>
      </section>
    );
  }
  if (!scene && admitted?.status === "unavailable") {
    return (
      <section className="syson-viewer syson-diagram-viewer">
        {header}
        {panels}
        <StateMessage tone="warning" title={t("diagramUnavailable")}>
          {t("recordedSvgRejected", { reason: admitted.reason })}
        </StateMessage>
      </section>
    );
  }
  return (
    <section className="syson-viewer syson-diagram-viewer">
      {header}
      {panels}
      <div
        ref={containerRef}
        hidden={!!detail}
        aria-label={dt(
          activeMode === "select" ? "Diagram: select elements" : "Diagram: pan",
        )}
        className={`syson-diagram-canvas ${
          activeMode === "select"
            ? "cursor-crosshair"
            : dragging
            ? "cursor-grabbing"
            : "cursor-grab"
        }`}
        style={canvasHeight ? { height: `${canvasHeight}px` } : undefined}
        role="group"
        tabIndex={0}
        data-layout={scene?.mode}
        data-layout-ms={auto.scene && auto.ms !== undefined
          ? Math.round(auto.ms)
          : undefined}
        data-layout-engine={auto.scene ? auto.engine : undefined}
        onDragStart={(event) => event.preventDefault()}
        onScroll={(event) => {
          // Focusing an off-screen element scrolls the clipped canvas; turn
          // that into a pan so toolbar, overlays and pointer math stay true.
          const canvas = event.currentTarget;
          const dx = canvas.scrollLeft, dy = canvas.scrollTop;
          if (!dx && !dy) return;
          canvas.scrollLeft = 0;
          canvas.scrollTop = 0;
          viewMode.current = "user";
          setTranslate((current) => ({ x: current.x - dx, y: current.y - dy }));
        }}
        onFocusIn={(event) => {
          const group = event.target instanceof Element
            ? event.target.closest("g[data-node-id],g[data-edge-id]")
            : null;
          const id = group?.getAttribute("data-node-id") ||
            group?.getAttribute("data-edge-id");
          setFocusedId(
            id && group?.matches(":focus-visible") ? id : undefined,
          );
        }}
        onFocusOut={() => setFocusedId(undefined)}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            return;
          }
          if (mode !== "select") return;
          const member = memberAt(event.target) || pressedMember.current;
          if (member) gestureFor(member).onClick(event);
        }}
        onDblClick={(event) => {
          if (suppressClick.current) return;
          const member = memberAt(event.target) || pressedMember.current;
          if (member && pressedMode.current === "pan") {
            void inspect(member);
            return;
          }
          if (member) gestureFor(member).onDoubleClick();
        }}
        onBlur={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            resetPan();
            cancelDrag();
            suppressClick.current = true;
          }
        }}
        onKeyDown={(event) => {
          const target = event.target;
          const editable = target instanceof Element &&
            !!target.closest(
              "input,textarea,select,[contenteditable]:not([contenteditable='false'])",
            );
          if (
            acceptsDiagramSpace(
              event.key,
              editable,
              event.currentTarget.contains(target as Node),
            )
          ) {
            event.preventDefault();
            panState.current.press();
            refreshPan((value) => value + 1);
            return;
          }
          if (editable) return;
          const member = memberAt(event.target);
          if (member) {
            if (mode === "select" || event.key === "Enter") {
              gestureFor(
                member,
              ).onKeyDown(event);
            }
            return;
          }
          if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            zoomBy(1.2);
          } else if (event.key === "-") {
            event.preventDefault();
            zoomBy(0.8);
          } else if (event.key === "0" || event.key.toLowerCase() === "f") {
            event.preventDefault();
            fit();
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          suppressClick.current = false;
          pressedMember.current = memberAt(event.target);
          pressedMode.current = panState.current.begin(mode);
          activePointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointerStart.current = { x: event.clientX, y: event.clientY };
          dragStart.current = {
            x: event.clientX - translate.x,
            y: event.clientY - translate.y,
          };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (activePointer.current !== event.pointerId) return;
          const point = { x: event.clientX, y: event.clientY };
          suppressClick.current = dragCrossedThreshold(
            suppressClick.current,
            pointerStart.current,
            point,
          );
          if (!suppressClick.current) return;
          if (panState.current.effective(mode) === "pan") {
            viewMode.current = "user";
            setTranslate({
              x: event.clientX - dragStart.current.x,
              y: event.clientY - dragStart.current.y,
            });
            return;
          }
          const container = event.currentTarget;
          const bounds = container.getBoundingClientRect();
          const origin = {
            left: bounds.left + container.clientLeft,
            top: bounds.top + container.clientTop,
            scrollLeft: container.scrollLeft,
            scrollTop: container.scrollTop,
          };
          setMarquee(
            rectangleBetween(
              pointerToDiagram(pointerStart.current, origin, {
                x: 0,
                y: 0,
                scale: 1,
              }),
              pointerToDiagram(point, origin, { x: 0, y: 0, scale: 1 }),
            ),
          );
        }}
        onPointerUp={(event) => {
          if (activePointer.current !== event.pointerId) return;
          const container = event.currentTarget;
          const end = { x: event.clientX, y: event.clientY };
          const dragged = dragCrossedThreshold(
            suppressClick.current,
            pointerStart.current,
            end,
          );
          const dragMode = panState.current.effective(mode);
          suppressClick.current = dragged || dragMode === "pan";
          if (dragMode === "select" && dragged) {
            const viewport = container.getBoundingClientRect();
            const origin = {
              left: viewport.left + container.clientLeft,
              top: viewport.top + container.clientTop,
              scrollLeft: container.scrollLeft,
              scrollTop: container.scrollTop,
            };
            const transform = { ...translate, scale };
            const box = rectangleBetween(
              pointerToDiagram(pointerStart.current, origin, transform),
              pointerToDiagram(end, origin, transform),
            );
            const primaryIds = new Set(
              marqueeDiagramMembers(members).map((member) => member.id),
            );
            const enclosed = new Map<string, DiagramNode>();
            for (
              const group of container.querySelectorAll<SVGGElement>(
                "g[data-node-id],g[data-edge-id]",
              )
            ) {
              const member = memberAt(group);
              if (!member || !primaryIds.has(member.id)) continue;
              const bounds = group.getBoundingClientRect();
              const rect = rectangleBetween(
                pointerToDiagram(
                  { x: bounds.left, y: bounds.top },
                  origin,
                  transform,
                ),
                pointerToDiagram(
                  { x: bounds.right, y: bounds.bottom },
                  origin,
                  transform,
                ),
              );
              if (whollyEnclosed(box, rect)) {
                enclosed.set(
                  member.targetObjectId!,
                  member,
                );
              }
            }
            // Beyond 8 blocks the kit controller sends one query element.
            if (enclosed.size) {
              void controller.setItems(
                [...enclosed.values()].map((member) => ({
                  reference: sysmlRef(
                    "element",
                    member.targetObjectId!,
                    recordedProjectionDigest(context),
                  ),
                  label: member.label || dt("Element"),
                })),
                "add",
              );
            }
          }
          cancelDrag();
          if (container.hasPointerCapture(event.pointerId)) {
            container
              .releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          suppressClick.current = true;
          resetPan();
          cancelDrag();
        }}
        onLostPointerCapture={() => {
          if (activePointer.current !== undefined) {
            resetPan();
            suppressClick.current = true;
            cancelDrag();
          }
        }}
      >
        <DiagramToolbar
          mode={activeMode}
          scale={scale}
          selectedCount={selectedHere}
          minimap={minimapOn}
          labels={{
            toolbar: t("zoomControls"),
            select: dt("Select"),
            pan: dt("Pan"),
            minus: t("zoomOut"),
            plus: t("zoomIn"),
            fit: t("fit"),
            zoomToSelection: m("zoomToSelection"),
            selectedCount: selectedHere === 1
              ? m("selectedOne")
              : m("selectedInDiagram", { count: selectedHere }),
            minimap: m("overviewMap"),
            help: m("shortcuts"),
            helpTitle: m("shortcutsTitle"),
          }}
          help={help}
          onMode={(next) => {
            cancelDrag();
            setMode(next);
          }}
          onZoom={zoomBy}
          onFit={fit}
          onZoomToSelection={zoomToSelection}
          onMinimap={() => setMinimapChoice(!minimapOn)}
        />
        {marquee && (
          <div
            aria-hidden="true"
            className="syson-diagram-marquee"
            style={{
              left: marquee.x,
              top: marquee.y,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        )}
        {scene
          ? (
            <div
              className="syson-diagram-stage"
              data-drawing="client"
              style={{
                transform:
                  `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                transformOrigin: "0 0",
                transition: "none",
              }}
            >
              <DiagramSvg
                scene={scene}
                detail={lod}
                scale={scale}
                states={states}
                desired={desiredIds}
                stateKey={`${stateKey}#${[...desiredIds].join(",")}`}
                measure={measureText}
                labels={svgLabels}
              />
            </div>
          )
          : (
            <div
              className="syson-diagram-stage"
              style={{
                transform:
                  `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
                transformOrigin: "0 0",
                transition: "none",
              }}
              dangerouslySetInnerHTML={{ __html: markup ?? "" }}
            />
          )}
        {(auto.running || auto.failed) && (
          <p
            className="syson-diagram-layout-status"
            role="status"
            data-state={auto.running ? "running" : "failed"}
          >
            {auto.running ? m("layoutRunning") : m("layoutFailed")}
          </p>
        )}
        <div className="syson-diagram-overlay" aria-hidden="true">
          {selectionBoxes.map(({ id, state, box }) => (
            <div
              key={id}
              className="syson-diagram-selection-box"
              data-context-state={state}
              style={{
                left: box.x,
                top: box.y,
                width: box.width,
                height: box.height,
              }}
            />
          ))}
          {focusBox && (
            <div
              className="syson-diagram-focus-box"
              style={{
                left: focusBox.x,
                top: focusBox.y,
                width: focusBox.width,
                height: focusBox.height,
              }}
            />
          )}
        </div>
        {minimapOn && geometry && canvasSize.width > 0 && (
          <DiagramMinimap
            label={m("overviewRegion")}
            bounds={geometry.bounds}
            blocks={blocks}
            selectedIds={desiredIds}
            viewport={visibleDiagramRect(canvasSize, transform)}
            onCenter={(point) => {
              viewMode.current = "user";
              apply(
                centerDiagramPoint(
                  point,
                  canvasSize,
                  transformRef.current.scale,
                ),
              );
            }}
          />
        )}
      </div>
      {detail && (
        <div
          className="syson-diagram-detail-frame"
          style={canvasHeight ? { minHeight: `${canvasHeight}px` } : undefined}
        >
          {sheet}
        </div>
      )}
    </section>
  );
}

function Elements(
  { data, context }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const { controller, snapshot } = useSysonSelection(
    context,
    data.editingContextId || data.diagramId,
    data.editingContextId,
  );
  const { open, pathBar, sheet } = useDetail(
    context,
    data,
    data.diagramLabel || t("diagramFallback"),
  );
  const dt = diagramMessages(context.hostContext.locale);
  const members = readableDiagramMembers(data.nodes, data.edges || [], {
    element: dt("Element"),
    relationship: dt("Relationship"),
  });
  const semantic = uniqueSemanticMembers(members);
  return (
    <Card
      title={t("diagramElements")}
      actions={<Badge>{semantic.length}</Badge>}
    >
      {!semantic.length && (
        <StateMessage title={t("noElements")}>
          {dt(
            "This snapshot has no semantic element identities. Graphical IDs cannot be added to context.",
          )}
        </StateMessage>
      )}
      <SemanticList label={t("diagramElements")} scrollable>
        {semantic.map((node) => {
          const item = {
            reference: sysmlRef(
              "element",
              node.targetObjectId!,
              recordedProjectionDigest(context),
            ),
            label: node.label || dt("Element"),
          };
          const gesture = createSelectionGesture(controller, item, () =>
            open(node));
          const selected = snapshot.desired.some((entry) =>
            entry.reference.id === node.targetObjectId
          );
          return (
            <div
              key={node.id}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={gesture.onClick}
              onDblClick={gesture.onDoubleClick}
              onKeyDown={gesture.onKeyDown}
            >
              <SemanticElement
                reference={item.reference}
                density="row"
                selected={selected}
                ident={<ElementIdent label={item.label} />}
              />
            </div>
          );
        })}
      </SemanticList>
      <p>
        {dt(
          "Click or Space: add/remove context. Double-click or Enter: inspect.",
        )}
      </p>
      {snapshot.pending && <p>{dt("Updating context…")}</p>}
      {snapshot.error && (
        <StateMessage tone="warning" title={dt("Context selection")}>
          {snapshot.error}
        </StateMessage>
      )}
      {pathBar}
      {sheet}
    </Card>
  );
}

function Identity(
  { data, context }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  return (
    <SemanticElement
      reference={sysmlRef("diagram", data.diagramId)}
      density="card"
      ident={
        <ElementIdent
          label={t("diagramIdentity")}
          detail={data.diagramId || t("unknown")}
        />
      }
      provenance={
        <ElementProvenance label={t("renderer")} value={data.renderer} />
      }
    />
  );
}

const keys = VIEWER_COMPONENT_KEYS.diagram;
const registry = defineComponentRegistry<
  SysonViewData<DiagramSnapshot>,
  SurfaceAppContext<DiagramSnapshot>
>({
  components: {
    [keys[0]]: definePreactComponent(
      {
        title: "Diagram summary",
        description: "Label and topology counts",
      },
      ({ data, context }) => (
        <DiagramPart source={data} context={context} part="summary" />
      ),
    ),
    [keys[1]]: definePreactComponent(
      {
        title: "Diagram visual",
        description: "Pan and zoom SVG canvas",
      },
      ({ data, context }) => (
        <DiagramPart source={data} context={context} part="visual" />
      ),
    ),
    [keys[2]]: definePreactComponent(
      {
        title: "Diagram elements",
        description: "Selectable semantic elements",
      },
      ({ data, context }) => (
        <DiagramPart source={data} context={context} part="elements" />
      ),
    ),
    [keys[3]]: definePreactComponent(
      {
        title: "Diagram identity",
        description: "Stable SysON diagram identifier",
      },
      ({ data, context }) => (
        <DiagramPart source={data} context={context} part="identity" />
      ),
    ),
  },
  defaultSurface: defaultComponentSurface(VIEWER_DEFAULT_SURFACE_KEYS.diagram),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: { view: "diagram", validateContent: isDiagramSnapshot },
  loadingLabel: surfaceLabel("loadingDiagram"),
  emptyLabel: surfaceLabel("emptyDiagram"),
}).catch((error) => console.error("[diagram-viewer] Failed to start", error));
