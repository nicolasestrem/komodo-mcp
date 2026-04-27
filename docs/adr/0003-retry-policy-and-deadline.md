# ADR 0003: Retry policy with shared deadline and pre-send retry

**Status:** Accepted
**Date:** 2026-04-27

## Context

The original retry logic in `KomodoClient` had three problems:

1. The per-attempt `setTimeout` reset on every retry, so a `timeoutMs: 30_000` with `maxRetries: 2` could effectively wait 60+ seconds on a slow upstream.
2. Retries were gated to the `read` endpoint and only on 5xx/429/transient `TypeError`. Pre-send transport errors (DNS resolution failure, ECONNREFUSED before headers were sent, EAI_AGAIN, undici connect timeout) are *safe to retry on any verb* because the request never reached Komodo, but the existing logic treated them like an `execute`/`write` failure and gave up.
3. Pure exponential backoff with no jitter risked thundering-herd amplification if multiple clients retried in lock-step.

## Decision

- Compute `deadline = clock.now() + timeoutMs` once at the start of `#request`. Each attempt's timeout is `Math.max(1, deadline - clock.now())`. Total wall-clock for retries is bounded by the original timeout.
- Distinguish two retry classes:
  - **Pre-send transport errors** (`TypeError` whose `cause.code` is `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_SOCKET`) → retry on any verb.
  - **Status-based / post-send transient errors** → retry only on `read`, only on 5xx/429 status or generic `TypeError` with no recognized cause.
- Apply uniform jitter to backoff: `100 * 2^(n-1) * (0.5 + Math.random())`.
- A `Clock` interface (`now`, `sleep`) is injectable via the constructor so tests can assert backoff schedules without paying real wall-clock time.

## Consequences

- ✅ Predictable upper bound on tool latency under retry.
- ✅ Idempotent execute ops survive flaky network connections.
- ✅ Backoff schedule is now testable.
- ⚖️ A pre-send retry on `write` ops is theoretically risky if the cause-code classifier mistakes a partially-sent request for a pre-send error. The undici cause codes are narrow enough to make this very unlikely; we accept the residual risk.
