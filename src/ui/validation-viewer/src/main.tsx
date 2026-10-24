/** Composable constraint-validation components. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  Card,
  ElementBody,
  ElementIdent,
  ElementProvenance,
  ElementReading,
  ElementVerdict,
  EmptyState,
  InlineCode,
  KeyValueList,
  MetricGrid,
  SemanticElement,
  SemanticList,
  StateMessage,
} from "@mcpview/components/preact/components";
import { useState } from "preact/hooks";
import {
  defaultComponentSurface,
  recordedProjectionDigest,
  sysmlRef,
  validationContractLabel,
  validationOverallStatus,
  VIEWER_COMPONENT_KEYS,
  VIEWER_DEFAULT_SURFACE_KEYS,
} from "../../shared/component-catalog";
import { formatHostDateTime, formatHostNumber } from "../../shared/messages";
import {
  definePreactComponent,
  publishSelection,
  startSysonViewerApp,
  type SurfaceAppContext,
  surfaceLabel,
  sysonMessages,
  type SysonViewData,
} from "../../shared/preact-surface";
import { isValidationReport } from "../../shared/recorded-content";
import "../../global.css";

interface ConstraintResult {
  constraintId: string;
  constraintName: string;
  status: "pass" | "fail" | "error" | "unresolved";
  expression?: string;
  computedValue?: number;
  threshold?: number;
  margin?: number;
  marginPercent?: number;
  error?: string;
  unresolvedRefs?: string[];
}
interface ValidationSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  unresolved: number;
}
interface ValidationReport extends Record<string, unknown> {
  editingContextId: string;
  elementId: string;
  elementName: string;
  constraints: ConstraintResult[];
  summary: ValidationSummary;
  resolvedValues?: Record<string, number | { value: number; unit?: string }>;
  validatedAt: string;
}

type ValidationViewStatus = ConstraintResult["status"] | "empty";

function statusTone(
  status: ValidationViewStatus,
): "success" | "danger" | "warning" {
  return status === "pass"
    ? "success"
    : status === "fail" || status === "error"
    ? "danger"
    : "warning";
}

function Status(
  { data, context }: {
    data: ValidationReport;
    context: SurfaceAppContext<ValidationReport>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const status = validationOverallStatus(data.summary);
  const locale = context.hostContext.locale;
  const validatedAtFormatted = formatHostDateTime(data.validatedAt, locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
  const headlineReading = data.summary.unresolved > 0
    ? (
      <ElementReading
        label="unresolved"
        value={data.summary.unresolved}
      />
    )
    : (
      <ElementReading
        label={t("constraints")}
        value={data.summary.total}
      />
    );
  return (
    <SemanticElement
      reference={sysmlRef("validation", data.elementId)}
      density="card"
      tone={statusTone(status)}
      ident={
        <ElementIdent
          label={data.elementName || t("validation")}
          detail={data.elementId}
        />
      }
      reading={headlineReading}
      body={data.summary.total === 0
        ? (
          <ElementBody>
            <StateMessage tone="warning" title="unavailable">
              {t("cannotClaimPass")}
            </StateMessage>
          </ElementBody>
        )
        : undefined}
      verdict={<ElementVerdict value={validationContractLabel(status)} />}
      provenance={
        <ElementProvenance
          label={t("validated")}
          value={validatedAtFormatted}
        />
      }
    />
  );
}

function Summary({ data }: { data: ValidationReport }) {
  return (
    <MetricGrid
      items={[
        {
          id: "pass",
          label: "pass",
          value: data.summary.pass,
          tone: "success",
        },
        { id: "fail", label: "fail", value: data.summary.fail, tone: "danger" },
        {
          id: "error",
          label: "error",
          value: data.summary.error,
          tone: "danger",
        },
        {
          id: "unresolved",
          label: "unresolved",
          value: data.summary.unresolved,
          tone: data.summary.unresolved ? "warning" : "neutral",
        },
      ]}
    />
  );
}

function formatResolved(
  value: number | { value: number; unit?: string },
  locale: string | undefined,
): string {
  const quantity = typeof value === "number" ? { value } : value;
  const number = formatHostNumber(quantity.value, locale, {
    maximumFractionDigits: 4,
  });
  return quantity.unit ? `${number} ${quantity.unit}` : number;
}

function ResolvedValues(
  { data, context }: {
    data: ValidationReport;
    context: SurfaceAppContext<ValidationReport>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const values = Object.entries(data.resolvedValues ?? {});
  const locale = context.hostContext.locale;
  return (
    <Card title={t("resolvedModelValues")}>
      <KeyValueList
        items={values.map(([name, value]) => ({
          id: name,
          label: name,
          value: <InlineCode>{formatResolved(value, locale)}</InlineCode>,
        }))}
      />
      {!values.length && <EmptyState>{t("noResolvedValues")}</EmptyState>}
    </Card>
  );
}

function formatValue(
  value: number | undefined,
  locale: string | undefined,
  digits = 2,
): string {
  if (value === undefined) return "−";
  return formatHostNumber(value, locale, { maximumFractionDigits: digits });
}

function Constraints(
  { data, context }: {
    data: ValidationReport;
    context: SurfaceAppContext<ValidationReport>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const [selected, setSelected] = useState<string>();
  const digest = recordedProjectionDigest(context);
  const locale = context.hostContext.locale;
  return (
    <Card
      title={t("constraints")}
      actions={<Badge>{data.constraints.length}</Badge>}
    >
      {data.constraints.length
        ? (
          <SemanticList label={t("constraintResults")} scrollable>
            {data.constraints.map((constraint) => {
              const margin = constraint.margin === undefined
                ? undefined
                : `${constraint.margin >= 0 ? "+" : ""}${
                  formatValue(constraint.margin, locale, 1)
                }${
                  constraint.marginPercent === undefined
                    ? ""
                    : ` (${formatValue(constraint.marginPercent, locale, 0)}%)`
                }`;
              return (
                <SemanticElement
                  key={constraint.constraintId}
                  reference={sysmlRef(
                    "constraint",
                    constraint.constraintId,
                    digest,
                  )}
                  density="row"
                  selected={selected === constraint.constraintId}
                  tone={statusTone(constraint.status)}
                  ident={
                    <ElementIdent
                      label={constraint.constraintName}
                      detail={[
                        constraint.expression,
                        constraint.error,
                        constraint.unresolvedRefs?.length
                          ? t("missingRefs", {
                            refs: constraint.unresolvedRefs.join(", "),
                          })
                          : undefined,
                      ].filter(Boolean).join(" · ")}
                    />
                  }
                  reading={
                    <ElementReading
                      label={t("value")}
                      value={formatValue(constraint.computedValue, locale)}
                      detail={constraint.threshold === undefined
                        ? margin
                        : `${
                          t("thresholdDetail", {
                            value: formatValue(constraint.threshold, locale),
                          })
                        }${margin ? ` · ${margin}` : ""}`}
                    />
                  }
                  verdict={
                    <ElementVerdict
                      value={validationContractLabel(constraint.status)}
                    />
                  }
                  activationLabel={t("selectItem", {
                    label: constraint.constraintName,
                  })}
                  onActivate={() => {
                    setSelected(constraint.constraintId);
                    publishSelection(
                      context,
                      "select_constraint",
                      "syson.constraint.selected",
                      {
                        constraintId: constraint.constraintId,
                        constraintName: constraint.constraintName,
                        status: constraint.status,
                      },
                    );
                  }}
                />
              );
            })}
          </SemanticList>
        )
        : <EmptyState>{t("noConstraints")}</EmptyState>}
    </Card>
  );
}

const keys = VIEWER_COMPONENT_KEYS.validation;
const registry = defineComponentRegistry<
  SysonViewData<ValidationReport>,
  SurfaceAppContext<ValidationReport>
>({
  components: {
    [keys[0]]: definePreactComponent({
      title: "Validation status",
      description: "Element and global result",
    }, ({ data, context }) => <Status data={data} context={context} />),
    [keys[1]]: definePreactComponent({
      title: "Validation summary",
      description: "Pass, fail, error and unresolved counts",
    }, ({ data }) => <Summary data={data} />),
    [keys[2]]: definePreactComponent({
      title: "Resolved values",
      description: "Model parameters used by validation",
    }, ({ data, context }) => <ResolvedValues data={data} context={context} />),
    [keys[3]]: definePreactComponent({
      title: "Constraints",
      description: "Detailed selectable constraint results",
    }, ({ data, context }) => <Constraints data={data} context={context} />),
  },
  defaultSurface: defaultComponentSurface(
    VIEWER_DEFAULT_SURFACE_KEYS.validation,
  ),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: { view: "validation", validateContent: isValidationReport },
  loadingLabel: surfaceLabel("loadingValidation"),
}).catch((error) =>
  console.error("[validation-viewer] Failed to start", error)
);
