/** Composable model-explorer components for SysON element children. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  BadgeGroup,
  Card,
  DrillHint,
  ElementIdent,
  ElementReading,
  EmptyState,
  InlineCode,
  PathBar,
  SemanticElement,
  TextInput,
  TreeList,
} from "@mcpview/components/preact/components";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  defaultComponentSurface,
  recordedProjectionDigest,
  shortSysmlKind,
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
import {
  adaptModelExplorerRecordedContent,
  isModelChildren,
} from "../../shared/recorded-content";
import "../../global.css";

import { readResultData } from "@mcpview/view";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { useSysonSelection } from "../../shared/selection-hooks";
import { createSelectionGesture } from "../../shared/selection-gesture";
import {
  type ChildrenData,
  createModelNavigation,
  type ModelNavigation,
} from "./navigation";

const retainedNavigation = new WeakMap<
  object,
  { rootId: string; source: ChildrenData; navigation: ModelNavigation }
>();
function navigationFor(
  context: SurfaceAppContext<ChildrenData>,
  data: ChildrenData,
  rootId: string,
) {
  let retained = retainedNavigation.get(context.app);
  if (!retained || retained.rootId !== rootId) {
    retained?.navigation.reset(data);
    retained = {
      rootId,
      source: data,
      navigation: createModelNavigation(data),
    };
    retainedNavigation.set(context.app, retained);
  } else if (retained.source !== data) {
    retained.navigation.reset(data);
    retained.source = data;
  }
  return retained.navigation;
}

function useCurrentModelData(
  context: SurfaceAppContext<ChildrenData>,
  data: ChildrenData,
) {
  const rootId = JSON.stringify([
    data.editingContextId ?? "",
    data.parentId,
    recordedProjectionDigest(context) ?? "",
  ]);
  const navigation = navigationFor(context, data, rootId);
  const [view, setView] = useState(navigation.getSnapshot());
  useEffect(() => {
    const unsubscribe = navigation.subscribe(() =>
      setView(navigation.getSnapshot())
    );
    setView(navigation.getSnapshot());
    return unsubscribe;
  }, [navigation]);
  return view.levels[view.levels.length - 1].data;
}

const KIND_MAP: Record<string, { icon: string; tone: string }> = {
  PartUsage: { icon: "■", tone: "part" },
  PartDefinition: { icon: "□", tone: "part" },
  AttributeUsage: { icon: "◆", tone: "attribute" },
  RequirementUsage: { icon: "★", tone: "requirement" },
  Package: { icon: "▶", tone: "package" },
  ItemUsage: { icon: "●", tone: "item" },
  PortUsage: { icon: "◐", tone: "port" },
  ConnectionUsage: { icon: "↔", tone: "connection" },
  ConstraintUsage: { icon: "!", tone: "constraint" },
  ActionUsage: { icon: "▷", tone: "action" },
};

function kindVisual(kind: string): { icon: string; tone: string } {
  return KIND_MAP[shortSysmlKind(kind)] ?? { icon: "○", tone: "neutral" };
}

function Summary(
  { data, context }: {
    data: ChildrenData;
    context: SurfaceAppContext<ChildrenData>;
  },
) {
  data = useCurrentModelData(context, data);
  const t = sysonMessages(context.hostContext.locale);
  return (
    <SemanticElement
      reference={sysmlRef("model-children", data.parentId)}
      density="card"
      ident={
        <ElementIdent
          label={t("modelChildren")}
          detail={data.parentId || t("root")}
        />
      }
      reading={
        <ElementReading
          label={t("elements")}
          value={String(data.count)}
        />
      }
    />
  );
}

function Elements(
  { data, context }: {
    data: ChildrenData;
    context: SurfaceAppContext<ChildrenData>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const digest = recordedProjectionDigest(context);
  const rootId = JSON.stringify([
    data.editingContextId ?? "",
    data.parentId,
    digest ?? "",
  ]);
  const navigation = navigationFor(context, data, rootId);
  const [view, setView] = useState(navigation.getSnapshot());
  const { controller, snapshot } = useSysonSelection(
    context,
    rootId,
    data.editingContextId,
  );
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unsubscribe = navigation.subscribe(() =>
      setView(navigation.getSnapshot())
    );
    setView(navigation.getSnapshot());
    return unsubscribe;
  }, [navigation]);
  const level = view.levels[view.levels.length - 1];
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = level.scrollTop;
  }, [level.data.parentId, navigation]);
  const canNavigate = Boolean(
    context.capabilities.serverTools && data.editingContextId &&
      !context.state.currentData?.recorded,
  );
  const elements = useMemo(() => {
    const needle = level.filter.trim().toLowerCase();
    return needle
      ? level.data.children.filter((item) =>
        `${item.label} ${item.kind}`.toLowerCase().includes(needle)
      )
      : level.data.children;
  }, [level.data.children, level.filter]);
  const retain = (filter = level.filter) =>
    navigation.retain(filter, scroller.current?.scrollTop ?? level.scrollTop);
  const open = (element: ChildrenData["children"][number]) => {
    if (!canNavigate) return;
    retain();
    return navigation.open(element, async (id) => {
      const result = await context.callTool("syson_element_children", {
        editing_context_id: data.editingContextId,
        element_id: id,
      });
      if (result.isError) throw new Error(t("navigationFailed"));
      const children = readResultData(result);
      if (!isModelChildren(children)) throw new Error(t("navigationFailed"));
      return children as ChildrenData;
    });
  };
  return (
    <>
      <Card
        eyebrow={view.levels.length === 1
          ? t("modelRoot")
          : level.label || t("root")}
        title={t("children")}
        actions={
          <TextInput
            label={t("filterModelElements")}
            placeholder={t("filterElementsPlaceholder")}
            value={level.filter}
            onValueInput={(value) => retain(value)}
          />
        }
      >
        <PathBar
          label={t("modelPath")}
          items={view.levels.map((item, index) => ({
            id: String(index),
            label: index === 0 ? t("modelRoot") : item.label || t("root"),
            detail: item.filter,
          }))}
          currentId={String(view.levels.length - 1)}
          onSelect={(id) => navigation.back(Number(id))}
          backLabel={t("back")}
          collapsedLabel={t("retainedLevels")}
        />
        {!canNavigate && <p role="status">{t("navigationUnavailable")}</p>}
        {view.loading && <p role="status">{t("loadingChildren")}</p>}
        {view.error && <p role="alert">{t("navigationFailed")}: {view.error}
        </p>}
        <div
          ref={scroller}
          style={{ maxHeight: "28rem", overflow: "auto" }}
          onScroll={() => retain()}
        >
          {elements.length
            ? (
              <TreeList
                label={t("modelElements")}
                expandedIds={[]}
                onToggle={() => {}}
                toggleLabel={t("children")}
                nodes={elements.map((element) => {
                  const kind = shortSysmlKind(element.kind);
                  const reference = sysmlRef("element", element.id, digest);
                  const visual = kindVisual(element.kind);
                  const item = {
                    reference: sysmlRef("element", element.id, digest),
                    label: element.label || element.id,
                    summary: element.kind,
                  };
                  const gesture = createSelectionGesture(
                    controller,
                    item,
                    canNavigate ? () => open(element) : undefined,
                  );
                  return {
                    id: element.id,
                    label: (
                      <div
                        role="button"
                        tabIndex={0}
                        aria-pressed={snapshot.desired.some((selected) =>
                          selected.reference.id === element.id &&
                          selected.reference.kind === "element"
                        )}
                        aria-label={t("selectItem", { label: item.label })}
                        onClick={gesture.onClick}
                        onDblClick={gesture.onDoubleClick}
                        onKeyDown={gesture.onKeyDown}
                      >
                        <SemanticElement
                          reference={reference}
                          density="row"
                          selected={snapshot.desired.some((selected) =>
                            selected.reference.id === element.id &&
                            selected.reference.kind === "element"
                          )}
                          ident={
                            <ElementIdent
                              marker={
                                <span
                                  aria-hidden="true"
                                  className="syson-kind-mark"
                                  data-kind-tone={visual.tone}
                                >
                                  {visual.icon}
                                </span>
                              }
                              label={element.label || t("unnamed")}
                              detail={`${kind} · ${element.id}`}
                            />
                          }
                        />
                      </div>
                    ),
                    detail: canNavigate
                      ? (
                        <DrillHint
                          direction="in-view"
                          label={t("children")}
                          actionLabel={t("openChildren", { label: item.label })}
                          onActivate={() => {
                            void open(element);
                          }}
                        />
                      )
                      : undefined,
                  };
                })}
              />
            )
            : <EmptyState>{t("noMatchingChildren")}</EmptyState>}
        </div>
      </Card>
      <SelectionBasket
        context={context}
        controller={controller}
        snapshot={snapshot}
      />
    </>
  );
}

function KindBreakdown(
  { data, context }: {
    data: ChildrenData;
    context: SurfaceAppContext<ChildrenData>;
  },
) {
  data = useCurrentModelData(context, data);
  const t = sysonMessages(context.hostContext.locale);
  const counts = new Map<string, number>();
  data.children.forEach((element) => {
    const kind = shortSysmlKind(element.kind);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  });
  return (
    <Card title={t("kinds")}>
      <BadgeGroup label={t("kindCounts")}>
        {[...counts.entries()].map(([kind, count]) => (
          <Badge key={kind}>{kind}: {count}</Badge>
        ))}
        {!counts.size && <EmptyState>{t("noKinds")}</EmptyState>}
      </BadgeGroup>
    </Card>
  );
}

function ParentContext(
  { data, context }: {
    data: ChildrenData;
    context: SurfaceAppContext<ChildrenData>;
  },
) {
  data = useCurrentModelData(context, data);
  const t = sysonMessages(context.hostContext.locale);
  return (
    <SemanticElement
      reference={sysmlRef("element", data.parentId || "root")}
      density="card"
      ident={
        <ElementIdent
          label={t("parent")}
          detail={data.parentId
            ? <InlineCode>{data.parentId}</InlineCode>
            : undefined}
        />
      }
      reading={
        <ElementReading
          label={t("children")}
          value={String(data.count)}
        />
      }
    />
  );
}

const keys = VIEWER_COMPONENT_KEYS.modelExplorer;
const registry = defineComponentRegistry<
  SysonViewData<ChildrenData>,
  SurfaceAppContext<ChildrenData>
>({
  components: {
    [keys[0]]: definePreactComponent({
      title: "Model summary",
      description: "Child count for one parent",
    }, ({ data, context }) => <Summary data={data} context={context} />),
    [keys[1]]: definePreactComponent({
      title: "Model elements",
      description: "Filterable, selectable element list",
    }, ({ data, context }) => <Elements data={data} context={context} />),
    [keys[2]]: definePreactComponent({
      title: "Kind breakdown",
      description: "Counts grouped by SysML kind",
    }, ({ data, context }) => <KindBreakdown data={data} context={context} />),
    [keys[3]]: definePreactComponent({
      title: "Parent context",
      description: "Stable parent element identifier",
    }, ({ data, context }) => <ParentContext data={data} context={context} />),
  },
  defaultSurface: defaultComponentSurface(
    VIEWER_DEFAULT_SURFACE_KEYS.modelExplorer,
  ),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: {
    view: "modelExplorer",
    validateContent: isModelChildren,
    adaptContent: adaptModelExplorerRecordedContent,
  },
  loadingLabel: surfaceLabel("loadingModel"),
}).catch((error) => console.error("[model-explorer] Failed to start", error));
