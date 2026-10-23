/** Composable AQL/search result components. */

import { defineComponentRegistry } from "@casys/mcp-view-components";
import {
  Button,
  Card,
  CodeBlock,
  ElementIdent,
  ElementReading,
  EmptyState,
  SemanticElement,
  SemanticList,
  TextInput,
  Toolbar,
} from "@casys/mcp-view-components/preact/components";
import { useMemo, useState } from "preact/hooks";
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
  publishSelection,
  startSysonViewerApp,
  type SurfaceAppContext,
  surfaceLabel,
  sysonMessages,
  type SysonViewData,
} from "../../shared/preact-surface";
import { isQueryResult } from "../../shared/recorded-content";
import "../../global.css";

interface ObjectResult {
  id: string;
  kind: string;
  label: string;
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
type QueryData = QueryShape & Record<string, unknown>;

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

function formatScalar(value: unknown, locale: string | undefined): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") {
    return formatHostNumber(value, locale);
  }
  return String(value);
}

function Summary(
  { data, context }: {
    data: QueryData;
    context: SurfaceAppContext<QueryData>;
  },
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
  { data, context }: {
    data: QueryData;
    context: SurfaceAppContext<QueryData>;
  },
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

function Values(
  { data, context }: { data: QueryData; context: SurfaceAppContext<QueryData> },
) {
  const t = sysonMessages(context.hostContext.locale);
  const objects = objectsOf(data);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<"label" | "kind">("label");
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<string>();
  const digest = recordedProjectionDigest(context);
  const locale = context.hostContext.locale;
  const rows = useMemo(() => {
    if (!objects) return [];
    const needle = filter.toLowerCase();
    return objects
      .filter((item) =>
        !needle || `${item.label} ${item.kind}`.toLowerCase().includes(needle)
      )
      .sort((left, right) => {
        const compared = compareText(left[sortKey], right[sortKey], locale);
        return descending ? -compared : compared;
      });
  }, [objects, filter, sortKey, descending, locale]);

  if (!objects) {
    const raw = "result" in data ? data.result : null;
    return (
      <SemanticElement
        reference={sysmlRef(
          data.type ?? "query",
          expressionOf(data) ?? "query-result",
        )}
        density="card"
        ident={
          <ElementIdent
            label={data.type ?? t("unknown")}
            detail={expressionOf(data)}
          />
        }
        reading={
          <ElementReading
            label={t("value")}
            value={formatScalar(raw, locale)}
          />
        }
      />
    );
  }
  const toggleSort = (key: "label" | "kind") => {
    if (sortKey === key) setDescending((value) => !value);
    else {
      setSortKey(key);
      setDescending(false);
    }
  };
  return (
    <Card
      title={t("objectResults")}
      actions={
        <Toolbar label={t("queryResultControls")}>
          <TextInput
            label={t("filterQueryResults")}
            placeholder={t("filterQueryPlaceholder")}
            value={filter}
            onValueInput={setFilter}
          />
          <Button
            pressed={sortKey === "label"}
            onClick={() => toggleSort("label")}
          >
            {t("labelSort")}{" "}
            {sortKey === "label" ? (descending ? "↓" : "↑") : ""}
          </Button>
          <Button
            pressed={sortKey === "kind"}
            onClick={() => toggleSort("kind")}
          >
            {t("kindSort")} {sortKey === "kind" ? (descending ? "↓" : "↑") : ""}
          </Button>
        </Toolbar>
      }
    >
      {rows.length
        ? (
          <SemanticList label={t("queryResults")} scrollable>
            {rows.map((item) => {
              const kind = shortSysmlKind(item.kind);
              return (
                <SemanticElement
                  key={item.id}
                  reference={sysmlRef(kind || "search-result", item.id, digest)}
                  density="row"
                  selected={selected === item.id}
                  ident={
                    <ElementIdent
                      label={item.label || t("unnamed")}
                      detail={`${kind || t("unknown")} · ${item.id}`}
                    />
                  }
                  activationLabel={t("selectItem", {
                    label: item.label || item.id,
                  })}
                  onActivate={() => {
                    setSelected(item.id);
                    publishSelection(
                      context,
                      "select-result",
                      "syson.element.selected",
                      { id: item.id, label: item.label, kind: item.kind },
                    );
                  }}
                />
              );
            })}
          </SemanticList>
        )
        : <EmptyState>{t("noResults")}</EmptyState>}
    </Card>
  );
}

const keys = VIEWER_COMPONENT_KEYS.queryResults;
const registry = defineComponentRegistry<
  SysonViewData<QueryData>,
  SurfaceAppContext<QueryData>
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
