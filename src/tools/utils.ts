/**
 * Helpers shared by all tool handlers.
 */

type TextContent = { type: "text"; text: string; _meta?: Record<string, unknown> };
type StructuredContent = { [key: string]: unknown };
export type FormattedResult = {
  content: TextContent[];
  structuredContent?: StructuredContent;
  isError?: boolean;
};

/** Threshold above which we omit the JSON-in-text duplication. 64 KiB serialized. */
const TEXT_INLINE_LIMIT = 64 * 1024;

/**
 * Format an API result into a consistent MCP message content payload.
 *
 * - The result is exposed as `structuredContent` so MCP clients can render it
 *   as data without re-parsing the text channel.
 * - The text channel carries a short human-readable summary; for small results
 *   the JSON body is appended too (compact, no indent) so legacy clients that
 *   only read text still see something useful.
 */
export function formatResult(result: unknown, summary?: string): FormattedResult {
  const structuredContent = toStructured(result);
  const summaryLine = summary ?? "ok";

  let text = summaryLine;
  if (structuredContent !== undefined) {
    const serialized = JSON.stringify(structuredContent);
    if (serialized.length <= TEXT_INLINE_LIMIT) {
      text = `${summaryLine}\n${serialized}`;
    } else {
      text = `${summaryLine} (result available as structuredContent; ${serialized.length} bytes)`;
    }
  }

  const content: TextContent[] = [{ type: "text", text }];
  return structuredContent ? { content, structuredContent } : { content };
}

function toStructured(result: unknown): StructuredContent | undefined {
  if (result === undefined) return undefined;
  if (Array.isArray(result)) return { items: result };
  if (typeof result === "object" && result !== null) return result as StructuredContent;
  return { value: result };
}

/**
 * Wrap an async tool implementation so any thrown error is surfaced as an MCP
 * tool error (`isError: true`) instead of propagating to the transport layer.
 *
 * Why: handlers without try/catch turn upstream Komodo failures (timeouts, 4xx,
 * network) into hard transport errors, which most MCP clients render as "tool
 * unavailable" rather than "the call failed; here is why".
 */
export function toolHandler<A, R>(
  fn: (args: A) => Promise<R>,
  summarize?: (args: A, result: R) => string
): (args: A) => Promise<FormattedResult> {
  return async (args: A) => {
    try {
      const result = await fn(args);
      const summary = summarize ? summarize(args, result) : undefined;
      return formatResult(result, summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}
