/** Read authored requirements; absence of text, limits or coverage stays explicit. */
import type { SysonTool } from "./types.ts";
import { evalAql, getSelf } from "./aql.ts";
import { getSysonClient } from "../api/graphql-client.ts";
import { GET_PROJECT, SEARCH_ELEMENTS } from "../api/queries.ts";
import type {
  GetProjectResult,
  GqlObject,
  SearchResult,
} from "../api/types.ts";
import { constraintTools } from "./constraint.ts";
import type {
  AuthoredConstraints,
  AuthoredRequirement,
  RequirementsViewData,
} from "../viewer-data.ts";

async function optionalText(
  ecId: string,
  id: string,
  expression: string,
): Promise<string | undefined> {
  try {
    const result = await evalAql(ecId, expression, [id]);
    return result.__typename === "StringExpressionResult" &&
        result.strValue.trim()
      ? result.strValue
      : undefined;
  } catch {
    return undefined;
  }
}
export const requirementsTools: SysonTool[] = [{
  name: "syson_requirements_list",
  description:
    "List authored RequirementUsage elements in a package or project. Returns actual documentation and identifiers when available, documentary parsed limits when extractable, and explicit unknown coverage. Does not evaluate requirements or infer missing prose.",
  category: "query",
  inputSchema: {
    type: "object",
    properties: {
      editing_context_id: { type: "string" },
      root_id: { type: "string" },
      project_id: { type: "string" },
    },
    oneOf: [
      {
        required: ["editing_context_id", "root_id"],
        not: { required: ["project_id"] },
      },
      {
        required: ["project_id"],
        not: {
          anyOf: [{ required: ["editing_context_id"] }, {
            required: ["root_id"],
          }],
        },
      },
    ],
  },
  _meta: {
    ui: {
      resourceUri: "ui://mcp-syson/requirements-viewer",
      emits: ["syson.requirement.selected"],
    },
  },
  handler: async (args): Promise<RequirementsViewData> => {
    const nonempty = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;
    const isProject = args.project_id !== undefined;
    if (
      isProject
        ? !nonempty(args.project_id) || args.editing_context_id !== undefined ||
          args.root_id !== undefined
        : !nonempty(args.editing_context_id) || !nonempty(args.root_id)
    ) {
      throw new Error("Supply project_id OR editing_context_id with root_id");
    }
    let ecId: string;
    let target: { id: string; kind: string; label: string };
    let requirements: GqlObject[];
    if (isProject) {
      const client = getSysonClient();
      const data = await client.query<GetProjectResult>(GET_PROJECT, {
        projectId: args.project_id,
      });
      const project = data.viewer.project;
      if (!project?.currentEditingContext?.id) {
        throw new Error("Project has no editing context");
      }
      ecId = project.currentEditingContext.id;
      target = { id: project.id, kind: "Project", label: project.name };
      const found = await client.query<SearchResult>(SEARCH_ELEMENTS, {
        editingContextId: ecId,
        query: {
          text: ".*",
          matchCase: false,
          matchWholeWord: false,
          useRegularExpression: true,
          searchInAttributes: true,
          searchInLibraries: false,
        },
      });
      const response = found.viewer.editingContext.search;
      if ("message" in response) {
        throw new Error(`Requirements discovery failed: ${response.message}`);
      }
      if (!response.result || !Array.isArray(response.result.matches)) {
        throw new Error("Requirements discovery returned no search result");
      }
      const matches = response.result.matches;
      // Search returns concrete kinds (ConcernUsage/ViewpointUsage included).
      // Ask the metamodel once per kind rather than guessing inheritance from names.
      const allowedKinds = new Set<string>();
      for (
        const representative of new Map(
          matches.map((item) => [item.kind, item]),
        ).values()
      ) {
        const result = await evalAql(
          ecId,
          "aql:self.oclIsKindOf(sysml::RequirementUsage) and not self.oclIsKindOf(sysml::SatisfyRequirementUsage)",
          [representative.id],
        );
        if (result.__typename !== "BooleanExpressionResult") {
          throw new Error("Could not classify project requirement kinds");
        }
        if (result.boolValue) allowedKinds.add(representative.kind);
      }
      requirements = matches.filter((item) => allowedKinds.has(item.kind));
    } else {
      ecId = args.editing_context_id as string;
      const root = await getSelf(ecId, args.root_id as string);
      if (!root || root.id !== args.root_id) {
        throw new Error("Requirement scope root could not be resolved");
      }
      target = { id: root.id, kind: root.kind, label: root.label };
      const found = await evalAql(
        ecId,
        "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::RequirementUsage) and not e.oclIsKindOf(sysml::SatisfyRequirementUsage))",
        [root.id],
      );
      if (found.__typename === "ObjectsExpressionResult") {
        requirements = found.objsValue;
      } else {
        throw new Error(`Unexpected requirements result: ${found.__typename}`);
      }
    }
    const rows: AuthoredRequirement[] = [];
    const extract = constraintTools.find((tool) =>
      tool.name === "syson_constraint_extract"
    )!;
    for (
      const requirement of new Map(requirements.map((item) => [item.id, item]))
        .values()
    ) {
      // Read-only accessors probed on the audit model. Void/unsupported results
      // are unavailable, never replaced with a label or inferred authored text.
      const text = await optionalText(
        ecId,
        requirement.id,
        "aql:self.documentation->first().body",
      );
      const identifier = await optionalText(
        ecId,
        requirement.id,
        "aql:self.requirementId",
      );
      const row: AuthoredRequirement = {
        id: requirement.id,
        name: requirement.label,
        kind: requirement.kind,
        textStatus: text ? "available" : "unavailable",
        ...(text ? { text } : {}),
        identifierStatus: identifier ? "available" : "unavailable",
        ...(identifier ? { identifier } : {}),
        coverageStatus: "unknown",
        authoredConstraintsStatus: "unavailable",
      };
      try {
        row.authoredConstraints = await extract.handler({
          editing_context_id: ecId,
          element_id: requirement.id,
        }) as AuthoredConstraints;
        const errors = row.authoredConstraints.errors ?? [];
        row.authoredConstraintsStatus = errors.length
          ? "unavailable"
          : "available";
        if (errors.length) {
          row.authoredConstraintsError = errors.map((error) =>
            `${error.name || error.id}: ${error.error}`
          ).join("; ");
        }
        // Only an explicit numeric comparison can become a displayed limit.
        const expr = errors.length === 0 &&
            row.authoredConstraints.constraints.length === 1
          ? row.authoredConstraints.constraints[0].expression
          : undefined;
        if (
          expr?.kind === "binary" &&
          ["<", "<=", ">", ">=", "=="].includes(expr.op) &&
          expr.left.kind === "ref" && expr.left.featurePath.length > 0 &&
          expr.right.kind === "literal" && Number.isFinite(expr.right.value)
        ) {
          row.metric = expr.left.featurePath.join(".");
          row.operator = expr.op;
          row.limit = { value: expr.right.value, unit: expr.right.unit ?? "" };
        }
      } catch (error) {
        row.authoredConstraintsError = error instanceof Error
          ? error.message
          : String(error);
      }
      rows.push(row);
    }
    return {
      kind: "live-requirements",
      rootId: target.id,
      editingContextId: ecId,
      scope: isProject
        ? { kind: "project", projectId: target.id, editingContextId: ecId }
        : { kind: "element", rootId: target.id, editingContextId: ecId },
      target,
      requirements: rows,
      count: rows.length,
    };
  },
}];
