/** Composable AQL/search result components. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Button,
  Card,
  CodeBlock,
  ElementIdent,
  ElementReading,
  EmptyState,
  SemanticElement,
  TextInput,
  Toolbar,
} from "@mcpview/components/preact/components";
import {
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
  shortSysmlKind,
  sysmlRef,
  VIEWER_COMPONENT_KEYS,
  VIEWER_DEFAULT_SURFACE_KEYS,
} from "../../shared/component-catalog";
import { compareText, formatHostNumber } from "../../shared/messages";
import {
  definePreactComponent,
  startSysonViewerApp,
  type SurfaceAppContext,
  surfaceLabel,
  sysonMessages,
  type SysonViewData,
} from "../../shared/preact-surface";
import { isQueryResult } from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { useSysonSelection } from "../../shared/selection-hooks";
import { kindInfo } from "../../shared/sysml-kind";
import { ElementRow, KindMark, ViewerHeader } from "../../shared/viewer-ui";
import { queryMessages } from "./messages";
import "../../global.css";
import "./viewer.css";

interface BareIdentity {
  id: string;
  kind: string;
  label: string;
}

interface ObjectResult extends BareIdentity {
  owner?: BareIdentity;
  path?: BareIdentity[];
}

/** Phase 2 metadata: where the query ran and on which selection. */
interface QueryMetadata {
  editingContextId?: string;
  scope?: {
    kind: "element" | "project" | "selection";
    editingContextId: string;
    rootId?: string;
    selectedObjectIds?: string[];
  };
}

type QueryShape =
  | {
    type: "objects";
    results: ObjectResult[];
    count: number;
    expression?: string;
    objectId?: string;
  }
  | { type: "object"; result: ObjectResult; expression?: string }
  | { type: "string"; result: string; expression?: string }
  | { type: "boolean"; result: boolean; expression?: string }
  | { type: "int"; result: number; expression?: string }
  | { type: "void"; result: null; expression?: string }
  | {
    type?: undefined;
    results: ObjectResult[];
    query?: string;
    count: number;
  };
type QueryData = QueryShape & QueryMetadata & Record<string, unknown>;
type QueryContext = SurfaceAppContext<QueryData>;
type SortKey = "label" | "kind";

function objectsOf(data: QueryData): ObjectResult[] | undefined {
  if (data.type === "objects" || data.type === undefined) {
    return data.results ?? [];
  }
  return data.type === "object" ? [data.result] : undefined;
}

function expressionOf(data: QueryData): string | undefined {
  if ("expression" in data && typeof data.expression === "string") {
    return data.expression;
  }
  if ("query" in data && typeof data.query === "string") {
    return data.query;
  }
  return undefined;
}

function editingContextOf(data: QueryData): string | undefined {
  return data.editingContextId ?? data.scope?.editingContextId;
}

function formatScalar(value: unknown, locale: string | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return formatHostNumber(value, locale);
  }
  return String(value);
}

/**
 * A locale remount hands the same result object back to the surface, while a
 * new tool result (even for the same query) is a new object: numbering result
 * objects gives each run its own selection scope without resetting on remount.
 */
const resultRuns = new WeakMap<object, number>();
let lastRun = 0;
function resultRun(data: QueryData): number {
  let run = resultRuns.get(data);
  if (run === undefined) {
    run = ++lastRun;
    resultRuns.set(data, run);
  }
  return run;
}

/** Selection scope: one per query run, stable across locale remounts. */
function queryScopeId(data: QueryData, digest: string | undefined): string {
  return JSON.stringify([
    editingContextOf(data) ?? "",
    data.type ?? "search",
    expressionOf(data) ?? "",
    data.scope?.selectedObjectIds ?? [],
    digest ?? "",
    resultRun(data),
  ]);
}

/**
 * Filter, sort, scroll and query-line state outlive the surface remount the
 * kit performs on a locale change (syson-ux-design.md §2, query-results).
 */
interface RetainedQueryView {
  readonly scopeId: string;
  filter: string;
  sortKey: SortKey;
  descending: boolean;
  expanded: boolean;
  scrollTop: number;
}
const retainedViews = new WeakMap<object, RetainedQueryView>();

function useRetainedQueryView(context: QueryContext, scopeId: string) {
  let view = retainedViews.get(context.app);
  if (!view || view.scopeId !== scopeId) {
    view = {
      scopeId,
      filter: "",
      sortKey: "label",
      descending: false,
      expanded: false,
      scrollTop: 0,
    };
    retainedViews.set(context.app, view);
  }
  const [, setRevision] = useState(0);
  const retained = view;
  const update = (patch: Partial<Omit<RetainedQueryView, "scopeId">>) => {
    Object.assign(retained, patch);
    setRevision((revision) => revision + 1);
  };
  return { view: retained, update };
}

/** The query that produced the rows: one monospace line, expandable when long. */
function QueryLine(
  { kindLabel, text, scope, expanded, onToggle, labels }: {
    readonly kindLabel: string;
    readonly text: string;
    readonly scope?: string;
    readonly expanded: boolean;
    readonly onToggle: () => void;
    readonly labels: {
      readonly query: string;
      readonly expand: string;
      readonly collapse: string;
    };
  },
) {
  const textId = useId();
  const textRef = useRef<HTMLElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || expanded) return;
    const measure = () =>
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  const canToggle = expanded || overflowing;
  return (
    <div
      className="syson-query-line"
      role="group"
      aria-label={labels.query}
      data-expanded={expanded ? "true" : undefined}
    >
      <span className="syson-query-kind">{kindLabel}</span>
      <code ref={textRef} id={textId} className="syson-query-text" title={text}>
        {text}
      </code>
      {scope && <span className="syson-query-scope">{scope}</span>}
      {canToggle && (
        <button
          type="button"
          className="syson-query-toggle"
          aria-expanded={expanded}
          aria-controls={textId}
          aria-label={expanded ? labels.collapse : labels.expand}
          title={expanded ? labels.collapse : labels.expand}
          onClick={onToggle}
        >
          <span aria-hidden="true">⌄</span>
        </button>
      )}
    </div>
  );
}

function queryLineFor(
  data: QueryData,
  t: ReturnType<typeof queryMessages>,
  expanded: boolean,
  onToggle: () => void,
) {
  const selected = data.scope?.selectedObjectIds?.length ?? 0;
  return (
    <QueryLine
      kindLabel={data.type === undefined ? t("searchKind") : t("aqlKind")}
      text={expressionOf(data) || t("noExpression")}
      scope={selected === 0
        ? undefined
        : selected === 1
        ? t("selectedScopeOne")
        : t("selectedScopeMany", { count: String(selected) })}
      expanded={expanded}
      onToggle={onToggle}
      labels={{
        query: t("queryText"),
        expand: t("showFullQuery"),
        collapse: t("collapseQuery"),
      }}
    />
  );
}

function Summary(
  { data, context }: { data: QueryData; context: QueryContext },
) {
  const t = sysonMessages(context.hostContext.locale);
  const objects = objectsOf(data);
  const locale = context.hostContext.locale;
  const scalarValue = "result" in data ? data.result : null;
  return (
    <SemanticElement
      reference={sysmlRef(data.type ?? "query", expressionOf(data) ?? "result")}
      density="card"
      ident={
        <ElementIdent
          label={data.type ?? t("queryResult")}
          detail={expressionOf(data)}
        />
      }
      reading={
        <ElementReading
          label={objects ? t("objectCount") : t("value")}
          value={objects
            ? String(objects.length)
            : formatScalar(scalarValue, locale)}
        />
      }
    />
  );
}

function Expression(
  { data, context }: { data: QueryData; context: QueryContext },
) {
  const t = sysonMessages(context.hostContext.locale);
  return (
    <Card title={t("expression")}>
      <CodeBlock label={t("queryExpression")}>
        {expressionOf(data) || t("noExpression")}
      </CodeBlock>
    </Card>
  );
}

/** Scalar AQL result: the same header and query line, then one reading card. */
function ScalarResult(
  { data, context, scopeId }: {
    data: QueryData;
    context: QueryContext;
    scopeId: string;
  },
) {
  const locale = context.hostContext.locale;
  const t = queryMessages(locale);
  const { view, update } = useRetainedQueryView(context, scopeId);
  const raw = "result" in data ? data.result : null;
  return (
    <section className="syson-viewer syson-query-viewer">
      <ViewerHeader
        title={t("queryResult")}
        below={queryLineFor(
          data,
          t,
          view.expanded,
          () => update({ expanded: !view.expanded }),
        )}
      />
      <SemanticElement
        reference={sysmlRef(
          data.type ?? "query",
          expressionOf(data) ?? "query-result",
        )}
        density="card"
        className="syson-query-scalar"
        ident={
          <ElementIdent
            marker={data.type ?? t("unknown")}
            label={t("returnedValue")}
          />
        }
        reading={<ElementReading value={formatScalar(raw, locale)} />}
      />
    </section>
  );
}

function ownerPath(item: ObjectResult): string | undefined {
  if (item.path?.length) return item.path.map((step) => step.label).join(" › ");
  return item.owner?.label || undefined;
}

/** Object results: the explorer's header, kind chips, rows and AI-context basket. */
function ObjectResults(
  { data, objects, context, scopeId, digest, selection }: {
    data: QueryData;
    objects: ObjectResult[];
    context: QueryContext;
    scopeId: string;
    digest: string | undefined;
    selection: ReturnType<typeof useSysonSelection>;
  },
) {
  const locale = context.hostContext.locale;
  const t = queryMessages(locale);
  const { controller, snapshot } = selection;
  const { view, update } = useRetainedQueryView(context, scopeId);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = view.scrollTop;
  }, [scopeId]);

  const kindNames = useMemo(
    () => new Map(objects.map((item) => [item.id, kindInfo(item.kind).name])),
    [objects],
  );
  const rows = useMemo(() => {
    const needle = view.filter.trim().toLowerCase();
    const kindName = (item: ObjectResult) => kindNames.get(item.id) ?? "";
    const byLabel = (left: ObjectResult, right: ObjectResult) =>
      compareText(left.label, right.label, locale);
    const byKind = (left: ObjectResult, right: ObjectResult) =>
      compareText(kindName(left), kindName(right), locale);
    const [primary, secondary] = view.sortKey === "label"
      ? [byLabel, byKind]
      : [byKind, byLabel];
    return objects
      .filter((item) =>
        !needle ||
        `${item.label} ${kindName(item)} ${shortSysmlKind(item.kind)}`
          .toLowerCase()
          .includes(needle)
      )
      .sort((left, right) => {
        // Deterministic order: the id breaks ties between homonyms.
        const compared = primary(left, right) || secondary(left, right) ||
          compareText(left.id, right.id, "en");
        return view.descending ? -compared : compared;
      });
  }, [objects, kindNames, view.filter, view.sortKey, view.descending, locale]);

  const kindCounts = useMemo(() => {
    const counts = new Map<string, { kind: string; count: number }>();
    objects.forEach((item) => {
      const name = kindNames.get(item.id) ?? kindInfo(item.kind).name;
      const entry = counts.get(name) ?? { kind: item.kind, count: 0 };
      entry.count += 1;
      counts.set(name, entry);
    });
    return [...counts.entries()]
      .sort(([leftName, left], [rightName, right]) =>
        right.count - left.count || compareText(leftName, rightName, "en")
      )
      .map(([name, entry]) => ({ name, ...entry }));
  }, [objects, kindNames]);

  const toggleSort = (key: SortKey) => {
    if (view.sortKey === key) update({ descending: !view.descending });
    else update({ sortKey: key, descending: false });
  };
  const sortButton = (key: SortKey, label: string) => {
    const active = view.sortKey === key;
    return (
      <Button
        pressed={active}
        title={active
          ? t(view.descending ? "sortDescending" : "sortAscending", {
            key: label,
          })
          : label}
        onClick={() => toggleSort(key)}
      >
        {label}
        {active ? (view.descending ? " ↓" : " ↑") : ""}
      </Button>
    );
  };
  const count = objects.length;
  return (
    <section className="syson-viewer syson-query-viewer">
      <ViewerHeader
        title={data.type === undefined ? t("searchResults") : t("queryResults")}
        meta={count === 1 ? t("elementCountOne") : t("elementCount", {
          count: formatHostNumber(count, locale),
        })}
        actions={
          <TextInput
            label={t("filterQueryResults")}
            placeholder={t("filterResultsPlaceholder")}
            value={view.filter}
            onValueInput={(filter) => update({ filter })}
          />
        }
        basket={
          <SelectionBasket
            context={context}
            controller={controller}
            snapshot={snapshot}
          />
        }
        below={queryLineFor(
          data,
          t,
          view.expanded,
          () => update({ expanded: !view.expanded }),
        )}
      />
      {count > 0 && (
        <div className="syson-element-sheet">
          <ul className="syson-kind-counts" aria-label={t("kindsInResults")}>
            {kindCounts.map((entry) => (
              <li key={entry.name}>
                <KindMark kind={entry.kind} />
                <span className="syson-sr-only">{entry.name}</span>
                <span>{entry.count}</span>
              </li>
            ))}
          </ul>
          <Toolbar label={t("sortResults")} className="syson-query-sort">
            <span className="syson-query-sort-label" aria-hidden="true">
              {t("sortBy")}
            </span>
            {sortButton("label", t("labelSort"))}
            {sortButton("kind", t("kindSort"))}
          </Toolbar>
        </div>
      )}
      <div
        ref={scroller}
        className="syson-scroll"
        onScroll={() => {
          view.scrollTop = scroller.current?.scrollTop ?? view.scrollTop;
        }}
      >
        {rows.length
          ? (
            <div
              className="syson-rows"
              role="list"
              aria-label={t("queryResults")}
            >
              {rows.map((result) => {
                const label = result.label || t("unnamed");
                const kind = shortSysmlKind(result.kind);
                const readableKind = kindNames.get(result.id) ??
                  kindInfo(result.kind).name;
                const owner = ownerPath(result);
                const item = {
                  reference: sysmlRef("element", result.id, digest),
                  label: result.label || result.id,
                  summary: readableKind,
                  ...(kind ? { kind } : {}),
                  ...(owner ? { owner } : {}),
                };
                return (
                  <div role="listitem" key={result.id}>
                    <ElementRow
                      controller={controller}
                      item={item}
                      kind={result.kind}
                      label={label}
                      meta={owner ? `${readableKind} · ${owner}` : readableKind}
                      selectLabel={t("selectItem", { label })}
                    />
                  </div>
                );
              })}
            </div>
          )
          : (
            <EmptyState>
              {count ? t("noMatchingResults") : t("emptyQuery")}
            </EmptyState>
          )}
      </div>
    </section>
  );
}

function Values(
  { data, context }: { data: QueryData; context: QueryContext },
) {
  const digest = recordedProjectionDigest(context);
  const scopeId = queryScopeId(data, digest);
  // Every result owns the selection scope, so a scalar that replaces an
  // object list also retires the selection made on that list.
  const selection = useSysonSelection(context, scopeId, editingContextOf(data));
  const objects = objectsOf(data);
  return objects
    ? (
      <ObjectResults
        data={data}
        objects={objects}
        context={context}
        scopeId={scopeId}
        digest={digest}
        selection={selection}
      />
    )
    : <ScalarResult data={data} context={context} scopeId={scopeId} />;
}

const keys = VIEWER_COMPONENT_KEYS.queryResults;
const registry = defineComponentRegistry<
  SysonViewData<QueryData>,
  QueryContext
>({
  components: {
    [keys[0]]: definePreactComponent({
      title: "Query summary",
      description: "Result type and count",
    }, ({ data, context }) => <Summary data={data} context={context} />),
    [keys[1]]: definePreactComponent({
      title: "Query expression",
      description: "AQL expression or search text",
    }, ({ data, context }) => <Expression data={data} context={context} />),
    [keys[2]]: definePreactComponent({
      title: "Query values",
      description: "Scalar value or selectable object results",
    }, ({ data, context }) => <Values data={data} context={context} />),
  },
  defaultSurface: defaultComponentSurface(
    VIEWER_DEFAULT_SURFACE_KEYS.queryResults,
  ),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: { view: "queryResults", validateContent: isQueryResult },
  loadingLabel: surfaceLabel("loadingQuery"),
}).catch((error) => console.error("[query-results] Failed to start", error));
