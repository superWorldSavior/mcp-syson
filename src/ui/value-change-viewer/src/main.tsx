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
import {
  defaultComponentSurface,
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
import "../../global.css";

interface SetValueResult extends Record<string, unknown> {
  element_id: string;
  old_value: number;
  new_value: number;
  verified_value?: number;
  literal_kind?: string;
  success: boolean;
  warning?: string;
}
interface ReadValueResult extends Record<string, unknown> {
  element_id: string;
  value: number;
  literal_kind?: string;
  negated?: boolean;
}
type ValueResult = SetValueResult | ReadValueResult;

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

function Readout(
  { data, context }: {
    data: ValueResult;
    context: SurfaceAppContext<ValueResult>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const locale = context.hostContext.locale;
  if (!isSetValue(data)) {
    return (
      <SemanticElement
        reference={sysmlRef(data.literal_kind ?? "value", data.element_id)}
        density="card"
        tone="warning"
        ident={
          <ElementIdent
            label={t("currentValue")}
            detail={data.element_id}
            marker={data.negated ? "negated" : undefined}
          />
        }
        reading={
          <ElementReading
            label={data.literal_kind ?? t("numericLiteral")}
            value={formatNumber(data.value, locale)}
          />
        }
        verdict={<ElementVerdict value="documentary · unverified" />}
      />
    );
  }
  const delta = data.new_value - data.old_value;
  const matched = readBackMatches(data);
  const evidenceTone = data.warning ? "warning" : matched ? "info" : "danger";
  const verdict = data.warning
    ? t("readBackWarning")
    : matched
    ? t("readBackMatched")
    : t("writeNotConfirmed");
  return (
    <SemanticElement
      reference={sysmlRef(data.literal_kind ?? "value", data.element_id)}
      density="card"
      tone={evidenceTone}
      ident={<ElementIdent label={t("valueChange")} detail={data.element_id} />}
      reading={[
        <ElementReading
          key="old"
          label={t("previous")}
          value={formatNumber(data.old_value, locale)}
        />,
        <ElementReading
          key="new"
          label={t("requested")}
          value={formatNumber(data.new_value, locale)}
        />,
        <ElementReading
          key="observed"
          label={t("readBack")}
          value={data.verified_value === undefined
            ? "unavailable"
            : formatNumber(data.verified_value, locale)}
        />,
        <ElementReading
          key="delta"
          label={t("change")}
          value={`${delta >= 0 ? "+" : ""}${formatNumber(delta, locale)}`}
        />,
      ]}
      verdict={<ElementVerdict value={verdict} />}
    />
  );
}

function Identity(
  { data, context }: {
    data: ValueResult;
    context: SurfaceAppContext<ValueResult>;
  },
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
  { data, context }: {
    data: ValueResult;
    context: SurfaceAppContext<ValueResult>;
  },
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
  SurfaceAppContext<ValueResult>
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
