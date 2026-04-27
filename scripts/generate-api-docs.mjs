#!/usr/bin/env node
/**
 * Regenerate docs/API.md from the compiled tool registry.
 *
 * - Reads `TOOLS` from dist/tools/registry.js (so the build step must run
 *   first; CI does `npm run build && npm run docs:api`).
 * - Walks each spec's Zod inputSchema to extract field name, type, optionality,
 *   bounds, and `.describe(...)` text.
 * - Emits a deterministic markdown file. Run `npm run docs:check` in CI to
 *   `git diff --exit-code` against the committed copy.
 *
 * The output between the AUTOGEN markers is fully replaced; everything else
 * in docs/API.md is preserved.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TOOLS } from "../dist/tools/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiDocPath = resolve(__dirname, "../docs/API.md");

const BEGIN = "<!-- BEGIN AUTOGEN: tool catalog -->";
const END = "<!-- END AUTOGEN: tool catalog -->";

function describeAnnotations(a) {
  const flags = [];
  if (a.readOnlyHint) flags.push("`readOnlyHint`");
  if (a.idempotentHint) flags.push("`idempotentHint`");
  if (a.destructiveHint) flags.push("**`destructiveHint`**");
  if (a.openWorldHint) flags.push("`openWorldHint`");
  return flags.join(", ") || "—";
}

/** Best-effort introspection of a Zod 4 schema for documentation. */
function introspect(zod) {
  const out = { type: "unknown", optional: false, default: undefined, bounds: [] };

  // Unwrap default + optional wrappers, recording as we go. `.describe(...)`
  // can be applied to the outer wrapper (e.g. `.default().describe()`) so we
  // capture it on the first cursor that has one.
  let cursor = zod;
  while (cursor) {
    const cdef = cursor.def ?? cursor._def ?? {};
    if (out.description == null) out.description = cursor.description ?? cdef.description;
    const ctype = String(cdef.type ?? cdef.typeName ?? "").replace(/^Zod/, "").toLowerCase();
    if (ctype === "default") {
      out.default =
        typeof cdef.defaultValue === "function" ? cdef.defaultValue() : cdef.defaultValue;
      cursor = cdef.innerType;
      continue;
    }
    if (ctype === "optional" || ctype === "nullable") {
      out.optional = true;
      cursor = cdef.innerType;
      continue;
    }
    out.type = ctype || out.type;

    // Bounds: string and number expose helpers; arrays carry their bounds in
    // `def.checks` as `_zod.def.{check,minimum,maximum}`.
    if (out.type === "string") {
      if (typeof cursor.minLength === "number") out.bounds.push(`min length ${cursor.minLength}`);
      if (typeof cursor.maxLength === "number") out.bounds.push(`max length ${cursor.maxLength}`);
      // Zod 4 puts string-format constraints (.url(), .email(), …) in `def.checks`
      // as nested string-format check schemas with `def.format`.
      for (const c of cdef.checks ?? []) {
        const innerDef = c._zod?.def ?? c.def ?? {};
        if (innerDef.check === "string_format" && innerDef.format) {
          out.bounds.push(`format: ${innerDef.format}`);
        }
      }
    } else if (out.type === "number") {
      if (typeof cursor.minValue === "number") out.bounds.push(`min ${cursor.minValue}`);
      if (typeof cursor.maxValue === "number") out.bounds.push(`max ${cursor.maxValue}`);
      if (cursor.def?.format === "safeint" || cursor.isInt) out.bounds.push("integer");
    } else if (out.type === "array") {
      for (const c of cdef.checks ?? []) {
        const innerDef = c._zod?.def ?? c.def ?? {};
        const kind = innerDef.check;
        const value = innerDef.minimum ?? innerDef.maximum ?? innerDef.value;
        if (kind === "min_length") out.bounds.push(`min ${value} entries`);
        else if (kind === "max_length") out.bounds.push(`max ${value} entries`);
      }
      if (cdef.element) {
        const inner = introspect(cdef.element);
        if (inner.bounds.length) {
          out.bounds.push(`each ${inner.type} ${inner.bounds.join(", ")}`);
        }
      }
    }

    if (out.description == null) out.description = cursor.description ?? cdef.description;
    break;
  }
  return out;
}

function renderTool(t) {
  const lines = [];
  lines.push(`### \`${t.name}\``);
  lines.push("");
  lines.push(`**${t.title}** — ${t.description}`);
  lines.push("");
  lines.push(`- **Endpoint**: \`${t.endpoint}\``);
  lines.push(`- **Operation**: \`${t.operation}\``);
  lines.push(`- **Annotations**: ${describeAnnotations(t.annotations)}`);
  lines.push("");

  const fields = Object.entries(t.inputSchema);
  if (fields.length === 0) {
    lines.push("**Parameters**: none");
  } else {
    lines.push("**Parameters**:");
    lines.push("");
    lines.push("| Name | Type | Required | Default | Bounds | Description |");
    lines.push("|---|---|---|---|---|---|");
    for (const [name, schema] of fields) {
      const info = introspect(schema);
      const required = info.optional || info.default !== undefined ? "no" : "yes";
      const def = info.default !== undefined ? `\`${JSON.stringify(info.default)}\`` : "—";
      const bounds = info.bounds.length ? info.bounds.join("; ") : "—";
      const desc = (info.description ?? "").replace(/\|/g, "\\|");
      lines.push(`| \`${name}\` | \`${info.type}\` | ${required} | ${def} | ${bounds} | ${desc || "—"} |`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function renderCatalog() {
  const buckets = { read: [], execute: [], write: [] };
  for (const t of TOOLS) buckets[t.endpoint].push(t);

  const sections = [];
  sections.push("");
  sections.push(
    "_This section is generated from `src/tools/registry.ts`. Do not edit by hand — run `npm run docs:api`._"
  );
  sections.push("");

  const counts = { read: buckets.read.length, execute: buckets.execute.length, write: buckets.write.length };
  sections.push(`Total tools: **${TOOLS.length}** (read ${counts.read}, execute ${counts.execute}, write ${counts.write}).`);
  sections.push("");

  const heading = { read: "Read Operations", execute: "Execute Operations", write: "Write Operations" };
  for (const endpoint of ["read", "execute", "write"]) {
    sections.push(`## ${heading[endpoint]} (${counts[endpoint]} tools)`);
    sections.push("");
    for (const t of buckets[endpoint]) sections.push(renderTool(t));
  }
  return sections.join("\n");
}

function main() {
  const existing = readFileSync(apiDocPath, "utf8");
  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);
  if (beginIdx === -1 || endIdx === -1) {
    console.error(`${apiDocPath} is missing BEGIN/END AUTOGEN markers; aborting.`);
    process.exit(2);
  }
  const before = existing.slice(0, beginIdx + BEGIN.length);
  const after = existing.slice(endIdx);
  const next = `${before}\n${renderCatalog()}\n${after}`;
  if (next === existing) {
    console.error("docs/API.md already up to date.");
    return;
  }
  writeFileSync(apiDocPath, next);
  console.error("docs/API.md regenerated.");
}

main();
