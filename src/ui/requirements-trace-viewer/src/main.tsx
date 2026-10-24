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
  ElementSection,
  ElementVerdict,
  EmptyState,
  FocusedView,
  InlineCode,
  LimitGauge,
  NoticeGroup,
  PathBar,
  SemanticElement,
  SemanticList,
  StateMessage,
} from "@mcpview/components/preact/components";
import type { ComponentChildren } from "preact";
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
  type SysonViewData,
} from "../../shared/preact-surface";
import {
  type ElementIdentity,
  isRequirementsTrace,
  type RequirementsTraceData as TraceData,
  type RequirementTraceEntry as TraceEntry,
} from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import type {
  SelectionController,
  SelectionItem,
} from "../../shared/selection";
import { createSelectionGesture } from "../../shared/selection-gesture";
import { useSysonSelection } from "../../shared/selection-hooks";
import { kindInfo } from "../../shared/sysml-kind";
import {
  ElementRow,
  KindMark,
  TechnicalDetails,
  ViewerHeader,
} from "../../shared/viewer-ui";
import { traceMessages } from "./messages";
import { requirementExpressionText } from "./requirement-expression";
import {
  AuthoredConstraintsSection,
  DetailSheet,
  useListDetail,
  useRetainedState,
} from "./requirement-ui";
import "../../global.css";
import "./viewer.css";

type Translate = ReturnType<typeof traceMessages>;

/** Trace rows are RequirementUsage elements (the provider's own query). */
const REQUIREMENT_KIND = "RequirementUsage";
/** Domain literals: shown as written in every locale. */
const TRACE_GAP = "TRACE GAP";
const UNKNOWN = "unknown";

/**
 * What one trace establishes. A gap is a missing link the provider looked
 * for: satisfaction always, verification only once it is `available`. An
 * unknown verification is neither a gap nor a pass.
 */
function traceState(trace: TraceEntry) {
  const status = traceLinkStatus(trace);
  const satisfactionGap = trace.satisfiedBy.length === 0;
  const verification: "linked" | "gap" | "unknown" = trace.verifiedBy?.length
    ? "linked"
    : trace.verificationStatus === "available"
    ? "gap"
    : "unknown";
  return {
    status,
    satisfactionGap,
    verification,
    gap: satisfactionGap || verification === "gap",
    unresolved: status === "unresolved",
  };
}

function traceTitle(data: TraceData, t: Translate) {
  return data.scope?.owner?.label || data.scope?.project?.label ||
    t("traceTitleFallback");
}

function constraintSummary(trace: TraceEntry) {
  return trace.authoredConstraints?.constraints.map((constraint) =>
    requirementExpressionText(constraint.expression)
  ).join("; ") || undefined;
}

function requirementItem(
  trace: TraceEntry,
  digest: string | undefined,
): SelectionItem {
  return {
    reference: sysmlRef(REQUIREMENT_KIND, trace.requirement.id, digest),
    label: trace.requirement.label || trace.requirement.id,
    summary: constraintSummary(trace),
  };
}

/** Provider errors behind unresolved satisfaction links, each stated once. */
function unresolvedNotes(trace: TraceEntry): string[] {
  return [
    ...new Set(
      [
        ...(trace.satisfactionLinks ?? [])
          .filter((link) => link.status === "unresolved")
          .map((link) => link.error),
        trace.error,
      ].filter((note): note is string => Boolean(note)),
    ),
  ];
}

function TraceResultError(
  { error, locale }: { error: string | undefined; locale?: string },
) {
  return (
    <StateMessage tone="danger" title="error">
      {error || traceMessages(locale)("traceFailedWithoutDetail")}
    </StateMessage>
  );
}

/** One linked element (satisfying or verifying), selectable into AI context. */
function LinkedElement(
  { controller, target, relation, requirementLabel, digest, t }: {
    controller: SelectionController;
    target: ElementIdentity;
    relation: "Satisfies" | "Verifies";
    requirementLabel: string;
    digest: string | undefined;
    t: Translate;
  },
) {
  const info = kindInfo(target.kind);
  const label = target.label || info.name;
  const item: SelectionItem = {
    reference: sysmlRef("element", target.id, digest),
    label: target.label || target.id,
    kind: shortSysmlKind(target.kind),
    values: { [relation]: requirementLabel },
  };
  const gesture = createSelectionGesture(controller, item);
  const state = controller.selectionState(item);
  return (
    <span
      className="syson-trace-chip mcp-view-context-selection"
      data-context-state={state}
      role="button"
      tabIndex={0}
      aria-pressed={state === "selected" || state === "adding"}
      aria-label={t("selectItem", { label })}
      title={info.name}
      onClick={gesture.onClick}
      onDblClick={gesture.onDoubleClick}
      onKeyDown={gesture.onKeyDown}
    >
      <KindMark kind={target.kind} />
      <span className="syson-trace-chip-label">{label}</span>
    </span>
  );
}

function LinkedElements(
  { targets, ...props }: Omit<Parameters<typeof LinkedElement>[0], "target"> & {
    targets: readonly ElementIdentity[];
  },
) {
  return (
    <span className="syson-trace-chips">
      {targets.map((target) => (
        <LinkedElement key={target.id} target={target} {...props} />
      ))}
    </span>
  );
}

function Coverage(
  { data, context }: {
    data: TraceData;
    context: SurfaceAppContext<TraceData>;
  },
) {
  const t = traceMessages(context.hostContext.locale);
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
                reference={sysmlRef(REQUIREMENT_KIND, trace.requirement.id)}
                density="row"
                ident={
                  <ElementIdent
                    label={trace.requirement.label || t("unnamedRequirement")}
                    detail={trace.satisfiedBy.map((target) =>
                      target.label || kindInfo(target.kind).name
                    ).join(" · ") || undefined}
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
  const locale = context.hostContext.locale;
  const t = traceMessages(locale);
  const digest = recordedProjectionDigest(context);
  const scope = JSON.stringify([
    data.editingContextId ?? "",
    data.rootId,
    digest ?? "",
  ]);
  const { controller, snapshot } = useSysonSelection(
    context,
    data.rootId,
    data.editingContextId,
  );
  const [gapsOnly, setGapsOnly] = useRetainedState(
    context.app,
    scope,
    "gapsOnly",
    false,
  );
  const detail = useListDetail(context.app, scope);
  const failed = data.error !== undefined;
  const traces = data.traces.map((trace) => ({
    trace,
    state: traceState(trace),
  }));
  const gapCount = traces.filter((entry) => entry.state.gap).length;
  const unresolvedCount =
    traces.filter((entry) => entry.state.unresolved).length;
  const title = traceTitle(data, t);
  const meta = failed ? undefined : [
    data.traces.length === 1
      ? t("requirementCountOne")
      : t("requirementCount", { count: String(data.traces.length) }),
    gapCount === 1
      ? t("gapCountOne")
      : t("gapCount", { count: String(gapCount) }),
    unresolvedCount === 0
      ? undefined
      : unresolvedCount === 1
      ? t("unresolvedCountOne")
      : t("unresolvedCount", { count: String(unresolvedCount) }),
  ].filter(Boolean).join(" · ");
  const header = (below?: ComponentChildren, actions?: ComponentChildren) => (
    <ViewerHeader
      eyebrow={t("traceEyebrow")}
      title={title}
      meta={meta}
      actions={actions}
      basket={
        <SelectionBasket
          context={context}
          controller={controller}
          snapshot={snapshot}
        />
      }
      below={below}
    />
  );
  const selectionError = snapshot.error && (
    <p className="syson-status" data-tone="danger" role="alert">
      {snapshot.error}
    </p>
  );

  if (failed) {
    return (
      <section className="syson-viewer">
        {header()}
        <TraceResultError error={data.error} locale={locale} />
      </section>
    );
  }

  const opened = detail.openId === undefined
    ? undefined
    : traces.find((entry) => entry.trace.requirement.id === detail.openId);
  if (opened) {
    const label = opened.trace.requirement.label || t("unnamedRequirement");
    return (
      <section className="syson-viewer">
        {header(
          <PathBar
            label={t("tracePath")}
            items={[{ id: "trace", label: title }, {
              id: "requirement",
              label,
            }]}
            currentId="requirement"
            onSelect={(id) => {
              if (id === "trace") detail.close();
            }}
            backLabel={t("backToTrace")}
          />,
        )}
        {selectionError}
        <DetailSheet sheetRef={detail.sheet} onClose={detail.close}>
          <TraceCard
            trace={opened.trace}
            state={opened.state}
            controller={controller}
            digest={digest}
            locale={locale}
            t={t}
          />
        </DetailSheet>
      </section>
    );
  }

  const rows = gapsOnly ? traces.filter((entry) => entry.state.gap) : traces;
  return (
    <section className="syson-viewer">
      {header(
        undefined,
        data.traces.length > 0 && (
          <Button
            pressed={gapsOnly}
            onClick={() => setGapsOnly(!gapsOnly)}
          >
            {t("gapsOnly")}
          </Button>
        ),
      )}
      <div className="syson-element-sheet">
        <TechnicalDetails
          label={t("technicalDetails")}
          idLabel={t("rootIdentity")}
          id={data.rootId}
          copyLabel={t("copyId")}
          copiedLabel={t("copied")}
        />
      </div>
      {selectionError}
      <div
        ref={detail.scroller}
        className="syson-scroll"
        onScroll={detail.onScroll}
      >
        {rows.length
          ? (
            <div
              className="syson-rows syson-trace-rows"
              role="list"
              aria-label={t("requirementTraces")}
            >
              {rows.map(({ trace, state }) => {
                const label = trace.requirement.label ||
                  t("unnamedRequirement");
                const links = {
                  controller,
                  requirementLabel: label,
                  digest,
                  t,
                };
                return (
                  <div
                    role="listitem"
                    key={trace.requirement.id}
                    className="syson-trace-item"
                    data-open-id={trace.requirement.id}
                  >
                    <ElementRow
                      controller={controller}
                      item={requirementItem(trace, digest)}
                      kind={REQUIREMENT_KIND}
                      label={label}
                      meta={constraintSummary(trace)}
                      trailing={state.unresolved && (
                        <Badge tone="warning">unresolved</Badge>
                      )}
                      onOpen={() => detail.open(trace.requirement.id)}
                      openLabel={t("openElement", { label })}
                      selectLabel={t("selectItem", { label })}
                    />
                    <dl
                      className="syson-trace-links"
                      aria-label={t("traceLinks", { label })}
                    >
                      <div className="syson-trace-link">
                        <dt>{t("satisfiedBy")}</dt>
                        <dd>
                          {state.satisfactionGap
                            ? <Badge tone="warning">{TRACE_GAP}</Badge>
                            : (
                              <LinkedElements
                                targets={trace.satisfiedBy}
                                relation="Satisfies"
                                {...links}
                              />
                            )}
                        </dd>
                      </div>
                      <div className="syson-trace-link">
                        <dt>{t("verifiedBy")}</dt>
                        <dd>
                          {state.verification === "linked"
                            ? (
                              <LinkedElements
                                targets={trace.verifiedBy ?? []}
                                relation="Verifies"
                                {...links}
                              />
                            )
                            : state.verification === "gap"
                            ? <Badge tone="warning">{TRACE_GAP}</Badge>
                            : <Badge>{UNKNOWN}</Badge>}
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          )
          : (
            <EmptyState>
              {data.traces.length ? t("noGaps") : t("noRequirements")}
            </EmptyState>
          )}
      </div>
    </section>
  );
}

/** Datasheet of one trace: satisfaction, verification, authored constraints. */
function TraceCard(
  { trace, state, controller, digest, locale, t }: {
    trace: TraceEntry;
    state: ReturnType<typeof traceState>;
    controller: SelectionController;
    digest: string | undefined;
    locale?: string;
    t: Translate;
  },
) {
  const label = trace.requirement.label || t("unnamedRequirement");
  const links = { controller, requirementLabel: label, digest, t };
  return (
    <SemanticElement
      reference={sysmlRef(REQUIREMENT_KIND, trace.requirement.id, digest)}
      density="card"
      tone={state.gap || state.unresolved ? "warning" : "info"}
      ident={
        <ElementIdent
          marker={<KindMark kind={REQUIREMENT_KIND} />}
          label={label}
          detail={kindInfo(REQUIREMENT_KIND).name}
        />
      }
      verdict={
        <ElementVerdict
          label={t("satisfaction")}
          value={state.satisfactionGap ? TRACE_GAP : state.status}
        />
      }
      body={
        <ElementBody>
          <ElementSection title={t("satisfiedBy")}>
            {state.satisfactionGap
              ? (
                <div className="syson-sheet-literal">
                  <Badge tone="warning">{TRACE_GAP}</Badge>
                  <span className="syson-status">
                    {state.unresolved
                      ? t("satisfactionUnresolvedDetail")
                      : t("satisfactionGapDetail")}
                  </span>
                </div>
              )
              : (
                <LinkedElements
                  targets={trace.satisfiedBy}
                  relation="Satisfies"
                  {...links}
                />
              )}
            <NoticeGroup
              label={t("unresolvedLinks")}
              tone="warning"
              items={unresolvedNotes(trace)}
            />
          </ElementSection>
          <ElementSection title={t("verifiedBy")}>
            {state.verification === "linked"
              ? (
                <LinkedElements
                  targets={trace.verifiedBy ?? []}
                  relation="Verifies"
                  {...links}
                />
              )
              : (
                <div className="syson-sheet-literal">
                  {state.verification === "gap"
                    ? <Badge tone="warning">{TRACE_GAP}</Badge>
                    : <Badge>{UNKNOWN}</Badge>}
                  <span className="syson-status">
                    {state.verification === "gap"
                      ? t("verificationGapDetail")
                      : t("verificationUnknownDetail")}
                  </span>
                </div>
              )}
          </ElementSection>
          <AuthoredConstraintsSection
            status={trace.authoredConstraintsStatus}
            constraints={trace.authoredConstraints}
            error={trace.authoredConstraintsError}
            locale={locale}
          />
          <TechnicalDetails
            label={t("technicalDetails")}
            idLabel={t("elementId")}
            id={trace.requirement.id}
            copyLabel={t("copyId")}
            copiedLabel={t("copied")}
          />
        </ElementBody>
      }
    />
  );
}

function SatisfactionLinks(
  { data, context }: {
    data: TraceData;
    context: SurfaceAppContext<TraceData>;
  },
) {
  const t = traceMessages(context.hostContext.locale);
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
      eyebrow={traceTitle(data, t)}
      actions={<Badge>{linked.length}</Badge>}
    >
      <SemanticList label={t("satisfactionLinks")} scrollable>
        {linked.map((trace) => (
          <SemanticElement
            key={trace.requirement.id}
            reference={sysmlRef(REQUIREMENT_KIND, trace.requirement.id)}
            density="row"
            ident={
              <ElementIdent
                label={trace.requirement.label || t("unnamedRequirement")}
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
                              target.label || shortSysmlKind(target.kind)
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
        description:
          "Satisfied-by and verified-by links per requirement, with gaps",
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
