# Docker operation name compatibility fix

Date: 2026-09-03
Branch: `fix/docker-operation-names`

## Scope

Update the five Docker inventory operations in `src/tools/registry.ts` from their pre-2.3 names to the operation names exposed by the installed `komodo_client` 2.3.2 type definitions.

## Operation mapping

| MCP tool | Previous operation | Current operation |
| --- | --- | --- |
| `komodo_list_containers` | `ListDockerContainers` | `ListContainers` |
| `komodo_inspect_container` | `InspectDockerContainer` | `InspectContainer` |
| `komodo_list_images` | `ListDockerImages` | `ListImages` |
| `komodo_list_networks` | `ListDockerNetworks` | `ListNetworks` |
| `komodo_list_volumes` | `ListDockerVolumes` | `ListVolumes` |

The request parameter schemas are unchanged.

## Verification

- `npx tsc`: passed with exit code 0.
- `node --test --test-reporter=spec test/*.js`: passed, 53 tests and 0 failures.
- `npx biome lint src/tools/registry.ts`: passed with no diagnostics.
- `node scripts/generate-api-docs.mjs`: passed and regenerated `docs/API.md` with the current operation names.
- `git diff --check`: passed.

The standard `npm run build` and `npm run docs:api` wrappers remain unavailable on Windows because the existing `clean` script invokes `rm -rf dist`. The compiler and documentation generator were therefore run directly. Repository-wide `npx biome check src test` also retains pre-existing CRLF formatting and unrelated lint failures; the changed source file passes the lint-only check above.
