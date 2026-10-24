/** Domain-shaped MCP error results for SysON tool calls. */

import type { ToolAnnotations } from "@mcpview/server";

export interface SysonToolErrorBody {
  code: string;
  message: string;
  context: Record<string, unknown>;
  recovery: string;
  retryable: boolean;
  reviewRequired: boolean;
}

export interface SysonToolErrorResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: SysonToolErrorBody;
  isError: true;
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  context?: unknown;
  recovery?: unknown;
  retryable?: unknown;
  reviewRequired?: unknown;
  name?: unknown;
}

/**
 * Convert a thrown provider error into a recoverable MCP result. Existing
 * fail-closed delete errors retain their exact code and retry/review fields.
 */
export function toSysonToolErrorResult(
  toolName: string,
  error: unknown,
  annotations: ToolAnnotations,
): SysonToolErrorResult {
  const source = errorLike(error);
  const message = boundedMessage(source.message ?? error);
  const providedCode = stringValue(source.code);
  const context = recordValue(source.context);
  const providedRecovery = stringValue(source.recovery);
  const providedRetryable = booleanValue(source.retryable);
  const providedReviewRequired = booleanValue(source.reviewRequired);

  const body = providedCode
    ? {
      code: providedCode,
      message,
      context,
      recovery: providedRecovery ??
        "Inspect the reported context before retrying.",
      retryable: providedRetryable ?? false,
      reviewRequired: providedReviewRequired ?? false,
    }
    : fallbackError(toolName, message, annotations);

  return {
    content: [{
      type: "text",
      text: `${body.code}: ${body.message}\nRecovery: ${body.recovery}`,
    }],
    structuredContent: body,
    isError: true,
  };
}

function fallbackError(
  toolName: string,
  message: string,
  annotations: ToolAnnotations,
): SysonToolErrorBody {
  const context = { toolName };
  // Untyped write failures do not prove whether the provider accepted the
  // mutation. Message text such as "must be" can also come from SysON after
  // dispatch, so mutation tools stay fail-closed before any text heuristic.
  const mutationMayHaveDispatched = annotations.readOnlyHint !== true;
  if (mutationMayHaveDispatched) {
    return {
      code: "SYSON_MUTATION_OUTCOME_UNKNOWN",
      message,
      context,
      recovery:
        "Read back the affected SysON state before deciding whether another mutation is safe.",
      retryable: false,
      reviewRequired: true,
    };
  }

  if (isInvalidArgumentError(message)) {
    return {
      code: "SYSON_INVALID_ARGUMENT",
      message,
      context,
      recovery:
        "Correct the arguments using the tool input schema, then call again.",
      retryable: false,
      reviewRequired: false,
    };
  }

  if (isConfigurationError(message)) {
    return {
      code: "SYSON_CONFIGURATION_REQUIRED",
      message,
      context,
      recovery:
        "Configure SYSON_URL for a reachable SysON instance, then retry.",
      retryable: false,
      reviewRequired: false,
    };
  }

  return {
    code: isTransientProviderError(message)
      ? "SYSON_UPSTREAM_UNAVAILABLE"
      : "SYSON_OPERATION_FAILED",
    message,
    context,
    recovery: isTransientProviderError(message)
      ? "Check SysON connectivity, then retry the read-only operation."
      : "Inspect the SysON model identity and provider response before retrying.",
    retryable: isTransientProviderError(message),
    reviewRequired: false,
  };
}

function errorLike(value: unknown): ErrorLike {
  return value && typeof value === "object" ? value as ErrorLike : {};
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function boundedMessage(value: unknown): string {
  const message = typeof value === "string" ? value : String(value);
  return message.length <= 1_000 ? message : `${message.slice(0, 997)}...`;
}

function isConfigurationError(message: string): boolean {
  return message.includes("SYSON_URL") ||
    message.includes("SysON URL is required");
}

/**
 * A provider or parser can also throw TypeError, so the class alone is not
 * evidence that the caller supplied invalid tool input. Only label explicit
 * argument-validation messages this way; all other failures retain their
 * provider-operation context.
 */
function isInvalidArgumentError(message: string): boolean {
  return /\b(must be|requires)\b/i.test(message) &&
    !/Cannot read properties|undefined|provider|response/i.test(message);
}

function isTransientProviderError(message: string): boolean {
  return /timed out|network|fetch failed|connection refused|ECONNREFUSED|ECONNRESET|ENOTFOUND|GraphQL HTTP error: 5\d\d/i
    .test(
      message,
    );
}
