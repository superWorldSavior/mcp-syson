/** Composable requirement coverage and trace components. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  BadgeGroup,
  Button,
  Card,
  DataTable,
  Disclosure,
  ElementBody,
  ElementIdent,
  ElementProvenance,
  ElementVerdict,
  EmptyState,
  FocusedView,
  InlineCode,
  LimitGauge,
  SemanticElement,
  SemanticList,
  StateMessage,
  Toolbar,
} from "@mcpview/components/preact/components";
import { useState } from "preact/hooks";
import {
  defaultComponentSurface,
  linkCoverageGauge,
  recordedProjectionDigest,
  shortSysmlKind,
  sysmlRef,
  traceLinkStatus,
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
import { isRequirementsTrace } from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { useSysonSelection } from "../../shared/selection-hooks";
import { createSelectionGesture } from "../../shared/selection-gesture";
import {
  type RequirementExpression,
  requirementExpressionText,
} from "./requirement-expression";
import "../../global.css";

interface TraceEntry {
  requirement: { id: string; label: string };
  satisfiedBy: Array<{ id: string; label: string; kind: string }>;
  error?: string;
  satisfactionLinks?: Array<{
    relationship: { id: string; label: string; kind: string };
    targets: Array<{ id: string; label: string; kind: string }>;
    status: "resolved" | "unresolved";
    error?: string;
  }>;
  authoredConstraintsStatus?: "available" | "unavailable" | "not-requested";
  authoredConstraintsError?: string;
  authoredConstraints?: {
    constraints: Array<
      { id: string; name: string; expression: RequirementExpression }
    >;
    errors?: Array<{ id: string; name: string; error: string }>;
    message?: string;
  };
}

interface TraceData extends Record<string, unknown> {
  rootId: string;
  requirementsCount: number;
  traces: TraceEntry[];
  error?: string;
  coverage: {
    total: number;
    satisfied: number;
    unsatisfied: number;
    percentage: number;
  };
}

function TraceResultError(
  { error, locale }: { error: string | undefined; locale?: string },
) {
  return (
    <StateMessage tone="danger" title="error">
      {error || sysonMessages(locale)("traceFailedWithoutDetail")}
    </StateMessage>
  );
}

function Coverage(
  { data, context }: {
    data: TraceData;
    context: SurfaceAppContext<TraceData>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const unresolvedCount =
    data.traces.filter((trace) => traceLinkStatus(trace) === "unresolved")
      .length;
  const gauge = data.error !== undefined
    ? { available: false as const, statusLabel: "unavailable" as const }
    : linkCoverageGauge(data.coverage, unresolvedCount);
  const knownUnlinked = data.coverage.unsatisfied - unresolvedCount;
  const coverageDetail = [
    `${data.coverage.satisfied} linked`,
    knownUnlinked > 0 ? `${knownUnlinked} unlinked` : undefined,
    unresolvedCount > 0 ? `${unresolvedCount} unresolved` : undefined,
  ].filter(Boolean).join(" · ");
  const details = (
    <>
      <ElementProvenance
        label={t("rootIdentity")}
        value={<InlineCode>{data.rootId}</InlineCode>}
      />
      {coverageDetail
        ? (
          <ElementProvenance
            label={t("linkCoverage")}
            value={coverageDetail}
          />
        )
        : undefined}
      {data.traces.length > 0 && (
        <Disclosure label={t("traceInspection")}>
          <SemanticList label={t("traceInspection")}>
            {data.traces.map((trace) => (
              <SemanticElement
                key={trace.requirement.id}
                reference={sysmlRef("RequirementUsage", trace.requirement.id)}
                density="row"
                ident={
                  <ElementIdent
                    label={trace.requirement.id}
                    detail={trace.satisfiedBy.map((target) => target.id).join(
                      " · ",
                    ) || undefined}
                  />
                }
                verdict={<ElementVerdict value={traceLinkStatus(trace)} />}
              />
            ))}
          </SemanticList>
        </Disclosure>
      )}
    </>
  );
  return (
    <FocusedView
      label={t("coverageLabel")}
      hostContext={context.hostContext}
      status={data.error !== undefined
        ? (
          <StateMessage tone="danger" title="error">
            {data.error || t("traceFailedWithoutDetail")}
          </StateMessage>
        )
        : gauge.available
        ? <ElementVerdict value={gauge.statusLabel} />
        : (
          <StateMessage tone="warning" title="unavailable">
            {t("coverageUnavailable")}
          </StateMessage>
        )}
      primary={gauge.available
        ? (
          <LimitGauge
            label={t("linkCoverage")}
            min={gauge.min}
            max={gauge.max}
            value={gauge.value}
            valueLabel={gauge.valueLabel}
            statusLabel={gauge.statusLabel}
            tone={gauge.tone}
          />
        )
        : (
          <ElementProvenance
            label={t("requirements")}
            value={String(data.coverage.total)}
          />
        )}
      detailsLabel={t("technicalDetails")}
      details={details}
    />
  );
}

function TraceList(
  { data, context }: {
    data: TraceData;
    context: SurfaceAppContext<TraceData>;
  },
) {
  if (data.error !== undefined) {
    return (
      <TraceResultError
        error={data.error}
        locale={context.hostContext.locale}
      />
    );
  }
  const t = sysonMessages(context.hostContext.locale);
  const [opened, setOpened] = useState<string>();
  const { controller, snapshot } = useSysonSelection(context, data.rootId);
  const [mode, setMode] = useState<
    "all" | "linked" | "unlinked" | "unresolved"
  >("all");
  const digest = recordedProjectionDigest(context);
  const rows = data.traces.filter((trace) =>
    mode === "all" || traceLinkStatus(trace) === mode
  );
  return (
    <>
      <Card
        title={t("requirements")}
        actions={
          <Toolbar label={t("coverageFilter")}>
            {(["all", "linked", "unlinked", "unresolved"] as const).map(
              (value) => (
                <Button
                  key={value}
                  pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === "all" ? t("filterAll") : value}
                </Button>
              ),
            )}
          </Toolbar>
        }
      >
        {snapshot.error && (
          <StateMessage tone="danger" title="error">
            {snapshot.error}
          </StateMessage>
        )}
        <ElementProvenance
          label={t("linkCoverage")}
          value={`${data.coverage.satisfied} / ${data.coverage.total}`}
        />
        <StateMessage title={t("authoredConstraintsOnly")}>
          {t("authoredConstraintsNotValidated")}
        </StateMessage>
        {rows.length
          ? (
            <SemanticList label={t("requirementTraces")} scrollable>
              {rows.map((trace) => {
                const relationStatus = traceLinkStatus(trace);
                const linked = relationStatus === "linked";
                const item = {
                  reference: sysmlRef(
                    "RequirementUsage",
                    trace.requirement.id,
                    digest,
                  ),
                  label: trace.requirement.label || trace.requirement.id,
                  summary: trace.authoredConstraints?.constraints.map((
                    constraint,
                  ) => requirementExpressionText(constraint.expression)).join(
                    "; ",
                  ),
                };
                const gesture = createSelectionGesture(
                  controller,
                  item,
                  () => setOpened(trace.requirement.id),
                );
                return (
                  <div
                    key={trace.requirement.id}
                    tabIndex={0}
                    role="group"
                    aria-label={item.label}
                    onClick={gesture.onClick}
                    onDblClick={gesture.onDoubleClick}
                    onKeyDown={(event) => {
                      // Nested controls retain their native Space/Enter behavior.
                      if (event.target === event.currentTarget) {
                        gesture.onKeyDown(event);
                      }
                    }}
                  >
                    <SemanticElement
                      key={trace.requirement.id}
                      reference={sysmlRef(
                        "RequirementUsage",
                        trace.requirement.id,
                        digest,
                      )}
                      density="row"
                      selected={snapshot.desired.some((item) =>
                        item.reference.id === trace.requirement.id
                      )}
                      tone={linked ? "info" : "warning"}
                      ident={
                        <ElementIdent
                          label={trace.requirement.label ||
                            t("unnamedRequirement")}
                          detail={trace.error}
                        />
                      }
                      verdict={<ElementVerdict value={relationStatus} />}
                      body={
                        <ElementBody>
                          {trace.authoredConstraints?.constraints.map((
                            constraint,
                          ) => (
                            <ElementProvenance
                              key={constraint.id}
                              label={constraint.name || constraint.id}
                              value={
                                <InlineCode>
                                  {requirementExpressionText(
                                    constraint.expression,
                                  )}
                                </InlineCode>
                              }
                            />
                          ))}
                          {trace.authoredConstraintsStatus !== "available" && (
                            <StateMessage
                              tone="warning"
                              title={t("authoredConstraintsUnavailable")}
                            >
                              {trace.authoredConstraintsError ||
                                t(
                                  trace.authoredConstraintsStatus ===
                                      "not-requested"
                                    ? "authoredConstraintsBounded"
                                    : "authoredConstraintsNotCaptured",
                                )}
                            </StateMessage>
                          )}
                          {trace.authoredConstraintsStatus === "available" &&
                            !trace.authoredConstraints?.constraints.length &&
                            !trace.authoredConstraints?.errors?.length &&
                            (
                              <StateMessage
                                title={t("noAuthoredRequirements")}
                              />
                            )}
                          {trace.authoredConstraints?.errors?.map((error) => (
                            <StateMessage
                              key={error.id}
                              tone="warning"
                              title={error.name || error.id}
                            >
                              {error.error}
                            </StateMessage>
                          ))}
                          <Button
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpened(
                                opened === trace.requirement.id
                                  ? undefined
                                  : trace.requirement.id,
                              );
                            }}
                          >
                            {t("technicalDetails")}
                          </Button>
                          {opened === trace.requirement.id && (
                            <div
                              onClick={(event) => event.stopPropagation()}
                              onDblClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              <ElementProvenance
                                label={t("rootIdentity")}
                                value={trace.requirement.id}
                              />
                              <DataTable
                                label={t("satisfactionLinks")}
                                rows={trace.satisfiedBy}
                                rowKey={(target) => target.id}
                                emptyLabel={t("noSatisfactionLinks")}
                                columns={[
                                  {
                                    id: "label",
                                    label: t("satisfiedByElements"),
                                    render: (target) =>
                                      target.label || target.id,
                                  },
                                  {
                                    id: "kind",
                                    label: t("kindSort"),
                                    render: (target) =>
                                      shortSysmlKind(target.kind),
                                  },
                                  {
                                    id: "id",
                                    label: t("rootIdentity"),
                                    render: (target) => (
                                      <InlineCode>{target.id}</InlineCode>
                                    ),
                                  },
                                ]}
                                onSelect={(target) => {
                                  void controller.toggle({
                                    reference: sysmlRef(
                                      target.kind,
                                      target.id,
                                      digest,
                                    ),
                                    label: target.label || target.id,
                                  });
                                }}
                              />
                            </div>
                          )}
                        </ElementBody>
                      }
                    />
                  </div>
                );
              })}
            </SemanticList>
          )
          : (
            <EmptyState>
              {mode === "all"
                ? t("noRequirements")
                : t("noModeRequirements", { mode })}
            </EmptyState>
          )}
      </Card>
      <SelectionBasket
        context={context}
        controller={controller}
        snapshot={snapshot}
      />
    </>
  );
}

function SatisfactionLinks(
  { data, context }: {
    data: TraceData;
    context: SurfaceAppContext<TraceData>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  if (data.error !== undefined) {
    return (
      <TraceResultError
        error={data.error}
        locale={context.hostContext.locale}
      />
    );
  }
  const linked = data.traces.filter((trace) =>
    trace.satisfiedBy.length || trace.error
  );
  if (!linked.length) {
    return (
      <StateMessage title={t("noSatisfactionLinks")}>
        {t("noTraceEvidence")}
      </StateMessage>
    );
  }
  return (
    <Card
      title={t("satisfactionLinks")}
      eyebrow={<InlineCode>{data.rootId}</InlineCode>}
      actions={<Badge>{linked.length}</Badge>}
    >
      <SemanticList label={t("satisfactionLinks")} scrollable>
        {linked.map((trace) => (
          <SemanticElement
            key={trace.requirement.id}
            reference={sysmlRef("RequirementUsage", trace.requirement.id)}
            density="row"
            ident={
              <ElementIdent
                label={trace.requirement.label || trace.requirement.id}
                detail={trace.requirement.id}
              />
            }
            body={
              <ElementBody>
                <BadgeGroup label={t("satisfiedByElements")}>
                  {trace.satisfiedBy.map((target) => (
                    <Badge key={target.id} tone="info">
                      {target.label || shortSysmlKind(target.kind)}
                    </Badge>
                  ))}
                  {trace.error && <Badge tone="danger">{trace.error}</Badge>}
                </BadgeGroup>
                {trace.satisfactionLinks?.length
                  ? (
                    <DataTable
                      label={t("satisfactionLinks")}
                      rows={trace.satisfactionLinks}
                      rowKey={(link) => link.relationship.id}
                      columns={[
                        {
                          id: "relationship",
                          label: t("satisfactionLinks"),
                          render: (link) =>
                            link.relationship.label ||
                            shortSysmlKind(link.relationship.kind),
                        },
                        {
                          id: "targets",
                          label: t("satisfiedByElements"),
                          render: (link) =>
                            link.targets.map((target) =>
                              target.label || target.id
                            ).join(" · ") || link.error,
                        },
                        {
                          id: "status",
                          label: t("value"),
                          render: (link) => (
                            <ElementVerdict value={link.status} />
                          ),
                        },
                      ]}
                    />
                  )
                  : undefined}
              </ElementBody>
            }
          />
        ))}
      </SemanticList>
    </Card>
  );
}

const keys = VIEWER_COMPONENT_KEYS.requirementsTrace;
const registry = defineComponentRegistry<
  SysonViewData<TraceData>,
  SurfaceAppContext<TraceData>
>({
  components: {
    [keys[0]]: definePreactComponent(
      {
        title: "Requirements coverage",
        description: "Coverage percentage and counters",
      },
      ({ data, context }) => <Coverage data={data} context={context} />,
    ),
    [keys[1]]: definePreactComponent(
      {
        title: "Requirements trace list",
        description: "Filterable selectable requirements",
      },
      ({ data, context }) => <TraceList data={data} context={context} />,
    ),
    [keys[2]]: definePreactComponent(
      {
        title: "Satisfaction links",
        description: "Requirement-to-element evidence",
      },
      ({ data, context }) => (
        <SatisfactionLinks data={data} context={context} />
      ),
    ),
  },
  defaultSurface: defaultComponentSurface(
    VIEWER_DEFAULT_SURFACE_KEYS.requirementsTrace,
  ),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: {
    view: "requirementsTrace",
    validateContent: isRequirementsTrace,
  },
  loadingLabel: surfaceLabel("loadingTrace"),
}).catch((error) =>
  console.error("[requirements-trace] Failed to start", error)
);
