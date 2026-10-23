/** Documentary rendering only: no feature resolution or evaluation. */
export type RequirementExpression =
  | { kind: "literal"; value: number; unit?: string }
  | { kind: "ref"; featurePath: string[] }
  | {
    kind: "binary";
    op: string;
    left: RequirementExpression;
    right: RequirementExpression;
  }
  | { kind: "unary"; op: string; operand: RequirementExpression }
  | { kind: "call"; name: string; args: RequirementExpression[] };

export function requirementExpressionText(
  expression: RequirementExpression,
): string {
  switch (expression.kind) {
    case "literal":
      return `${expression.value}${
        expression.unit ? ` ${expression.unit}` : ""
      }`;
    case "ref":
      return expression.featurePath.join(".");
    case "binary":
      return `(${requirementExpressionText(expression.left)} ${expression.op} ${
        requirementExpressionText(expression.right)
      })`;
    case "unary":
      return `${expression.op} (${
        requirementExpressionText(expression.operand)
      })`;
    case "call":
      return `${expression.name}(${
        expression.args.map(requirementExpressionText).join(", ")
      })`;
  }
}
