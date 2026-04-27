type TextContent = { type: "text"; text: string; _meta?: Record<string, unknown> };
type StructuredContent = { [key: string]: unknown };
type FormattedResult = { content: TextContent[]; structuredContent?: StructuredContent };

/**
 * Format an API result into a consistent MCP message content payload.
 * The response includes human-readable text and a structured JSON attachment
 * when available.
 */
export function formatResult(result: unknown, summary?: string): FormattedResult {
  const content: TextContent[] = [];

  const text = summary
    ? `${summary}\n\n${JSON.stringify(result, null, 2)}`
    : JSON.stringify(result, null, 2);

  content.push({ type: "text", text });

  const structuredContent: StructuredContent | undefined = (() => {
    if (result === undefined) return undefined;
    if (Array.isArray(result)) {
      return { items: result } satisfies StructuredContent;
    }
    if (typeof result === "object" && result !== null) {
      return result as StructuredContent;
    }
    return { value: result } satisfies StructuredContent;
  })();

  return structuredContent ? { content, structuredContent } : { content };
}
