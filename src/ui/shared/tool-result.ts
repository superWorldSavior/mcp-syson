/** Provider failures and rejected payloads must not masquerade as empty data. */
export interface ToolResultIssue {
  readonly kind: "provider" | "invalid";
  readonly code: string;
  readonly message?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorDetails(value: unknown): { code?: string; message?: string } {
  if (!record(value)) return {};
  const nested = record(value.error) ? value.error : value;
  return {
    ...(typeof nested.code === "string" ? { code: nested.code } : {}),
    ...(typeof nested.message === "string" ? { message: nested.message } : {}),
  };
}

export function toolResultIssue(
  result: unknown,
  acceptedContent: boolean,
): ToolResultIssue | undefined {
  if (!record(result)) return { kind: "invalid", code: "invalid-view-data" };
  if (result.isError === true) {
    let details = errorDetails(result.structuredContent);
    if (!details.message && Array.isArray(result.content)) {
      for (const block of result.content) {
        if (
          !record(block) || block.type !== "text" ||
          typeof block.text !== "string"
        ) continue;
        try {
          details = { ...details, ...errorDetails(JSON.parse(block.text)) };
        } catch {
          details = { ...details, message: block.text };
        }
        if (details.message) break;
      }
    }
    return {
      kind: "provider",
      code: details.code || "provider-operation-failed",
      message: details.message,
    };
  }
  if (acceptedContent) return undefined;
  if (
    result.structuredContent !== undefined ||
    (Array.isArray(result.content) && result.content.length > 0)
  ) {
    return { kind: "invalid", code: "invalid-view-data" };
  }
  return undefined;
}
