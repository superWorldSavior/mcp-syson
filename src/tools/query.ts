/**
 * SysON Query Tools
 *
 * AQL queries, full-text search, and model traversal.
 * Uses evaluateExpression mutation (not queryBasedObjects which returns null in current SysON).
 *
 * @module lib/syson/tools/query
 */

import type { SysonTool } from "./types.ts";
import { getSysonClient } from "../api/graphql-client.ts";
import { SEARCH_ELEMENTS } from "../api/queries.ts";
import { evalAql, getChildren, getSelf } from "./aql.ts";
import type { GqlObject, SearchResult } from "../api/types.ts";
import { normalizeKind } from "../constraints/ast-parser.ts";
import { readAttributeValue } from "../constraints/resolver.ts";
import { constraintTools } from "./constraint.ts";

// ============================================================================
// syson_part_structure — product breakdown traversal
// ============================================================================

/** A numeric attribute read off a part; `value: null` means present but unvalued. */
interface PartAttribute {
  name: string;
  value: number | null;
}

/** One node of the part hierarchy. Root itself is not a PartNode — see below. */
interface PartNode {
  id: string;
  label: string;
  kind: string;
  quantity: number;
  quantitySource: "model" | "sysml-default";
  attributes?: PartAttribute[];
  children: PartNode[];
}

/** A flattened row of the tree with the path-multiplied quantity. */
interface FlatEntry {
  path: string;
  id: string;
  label: string;
  quantity: number;
  effectiveQuantity: number;
}

interface TraversalState {
  partCount: number;
  maxDepthReached: boolean;
}

const DEFAULT_MULTIPLICITY = {
  quantity: 1,
  quantitySource: "sysml-default" as const,
};

/**
 * Read a PartUsage's multiplicity as a plain count.
 *
 * SysML's own default multiplicity is 1 when none is declared — that is not
 * a guess this tool makes, so it is reported as `quantitySource:
 * "sysml-default"` rather than silently presented the same as a value read
 * from the model. Any failure along the way (no multiplicity object, no
 * LiteralInteger among its descendants, an AQL error) collapses to the same
 * labelled default — the caller can always tell a modelled quantity from
 * SysML's fallback.
 */
async function readMultiplicity(
  ecId: string,
  elementId: string,
): Promise<{ quantity: number; quantitySource: "model" | "sysml-default" }> {
  try {
    const multResult = await evalAql(ecId, "aql:self.multiplicity", [
      elementId,
    ]);
    if (multResult.__typename !== "ObjectExpressionResult") {
      return DEFAULT_MULTIPLICITY;
    }

    const literalResult = await evalAql(
      ecId,
      "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::LiteralInteger))->first()",
      [multResult.objValue.id],
    );
    if (literalResult.__typename !== "ObjectExpressionResult") {
      return DEFAULT_MULTIPLICITY;
    }

    const valueResult = await evalAql(
      ecId,
      "aql:self.oclAsType(sysml::LiteralInteger).value.toString()",
      [literalResult.objValue.id],
    );

    if (valueResult.__typename === "StringExpressionResult") {
      const parsed = parseInt(valueResult.strValue, 10);
      return isNaN(parsed)
        ? DEFAULT_MULTIPLICITY
        : { quantity: parsed, quantitySource: "model" };
    }
    if (valueResult.__typename === "IntExpressionResult") {
      return { quantity: valueResult.intValue, quantitySource: "model" };
    }
    return DEFAULT_MULTIPLICITY;
  } catch {
    return DEFAULT_MULTIPLICITY;
  }
}

/**
 * Read the numeric AttributeUsage children of a part. An attribute without a
 * resolvable numeric literal is still reported, with `value: null` — it
 * exists on the model and hiding it would look like the model has less on
 * it than it does.
 */
async function readPartAttributes(
  ecId: string,
  kids: GqlObject[],
): Promise<PartAttribute[] | undefined> {
  const attributeKids = kids.filter((k) =>
    normalizeKind(k.kind).includes("AttributeUsage")
  );
  if (attributeKids.length === 0) return undefined;

  const attributes: PartAttribute[] = [];
  for (const kid of attributeKids) {
    const reading = await readAttributeValue(ecId, kid.id);
    attributes.push({ name: kid.label, value: reading?.value ?? null });
  }
  return attributes;
}

/**
 * Build one PartNode and recurse into its PartUsage children, up to
 * `maxDepth`. Sequential (not Promise.all) so callers get a deterministic
 * AQL call order — this traversal is already the slow path of the tool, and
 * predictability matters more here than shaving round-trips.
 */
async function buildPartNode(
  ecId: string,
  obj: GqlObject,
  depth: number,
  maxDepth: number,
  includeAttributes: boolean,
  state: TraversalState,
): Promise<PartNode> {
  state.partCount++;

  const { quantity, quantitySource } = await readMultiplicity(ecId, obj.id);
  const kids = await getChildren(ecId, obj.id);

  const node: PartNode = {
    id: obj.id,
    label: obj.label,
    kind: obj.kind,
    quantity,
    quantitySource,
    children: [],
  };

  if (includeAttributes) {
    const attributes = await readPartAttributes(ecId, kids);
    if (attributes) node.attributes = attributes;
  }

  const partKids = kids.filter((k) =>
    normalizeKind(k.kind).includes("PartUsage")
  );

  if (depth < maxDepth) {
    for (const kid of partKids) {
      node.children.push(
        await buildPartNode(
          ecId,
          kid,
          depth + 1,
          maxDepth,
          includeAttributes,
          state,
        ),
      );
    }
  } else if (partKids.length > 0) {
    // Truncated here — never silently, the caller sees maxDepthReached.
    state.maxDepthReached = true;
  }

  return node;
}

/** Flatten the tree into rows with quantities multiplied along the path. */
function flattenTree(
  nodes: PartNode[],
  parentPath: string[],
  parentEffectiveQuantity: number,
): FlatEntry[] {
  const entries: FlatEntry[] = [];
  for (const node of nodes) {
    const path = [...parentPath, node.label];
    const effectiveQuantity = parentEffectiveQuantity * node.quantity;
    entries.push({
      path: path.join("."),
      id: node.id,
      label: node.label,
      quantity: node.quantity,
      effectiveQuantity,
    });
    entries.push(...flattenTree(node.children, path, effectiveQuantity));
  }
  return entries;
}

export const queryTools: SysonTool[] = [
  {
    name: "syson_query_aql",
    description:
      "Run an AQL query on a model element. The most powerful query tool — " +
      "can read any property, filter by type, traverse relationships. " +
      "Common expressions: " +
      "'aql:self.ownedElement' (direct children), " +
      "'aql:self.eAllContents()' (all descendants), " +
      "'aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::PartUsage))' (filter by type). " +
      "Can also mutate the model (e.g., eSet to change properties).",
    category: "query",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        object_id: {
          type: "string",
          description: "ID of the element to query on (the 'self' in AQL)",
        },
        expression: {
          type: "string",
          description:
            "AQL expression starting with 'aql:'. E.g. 'aql:self.ownedElement', " +
            "'aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::RequirementUsage))'",
        },
      },
      required: ["editing_context_id", "object_id", "expression"],
    },
    handler: async ({ editing_context_id, object_id, expression }) => {
      const ecId = editing_context_id as string;
      const objId = object_id as string;
      const expr = expression as string;

      const exprResult = await evalAql(ecId, expr, [objId]);

      switch (exprResult.__typename) {
        case "ObjectExpressionResult":
          return {
            objectId: objId,
            expression: expr,
            type: "object",
            result: {
              id: exprResult.objValue.id,
              kind: exprResult.objValue.kind,
              label: exprResult.objValue.label,
            },
          };
        case "ObjectsExpressionResult":
          return {
            objectId: objId,
            expression: expr,
            type: "objects",
            results: exprResult.objsValue.map((o) => ({
              id: o.id,
              kind: o.kind,
              label: o.label,
            })),
            count: exprResult.objsValue.length,
          };
        case "StringExpressionResult":
          return {
            objectId: objId,
            expression: expr,
            type: "string",
            result: exprResult.strValue,
          };
        case "BooleanExpressionResult":
          return {
            objectId: objId,
            expression: expr,
            type: "boolean",
            result: exprResult.boolValue,
          };
        case "IntExpressionResult":
          return {
            objectId: objId,
            expression: expr,
            type: "int",
            result: exprResult.intValue,
          };
        case "VoidExpressionResult":
          return {
            objectId: objId,
            expression: expr,
            type: "void",
            result: null,
          };
        default:
          return {
            objectId: objId,
            expression: expr,
            type: "unknown",
            result: exprResult,
          };
      }
    },
  },

  {
    name: "syson_search",
    description: "Full-text search across all elements in a project. " +
      "Find elements by name or content. Supports regex.",
    category: "query",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        text: {
          type: "string",
          description: "Search text",
        },
        match_case: {
          type: "boolean",
          description: "Case-sensitive search. Default: false",
        },
        whole_word: {
          type: "boolean",
          description: "Match whole words only. Default: false",
        },
        use_regex: {
          type: "boolean",
          description: "Treat search text as regex. Default: false",
        },
      },
      required: ["editing_context_id", "text"],
    },
    _meta: {
      ui: {
        resourceUri: "ui://mcp-syson/query-results-viewer",
        emits: ["syson.element.selected"],
      },
    },
    handler: async (
      { editing_context_id, text, match_case, whole_word, use_regex },
    ) => {
      const client = getSysonClient();

      const data = await client.query<SearchResult>(SEARCH_ELEMENTS, {
        editingContextId: editing_context_id as string,
        query: {
          text: text as string,
          matchCase: (match_case as boolean) ?? false,
          matchWholeWord: (whole_word as boolean) ?? false,
          useRegularExpression: (use_regex as boolean) ?? false,
          searchInAttributes: true,
          searchInLibraries: false,
        },
      });

      const searchResponse = data.viewer.editingContext.search;

      // Check for error
      if ("message" in searchResponse) {
        throw new Error(`[lib/syson] Search failed: ${searchResponse.message}`);
      }

      const matches = searchResponse.result?.matches ?? [];
      const results = matches.map((m) => ({
        id: m.id,
        kind: m.kind,
        label: m.label,
        iconURLs: m.iconURLs ?? [],
      }));
      return {
        query: text,
        results,
        count: results.length,
      };
    },
  },

  {
    name: "syson_query_eval",
    description: "Evaluate an AQL expression on multiple elements at once. " +
      "Like syson_query_aql but accepts an array of object IDs as context. " +
      "Use when you need to query across multiple elements simultaneously.",
    category: "query",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        expression: {
          type: "string",
          description: "AQL expression to evaluate (e.g. 'aql:self.name')",
        },
        selected_object_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of selected objects (context for the expression)",
        },
      },
      required: ["editing_context_id", "expression", "selected_object_ids"],
    },
    _meta: {
      ui: {
        resourceUri: "ui://mcp-syson/query-results-viewer",
        emits: ["syson.element.selected"],
      },
    },
    handler: async (
      { editing_context_id, expression, selected_object_ids },
    ) => {
      const expr = expression as string;
      const selectedIds = selected_object_ids as string[];
      // SysON binds self to only the first selected object. An identity-set
      // reproducer must resolve every identity explicitly rather than claiming
      // the upstream scalar is the complete selection.
      if (expr.trim() === "aql:self" && selectedIds.length > 1) {
        const results: Array<{ id: string; kind: string; label: string }> = [];
        for (const id of new Set(selectedIds)) {
          const element = await getSelf(editing_context_id as string, id);
          if (!element || element.id !== id) {
            throw new Error(`Selected element could not be resolved: ${id}`);
          }
          results.push({
            id: element.id,
            kind: element.kind,
            label: element.label,
          });
        }
        return {
          type: "objects",
          expression: expr,
          results,
          count: results.length,
        };
      }
      const exprResult = await evalAql(
        editing_context_id as string,
        expr,
        selectedIds,
      );

      switch (exprResult.__typename) {
        case "ObjectExpressionResult":
          return {
            type: "object",
            expression: expr,
            result: {
              id: exprResult.objValue.id,
              kind: exprResult.objValue.kind,
              label: exprResult.objValue.label,
            },
          };
        case "ObjectsExpressionResult":
          return {
            type: "objects",
            expression: expr,
            results: exprResult.objsValue.map((o) => ({
              id: o.id,
              kind: o.kind,
              label: o.label,
            })),
            count: exprResult.objsValue.length,
          };
        case "StringExpressionResult":
          return {
            type: "string",
            expression: expr,
            result: exprResult.strValue,
          };
        case "BooleanExpressionResult":
          return {
            type: "boolean",
            expression: expr,
            result: exprResult.boolValue,
          };
        case "IntExpressionResult":
          return { type: "int", expression: expr, result: exprResult.intValue };
        case "VoidExpressionResult":
          return { type: "void", expression: expr, result: null };
      }
    },
  },

  {
    name: "syson_query_requirements_trace",
    description:
      "Trace requirements to explicit satisfying features within the requested root. " +
      "Returns satisfaction relationship provenance and link coverage (not validation). " +
      "Includes documentary authored constraints for the first 10 requirements; " +
      "relationships outside the root are outside this query scope.",
    category: "query",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        root_id: {
          type: "string",
          description: "Root element ID to search requirements from",
        },
      },
      required: ["editing_context_id", "root_id"],
    },
    _meta: {
      ui: {
        resourceUri: "ui://mcp-syson/requirements-trace-viewer",
        emits: ["syson.requirement.selected"],
      },
    },
    handler: async ({ editing_context_id, root_id }) => {
      const ecId = editing_context_id as string;
      const rootId = root_id as string;

      // Find all RequirementUsage elements via evaluateExpression
      const reqResult = await evalAql(
        ecId,
        "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::RequirementUsage) and not e.oclIsKindOf(sysml::SatisfyRequirementUsage))",
        [rootId],
      );

      if (reqResult.__typename !== "ObjectsExpressionResult") {
        return {
          rootId,
          requirementsCount: 0,
          traces: [],
          coverage: {
            total: 0,
            satisfied: 0,
            unsatisfied: 0,
            percentage: 0,
          },
          error: `Unexpected result type: ${reqResult.__typename}`,
        };
      }

      const requirements = reqResult.objsValue;

      // SysON v2026.7.0: SatisfyRequirementUsage is a relationship usage,
      // not its satisfying part. Its derived accessors are implemented here:
      // https://github.com/eclipse-syson/syson/blob/v2026.7.0/backend/metamodel/syson-sysml-metamodel/src/main/java/org/eclipse/syson/sysml/impl/SatisfyRequirementUsageImpl.java
      // Search throughout the requested root, since the relationship can be
      // owned by a satisfying feature rather than by the requirement.
      type Identity = { id: string; label: string; kind: string };
      type SatisfactionLink = {
        relationship: Identity;
        targets: Identity[];
        status: "resolved" | "unresolved";
        error?: string;
      };
      const linksByRequirement = new Map<string, SatisfactionLink[]>();
      let discoveryError: string | undefined;
      const identity = ({ id, label, kind }: GqlObject): Identity => ({
        id,
        label,
        kind,
      });
      const readObjects = async (
        id: string,
        expression: string,
        allowAbsent = false,
      ): Promise<GqlObject[]> => {
        const result = await evalAql(ecId, expression, [id]);
        if (result.__typename === "ObjectsExpressionResult") {
          return result.objsValue;
        }
        if (result.__typename === "ObjectExpressionResult") {
          return [result.objValue];
        }
        if (allowAbsent && result.__typename === "VoidExpressionResult") {
          return [];
        }
        throw new Error(`Unexpected relationship result: ${result.__typename}`);
      };
      try {
        const relationships = await readObjects(
          rootId,
          "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::SatisfyRequirementUsage))",
        );
        for (const relationship of relationships) {
          // Without its requirement identity the relationship cannot safely be
          // attributed to any row; keep the entire scoped discovery unresolved.
          const referenced = await readObjects(
            relationship.id,
            "aql:self.satisfiedRequirement",
            true,
          );
          if (referenced.length !== 1) {
            throw new Error(
              "Could not resolve a satisfaction relationship's requirement",
            );
          }
          const requirementId = referenced[0].id;
          if (
            !requirements.some((requirement) =>
              requirement.id === requirementId
            )
          ) continue;
          let link: SatisfactionLink;
          try {
            const targets =
              (await readObjects(relationship.id, "aql:self.satisfyingFeature"))
                .map(identity);
            link = targets.length
              ? {
                relationship: identity(relationship),
                targets,
                status: "resolved",
              }
              : {
                relationship: identity(relationship),
                targets: [],
                status: "unresolved",
                error:
                  "Satisfaction relationship has no explicit satisfying feature",
              };
          } catch (error) {
            link = {
              relationship: identity(relationship),
              targets: [],
              status: "unresolved",
              error: error instanceof Error ? error.message : String(error),
            };
          }
          const links = linksByRequirement.get(requirementId) ?? [];
          links.push(link);
          linksByRequirement.set(requirementId, links);
        }
      } catch (error) {
        discoveryError = `Could not resolve satisfy relationships: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
      const traces = requirements.map((requirement) => {
        const satisfactionLinks = linksByRequirement.get(requirement.id) ?? [];
        const satisfiedBy = [
          ...new Map(
            satisfactionLinks.flatMap((link) => link.targets).map((
              target,
            ) => [target.id, target]),
          ).values(),
        ];
        const unresolved = satisfactionLinks.find((link) =>
          link.status === "unresolved"
        );
        const error = discoveryError ?? unresolved?.error;
        return {
          requirement: { id: requirement.id, label: requirement.label },
          satisfiedBy,
          satisfactionLinks,
          ...(error ? { error } : {}),
        };
      });

      // Documentary extraction only: never resolve measurements or evaluate a limit.
      // Cap enrichment independently of coverage; larger results remain navigable.
      const extract = constraintTools.find((tool) =>
        tool.name === "syson_constraint_extract"
      )!;
      const enrichedTraces = [];
      for (const [index, trace] of traces.entries()) {
        if (index >= 10) {
          enrichedTraces.push({
            ...trace,
            authoredConstraintsStatus: "not-requested",
          });
          continue;
        }
        try {
          const authoredConstraints = await extract.handler({
            editing_context_id: ecId,
            element_id: trace.requirement.id,
          });
          enrichedTraces.push({
            ...trace,
            authoredConstraintsStatus: "available",
            authoredConstraints,
          });
        } catch (error) {
          enrichedTraces.push({
            ...trace,
            authoredConstraintsStatus: "unavailable",
            authoredConstraintsError: error instanceof Error
              ? error.message
              : String(error),
          });
        }
      }

      // A partial relationship read remains unresolved even when another link
      // has an explicit target. Match the viewer's conservative row status.
      const satisfied =
        traces.filter((trace) =>
          trace.error === undefined && trace.satisfiedBy.length > 0
        ).length;
      const total = requirements.length;
      const unsatisfied = total - satisfied;

      return {
        rootId,
        requirementsCount: total,
        traces: enrichedTraces,
        coverage: {
          total,
          satisfied,
          unsatisfied,
          percentage: total > 0 ? Math.round((satisfied / total) * 100) : 0,
        },
      };
    },
  },

  {
    name: "syson_part_structure",
    description:
      "Derive the product breakdown structure (parts, hierarchy, quantities, " +
      "numeric attributes) from a SysML v2 model. Structure only — no prices, " +
      "no inferred materials. Costing belongs to the ERP: feed this tool's " +
      "output to erpnext_doc_create with doctype 'BOM' for actual costs.",
    category: "query",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        root_element_id: {
          type: "string",
          description:
            "Root element ID to derive the structure from (a package or a part)",
        },
        max_depth: {
          type: "number",
          description: "Maximum recursion depth into nested parts. Default: 10",
        },
        include_attributes: {
          type: "boolean",
          description:
            "Include each part's numeric AttributeUsage children (value: null when " +
            "present but unvalued). Default: true",
        },
        flatten: {
          type: "boolean",
          description:
            "Also return a flat list with quantities multiplied along each part's " +
            "path. Default: false",
        },
      },
      required: ["editing_context_id", "root_element_id"],
    },
    handler: async (args) => {
      const ecId = args.editing_context_id as string;
      const rootId = args.root_element_id as string;
      const maxDepth = (args.max_depth as number | undefined) ?? 10;
      const includeAttributes =
        (args.include_attributes as boolean | undefined) ?? true;
      const flatten = (args.flatten as boolean | undefined) ?? false;

      const rootObj = await getSelf(ecId, rootId);
      if (!rootObj) {
        throw new Error(
          `[lib/syson] syson_part_structure: element ${rootId} not found in editing context ${ecId}`,
        );
      }

      const rootChildren = await getChildren(ecId, rootId);
      const partChildren = rootChildren.filter((c) =>
        normalizeKind(c.kind).includes("PartUsage")
      );

      const state: TraversalState = { partCount: 0, maxDepthReached: false };
      const tree: PartNode[] = [];

      if (maxDepth >= 1) {
        for (const child of partChildren) {
          tree.push(
            await buildPartNode(
              ecId,
              child,
              1,
              maxDepth,
              includeAttributes,
              state,
            ),
          );
        }
      } else if (partChildren.length > 0) {
        state.maxDepthReached = true;
      }

      const result: Record<string, unknown> = {
        root: { id: rootObj.id, label: rootObj.label, kind: rootObj.kind },
        tree,
        partCount: state.partCount,
        maxDepthReached: state.maxDepthReached,
      };

      if (flatten) {
        result.flat = flattenTree(tree, [], 1);
      }

      return result;
    },
  },
];
