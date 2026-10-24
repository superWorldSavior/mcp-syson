/** Small composable SysON diagram components with a standalone default surface. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  Button,
  Card,
  Disclosure,
  ElementIdent,
  ElementProvenance,
  ElementReading,
  PathBar,
  SemanticElement,
  SemanticList,
  StateMessage,
} from "@mcpview/components/preact/components";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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
import { DiagramToolbar } from "./DiagramToolbar";
import { diagramMessages } from "./diagram-messages";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { useSysonSelection } from "../../shared/selection-hooks";
import { createDiagramGesture } from "./diagram-gesture";
import { createSelectionGesture } from "../../shared/selection-gesture";
import {
  acceptsDiagramSpace,
  createDiagramPanState,
  diagramNavigationAllowed,
  dragCrossedThreshold,
  fitDiagram,
  marqueeDiagramMembers,
  pointerToDiagram,
  readableDiagramMembers,
  rectangleBetween,
  semanticDiagramMember,
  syncDiagramSelection,
  toolContent,
  uniqueSemanticMembers,
  whollyEnclosed,
  zoomDiagram,
} from "./diagram-model";
import { sanitizeDiagramSvg } from "./sanitize-svg";
import "../../global.css";

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
function useDetail(
  context: SurfaceAppContext<DiagramSnapshot>,
  data: DiagramSnapshot,
) {
  const dt = diagramMessages(context.hostContext.locale);
  const [detail, setDetail] = useState<DiagramNode>();
  const [content, setContent] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  const epoch = useRef(0);
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
  const panel = detail && (
    <section>
      <PathBar
        label={dt("Diagram path")}
        items={[{ id: data.diagramId, label: data.diagramLabel }, {
          id: detail.targetObjectId!,
          label: detail.label || dt("Element"),
        }]}
        currentId={detail.targetObjectId!}
        onSelect={(id) => {
          if (id === data.diagramId) {
            epoch.current++;
            setDetail(undefined);
          }
        }}
      />
      <p>
        {detail.label || dt("Element")} · {detail.type || dt("SysML element")} ·
        {" "}
        {detail.targetObjectId}
      </p>
      {content && (
        <SemanticElement
          reference={sysmlRef("element", detail.targetObjectId!)}
          density="card"
          ident={
            <ElementIdent
              label={typeof content.label === "string" && content.label.trim()
                ? content.label
                : detail.label || dt("Element")!}
              detail={typeof content.kind === "string"
                ? content.kind
                : detail.type}
            />
          }
        />
      )}
      {error && (
        <StateMessage tone="warning" title={dt("Element details")}>
          {error}
        </StateMessage>
      )}
      {!content && !error && (
        <p>
          {context.state.currentData?.recorded
            ? dt("Recorded element identity; live details are unavailable.")
            : !context.capabilities.serverTools || !data.editingContextId
            ? dt("Live element details are unavailable in this host.")
            : dt("Loading element details…")}
        </p>
      )}
    </section>
  );
  return { open, panel };
}

function ViewChooser(
  { data, context, onSwitch }: {
    data: DiagramSnapshot;
    context: SurfaceAppContext<DiagramSnapshot>;
    onSwitch: (data: DiagramSnapshot) => void;
  },
) {
  const dt = diagramMessages(context.hostContext.locale);
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
  const live = diagramNavigationAllowed({
    recorded: !!context.state.currentData?.recorded,
    serverTools: !!context.capabilities.serverTools,
    editingContextId: data.editingContextId,
  });
  useEffect(() => {
    request.current++;
    setViews([]);
    setTypes([]);
    setError(undefined);
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [data.editingContextId, data.diagramId, live]);
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
    <Disclosure
      label={`${dt("Views")} · ${
        data.metadata?.description?.label || dt("Diagram")
      }`}
    >
      <p>
        {data.metadata?.description?.label || dt("Diagram")} ·{" "}
        {data.diagramLabel}
      </p>
      {live
        ? (
          <Button disabled={busy} onClick={load}>
            {busy ? dt("Loading…") : dt("Browse existing views")}
          </Button>
        )
        : (
          <p>
            {context.state.currentData?.recorded
              ? dt("Recorded view: live navigation is unavailable.")
              : dt("Live view navigation is unavailable in this host.")}
          </p>
        )}
      {!!views.length && (
        <label>
          {dt("Existing view")}{" "}
          <select
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
        <p>
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
    </Disclosure>
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
          detail={data.diagramId}
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
  const t = sysonMessages(context.hostContext.locale);
  const dt = diagramMessages(context.hostContext.locale);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const fit = useCallback(() => {
    const container = containerRef.current;
    const svg = container?.querySelector(".syson-diagram-stage > svg");
    if (!container || !svg) return;
    const rect = svg.getBoundingClientRect();
    const canvas = container.getBoundingClientRect();
    const transform = transformRef.current;
    const bounds = {
      x: (rect.left - canvas.left - transform.translate.x) / transform.scale,
      y: (rect.top - canvas.top - transform.translate.y) / transform.scale,
      width: rect.width / transform.scale,
      height: rect.height / transform.scale,
    };
    const next = fitDiagram(bounds, {
      width: container.clientWidth,
      height: container.clientHeight,
    });
    setScale(next.scale);
    setTranslate({ x: next.x, y: next.y });
  }, []);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [data.svg, fit]);
  const { controller, snapshot } = useSysonSelection(
    context,
    data.editingContextId || data.diagramId,
    data.editingContextId,
  );
  const { open, panel } = useDetail(context, data);
  const members = readableDiagramMembers(data.nodes, data.edges || [], {
    element: dt("Element"),
    relationship: dt("Relationship"),
  });
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
      open(member), mode);

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
  }, [handleWheel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    syncDiagramSelection(
      container.querySelectorAll("g[data-node-id],g[data-edge-id]"),
      members,
      snapshot.desired.map((item) => item.reference.id),
    );
  }, [data.svg, data.nodes, data.edges, snapshot.desired]);

  if (!data.svg) {
    return (
      <StateMessage title={t("noDiagram")}>
        {t("noDiagramContent")}
      </StateMessage>
    );
  }
  const admitted = sanitizeDiagramSvg(
    data.svg,
    members,
    [],
  );
  if (admitted.status === "unavailable") {
    return (
      <StateMessage tone="warning" title={t("diagramUnavailable")}>
        {t("recordedSvgRejected", { reason: admitted.reason })}
      </StateMessage>
    );
  }
  return (
    <>
      <style>
        {`.syson-diagram-stage g[data-selected="true"] { outline: 2px solid var(--mcp-view-accent, #0d7c8a); outline-offset: 3px; }
.syson-diagram-stage g[data-selected="true"] > :is(rect,ellipse,circle,polygon,path,line,polyline) { stroke: var(--mcp-view-accent, #0d7c8a); stroke-width: 2.5px; }`}
      </style>
      <ViewChooser data={data} context={context} onSwitch={onSwitch} />
      {data.rendererWarning && (
        <Disclosure label={dt("Rendering details")}>
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
        </Disclosure>
      )}
      <Card
        className="syson-diagram-card"
        title={data.diagramLabel || t("diagramFallback")}
      >
        <div className="syson-diagram-contextbar">
          <SelectionBasket
            context={context}
            controller={controller}
            snapshot={snapshot}
          />
        </div>
        <div
          ref={containerRef}
          aria-label={dt(
            activeMode === "select"
              ? "Diagram: select elements"
              : "Diagram: pan",
          )}
          className={`syson-diagram-canvas ${
            activeMode === "select"
              ? "cursor-crosshair"
              : dragging
              ? "cursor-grabbing"
              : "cursor-grab"
          }`}
          role="group"
          tabIndex={0}
          onDragStart={(event) => event.preventDefault()}
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
              void open(member);
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
            labels={{
              toolbar: t("zoomControls"),
              select: dt("Select"),
              pan: dt("Pan"),
              minus: t("zoomOut"),
              plus: t("zoomIn"),
              fit: t("fit"),
            }}
            onMode={(next) => {
              cancelDrag();
              setMode(next);
            }}
            onZoom={zoomBy}
            onFit={fit}
          />
          {marquee && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                pointerEvents: "none",
                zIndex: 1,
                left: marquee.x,
                top: marquee.y,
                width: marquee.width,
                height: marquee.height,
                border: "1px solid var(--mcp-view-accent,#0d7c8a)",
                background:
                  "color-mix(in srgb,var(--mcp-view-accent,#0d7c8a) 15%,transparent)",
              }}
            />
          )}
          <div
            className="syson-diagram-stage"
            style={{
              transform:
                `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: "0 0",
              transition: "none",
            }}
            dangerouslySetInnerHTML={{ __html: admitted.markup }}
          />
        </div>
        {panel}
        <p className="syson-diagram-help">
          {dt(
            mode === "select"
              ? "Rectangle: blocks · click: element · double-click: details"
              : "Drag to pan · double-click to inspect",
          )} · {dt(
            "Hold Space + drag to pan · wheel or +/− to zoom · 0 or F to fit",
          )}
        </p>
      </Card>
    </>
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
  const { open, panel } = useDetail(context, data);
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
                ident={
                  <ElementIdent
                    label={item.label}
                    detail={node.type || node.targetObjectId}
                  />
                }
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
      {panel}
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
