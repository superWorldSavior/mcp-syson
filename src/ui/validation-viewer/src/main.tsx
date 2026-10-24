/** Composable constraint-validation components. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  BadgeGroup,
  Card,
  ElementIdent,
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
import type { ComponentChildren } from "preact";
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
import {
  formatHostDateTime,
  formatHostNumber,
  presentationLocale,
} from "../../shared/messages";
import {
  definePreactComponent,
  publishSelection,
  startSysonViewerApp,
  type SurfaceAppContext,
  surfaceLabel,
  sysonMessages,
  type SysonViewData,
} from "../../shared/preact-surface";
import {
  isValidationReport,
  type ValidationDiagnostic,
  type ValidationReport,
} from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import type {
  SelectionController,
  SelectionItem,
} from "../../shared/selection";
import { useSysonSelection } from "../../shared/selection-hooks";
import {
  ElementRow,
  TechnicalDetails,
  ViewerHeader,
} from "../../shared/viewer-ui";
import { validationDiagnostics } from "../../../viewer-data";
import { type ValidationMessageKey, validationMessages } from "./messages";
import "../../global.css";
import "./viewer.css";

type ValidationConstraint = ValidationReport["constraints"][number];
type ValidationViewStatus = ValidationConstraint["status"] | "empty";
type ValidationTranslator = ReturnType<typeof validationMessages>;

/**
 * Every listed constraint is at least a ConstraintUsage: the provider extracts
 * `oclIsKindOf(sysml::ConstraintUsage)`, so the pill reads CSTR without
 * claiming a more specific kind the data does not carry.
 */
const CONSTRAINT_KIND = "ConstraintUsage";

/** Display order and tone per severity: errors first. */
const SEVERITIES = [
  {
    id: "error",
    tone: "danger",
    heading: "severityError",
    one: "errorCountOne",
    many: "errorCountMany",
  },
  {
    id: "warning",
    tone: "warning",
    heading: "severityWarning",
    one: "warningCountOne",
    many: "warningCountMany",
  },
  {
    id: "info",
    tone: "info",
    heading: "severityInfo",
    one: "infoCountOne",
    many: "infoCountMany",
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly tone: "danger" | "warning" | "info";
  readonly heading: ValidationMessageKey;
  readonly one: ValidationMessageKey;
  readonly many: ValidationMessageKey;
}>;

function statusTone(
  status: ValidationViewStatus,
): "success" | "danger" | "warning" {
  return status === "pass"
    ? "success"
    : status === "fail" || status === "error"
    ? "danger"
    : "warning";
}

function countLabel(
  t: ValidationTranslator,
  locale: string | undefined,
  count: number,
  one: ValidationMessageKey,
  many: ValidationMessageKey,
): string {
  const rule = new Intl.PluralRules(presentationLocale(locale)).select(count);
  return t(rule === "one" ? one : many, {
    count: formatHostNumber(count, locale),
  });
}

/**
 * One context item per constraint element. A diagnostic and its constraint row
 * build the same item, so they share one selection state; the summary carries
 * the diagnostic message and the values name the validated element.
 */
function constraintItem(
  constraint: {
    readonly id: string;
    readonly label: string;
    readonly status: string;
    readonly summary: string;
  },
  data: ValidationReport,
  digest: string | undefined,
): SelectionItem {
  return {
    reference: sysmlRef("element", constraint.id, digest),
    label: constraint.label || constraint.id,
    summary: constraint.summary,
    values: {
      Status: constraint.status,
      "Validated element": data.elementName || data.elementId,
      "Validated element ID": data.elementId,
    },
  };
}

/** AI-facing summary: the provider error, else the expression and gaps. */
function constraintSummary(constraint: ValidationConstraint): string {
  if (constraint.error !== undefined) return constraint.error;
  return constraint.unresolvedRefs?.length
    ? `${constraint.expression} (missing: ${
      constraint.unresolvedRefs.join(", ")
    })`
    : constraint.expression;
}

function formatMargin(
  constraint: ValidationConstraint,
  locale: string | undefined,
): string | undefined {
  if (constraint.margin === undefined) return undefined;
  const sign = constraint.margin >= 0 ? "+" : "";
  const percent = constraint.marginPercent === undefined
    ? ""
    : ` (${formatValue(constraint.marginPercent, locale, 0)}%)`;
  return `${sign}${formatValue(constraint.margin, locale, 1)}${percent}`;
}

/** Visible row detail: the provider error, else expression, gaps and reading. */
function constraintMeta(
  constraint: ValidationConstraint,
  t: ValidationTranslator,
  locale: string | undefined,
): ComponentChildren {
  if (constraint.error !== undefined) return constraint.error;
  const unit = constraint.unit ? ` ${constraint.unit}` : "";
  const facts = [
    constraint.unresolvedRefs?.length
      ? t("missingRefs", { refs: constraint.unresolvedRefs.join(", ") })
      : undefined,
    constraint.computedValue === undefined
      ? undefined
      : `${t("value")} ${formatValue(constraint.computedValue, locale)}${unit}`,
    constraint.threshold === undefined ? undefined : t("thresholdDetail", {
      value: formatValue(constraint.threshold, locale),
    }),
    formatMargin(constraint, locale),
  ].filter((fact): fact is string => fact !== undefined);
  return (
    <>
      <code className="syson-validation-expression">
        {constraint.expression}
      </code>
      {facts.map((fact, index) => <span key={index}>{` · ${fact}`}</span>)}
    </>
  );
}

function DiagnosticGroup(
  { severity, diagnostics, statusById, data, digest, controller, t, locale }: {
    readonly severity: typeof SEVERITIES[number];
    readonly diagnostics: readonly ValidationDiagnostic[];
    readonly statusById: ReadonlyMap<string, string>;
    readonly data: ValidationReport;
    readonly digest: string | undefined;
    readonly controller: SelectionController;
    readonly t: ValidationTranslator;
    readonly locale: string | undefined;
  },
) {
  const heading = t(severity.heading);
  return (
    <section className="syson-validation-section syson-validation-diagnostics">
      <h3 className="syson-validation-heading" data-tone={severity.tone}>
        <span>{heading}</span>
        <span className="syson-validation-count">
          {formatHostNumber(diagnostics.length, locale)}
        </span>
      </h3>
      <div className="syson-rows" role="list" aria-label={heading}>
        {diagnostics.map((diagnostic) => {
          const constraint = diagnostic.constraint.label || t("unnamed");
          const element = diagnostic.element.label || t("unnamed");
          const item = constraintItem(
            {
              id: diagnostic.constraint.id,
              label: diagnostic.constraint.label,
              status: statusById.get(diagnostic.constraint.id) ??
                diagnostic.severity,
              summary: diagnostic.message,
            },
            data,
            digest,
          );
          return (
            <div role="listitem" key={diagnostic.id}>
              <ElementRow
                controller={controller}
                item={item}
                kind={CONSTRAINT_KIND}
                // The constraint names the row: the ten diagnostics often share
                // one message, and the validated scope is already the title.
                label={constraint}
                meta={diagnostic.message}
                selectLabel={t("selectDiagnostic", {
                  message: diagnostic.message,
                  constraint,
                  element,
                })}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Default surface (syson-ux-design.md §2, validation-viewer): the validated
 * element in the header, counts per severity, diagnostics grouped by severity
 * and the constraint inventory. A click puts the constraint and its diagnostic
 * in AI context. Double-click opens nothing: this viewer has no detail
 * navigation, so no open action is wired.
 */
function ValidationOverview(
  { data, context }: {
    data: ValidationReport;
    context: SurfaceAppContext<ValidationReport>;
  },
) {
  const locale = context.hostContext.locale;
  const t = validationMessages(locale);
  const digest = recordedProjectionDigest(context);
  const rootId = JSON.stringify([
    data.editingContextId,
    data.elementId,
    digest ?? "",
  ]);
  const { controller, snapshot } = useSysonSelection(
    context,
    rootId,
    data.editingContextId,
  );
  const status = validationOverallStatus(data.summary);
  const validatedAtFormatted = formatHostDateTime(data.validatedAt, locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
  // Results recorded before diagnostics existed get the same provider projection.
  const diagnostics = data.diagnostics ??
    validationDiagnostics(data.constraints, data.elementId, data.elementName);
  const groups = SEVERITIES.map((severity) => ({
    severity,
    diagnostics: diagnostics.filter((diagnostic) =>
      diagnostic.severity === severity.id
    ),
  }));
  const statusById = new Map(
    data.constraints.map((constraint) => [
      constraint.constraintId,
      constraint.status,
    ]),
  );
  const hasConstraints = data.summary.total > 0;
  return (
    <section className="syson-viewer syson-validation">
      <ViewerHeader
        eyebrow={t("validation")}
        title={data.elementName || t("unnamed")}
        meta={
          <span className="syson-validation-meta">
            <span>{t("validated")} {validatedAtFormatted}</span>
            <Badge tone={statusTone(status)}>
              {validationContractLabel(status)}
            </Badge>
          </span>
        }
        basket={
          <SelectionBasket
            context={context}
            controller={controller}
            snapshot={snapshot}
          />
        }
      />
      <div className="syson-element-sheet">
        {hasConstraints && (
          <BadgeGroup label={t("diagnosticsBySeverity")}>
            {groups.map(({ severity, diagnostics }) => (
              <Badge
                key={severity.id}
                tone={diagnostics.length ? severity.tone : "neutral"}
              >
                {countLabel(
                  t,
                  locale,
                  diagnostics.length,
                  severity.one,
                  severity.many,
                )}
              </Badge>
            ))}
          </BadgeGroup>
        )}
        <TechnicalDetails
          label={t("technicalDetails")}
          idLabel={t("elementId")}
          id={data.elementId}
          copyLabel={t("copyId")}
          copiedLabel={t("copied")}
        />
      </div>
      {!hasConstraints && (
        <StateMessage tone="warning" title={validationContractLabel("empty")}>
          {t("cannotClaimPass")}
        </StateMessage>
      )}
      {hasConstraints && diagnostics.length === 0 && (
        <section className="syson-validation-section">
          <h3 className="syson-validation-heading">
            <span>{t("diagnostics")}</span>
          </h3>
          <EmptyState>{t("noDiagnostics")}</EmptyState>
        </section>
      )}
      {groups.filter((group) => group.diagnostics.length > 0).map((group) => (
        <DiagnosticGroup
          key={group.severity.id}
          severity={group.severity}
          diagnostics={group.diagnostics}
          statusById={statusById}
          data={data}
          digest={digest}
          controller={controller}
          t={t}
          locale={locale}
        />
      ))}
      {hasConstraints && (
        <section className="syson-validation-section syson-validation-constraints">
          <h3 className="syson-validation-heading">
            <span>{t("constraints")}</span>
            <span className="syson-validation-count">
              {formatHostNumber(data.constraints.length, locale)}
            </span>
          </h3>
          <div
            className="syson-rows"
            role="list"
            aria-label={t("constraintResults")}
          >
            {data.constraints.map((constraint) => {
              const label = constraint.constraintName || t("unnamed");
              const statusLabel = validationContractLabel(constraint.status);
              return (
                <div role="listitem" key={constraint.constraintId}>
                  <ElementRow
                    controller={controller}
                    item={constraintItem(
                      {
                        id: constraint.constraintId,
                        label: constraint.constraintName,
                        status: constraint.status,
                        summary: constraintSummary(constraint),
                      },
                      data,
                      digest,
                    )}
                    kind={CONSTRAINT_KIND}
                    label={label}
                    meta={constraintMeta(constraint, t, locale)}
                    trailing={
                      <Badge tone={statusTone(constraint.status)}>
                        {statusLabel}
                      </Badge>
                    }
                    selectLabel={t("selectItem", {
                      label: `${label} (${statusLabel})`,
                    })}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </section>
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
              const margin = formatMargin(constraint, locale);
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
    [keys[0]]: definePreactComponent(
      {
        title: "Validation status",
        description:
          "Validated element, severity counts, diagnostics and constraints",
      },
      ({ data, context }) => (
        <ValidationOverview data={data} context={context} />
      ),
    ),
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
