/** Composable value read/change components. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  Card,
  ElementIdent,
  ElementProvenance,
  ElementReading,
  ElementVerdict,
  SemanticElement,
  StateMessage,
} from "@mcpview/components/preact/components";
import { readResultData } from "@mcpview/view";
import { useEffect, useId, useState } from "preact/hooks";
import {
  defaultComponentSurface,
  recordedBasis,
  recordedProjectionDigest,
  shortSysmlKind,
  sysmlRef,
  VIEWER_COMPONENT_KEYS,
  VIEWER_DEFAULT_SURFACE_KEYS,
} from "../../shared/component-catalog";
import { formatHostNumber } from "../../shared/messages";
import {
  definePreactComponent,
  startSysonViewerApp,
  type SurfaceAppContext,
  surfaceLabel,
  sysonMessages,
  type SysonViewData,
} from "../../shared/preact-surface";
import { isValueResult } from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { createSelectionGesture } from "../../shared/selection-gesture";
import { useSysonSelection } from "../../shared/selection-hooks";
import type { SelectionItem } from "../../shared/selection";
import { kindInfo } from "../../shared/sysml-kind";
import {
  KindMark,
  TechnicalDetails,
  ViewerHeader,
} from "../../shared/viewer-ui";
import { valueMessages } from "./messages";
import "../../global.css";
import "./viewer.css";

/** Phase 2 metadata: the editing context and the element scope of the read. */
interface ValueMetadata {
  editingContextId?: string;
  scope?: { kind: "element"; editingContextId: string; rootId?: string };
  /** Shown only when the provider resolves it; never guessed. */
  unit?: string;
}
interface SetValueResult extends ValueMetadata, Record<string, unknown> {
  element_id: string;
  old_value: number;
  new_value: number;
  verified_value?: number;
  literal_kind?: string;
  success: boolean;
  warning?: string;
}
interface ReadValueResult extends ValueMetadata, Record<string, unknown> {
  element_id: string;
  value: number;
  literal_kind?: string;
  negated?: boolean;
}
type ValueResult = SetValueResult | ReadValueResult;
type ValueContext = SurfaceAppContext<ValueResult>;
type ValueTranslator = ReturnType<typeof valueMessages>;

function isSetValue(data: ValueResult): data is SetValueResult {
  return "old_value" in data;
}

function formatNumber(value: number, locale?: string): string {
  return formatHostNumber(value, locale, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function readBackMatches(data: SetValueResult): boolean {
  return data.success && data.verified_value !== undefined &&
    Math.abs(data.verified_value - data.new_value) < 1e-9;
}

function signedDelta(delta: number, locale?: string): string {
  return `${delta >= 0 ? "+" : ""}${formatNumber(delta, locale)}`;
}

function editingContextOf(data: ValueResult): string | undefined {
  return data.editingContextId ?? data.scope?.editingContextId;
}

function unitOf(data: ValueResult): string | undefined {
  return typeof data.unit === "string" && data.unit ? data.unit : undefined;
}

// ── Element identity ────────────────────────────────────────────────────────
// Value results carry only the element id. When the host lets the App call
// server tools on live data, one read-only `syson_element_get` resolves the
// name and kind; recorded sessions never call the provider.

type IdentityState =
  | {
    readonly status: "resolved";
    readonly kind: string;
    readonly label: string;
  }
  | { readonly status: "loading" }
  | { readonly status: "unavailable" };

const settledIdentities = new Map<string, IdentityState>();
const pendingIdentities = new Map<string, Promise<IdentityState>>();

function isElementIdentity(
  value: unknown,
): value is { id: string; kind: string; label: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.kind === "string" &&
    typeof record.label === "string";
}

function resolveIdentity(
  context: ValueContext,
  editingContextId: string,
  elementId: string,
  key: string,
): Promise<IdentityState> {
  let request = pendingIdentities.get(key);
  if (!request) {
    request = context.callTool("syson_element_get", {
      editing_context_id: editingContextId,
      element_id: elementId,
    }).then(
      (result): IdentityState => {
        const element = result.isError ? undefined : readResultData(result);
        return isElementIdentity(element) && element.id === elementId
          ? { status: "resolved", kind: element.kind, label: element.label }
          : { status: "unavailable" };
      },
      (): IdentityState => ({ status: "unavailable" }),
    ).then((state) => {
      settledIdentities.set(key, state);
      pendingIdentities.delete(key);
      return state;
    });
    pendingIdentities.set(key, request);
  }
  return request;
}

function useElementIdentity(
  context: ValueContext,
  editingContextId: string | undefined,
  elementId: string,
): IdentityState {
  // Recorded sessions show only what the recording holds: no call, no cache.
  const canResolve = Boolean(
    context.capabilities.serverTools && editingContextId &&
      !context.state.currentData?.recorded,
  );
  const key = JSON.stringify([editingContextId ?? "", elementId]);
  const initial: IdentityState = canResolve
    ? settledIdentities.get(key) ?? { status: "loading" }
    : { status: "unavailable" };
  const [state, setState] = useState<IdentityState>(initial);
  useEffect(() => {
    const settled = canResolve ? settledIdentities.get(key) : undefined;
    if (settled || !canResolve || !editingContextId) {
      setState(settled ?? { status: "unavailable" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    void resolveIdentity(context, editingContextId, elementId, key).then(
      (next) => {
        if (active) setState(next);
      },
    );
    return () => {
      active = false;
    };
  }, [key, canResolve]);
  return state;
}

// ── Readout: one selectable before/after card ───────────────────────────────

/**
 * Keep a selected element's context current when its resolved name or its
 * readings change. The last content seen per scope outlives remounts, so a
 * locale change alone never writes to the host context.
 */
const lastItemContent = new Map<string, string>();
function useRefreshSelectedItem(
  controller: ReturnType<typeof useSysonSelection>["controller"],
  scopeId: string,
  item: SelectionItem,
) {
  const content = JSON.stringify([
    item.label,
    item.summary,
    item.kind,
    item.values,
  ]);
  useEffect(() => {
    const previous = lastItemContent.get(scopeId);
    lastItemContent.set(scopeId, content);
    if (
      previous !== undefined && previous !== content &&
      controller.isSelected(item)
    ) {
      void controller.reconcile([item]);
    }
  }, [scopeId, content]);
}

function statusLine(
  data: ValueResult,
  t: ValueTranslator,
  locale: string | undefined,
): { text: string; tone?: "warning" | "danger" } {
  if (!isSetValue(data)) return { text: t("documentaryUnverifiedMessage") };
  const matched = readBackMatches(data);
  const observed = data.verified_value === undefined
    ? t("noReadBack")
    : t(matched ? "readBackMatches" : "readBackDoesNotMatch", {
      observed: formatNumber(data.verified_value, locale),
      requested: formatNumber(data.new_value, locale),
    });
  return {
    text: [observed, data.warning].filter(Boolean).join(" "),
    tone: data.warning ? "warning" : matched ? undefined : "danger",
  };
}

function Readout(
  { data, context }: { data: ValueResult; context: ValueContext },
) {
  const locale = context.hostContext.locale;
  const t = valueMessages(locale);
  const digest = recordedProjectionDigest(context);
  const basis = recordedBasis(context);
  const editingContextId = editingContextOf(data);
  const scopeId = JSON.stringify([
    editingContextId ?? "",
    "value",
    data.element_id,
    digest ?? "",
  ]);
  const { controller, snapshot } = useSysonSelection(
    context,
    scopeId,
    editingContextId,
  );
  const identity = useElementIdentity(
    context,
    editingContextId,
    data.element_id,
  );
  const descriptionId = useId();

  const resolved = identity.status === "resolved" ? identity : undefined;
  const kind = resolved?.kind ?? "";
  const name = resolved ? resolved.label || t("unnamed") : t("elementFallback");
  const identityDetail = resolved
    ? kindInfo(kind).name
    : identity.status === "loading"
    ? t("identityLoading")
    : t("identityUnavailable");
  const unit = unitOf(data);
  const literal = shortSysmlKind(data.literal_kind ?? "") ||
    t("numericLiteral");
  const withUnit = (value: number) =>
    unit
      ? `${formatNumber(value, locale)} ${unit}`
      : formatNumber(value, locale);

  const set = isSetValue(data) ? data : undefined;
  const matched = set ? readBackMatches(set) : false;
  const tone = !set
    ? "warning"
    : set.warning
    ? "warning"
    : matched
    ? "info"
    : "danger";
  const verdict = !set
    ? "documentary · unverified"
    : set.warning
    ? t("readBackWarning")
    : matched
    ? t("readBackMatched")
    : t("writeNotConfirmed");
  const readings = isSetValue(data)
    ? [
      <ElementReading
        key="before"
        className="syson-value-before"
        label={t("before")}
        value={<s>{formatNumber(data.old_value, locale)}</s>}
        unit={unit}
      />,
      <ElementReading
        key="after"
        className="syson-value-after"
        label={matched ? t("after") : t("requested")}
        value={formatNumber(data.new_value, locale)}
        unit={unit}
        detail={t("changeDetail", {
          delta: signedDelta(data.new_value - data.old_value, locale),
        })}
      />,
    ]
    : [
      <ElementReading
        key="value"
        className="syson-value-after"
        label={t("value")}
        value={formatNumber(data.value, locale)}
        unit={unit}
        detail={data.negated ? t("negatedLiteral", { kind: literal }) : literal}
      />,
    ];

  // AI context: the element plus the reading it is being discussed with.
  const values: Record<string, string> = isSetValue(data)
    ? {
      Previous: withUnit(data.old_value),
      Requested: withUnit(data.new_value),
      "Read-back": data.verified_value === undefined
        ? "unavailable"
        : withUnit(data.verified_value),
    }
    : { Value: withUnit(data.value) };
  const item = {
    reference: sysmlRef("element", data.element_id, digest),
    label: name,
    ...(resolved
      ? { summary: kindInfo(kind).name, kind: shortSysmlKind(kind) || kind }
      : {}),
    values,
  };
  useRefreshSelectedItem(controller, scopeId, item);
  const gesture = createSelectionGesture(controller, item);
  const state = controller.selectionState(item);
  const status = statusLine(data, t, locale);

  return (
    <section className="syson-viewer syson-value-viewer">
      <ViewerHeader
        title={set ? t("valueChange") : t("currentValue")}
        basket={
          <SelectionBasket
            context={context}
            controller={controller}
            snapshot={snapshot}
          />
        }
      />
      <div
        className="syson-value-card mcp-view-context-selection"
        data-context-state={state}
        role="button"
        tabIndex={0}
        aria-pressed={state === "selected" || state === "adding"}
        aria-label={t("selectItem", { label: name })}
        aria-describedby={descriptionId}
        onClick={gesture.onClick}
        onDblClick={gesture.onDoubleClick}
        onKeyDown={(event) =>
          gesture.onKeyDown(
            event.key === "Enter"
              ? {
                key: " ",
                repeat: event.repeat,
                preventDefault: () => event.preventDefault(),
              }
              : event,
          )}
      >
        <div id={descriptionId} className="syson-value-sheet">
          <SemanticElement
            reference={sysmlRef(
              data.literal_kind ?? "value",
              data.element_id,
              digest,
            )}
            density="card"
            tone={tone}
            ident={
              <ElementIdent
                marker={<KindMark kind={kind} />}
                label={name}
                detail={identityDetail}
              />
            }
            reading={readings}
            verdict={<ElementVerdict value={verdict} />}
            provenance={basis
              ? (
                <ElementProvenance
                  label={t("source")}
                  value={t("recordedSource", {
                    revision: String(basis.projectRevision),
                  })}
                />
              )
              : undefined}
          />
        </div>
      </div>
      <p className="syson-status" data-tone={status.tone} role="status">
        {status.text}
      </p>
      <TechnicalDetails
        label={t("technicalDetails")}
        idLabel={t("elementId")}
        id={data.element_id}
        copyLabel={t("copyId")}
        copiedLabel={t("copied")}
      />
    </section>
  );
}

function Identity(
  { data, context }: { data: ValueResult; context: ValueContext },
) {
  const t = sysonMessages(context.hostContext.locale);
  return (
    <SemanticElement
      reference={sysmlRef(data.literal_kind ?? "value", data.element_id)}
      density="card"
      ident={
        <ElementIdent label={t("elementIdentity")} detail={data.element_id} />
      }
      provenance={
        <ElementProvenance
          label={t("literal")}
          value={data.literal_kind ?? t("numericLiteralLower")}
        />
      }
    />
  );
}

function Verification(
  { data, context }: { data: ValueResult; context: ValueContext },
) {
  const t = sysonMessages(context.hostContext.locale);
  const locale = context.hostContext.locale;
  if (!isSetValue(data)) {
    return (
      <Card
        title={t("evidenceStatus")}
        actions={<Badge>{data.literal_kind ?? t("numericLiteralLower")}</Badge>}
      >
        <StateMessage tone="warning" title="Documentary · unverified">
          {t("documentaryUnverifiedMessage")}
        </StateMessage>
      </Card>
    );
  }

  const matched = readBackMatches(data);
  const evidenceTone = data.warning ? "warning" : matched ? "info" : "danger";
  const observed = data.verified_value === undefined
    ? t("noReadBack")
    : t(matched ? "readBackMatches" : "readBackDoesNotMatch", {
      observed: formatNumber(data.verified_value, locale),
      requested: formatNumber(data.new_value, locale),
    });
  const detail = [observed, data.warning].filter(Boolean).join(" ");
  return (
    <Card
      title={t("readBackEvidence")}
      actions={<Badge>{data.literal_kind ?? t("numericLiteralLower")}</Badge>}
    >
      <StateMessage
        tone={evidenceTone}
        title={data.warning
          ? t("readBackWarning")
          : matched
          ? t("immediateReadBackMatched")
          : t("writeNotConfirmed")}
      >
        {detail} {t("evidenceDisclaimer")}
      </StateMessage>
    </Card>
  );
}

const keys = VIEWER_COMPONENT_KEYS.value;
const registry = defineComponentRegistry<
  SysonViewData<ValueResult>,
  ValueContext
>({
  components: {
    [keys[0]]: definePreactComponent({
      title: "Value readout",
      description: "Current value or write transition",
    }, ({ data, context }) => <Readout data={data} context={context} />),
    [keys[1]]: definePreactComponent({
      title: "Value identity",
      description: "Stable SysON element identifier",
    }, ({ data, context }) => <Identity data={data} context={context} />),
    [keys[2]]: definePreactComponent({
      title: "Value verification",
      description: "Literal kind and write verification",
    }, ({ data, context }) => <Verification data={data} context={context} />),
  },
  defaultSurface: defaultComponentSurface(VIEWER_DEFAULT_SURFACE_KEYS.value),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: { view: "value", validateContent: isValueResult },
  loadingLabel: surfaceLabel("loadingValue"),
}).catch((error) => console.error("[value-change] Failed to start", error));
