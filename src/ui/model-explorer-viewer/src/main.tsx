/** Composable model-explorer components for SysON element children. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  BadgeGroup,
  Card,
  ElementIdent,
  ElementReading,
  EmptyState,
  InlineCode,
  PathBar,
  SemanticElement,
  TextInput,
} from "@mcpview/components/preact/components";
import { Fragment } from "preact";
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
import {
  ElementRow,
  KindMark,
  TechnicalDetails,
  ViewerHeader,
} from "../../shared/viewer-ui";
import { kindInfo, type KindTone } from "../../shared/sysml-kind";
import {
  type ChildrenData,
  createModelNavigation,
  type ModelElement,
  type ModelNavigation,
} from "./navigation";
import {
  createModelTree,
  type ModelTree,
  visibleTreeNodes,
} from "./model-tree";

/** Family order for the grouped first level (syson-ux-design.md, explorer). */
const FAMILY_ORDER: readonly KindTone[] = [
  "structure",
  "interface",
  "behavior",
  "requirement",
  "neutral",
];
const FAMILY_LABEL = {
  structure: "groupStructure",
  interface: "groupInterface",
  behavior: "groupBehavior",
  requirement: "groupRequirement",
  neutral: "groupNeutral",
} as const;
/** Group the first level by family only when it is long enough to need it. */
const GROUP_THRESHOLD = 8;

/** One tree per explorer level, retained across locale remounts. */
const retainedTrees = new WeakMap<object, Map<string, ModelTree>>();
function treeFor(
  context: SurfaceAppContext<ChildrenData>,
  key: string,
  load: (id: string) => Promise<readonly ModelElement[]>,
) {
  let trees = retainedTrees.get(context.app);
  if (!trees) {
    trees = new Map();
    retainedTrees.set(context.app, trees);
  }
  let tree = trees.get(key);
  if (!tree) {
    tree = createModelTree(load);
    trees.set(key, tree);
  }
  return tree;
}

/** Arrow-key navigation over the visible treeitems (WAI-ARIA tree pattern). */
function onTreeKeyDown(
  event: KeyboardEvent,
  tree: ModelTree,
  canExpand: (id: string) => boolean,
) {
  const keys = [
    "ArrowDown",
    "ArrowUp",
    "ArrowRight",
    "ArrowLeft",
    "Home",
    "End",
  ];
  if (!keys.includes(event.key)) return;
  const current = (event.target as HTMLElement).closest<HTMLElement>(
    '[role="treeitem"]',
  );
  const container = event.currentTarget as HTMLElement;
  if (!current) return;
  const rows = [
    ...container.querySelectorAll<HTMLElement>('[role="treeitem"]'),
  ];
  const index = rows.indexOf(current);
  const id = current.dataset.rowKey ?? "";
  const level = Number(current.getAttribute("aria-level") ?? "1");
  const focus = (row?: HTMLElement) => row?.focus();
  event.preventDefault();
  switch (event.key) {
    case "ArrowDown":
      return focus(rows[index + 1]);
    case "ArrowUp":
      return focus(rows[index - 1]);
    case "Home":
      return focus(rows[0]);
    case "End":
      return focus(rows[rows.length - 1]);
    case "ArrowRight":
      if (canExpand(id) && !tree.isExpanded(id)) return tree.expand(id);
      if (tree.isExpanded(id)) return focus(rows[index + 1]);
      return;
    case "ArrowLeft":
      if (tree.isExpanded(id)) return tree.collapse(id);
      for (let i = index - 1; i >= 0; i -= 1) {
        if (Number(rows[i].getAttribute("aria-level")) === level - 1) {
          return focus(rows[i]);
        }
      }
  }
}

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
  const loadChildren = async (id: string) => {
    const result = await context.callTool("syson_element_children", {
      editing_context_id: data.editingContextId,
      element_id: id,
    });
    if (result.isError) throw new Error(t("navigationFailed"));
    const children = readResultData(result);
    if (!isModelChildren(children)) throw new Error(t("navigationFailed"));
    return (children as ChildrenData).children;
  };
  const tree = treeFor(
    context,
    JSON.stringify([rootId, level.data.parentId]),
    loadChildren,
  );
  const [, setTreeVersion] = useState(0);
  useEffect(
    () => tree.subscribe(() => setTreeVersion((version) => version + 1)),
    [tree],
  );
  const [kindFilter, setKindFilter] = useState<string | undefined>(undefined);
  const needle = level.filter.trim().toLowerCase();
  const filtering = Boolean(needle || kindFilter);
  const matches = (element: ModelElement) =>
    (!needle ||
      `${element.label} ${element.kind}`.toLowerCase().includes(needle)) &&
    (!kindFilter || kindInfo(element.kind).marker === kindFilter);
  // First level grouped by family when long and unfiltered; depth follows
  // the tree. Groups keep the provider order inside each family.
  const grouped = !kindFilter &&
    level.data.children.length > GROUP_THRESHOLD;
  const roots = grouped
    ? FAMILY_ORDER.flatMap((family) =>
      level.data.children.filter((element) =>
        kindInfo(element.kind).tone === family
      )
    )
    : level.data.children;
  const rows = visibleTreeNodes(roots, tree, filtering ? matches : undefined);
  // A family header opens before the first first-level row of each family.
  const familyStarts = new Map<number, KindTone>();
  if (grouped && !filtering) {
    let previous: KindTone | undefined;
    rows.forEach((row, index) => {
      if (row.depth !== 0) return;
      const tone = kindInfo(row.element.kind).tone;
      if (tone !== previous) familyStarts.set(index, tone);
      previous = tone;
    });
  }
  const kindCounts = useMemo(() => {
    const counts = new Map<string, { kind: string; count: number }>();
    level.data.children.forEach((element) => {
      const marker = kindInfo(element.kind).marker;
      const entry = counts.get(marker) ?? { kind: element.kind, count: 0 };
      entry.count += 1;
      counts.set(marker, entry);
    });
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [level.data.children]);
  const canExpand = (id: string) => canNavigate && !tree.isLeaf(id);
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
  const atRoot = view.levels.length === 1;
  const count = level.data.count;
  return (
    <section className="syson-viewer">
      <ViewerHeader
        eyebrow={atRoot ? undefined : level.kind && kindInfo(level.kind).name}
        title={atRoot ? t("modelRoot") : level.label || t("unnamed")}
        meta={count === 1
          ? t("elementCountOne")
          : t("elementCount", { count: String(count) })}
        actions={
          <TextInput
            label={t("filterModelElements")}
            placeholder={t("filterElementsPlaceholder")}
            value={level.filter}
            onValueInput={(value) => retain(value)}
          />
        }
        basket={
          <SelectionBasket
            context={context}
            controller={controller}
            snapshot={snapshot}
          />
        }
        below={view.levels.length > 1 && (
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
        )}
      />
      {(kindCounts.length > 0 || !atRoot) && (
        <div className="syson-element-sheet">
          {kindCounts.length > 0 && (
            <ul className="syson-kind-counts" aria-label={t("kindsInElement")}>
              {kindCounts.map((entry) => {
                const info = kindInfo(entry.kind);
                const active = kindFilter === info.marker;
                return (
                  <li key={info.marker}>
                    <button
                      type="button"
                      aria-pressed={active}
                      title={t("filterByKind", { kind: info.name })}
                      onClick={() =>
                        setKindFilter(active ? undefined : info.marker)}
                    >
                      <KindMark kind={entry.kind} />
                      <span>{entry.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!atRoot && (
            <TechnicalDetails
              label={t("technicalDetails")}
              idLabel={t("elementId")}
              id={level.data.parentId}
              copyLabel={t("copyId")}
              copiedLabel={t("copied")}
            />
          )}
        </div>
      )}
      {!canNavigate && (
        <p className="syson-status" role="status">
          {t("navigationUnavailable")}
        </p>
      )}
      {view.loading && (
        <p className="syson-status" role="status">{t("loadingChildren")}</p>
      )}
      {view.error && (
        <p className="syson-status" data-tone="danger" role="alert">
          {t("navigationFailed")}: {view.error}
        </p>
      )}
      <div
        ref={scroller}
        className="syson-scroll"
        onScroll={() => retain()}
      >
        {rows.length
          ? (
            <div
              className="syson-tree"
              role="tree"
              aria-label={t("modelTree")}
              aria-multiselectable="true"
              onKeyDown={(event) => onTreeKeyDown(event, tree, canExpand)}
            >
              {rows.map(({ element, depth }, index) => {
                const label = element.label || t("unnamed");
                const info = kindInfo(element.kind);
                const state = tree.node(element.id);
                const expanded = tree.isExpanded(element.id);
                const family = familyStarts.get(index);
                const familyCount = family
                  ? roots.filter((root) => kindInfo(root.kind).tone === family)
                    .length
                  : 0;
                const item = {
                  reference: sysmlRef("element", element.id, digest),
                  label: element.label || element.id,
                  summary: element.kind,
                };
                return (
                  <Fragment key={element.id}>
                    {family && (
                      <div className="syson-tree-group" aria-hidden="true">
                        <span>{t(FAMILY_LABEL[family])}</span>
                        <span className="syson-tree-group-count">
                          {familyCount}
                        </span>
                      </div>
                    )}
                    <ElementRow
                      controller={controller}
                      item={item}
                      kind={element.kind}
                      label={label}
                      meta={info.name}
                      rowKey={element.id}
                      tree={{
                        depth,
                        expandable: canExpand(element.id),
                        expanded,
                        loading: state?.status === "loading",
                        onToggle: () => tree.toggle(element.id),
                        toggleLabel: t(
                          expanded ? "collapseElement" : "expandElement",
                          { label },
                        ),
                      }}
                      onOpen={canNavigate ? () => open(element) : undefined}
                      openLabel={t("openElement", { label })}
                      selectLabel={t("selectItem", { label })}
                    />
                    {expanded && state?.status === "error" && (
                      <p
                        className="syson-tree-status"
                        style={`--syson-depth: ${depth + 1}`}
                        role="alert"
                      >
                        {t("navigationFailed")}: {state.error}
                      </p>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )
          : (
            <EmptyState>
              {level.data.children.length
                ? t("noMatchingChildren")
                : t("emptyElement")}
            </EmptyState>
          )}
      </div>
    </section>
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
