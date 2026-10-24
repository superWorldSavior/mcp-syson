/** Documentary authored limits, without inferred measurements or satisfaction. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  ElementBody,
  ElementIdent,
  ElementLimit,
  ElementSection,
  EmptyState,
  PathBar,
  SemanticElement,
  TextInput,
} from "@mcpview/components/preact/components";
import type { ComponentChildren } from "preact";
import { useMemo } from "preact/hooks";
import {
  defaultComponentSurface,
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
  type SysonViewData,
} from "../../shared/preact-surface";
import {
  adaptRequirementsRecordedContent,
  type AuthoredRequirement,
  isRequirementsViewData,
  type RequirementsViewData,
} from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import type { SelectionItem } from "../../shared/selection";
import { useSysonSelection } from "../../shared/selection-hooks";
import { kindInfo } from "../../shared/sysml-kind";
import {
  ElementRow,
  KindMark,
  TechnicalDetails,
  ViewerHeader,
} from "../../shared/viewer-ui";
import {
  AuthoredConstraintsSection,
  DetailSheet,
  documentationLines,
  documentationPreview,
  operatorGlyph,
  useListDetail,
  useRetainedState,
} from "../../requirements-trace-viewer/src/requirement-ui";
import { requirementsMessages } from "./messages";
import "../../global.css";
import "./viewer.css";

type Translate = ReturnType<typeof requirementsMessages>;

/** Recorded captures carry no kind: they are requirements, nothing more. */
const kindOf = (requirement: AuthoredRequirement) =>
  requirement.kind ?? "Requirement";

function requirementLabel(requirement: AuthoredRequirement, t: Translate) {
  return requirement.name || requirement.identifier ||
    t("unnamedRequirement");
}

/** The authored statement as written: operator, literal value and unit. */
function authoredLimit(requirement: AuthoredRequirement, locale?: string) {
  if (!requirement.limit || !requirement.operator) return undefined;
  return {
    operator: operatorGlyph(requirement.operator),
    value: formatHostNumber(requirement.limit.value, locale, {
      maximumSignificantDigits: 21,
    }),
    unit: requirement.limit.unit || undefined,
  };
}

/** Only a status the provider actually established; "unknown" stays out of rows. */
function knownCoverage(requirement: AuthoredRequirement) {
  const status: string | undefined = requirement.coverageStatus;
  return status && status !== "unknown" ? status : undefined;
}

function selectionItem(
  requirement: AuthoredRequirement,
  digest: string | undefined,
): SelectionItem {
  const summary = requirement.limit && requirement.operator
    ? `${
      requirement.metric ?? ""
    } ${requirement.operator} ${requirement.limit.value} ${requirement.limit.unit}`
      .trim()
    : documentationPreview(requirement.text)?.slice(0, 1000);
  return {
    reference: sysmlRef("Requirement", requirement.id, digest),
    label: requirement.name || requirement.identifier || requirement.id,
    summary,
    kind: shortSysmlKind(kindOf(requirement)),
    ...(requirement.identifier
      ? { values: { Identifier: requirement.identifier } }
      : {}),
  };
}

function AuthoredRequirements(
  { data, context }: {
    data: RequirementsViewData;
    context: SurfaceAppContext<RequirementsViewData>;
  },
) {
  const locale = context.hostContext.locale;
  const t = requirementsMessages(locale);
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
  const [filter, setFilter] = useRetainedState(
    context.app,
    scope,
    "filter",
    "",
  );
  const detail = useListDetail(context.app, scope);
  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return data.requirements;
    return data.requirements.filter((requirement) =>
      [
        requirement.name,
        requirement.identifier,
        requirement.metric,
        documentationPreview(requirement.text),
        kindInfo(kindOf(requirement)).name,
      ].filter(Boolean).join(" ").toLowerCase().includes(needle)
    );
  }, [data.requirements, filter]);
  const kindCounts = useMemo(() => {
    const counts = new Map<string, { kind: string; count: number }>();
    data.requirements.forEach((requirement) => {
      const kind = kindOf(requirement);
      const marker = kindInfo(kind).marker;
      const entry = counts.get(marker) ?? { kind, count: 0 };
      entry.count += 1;
      counts.set(marker, entry);
    });
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [data.requirements]);

  const title = data.target.label || t("unnamed");
  const opened = detail.openId === undefined
    ? undefined
    : data.requirements.find((requirement) => requirement.id === detail.openId);
  const header = (below?: ComponentChildren, actions?: ComponentChildren) => (
    <ViewerHeader
      eyebrow={t("authoredRequirements")}
      title={title}
      meta={data.count === 1
        ? t("requirementCountOne")
        : t("requirementCount", { count: String(data.count) })}
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

  if (opened) {
    const label = requirementLabel(opened, t);
    return (
      <section className="syson-viewer">
        {header(
          <PathBar
            label={t("requirementPath")}
            items={[
              { id: "list", label: title },
              { id: "requirement", label },
            ]}
            currentId="requirement"
            onSelect={(id) => {
              if (id === "list") detail.close();
            }}
            backLabel={t("backToList")}
          />,
        )}
        {selectionError}
        <DetailSheet sheetRef={detail.sheet} onClose={detail.close}>
          <RequirementCard
            requirement={opened}
            digest={digest}
            locale={locale}
            t={t}
          />
        </DetailSheet>
      </section>
    );
  }

  return (
    <section className="syson-viewer">
      {header(
        undefined,
        data.requirements.length > 0 && (
          <TextInput
            label={t("filterRequirements")}
            placeholder={t("filterRequirementsPlaceholder")}
            value={filter}
            onValueInput={setFilter}
          />
        ),
      )}
      <div className="syson-element-sheet">
        {kindCounts.length > 1 && (
          <ul className="syson-kind-counts" aria-label={t("requirementKinds")}>
            {kindCounts.map((entry) => (
              <li key={entry.kind}>
                <KindMark kind={entry.kind} />
                <span>{entry.count}</span>
              </li>
            ))}
          </ul>
        )}
        <TechnicalDetails
          label={t("technicalDetails")}
          idLabel={data.scope?.kind === "project"
            ? t("projectId")
            : t("elementId")}
          id={data.target.id}
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
              className="syson-rows"
              role="list"
              aria-label={t("authoredRequirements")}
            >
              {rows.map((requirement) => {
                const label = requirementLabel(requirement, t);
                const kind = kindOf(requirement);
                const limit = authoredLimit(requirement, locale);
                const coverage = knownCoverage(requirement);
                const errors = requirement.authoredConstraints?.errors
                  ?.length ?? 0;
                const meta = [
                  requirement.identifier !== label
                    ? requirement.identifier
                    : undefined,
                  documentationPreview(requirement.text) ??
                    requirement.metric ?? kindInfo(kind).name,
                ].filter(Boolean).join(" · ");
                return (
                  <div
                    role="listitem"
                    key={requirement.id}
                    data-open-id={requirement.id}
                  >
                    <ElementRow
                      controller={controller}
                      item={selectionItem(requirement, digest)}
                      kind={kind}
                      label={label}
                      meta={meta}
                      trailing={(limit || errors > 0 || coverage) && (
                        <span className="syson-req-trailing">
                          {limit && (
                            <span title={t("authoredLimit")}>
                              <ElementLimit {...limit} />
                            </span>
                          )}
                          {!limit && errors > 0 && (
                            <Badge tone="warning">
                              {errors === 1
                                ? t("constraintErrorCountOne")
                                : t("constraintErrorCount", {
                                  count: String(errors),
                                })}
                            </Badge>
                          )}
                          {coverage && <Badge>{coverage}</Badge>}
                        </span>
                      )}
                      onOpen={() => detail.open(requirement.id)}
                      openLabel={t("openElement", { label })}
                      selectLabel={t("selectItem", { label })}
                    />
                  </div>
                );
              })}
            </div>
          )
          : (
            <EmptyState>
              {data.requirements.length
                ? t("noMatchingRequirements")
                : t("noAuthoredRequirements")}
            </EmptyState>
          )}
      </div>
    </section>
  );
}

/** Datasheet of one requirement: full text, authored limit, constraints, coverage. */
function RequirementCard(
  { requirement, digest, locale, t }: {
    requirement: AuthoredRequirement;
    digest: string | undefined;
    locale?: string;
    t: Translate;
  },
) {
  const kind = kindOf(requirement);
  const info = kindInfo(kind);
  const limit = authoredLimit(requirement, locale);
  const lines = requirement.text ? documentationLines(requirement.text) : [];
  const coverage: string | undefined = requirement.coverageStatus;
  return (
    <SemanticElement
      reference={sysmlRef("Requirement", requirement.id, digest)}
      density="card"
      ident={
        <ElementIdent
          marker={<KindMark kind={kind} />}
          label={requirementLabel(requirement, t)}
          detail={[info.name, requirement.identifier].filter(Boolean).join(
            " · ",
          )}
        />
      }
      reading={limit
        ? (
          <ElementLimit
            {...limit}
            label={t("authoredLimit")}
            detail={requirement.metric}
          />
        )
        : undefined}
      body={
        <ElementBody>
          <ElementSection title={t("requirementText")}>
            {lines.length
              ? (
                <div className="syson-sheet-text">
                  {lines.map((line, index) => <p key={index}>{line}</p>)}
                </div>
              )
              : (
                <p className="syson-status">
                  {requirement.textStatus === "unavailable"
                    ? t("textUnavailable")
                    : t("textNotCaptured")}
                </p>
              )}
          </ElementSection>
          <AuthoredConstraintsSection
            status={requirement.authoredConstraintsStatus}
            constraints={requirement.authoredConstraints}
            error={requirement.authoredConstraintsError}
            locale={locale}
          />
          {coverage !== undefined && (
            <ElementSection title={t("coverage")}>
              <div className="syson-sheet-literal">
                <Badge>{coverage}</Badge>
                {coverage === "unknown" && (
                  <span className="syson-status">
                    {t("coverageUnknownDetail")}
                  </span>
                )}
              </div>
            </ElementSection>
          )}
          <TechnicalDetails
            label={t("technicalDetails")}
            idLabel={t("elementId")}
            id={requirement.id}
            copyLabel={t("copyId")}
            copiedLabel={t("copied")}
          />
        </ElementBody>
      }
    />
  );
}

const keys = VIEWER_COMPONENT_KEYS.requirements;
const registry = defineComponentRegistry<
  SysonViewData<RequirementsViewData>,
  SurfaceAppContext<RequirementsViewData>
>({
  components: {
    [keys[0]]: definePreactComponent(
      {
        title: "Authored requirements",
        description: "Selectable authored requirements with a detail sheet",
      },
      ({ data, context }) => (
        <AuthoredRequirements data={data} context={context} />
      ),
    ),
  },
  defaultSurface: defaultComponentSurface(
    VIEWER_DEFAULT_SURFACE_KEYS.requirements,
  ),
});

void startSysonViewerApp({
  root: document.getElementById("app")!,
  registry,
  recordedSession: {
    view: "requirements",
    validateContent: isRequirementsViewData,
    adaptContent: adaptRequirementsRecordedContent,
  },
  loadingLabel: surfaceLabel("loadingRequirements"),
}).catch((error) =>
  console.error("[requirements-viewer] Failed to start", error)
);
