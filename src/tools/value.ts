/**
 * SysON Value Tools
 *
 * Read and write numeric attribute values in the model. `syson_value_set`
 * mutates the underlying Literal node via AQL `eSet`, which is what makes
 * what-if loops possible: change a value, re-run syson_constraint_validate.
 * This direct mutation bypasses Sirius Web's normal command/event pipeline;
 * the tool reads back the numeric value, but editor-side listeners or undo
 * state may not observe it like a UI edit. Keep that risk explicit until a
 * standard SysML v2 write endpoint covers this operation.
 *
 * @module lib/syson/tools/value
 */

import type { SysonTool } from "./types.ts";
import { aqlEscape, evalAql } from "./aql.ts";
import { readAttributeValue } from "../constraints/resolver.ts";

// ============================================================================
// Sign-change helper
// ============================================================================

/**
 * Attempt to remove the OperatorExpression('-') wrapping a literal, turning a
 * negative stored value positive. Works by reparenting the literal's
 * membership to the FeatureValue and dropping the operator's membership.
 *
 * @returns false when the AST manipulation does not apply — the caller then
 *          reports the limitation instead of pretending the sign changed
 */
async function tryRemoveNegation(
  ecId: string,
  attributeId: string,
): Promise<boolean> {
  const opResult = await evalAql(
    ecId,
    "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::OperatorExpression))->first()",
    [attributeId],
  );
  if (opResult.__typename !== "ObjectExpressionResult") return false;
  const opId = opResult.objValue.id;

  const litResult = await evalAql(
    ecId,
    "aql:self.eAllContents()->select(e | e.oclIsKindOf(sysml::LiteralRational) or e.oclIsKindOf(sysml::LiteralInteger))->first()",
    [opId],
  );
  if (litResult.__typename !== "ObjectExpressionResult") return false;
  const literalId = litResult.objValue.id;

  const opMembership = await evalAql(ecId, "aql:self.eContainer()", [opId]);
  if (opMembership.__typename !== "ObjectExpressionResult") return false;
  const opMembershipId = opMembership.objValue.id;

  const litMembership = await evalAql(ecId, "aql:self.eContainer()", [
    literalId,
  ]);
  if (litMembership.__typename !== "ObjectExpressionResult") return false;
  const litMembershipId = litMembership.objValue.id;

  const featureValue = await evalAql(ecId, "aql:self.eContainer()", [
    opMembershipId,
  ]);
  if (featureValue.__typename !== "ObjectExpressionResult") return false;
  const featureValueId = featureValue.objValue.id;

  try {
    await evalAql(
      ecId,
      `aql:self.eGet(self.eClass().getEStructuralFeature('ownedRelationship')).add(` +
        `self.eResource().getEObject('${aqlEscape(litMembershipId)}'))`,
      [featureValueId],
    );
    await evalAql(
      ecId,
      `aql:self.eGet(self.eClass().getEStructuralFeature('ownedRelationship')).remove(` +
        `self.eResource().getEObject('${aqlEscape(opMembershipId)}'))`,
      [featureValueId],
    );
    return true;
  } catch {
    // AST reparenting failed — surfaced to the caller as a warning
    return false;
  }
}

// ============================================================================
// Tool definitions
// ============================================================================

export const valueTools: SysonTool[] = [
  {
    name: "syson_value_read",
    description:
      "Read the numeric value of an attribute in the model. Returns the " +
      "value plus the underlying literal's id and kind. The element must be " +
      "an AttributeUsage holding a numeric literal.",
    category: "value",
    _meta: { ui: { resourceUri: "ui://mcp-syson/value-change-viewer" } },
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID (from syson_project_get)",
        },
        element_id: {
          type: "string",
          description:
            "UUID of the AttributeUsage to read (e.g., 'totalMass'). " +
            "Obtain via syson_element_children or syson_query_aql.",
        },
      },
      required: ["editing_context_id", "element_id"],
    },
    handler: async ({ editing_context_id, element_id }) => {
      const ecId = editing_context_id as string;
      const elementId = element_id as string;

      const current = await readAttributeValue(ecId, elementId);
      if (!current) {
        throw new Error(
          `[syson_value_read] No numeric literal found under element ${elementId}. ` +
            "Ensure element_id points to an AttributeUsage with a LiteralRational or LiteralInteger.",
        );
      }

      return {
        editingContextId: ecId,
        scope: { kind: "element", editingContextId: ecId, rootId: elementId },
        element_id: elementId,
        value: current.value,
        literal_id: current.literalId,
        literal_kind: current.literalKind,
        negated: current.negated,
      };
    },
  },

  {
    name: "syson_value_set",
    description:
      "Change the numeric value of an attribute in the model. Returns old " +
      "value, new value, and read-back verification. Use before " +
      "syson_constraint_validate to test what-if scenarios on the model " +
      "itself (for evaluation-only what-ifs, prefer the 'values' override — " +
      "it does not mutate the model).",
    category: "value",
    _meta: { ui: { resourceUri: "ui://mcp-syson/value-change-viewer" } },
    inputSchema: {
      type: "object",
      properties: {
        editing_context_id: {
          type: "string",
          description: "Editing context ID (from syson_project_get)",
        },
        element_id: {
          type: "string",
          description:
            "UUID of the AttributeUsage to modify. Must hold a numeric " +
            "literal — not a part or package.",
        },
        value: {
          type: "number",
          description: "New numeric value, positive or negative",
        },
      },
      required: ["editing_context_id", "element_id", "value"],
    },
    handler: async (args) => {
      const ecId = args.editing_context_id as string;
      const elementId = args.element_id as string;
      const newValue = args.value as number;

      const current = await readAttributeValue(ecId, elementId);
      if (!current) {
        throw new Error(
          `[syson_value_set] No numeric literal found under element ${elementId}. ` +
            "Ensure element_id points to an AttributeUsage with a numeric value.",
        );
      }

      const absNewValue = Math.abs(newValue);
      const needsNegation = newValue < 0;

      // Write the absolute value onto the literal node
      const isRational = current.literalKind.includes("LiteralRational");
      const valueStr = isRational
        ? (Number.isInteger(absNewValue)
          ? `${absNewValue}.0`
          : absNewValue.toString())
        : Math.round(absNewValue).toString();

      await evalAql(
        ecId,
        `aql:self.eSet(self.eClass().getEStructuralFeature('value'), ${valueStr})`,
        [current.literalId],
      );

      // Handle a sign flip when needed
      let signChangeAttempted = false;
      let signChangeSuccess = false;
      if (needsNegation !== current.negated) {
        signChangeAttempted = true;
        if (!needsNegation && current.negated) {
          signChangeSuccess = await tryRemoveNegation(ecId, elementId);
        }
        // Positive → negative would require creating an OperatorExpression('-'),
        // which needs insertTextualSysMLv2 — reported below, not silently skipped.
      }

      const verified = await readAttributeValue(ecId, elementId);
      const verifiedValue = verified?.value;

      let warning: string | undefined;
      if (signChangeAttempted && !signChangeSuccess) {
        warning =
          `Sign change from ${current.negated ? "negative" : "positive"} to ` +
          `${needsNegation ? "negative" : "positive"} could not be applied; ` +
          "the absolute value was set. Change the sign in the SysON UI, or " +
          "use syson_constraint_validate with a 'values' override for " +
          "what-if evaluation.";
      }

      return {
        editingContextId: ecId,
        scope: { kind: "element", editingContextId: ecId, rootId: elementId },
        element_id: elementId,
        old_value: current.value,
        new_value: newValue,
        ...(verifiedValue !== undefined && { verified_value: verifiedValue }),
        literal_id: current.literalId,
        literal_kind: current.literalKind,
        success: verifiedValue !== undefined &&
          Math.abs(verifiedValue - newValue) < 1e-9,
        ...(warning && { warning }),
      };
    },
  },
];
