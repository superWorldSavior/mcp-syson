/**
 * SysON Element Tools
 *
 * CRUD operations on SysML v2 elements (PartUsage, RequirementUsage, Package, etc.)
 * Rename uses AQL eSet(declaredName) via evaluateExpression (renameTreeItem requires representationId).
 * Children listing uses evaluateExpression (queryBasedObjects returns null in current SysON).
 *
 * @module lib/syson/tools/element
 */

import type { StructuredToolResult } from "@casys/mcp-server";
import type { SysonTool } from "./types.ts";
import { getSysonClient } from "../api/graphql-client.ts";
import { GET_CHILD_CREATION_DESCRIPTIONS, GET_OBJECT } from "../api/queries.ts";
import { CREATE_CHILD, INSERT_TEXTUAL_SYSMLV2 } from "../api/mutations.ts";
import {
  getSysonRestClient,
  isSysonUuid,
  resolveProjectId,
  type SysonRestClient,
} from "../api/rest-client.ts";
import { aqlEscape, evalAql, getChildren } from "./aql.ts";
import type {
  CreateChildResult,
  GetChildCreationDescriptionsResult,
  GetObjectResult,
  InsertTextualSysMLv2Result,
} from "../api/types.ts";

/**
 * Extract mutation result, throwing on ErrorPayload.
 */
function unwrapMutation<T extends object>(
  result: T,
  operationName: string,
): Record<string, unknown> {
  const payload = Object.values(result)[0] as Record<string, unknown>;
  if (payload?.__typename === "ErrorPayload") {
    throw new Error(
      `[lib/syson] ${operationName} failed: ${
        (payload as { message: string }).message
      }`,
    );
  }
  return payload;
}

/**
 * Rename an element using AQL eSet on declaredName.
 *
 * This is the only headless-compatible route because renameTreeItem requires a
 * Sirius tree representation. It deliberately bypasses Sirius Web's normal
 * command/event pipeline, though: editor-side subscribers or undo state may
 * not observe it as they would a UI rename. The write is known to work, but
 * that integration risk remains until SysON exposes an equivalent REST write.
 */
async function renameViaAql(
  ecId: string,
  elementId: string,
  newName: string,
): Promise<void> {
  await evalAql(
    ecId,
    `aql:self.eSet(self.eClass().getEStructuralFeature('declaredName'), '${
      aqlEscape(newName)
    }')`,
    [elementId],
  );
}

export interface ElementInsertSysmlOutput extends Record<string, unknown> {
  inserted: true;
  parentId: string;
  text: string;
  acknowledged: true;
  semanticCompleteness: "unverified";
}

/** Closed wire contract for a successful textual SysML insertion. */
export const elementInsertSysmlOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    inserted: { type: "boolean", const: true },
    parentId: { type: "string" },
    text: { type: "string" },
    acknowledged: { type: "boolean", const: true },
    semanticCompleteness: { type: "string", const: "unverified" },
  },
  required: [
    "inserted",
    "parentId",
    "text",
    "acknowledged",
    "semanticCompleteness",
  ],
};

/** Closed MCP output contract for an exact SysON element read. */
export const elementGetOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    kind: { type: "string" },
    label: { type: "string" },
    iconURLs: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["id", "kind", "label", "iconURLs"],
};

/** Expose mutation evidence natively while keeping model-facing text concise. */
export function toElementInsertSysmlResult(
  value: unknown,
): StructuredToolResult {
  const insertion = value as ElementInsertSysmlOutput;
  return {
    content:
      `SysON acknowledged a textual insertion request under ${insertion.parentId}; semantic completeness is unverified.`,
    structuredContent: insertion,
  };
}

function elementDeleteError(
  code: string,
  message: string,
  context: Record<string, unknown>,
  recovery: string,
  retryable: boolean,
  reviewRequired: boolean,
): Error {
  return Object.assign(new Error(message), {
    code,
    context,
    recovery,
    retryable,
    reviewRequired,
  });
}

function responseSnippet(body: string): string {
  return body.slice(0, 200);
}

function parseJson(body: string): unknown | undefined {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function commitIdFromRestValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as Record<string, unknown>)["@id"];
  return isSysonUuid(id) ? id : undefined;
}

/**
 * Find a current commit only when the REST endpoint says so unambiguously.
 *
 * SysON 2026.7.0 returned one commit in probes, but other projects have
 * returned HTTP 404 for this endpoint. Its list payload does not designate a
 * head when multiple commits exist, so a project ID, default branch ID, or an
 * arbitrary list item would be an invented convention. Deletion therefore
 * stops before dispatch unless exactly one usable commit is returned.
 */
async function resolveCurrentCommitId(
  restClient: SysonRestClient,
  projectId: string,
): Promise<string> {
  let response: Response;
  try {
    response = await restClient.get(`/api/rest/projects/${projectId}/commits`);
  } catch (error) {
    throw elementDeleteError(
      "SYSON_DELETE_PRECONDITION_FAILED",
      `[syson_element_delete] current-commit lookup failed: ${
        (error as Error).message
      }`,
      { projectId },
      "Restore SysON connectivity and retry; no delete was dispatched.",
      true,
      false,
    );
  }

  const body = await response.text().catch(() => "");
  if (response.status !== 200) {
    throw elementDeleteError(
      "SYSON_DELETE_PRECONDITION_FAILED",
      `[syson_element_delete] cannot resolve a current commit (HTTP ${response.status})`,
      {
        projectId,
        httpStatus: response.status,
        responseSnippet: responseSnippet(body),
      },
      "Do not assume projectId is a commitId. Retry only after SysON exposes one current commit.",
      response.status >= 500,
      false,
    );
  }

  const commits = parseJson(body);
  if (!Array.isArray(commits) || commits.length !== 1) {
    throw elementDeleteError(
      "SYSON_DELETE_PRECONDITION_FAILED",
      "[syson_element_delete] current-commit lookup was missing or ambiguous",
      {
        projectId,
        commitCount: Array.isArray(commits) ? commits.length : undefined,
        responseSnippet: responseSnippet(body),
      },
      "Do not choose a commit by convention; obtain an unambiguous current commit before deleting.",
      false,
      false,
    );
  }

  const commitId = commitIdFromRestValue(commits[0]);
  if (!commitId) {
    throw elementDeleteError(
      "SYSON_DELETE_PRECONDITION_FAILED",
      "[syson_element_delete] current-commit lookup returned no usable @id",
      { projectId, responseSnippet: responseSnippet(body) },
      "Do not construct a commit URL from a project ID; fix the SysON commit response first.",
      false,
      false,
    );
  }

  return commitId;
}

export const elementTools: SysonTool[] = [
  {
    name: "syson_element_create",
    description:
      "Create a single SysML element under a parent (e.g., PartUsage, Package). " +
      "Pass an exact child creation-description ID or exact label like 'New PartUsage'. " +
      "Ambiguous labels are rejected rather than selecting an arbitrary type. " +
      "For bulk creation or complex structures, prefer syson_element_insert_sysml instead.",
    category: "element",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        parent_id: {
          type: "string",
          description: "ID of the parent element",
        },
        child_type: {
          type: "string",
          description:
            "Child creation description ID or label (e.g. 'New PartUsage', 'New Package')",
        },
        name: {
          type: "string",
          description:
            "Name for the new element (renames after creation via AQL)",
        },
      },
      required: ["editing_context_id", "parent_id", "child_type"],
    },
    handler: async ({ editing_context_id, parent_id, child_type, name }) => {
      const ecId = editing_context_id as string;
      const parentId = parent_id as string;
      const childTypeInput = child_type as string;

      if (
        typeof childTypeInput !== "string" || childTypeInput.trim().length === 0
      ) {
        throw Object.assign(
          new Error(
            "[lib/syson] syson_element_create: child_type must be non-empty",
          ),
          {
            code: "SYSON_ELEMENT_CREATE_CHILD_TYPE_NOT_FOUND",
            context: { childType: child_type, parentId },
            recovery:
              "Call syson_model_child_types and pass one returned ID or exact label.",
            retryable: false,
            reviewRequired: false,
          },
        );
      }

      const client = getSysonClient();

      // Resolve child_type deterministically. A child creation description is
      // contextual and its list grows with SysON extensions; substring matching
      // could silently create a different SysML element after such a change.
      let descriptionId = childTypeInput;
      if (!isSysonUuid(childTypeInput as unknown)) {
        const descriptions = await client.query<
          GetChildCreationDescriptionsResult
        >(
          GET_CHILD_CREATION_DESCRIPTIONS,
          { editingContextId: ecId, containerId: parentId },
        );

        const normalizedInput = childTypeInput.trim().toLowerCase();
        const matches = descriptions.viewer.editingContext
          .childCreationDescriptions.filter(
            (d) =>
              d.id === childTypeInput ||
              d.label.trim().toLowerCase() === normalizedInput,
          );

        if (matches.length === 0) {
          const available = descriptions.viewer.editingContext
            .childCreationDescriptions
            .map((d) => d.label)
            .join(", ");
          throw Object.assign(
            new Error(
              `[lib/syson] syson_element_create: No exact child type matching '${childTypeInput}'. ` +
                `Available: ${available}`,
            ),
            {
              code: "SYSON_ELEMENT_CREATE_CHILD_TYPE_NOT_FOUND",
              context: { childType: childTypeInput, parentId },
              recovery:
                "Call syson_model_child_types and pass one returned ID or exact label.",
              retryable: false,
              reviewRequired: false,
            },
          );
        }

        if (matches.length > 1) {
          throw Object.assign(
            new Error(
              `[lib/syson] syson_element_create: Child type '${childTypeInput}' is ambiguous.`,
            ),
            {
              code: "SYSON_ELEMENT_CREATE_CHILD_TYPE_AMBIGUOUS",
              context: {
                childType: childTypeInput,
                parentId,
                matchingDescriptions: matches.map((d) => ({
                  id: d.id,
                  label: d.label,
                })),
              },
              recovery:
                "Pass the exact child creation-description ID returned by syson_model_child_types.",
              retryable: false,
              reviewRequired: false,
            },
          );
        }
        descriptionId = matches[0].id;
      }

      // Create the child element
      const mutationId = crypto.randomUUID();
      const data = await client.mutate<CreateChildResult>(CREATE_CHILD, {
        input: {
          id: mutationId,
          editingContextId: ecId,
          objectId: parentId,
          childCreationDescriptionId: descriptionId,
        },
      });

      const payload = unwrapMutation(data, "createChild");
      const element =
        (payload as { object: { id: string; kind: string; label: string } })
          .object;

      const result: Record<string, unknown> = {
        id: element.id,
        kind: element.kind,
        label: element.label,
      };

      // Rename if name provided — uses AQL eSet(declaredName)
      if (name) {
        try {
          await renameViaAql(ecId, element.id, name as string);
          result.label = name;
        } catch (renameError) {
          console.error(
            `[lib/syson] Warning: element created but rename failed: ${
              (renameError as Error).message
            }`,
          );
          result.renameWarning = (renameError as Error).message;
        }
      }

      return result;
    },
  },

  {
    name: "syson_element_get",
    description:
      "Get a single element by ID. Returns its kind, label, and type.",
    category: "element",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        element_id: {
          type: "string",
          description: "Element UUID",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    outputSchema: elementGetOutputSchema,
    handler: async ({ editing_context_id, element_id }) => {
      // GET /api/rest/projects/{project}/commits/{commit}/elements/{element}
      // exists, but deliberately does not replace this query. Live probing
      // showed that REST returns a semantic @id distinct from the Sirius object
      // ID supplied to this tool, a semantic @type instead of the UI kind, and
      // no iconURLs. Those losses would break consumers that feed this result
      // into the other GraphQL/Sirius tools, so GraphQL remains the more
      // expressive contract here.
      const client = getSysonClient();
      const data = await client.query<GetObjectResult>(GET_OBJECT, {
        editingContextId: editing_context_id as string,
        objectId: element_id as string,
      });

      const obj = data.viewer.editingContext.object;
      return {
        id: obj.id,
        kind: obj.kind,
        label: obj.label,
        iconURLs: obj.iconURLs ?? [],
      };
    },
  },

  {
    name: "syson_element_children",
    description:
      "List direct children of an element. Use to browse the model tree. " +
      "Returns ID, kind, and label for each child. " +
      "Start from the root package ID (from syson_model_create) and drill down.",
    category: "element",
    _meta: {
      ui: {
        resourceUri: "ui://mcp-syson/model-explorer-viewer",
        emits: ["syson.element.selected"],
      },
    },
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        element_id: {
          type: "string",
          description: "Parent element UUID",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    handler: async ({ editing_context_id, element_id }) => {
      const children = await getChildren(
        editing_context_id as string,
        element_id as string,
      );

      return {
        parentId: element_id,
        editingContextId: editing_context_id,
        children: children.map((obj) => ({
          id: obj.id,
          kind: obj.kind,
          label: obj.label,
        })),
        count: children.length,
      };
    },
  },

  {
    name: "syson_element_rename",
    description: "Rename an element in the model.",
    category: "element",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        element_id: {
          type: "string",
          description: "Element UUID to rename",
        },
        new_name: {
          type: "string",
          description: "New name for the element",
        },
      },
      required: ["editing_context_id", "element_id", "new_name"],
    },
    handler: async ({ editing_context_id, element_id, new_name }) => {
      await renameViaAql(
        editing_context_id as string,
        element_id as string,
        new_name as string,
      );
      return { id: element_id, newName: new_name };
    },
  },

  {
    name: "syson_element_delete",
    description:
      "Delete an element and all its children via the SysML v2 REST API. " +
      "Irreversible. Returns only after the deletion is confirmed by a GET 404.",
    category: "element",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        element_id: {
          type: "string",
          description: "Element UUID to delete",
        },
        representation_id: {
          type: "string",
          description:
            "Deprecated — no longer used. Kept for backward compatibility only. " +
            "The previous implementation passed this to the Sirius Web deleteTreeItem " +
            "mutation, which required a live tree representation with a WebSocket " +
            "subscription; that tool was broken in headless contexts. The current " +
            "implementation uses the stateless SysML v2 REST API instead.",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    handler: async ({ editing_context_id, element_id }) => {
      /**
       * Why REST and not deleteTreeItem (GraphQL):
       * deleteTreeItem is a Sirius Web UI mutation that drives the tree explorer
       * widget. It requires a representationId pointing to a live, WebSocket-backed
       * tree representation. In a headless MCP context no such representation exists,
       * so the mutation always failed ("No representation event processor found").
       *
       * The OMG SysML v2 REST API (POST /api/rest/projects/{id}/commits with a
       * DataVersion whose payload is omitted) is stateless, requires no subscription,
       * and is verifiable by a GET on the same resource. Sonde-verified 2026-08-10.
       */

      const ecId = editing_context_id as string;
      const elemId = element_id as string;

      // 1. Fail fast: validate inputs before any network call.
      if (!isSysonUuid(ecId) || !isSysonUuid(elemId)) {
        throw elementDeleteError(
          "SYSON_DELETE_PRECONDITION_FAILED",
          "[syson_element_delete] editing_context_id and element_id must be non-empty UUIDs",
          { editingContextId: ecId, elementId: elemId },
          "Pass valid UUID values for both parameters.",
          false,
          false,
        );
      }

      let gqlClient: ReturnType<typeof getSysonClient>;
      let restClient: SysonRestClient;
      try {
        gqlClient = getSysonClient();
        restClient = getSysonRestClient();
      } catch (error) {
        throw elementDeleteError(
          "SYSON_DELETE_PRECONDITION_FAILED",
          `[syson_element_delete] client configuration failed: ${
            (error as Error).message
          }`,
          { editingContextId: ecId, elementId: elemId },
          "Configure SYSON_URL and retry; no delete was dispatched.",
          false,
          false,
        );
      }

      // 2. Resolve editingContextId → projectId (GraphQL scan, fail-closed).
      let projectId: string;
      try {
        projectId = await resolveProjectId(gqlClient, ecId);
      } catch (err) {
        const typedError = err as { code?: unknown } | null;
        if (
          typedError && typeof typedError.code === "string" &&
          typedError.code.startsWith("SYSON_DELETE_")
        ) {
          throw err; // already a typed error from resolveProjectId
        }
        throw elementDeleteError(
          "SYSON_DELETE_PRECONDITION_FAILED",
          `[syson_element_delete] project resolution failed: ${
            (err as Error).message
          }`,
          { editingContextId: ecId },
          "Call syson_project_list then syson_project_get to verify the editingContextId.",
          true,
          false,
        );
      }

      // 3. Resolve the pre-dispatch commit without assuming a project/commit
      // identity convention. resolveCurrentCommitId rejects an absent or
      // ambiguous REST response before the irreversible POST is attempted.
      const currentCommitId = await resolveCurrentCommitId(
        restClient,
        projectId,
      );
      const preCheckPath =
        `/api/rest/projects/${projectId}/commits/${currentCommitId}/elements/${elemId}`;

      // 4. Verify the element exists before dispatching an irreversible operation.
      let preCheck: Response;
      try {
        preCheck = await restClient.get(preCheckPath);
      } catch (err) {
        throw elementDeleteError(
          "SYSON_DELETE_PRECONDITION_FAILED",
          `[syson_element_delete] pre-deletion check failed: ${
            (err as Error).message
          }`,
          { elementId: elemId, projectId, currentCommitId },
          "Restore SysON connectivity and retry; no delete was dispatched.",
          true,
          false,
        );
      }
      await preCheck.body?.cancel().catch(() => undefined);

      if (preCheck.status === 404) {
        throw elementDeleteError(
          "SYSON_DELETE_PRECONDITION_FAILED",
          `[syson_element_delete] element ${elemId} not found in project ${projectId}`,
          { elementId: elemId, projectId, currentCommitId },
          "Confirm the element_id is correct using syson_element_get before retrying.",
          false,
          false,
        );
      }

      if (preCheck.status !== 200) {
        throw elementDeleteError(
          "SYSON_DELETE_PRECONDITION_FAILED",
          `[syson_element_delete] unexpected pre-check status ${preCheck.status}`,
          {
            elementId: elemId,
            projectId,
            currentCommitId,
            httpStatus: preCheck.status,
          },
          "Inspect SysON health and retry only after the element can be read.",
          preCheck.status >= 500,
          false,
        );
      }

      // 5. Dispatch deletion — irreversible from this point.
      // A network error after the fetch call starts means we cannot know whether the
      // server received and processed the request. Never retry; require human review.
      let deleteResp: Response;
      try {
        deleteResp = await restClient.post(
          `/api/rest/projects/${projectId}/commits`,
          {
            "@type": "Commit",
            change: [{
              "@type": "DataVersion",
              identity: { "@id": elemId, "@type": "DataIdentity" },
            }],
          },
        );
      } catch (err) {
        throw elementDeleteError(
          "SYSON_DELETE_OUTCOME_UNKNOWN",
          `[syson_element_delete] network failure during delete dispatch — outcome unknown, do NOT retry: ${
            (err as Error).message
          }`,
          { elementId: elemId, projectId, currentCommitId },
          "Verify element existence via syson_element_get before deciding whether to retry.",
          false,
          true,
        );
      }

      // HTTP 201 = commit created (deletion dispatched).
      // HTTP 200 + empty body = project not found (no commit created).
      // Any other status = unexpected; treat conservatively.
      if (deleteResp.status !== 201) {
        const deleteBody = await deleteResp.text().catch(() => "");
        throw elementDeleteError(
          "SYSON_DELETE_OUTCOME_UNKNOWN",
          `[syson_element_delete] delete request returned HTTP ${deleteResp.status} — outcome unknown, do NOT retry`,
          {
            elementId: elemId,
            projectId,
            currentCommitId,
            httpStatus: deleteResp.status,
            responseSnippet: responseSnippet(deleteBody),
          },
          "Verify element existence via syson_element_get before deciding whether to retry.",
          false,
          true,
        );
      }

      let acknowledgementBody: string;
      try {
        acknowledgementBody = await deleteResp.text();
      } catch (err) {
        throw elementDeleteError(
          "SYSON_DELETE_ACKNOWLEDGED_UNVERIFIED",
          `[syson_element_delete] delete was acknowledged (HTTP 201) but its commit ID could not be read — do NOT retry: ${
            (err as Error).message
          }`,
          { elementId: elemId, projectId, currentCommitId },
          "Manually verify element absence before proceeding; the acknowledged delete may have succeeded.",
          false,
          true,
        );
      }

      // The acknowledgement's @id, not an observed project/commit equality,
      // is the only safe anchor for the verification GET. A missing or malformed
      // ID leaves the deletion acknowledged but unverifiable, never successful.
      const commitId = commitIdFromRestValue(parseJson(acknowledgementBody));
      if (!commitId) {
        throw elementDeleteError(
          "SYSON_DELETE_ACKNOWLEDGED_UNVERIFIED",
          "[syson_element_delete] delete was acknowledged (HTTP 201) without a usable commit @id — do NOT retry",
          {
            elementId: elemId,
            projectId,
            currentCommitId,
            responseSnippet: responseSnippet(acknowledgementBody),
          },
          "Manually verify element absence before proceeding; do not substitute projectId for the missing commit ID.",
          false,
          true,
        );
      }

      // 6. Confirm deletion via GET — a 201 acquittement alone does not prove the
      // element is gone (sonde: the API returns 201 even for non-existent elementIds).
      const verifyPath =
        `/api/rest/projects/${projectId}/commits/${commitId}/elements/${elemId}`;
      let verifyResp: Response;
      try {
        verifyResp = await restClient.get(verifyPath);
      } catch (err) {
        throw elementDeleteError(
          "SYSON_DELETE_ACKNOWLEDGED_UNVERIFIED",
          `[syson_element_delete] delete acknowledged (HTTP 201) but verification GET failed — do NOT retry: ${
            (err as Error).message
          }`,
          { elementId: elemId, projectId, commitId },
          "Manually verify element absence via syson_element_get before proceeding.",
          false,
          true,
        );
      }
      await verifyResp.body?.cancel().catch(() => undefined);

      if (verifyResp.status === 404) {
        return { deleted: true, elementId: elemId, commitId };
      }

      if (verifyResp.status === 200) {
        throw elementDeleteError(
          "SYSON_DELETE_POSTCONDITION_FAILED",
          `[syson_element_delete] element ${elemId} still present after delete was acknowledged (HTTP 201) — do NOT retry`,
          { elementId: elemId, projectId, commitId },
          "Inspect SysON state manually; do not retry without human review.",
          false,
          true,
        );
      }

      throw elementDeleteError(
        "SYSON_DELETE_ACKNOWLEDGED_UNVERIFIED",
        `[syson_element_delete] delete acknowledged but verification returned unexpected HTTP ${verifyResp.status} — do NOT retry`,
        {
          elementId: elemId,
          projectId,
          commitId,
          httpStatus: verifyResp.status,
        },
        "Manually verify element absence via syson_element_get before proceeding.",
        false,
        true,
      );
    },
  },

  {
    name: "syson_element_insert_sysml",
    description:
      "Insert SysML v2 textual notation as children of an element. " +
      "Best way to create complex structures in one call. " +
      "Examples: 'part heater : HeaterAssembly;', " +
      "'attribute totalMass : Real = 2.86;', " +
      "'constraint massConstraint { totalMass <= maxAllowedMass }'. " +
      "Accepts multiple statements separated by newlines. A SuccessPayload is " +
      "an acknowledgement only; semantic completeness is unverified. Re-read " +
      "critical content afterwards: SysON can acknowledge an insertion while " +
      "omitting a clause that is invalid in its surrounding context.",
    category: "element",
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID",
        },
        parent_id: {
          type: "string",
          description: "ID of the parent element to insert into",
        },
        sysml_text: {
          type: "string",
          description: "SysML v2 textual content. E.g. 'part Heater;', " +
            "'requirement ThermalReq { doc /* Must maintain 20-25C */ }'",
        },
      },
      required: ["editing_context_id", "parent_id", "sysml_text"],
    },
    outputSchema: elementInsertSysmlOutputSchema,
    handler: async ({ editing_context_id, parent_id, sysml_text }) => {
      // A SuccessPayload proves only that SysON accepted the textual insertion
      // request, not that every clause survived semantic/context validation.
      // Observed failure mode: `require constraint` outside a `requirement`
      // block inserted its attribute but silently dropped the constraint while
      // reporting SuccessPayload. acknowledged/semanticCompleteness qualify that
      // evidence; they are not a parse, delta, or semantic read-back.
      const client = getSysonClient();
      const mutationId = crypto.randomUUID();

      const data = await client.mutate<InsertTextualSysMLv2Result>(
        INSERT_TEXTUAL_SYSMLV2,
        {
          input: {
            id: mutationId,
            editingContextId: editing_context_id as string,
            objectId: parent_id as string,
            textualContent: sysml_text as string,
          },
        },
      );

      const payload = unwrapMutation(data, "insertTextualSysMLv2");
      if (payload.__typename !== "SuccessPayload") {
        throw new Error(
          `[lib/syson] insertTextualSysMLv2 failed: expected SuccessPayload, got ${
            String(payload.__typename)
          }`,
        );
      }
      return {
        inserted: true,
        parentId: parent_id as string,
        text: sysml_text as string,
        acknowledged: true,
        semanticCompleteness: "unverified",
      } satisfies ElementInsertSysmlOutput;
    },
  },
];
