import assert from "node:assert/strict";
import { test } from "node:test";
import { formatResult, toolHandler } from "../dist/tools/utils.js";

test("array result is wrapped under structuredContent.items", () => {
  const out = formatResult([1, 2, 3], "got list");
  assert.deepEqual(out.structuredContent, { items: [1, 2, 3] });
  assert.match(out.content[0].text, /^got list/);
});

test("object result is exposed directly as structuredContent", () => {
  const out = formatResult({ a: 1 }, "ok");
  assert.deepEqual(out.structuredContent, { a: 1 });
});

test("primitive result is wrapped under structuredContent.value", () => {
  const out = formatResult(42, "got value");
  assert.deepEqual(out.structuredContent, { value: 42 });
});

test("undefined result has no structuredContent", () => {
  const out = formatResult(undefined, "no body");
  assert.equal(out.structuredContent, undefined);
  assert.equal(out.content[0].text, "no body");
});

test("default summary 'ok' when none provided", () => {
  const out = formatResult({ a: 1 });
  assert.match(out.content[0].text, /^ok/);
});

test("very large payload omits inline JSON in text channel", () => {
  const big = { blob: "x".repeat(80_000) };
  const out = formatResult(big, "huge");
  assert.match(out.content[0].text, /result available as structuredContent/);
  assert.deepEqual(out.structuredContent, big);
});

test("toolHandler converts thrown errors into MCP isError result", async () => {
  const handler = toolHandler(async () => {
    throw new Error("boom");
  });
  const res = await handler({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Error: boom/);
});

test("toolHandler passes through successful results with summary", async () => {
  const handler = toolHandler(
    async (args) => ({ doubled: args.n * 2 }),
    (args, result) => `n=${args.n} doubled=${result.doubled}`
  );
  const res = await handler({ n: 21 });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /n=21 doubled=42/);
  assert.deepEqual(res.structuredContent, { doubled: 42 });
});
