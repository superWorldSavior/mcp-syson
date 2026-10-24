/** Documentary authored limits, without inferred measurements or satisfaction. */

import { defineComponentRegistry } from "@mcpview/components";
import {
  Badge,
  CollectionCard,
  DataTable,
  Disclosure,
  ElementIdent,
  ElementLimit,
  EmptyState,
  SemanticElement,
  StateMessage,
} from "@mcpview/components/preact/components";
import {
  defaultComponentSurface,
  recordedProjectionDigest,
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
import {
  adaptRequirementsRecordedContent,
  isRequirementsViewData,
  type RequirementsViewData,
} from "../../shared/recorded-content";
import { SelectionBasket } from "../../shared/SelectionBasket";
import { useSysonSelection } from "../../shared/selection-hooks";
import { createSelectionGesture } from "../../shared/selection-gesture";
import "../../global.css";

function operatorGlyph(operator: string): string {
  const glyphs: Record<string, string> = {
    "<=": "≤",
    ">=": "≥",
    "==": "=",
    "!=": "≠",
  };
  return glyphs[operator] ?? operator;
}

function AuthoredList(
  { data, context }: {
    data: RequirementsViewData;
    context: SurfaceAppContext<RequirementsViewData>;
  },
) {
  const t = sysonMessages(context.hostContext.locale);
  const digest = recordedProjectionDigest(context);
  const { controller, snapshot } = useSysonSelection(
    context,
    data.rootId,
    data.editingContextId,
  );
  return (
    <>
      <CollectionCard
        label={t("authoredRequirements")}
        eyebrow={t("authoredRequirements")}
        title={data.target.label || data.target.id}
        actions={
          <Badge>
            {t(data.count === 1 ? "limitCountOne" : "limitCountMany", {
              count: data.count,
            })}
          </Badge>
        }
        scrollable
      >
        {snapshot.error && (
          <StateMessage tone="danger" title="error">
            {snapshot.error}
          </StateMessage>
        )}
        {data.requirements.length
          ? (
            <>
              {data.requirements.map((requirement) => {
                const item = {
                  reference: sysmlRef("Requirement", requirement.id, digest),
                  label: requirement.name,
                  summary: requirement.limit
                    ? `${requirement.metric} ${requirement.operator} ${requirement.limit.value} ${requirement.limit.unit}`
                    : requirement.text,
                  kind: requirement.kind ?? "Requirement",
                };
                const gesture = createSelectionGesture(controller, item);
                return (
                  <div
                    key={requirement.id}
                    tabIndex={0}
                    role="group"
                    aria-label={requirement.name}
                    onClick={gesture.onClick}
                    onKeyDown={(event) => {
                      // Nested controls retain their native Space/Enter behavior.
                      if (event.target === event.currentTarget) {
                        gesture.onKeyDown(event);
                      }
                    }}
                  >
                    <SemanticElement
                      key={requirement.id}
                      reference={sysmlRef(
                        "Requirement",
                        requirement.id,
                        digest,
                      )}
                      density="row"
                      selected={snapshot.desired.some((item) =>
                        item.reference.id === requirement.id
                      )}
                      ident={
                        <ElementIdent
                          label={requirement.name}
                          detail={requirement.metric}
                        />
                      }
                      reading={requirement.limit && requirement.operator
                        ? (
                          <ElementLimit
                            label={t("authoredLimit")}
                            operator={operatorGlyph(requirement.operator)}
                            value={formatHostNumber(
                              requirement.limit.value,
                              context.hostContext.locale,
                              { maximumSignificantDigits: 21 },
                            )}
                            unit={requirement.limit.unit}
                          />
                        )
                        : undefined}
                    />
                  </div>
                );
              })}
              <Disclosure label={t("rowIdentities")}>
                <DataTable
                  label={t("authoredRequirements")}
                  rows={data.requirements}
                  rowKey={(requirement) => requirement.id}
                  columns={[
                    {
                      id: "name",
                      label: t("requirements"),
                      render: (requirement) => requirement.name,
                    },
                    {
                      id: "metric",
                      label: t("authoredLimit"),
                      render: (requirement) =>
                        requirement.limit && requirement.operator
                          ? `${requirement.metric} ${
                            operatorGlyph(requirement.operator)
                          } ${
                            formatHostNumber(
                              requirement.limit.value,
                              context.hostContext.locale,
                              { maximumSignificantDigits: 21 },
                            )
                          } ${requirement.limit.unit}`
                          : requirement.text ?? "",
                    },
                    {
                      id: "id",
                      label: t("rootIdentity"),
                      render: (requirement) => requirement.id,
                    },
                  ]}
                />
              </Disclosure>
            </>
          )
          : <EmptyState>{t("noAuthoredRequirements")}</EmptyState>}
      </CollectionCard>
      <SelectionBasket
        context={context}
        controller={controller}
        snapshot={snapshot}
      />
    </>
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
        description: "Documentary authored limits",
      },
      ({ data, context }) => <AuthoredList data={data} context={context} />,
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
