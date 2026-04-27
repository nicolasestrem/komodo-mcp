/**
 * Komodo API Client
 * Provides typed methods for interacting with the Komodo Core API.
 */

import { readFileSync } from "node:fs";
import pLimit from "p-limit";
import { Agent, type Dispatcher } from "undici";

export interface KomodoConfig {
  address: string;
  apiKey: string;
  apiSecret: string;
  /** Timeout in milliseconds for API requests. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum attempts for idempotent read operations. Defaults to 2. */
  maxRetries?: number;
  /** Maximum number of concurrent in-flight requests. Defaults to 8. */
  maxConcurrency?: number;
  /** Maximum response body size in bytes. Defaults to 16 MiB. */
  maxResponseBytes?: number;
  /** Optional undici dispatcher (e.g. shared keep-alive Agent). */
  dispatcher?: Dispatcher;
  /** Optional clock for testing (overrides Date.now / setTimeout). */
  clock?: Clock;
}

export interface KomodoRequest {
  type: string;
  params: Record<string, unknown>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const defaultDispatcher = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 16,
  pipelining: 1,
});

function readEnvOrFile(envName: string): string | undefined {
  const direct = process.env[envName];
  if (direct && direct.length > 0) return direct;
  const filePath = process.env[`${envName}_FILE`];
  if (filePath && filePath.length > 0) {
    try {
      return readFileSync(filePath, "utf8").trim();
    } catch (err) {
      throw new Error(`Failed to read ${envName}_FILE (${filePath}): ${(err as Error).message}`);
    }
  }
  return undefined;
}

function normalizeAddress(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`KOMODO_ADDRESS is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`KOMODO_ADDRESS must be http(s); got ${parsed.protocol}`);
  }
  // Strip path/query/hash so request() can append "/<endpoint>" cleanly.
  return parsed.origin;
}

function readNumberEnv(name: string, min = 1): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return n;
}

export class KomodoClient {
  readonly address: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxConcurrency: number;
  readonly maxResponseBytes: number;
  #apiKey: string;
  #apiSecret: string;
  #limit: ReturnType<typeof pLimit>;
  #dispatcher: Dispatcher;
  #clock: Clock;

  constructor(config: KomodoConfig) {
    this.address = normalizeAddress(config.address);
    this.#apiKey = config.apiKey;
    this.#apiSecret = config.apiSecret;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(1, config.maxRetries ?? 2);
    this.maxConcurrency = Math.max(1, config.maxConcurrency ?? 8);
    this.maxResponseBytes = config.maxResponseBytes ?? 16 * 1024 * 1024;
    this.#limit = pLimit(this.maxConcurrency);
    this.#dispatcher = config.dispatcher ?? defaultDispatcher;
    this.#clock = config.clock ?? realClock;
  }

  /**
   * Create a client from environment variables. Supports `*_FILE` overrides
   * for Docker/Kubernetes secrets (e.g. `KOMODO_API_KEY_FILE`).
   */
  static fromEnv(): KomodoClient {
    const address = readEnvOrFile("KOMODO_ADDRESS");
    const apiKey = readEnvOrFile("KOMODO_API_KEY");
    const apiSecret = readEnvOrFile("KOMODO_API_SECRET");

    if (!address || !apiKey || !apiSecret) {
      throw new Error(
        "Missing required environment variables: KOMODO_ADDRESS, KOMODO_API_KEY, KOMODO_API_SECRET"
      );
    }

    const timeoutMs = readNumberEnv("KOMODO_TIMEOUT_MS", 1);
    const maxRetries = readNumberEnv("KOMODO_MAX_RETRIES", 1);
    const maxConcurrency = readNumberEnv("KOMODO_MAX_CONCURRENCY", 1);

    return new KomodoClient({
      address,
      apiKey,
      apiSecret,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(maxRetries !== undefined ? { maxRetries } : {}),
      ...(maxConcurrency !== undefined ? { maxConcurrency } : {}),
    });
  }

  /** Redacted JSON form — used by `JSON.stringify(client)` and structured loggers. */
  toJSON(): Record<string, unknown> {
    return {
      address: this.address,
      apiKey: "[redacted]",
      apiSecret: "[redacted]",
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /** Redacted util.inspect form — used by `console.log(client)`. */
  [Symbol.for("nodejs.util.inspect.custom")](): unknown {
    return this.toJSON();
  }

  /**
   * Dispatch a Komodo API request. Public so the tool registry can drive it
   * without a per-operation method.
   */
  async call<T = unknown>(
    endpoint: "read" | "write" | "execute",
    operation: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    return this.#limit(() => this.#request<T>(endpoint, { type: operation, params }));
  }

  async #request<T>(endpoint: "read" | "write" | "execute", body: KomodoRequest): Promise<T> {
    const url = `${this.address}/${endpoint}`;
    const payload = JSON.stringify(body);
    const attempts = endpoint === "read" ? this.maxRetries : 1;
    const deadline = this.#clock.now() + this.timeoutMs;

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const remaining = Math.max(1, deadline - this.#clock.now());
      // We use a manual AbortController + setTimeout instead of
      // `AbortSignal.timeout(ms)` because the latter's internal timer is
      // unref'd in Node 22 — if the only thing holding the loop open is the
      // pending fetch, Node will exit before the timer fires.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(
          new DOMException(`Request timed out after ${remaining}ms`, "TimeoutError")
        );
      }, remaining);

      try {
        // Node's global fetch is undici under the hood; the `dispatcher`
        // option is a non-standard init key it accepts but `RequestInit`
        // doesn't model (and Node's bundled `undici-types` is a parallel
        // type tree from the `undici` package). Cast through unknown.
        const init = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": this.#apiKey,
            "X-Api-Secret": this.#apiSecret,
          },
          body: payload,
          signal: controller.signal,
          dispatcher: this.#dispatcher,
        } as unknown as RequestInit;
        const response = await fetch(url, init);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await this.#normalizeResponseError(response, endpoint, body.type);
          if (this.#shouldRetry(endpoint, response.status) && attempt < attempts) {
            await this.#delayForAttempt(attempt);
            continue;
          }
          throw error;
        }

        return await this.#parseBody<T>(response);
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;

        if (this.#isTimeoutError(error)) {
          throw new Error(
            `Komodo API ${endpoint} (${body.type}) timed out after ${this.timeoutMs}ms`
          );
        }

        // Pre-send transport errors (DNS, ECONNRESET before headers, etc.) are
        // safe to retry on any verb because the request never reached Komodo.
        if (this.#isPreSendTransportError(error) && attempt < attempts) {
          await this.#delayForAttempt(attempt);
          continue;
        }

        // Status-code retries for read are handled above; this branch covers
        // network/abort errors after pre-send retries are exhausted.
        if (this.#isTransientError(error) && endpoint === "read" && attempt < attempts) {
          await this.#delayForAttempt(attempt);
          continue;
        }

        throw this.#normalizeError(error, endpoint, body.type);
      }
    }

    throw this.#normalizeError(lastError ?? new Error("attempts exhausted"), endpoint, body.type);
  }

  async #parseBody<T>(response: Response): Promise<T> {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > this.maxResponseBytes) {
      throw new Error(
        `Komodo API response exceeded ${this.maxResponseBytes} bytes (got ${buf.byteLength})`
      );
    }
    if (buf.byteLength === 0) {
      return undefined as unknown as T;
    }
    const text = Buffer.from(buf).toString("utf8");
    return JSON.parse(text) as T;
  }

  #shouldRetry(endpoint: "read" | "write" | "execute", status: number): boolean {
    if (endpoint !== "read") return false;
    return status >= 500 || status === 429;
  }

  #isTimeoutError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "TimeoutError") return true;
    if (error instanceof DOMException && error.name === "AbortError") return true;
    if (error instanceof Error && error.name === "TimeoutError") return true;
    if (error instanceof Error && error.name === "AbortError") return true;
    return false;
  }

  #isTransientError(error: unknown): boolean {
    if (this.#isTimeoutError(error)) return true;
    if (error instanceof TypeError) return true;
    return false;
  }

  /**
   * Pre-send transport errors mean the request never reached the server, so
   * retrying is safe regardless of the HTTP verb. Undici raises these as
   * `TypeError` with a `cause` carrying a libuv code (ECONNREFUSED, ENOTFOUND,
   * ECONNRESET before headers, EAI_AGAIN).
   */
  #isPreSendTransportError(error: unknown): boolean {
    if (!(error instanceof TypeError)) return false;
    const cause = (error as { cause?: { code?: string } }).cause;
    const code = cause?.code;
    if (!code) return false;
    return (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "ECONNRESET" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_SOCKET"
    );
  }

  async #normalizeResponseError(
    response: Response,
    endpoint: "read" | "write" | "execute",
    type: string
  ): Promise<Error> {
    const text = this.#redact(await response.text().catch(() => ""));
    let messageDetail: string | undefined;

    try {
      const parsedBody = JSON.parse(text);
      if (parsedBody && typeof parsedBody === "object") {
        const obj = parsedBody as { message?: unknown; error?: unknown };
        const candidate = obj.message ?? obj.error;
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          messageDetail = candidate;
        } else {
          messageDetail = JSON.stringify(parsedBody);
        }
      }
    } catch {
      // Not JSON — fall through to raw text.
    }

    const detail = this.#redact(messageDetail || text || "Unknown error");
    return new Error(`Komodo API ${endpoint} (${type}) returned ${response.status}: ${detail}`);
  }

  #normalizeError(error: unknown, endpoint: "read" | "write" | "execute", type: string): Error {
    const msg = error instanceof Error ? error.message : String(error);
    return new Error(`Komodo API ${endpoint} (${type}) request failed: ${this.#redact(msg)}`);
  }

  #redact(s: string): string {
    if (!s) return s;
    let out = s;
    // Skip redaction for very short secret values: scrubbing a 1-2 char string
    // would mangle every word containing those letters. Real Komodo creds are
    // long; the < 4 guard is purely a defense against test fixtures using
    // toy values like "k"/"s".
    if (this.#apiSecret && this.#apiSecret.length >= 4) {
      out = out.split(this.#apiSecret).join("[redacted]");
    }
    if (this.#apiKey && this.#apiKey.length >= 4) {
      out = out.split(this.#apiKey).join("[redacted]");
    }
    return out;
  }

  async #delayForAttempt(attempt: number): Promise<void> {
    const baseMs = 100 * 2 ** (attempt - 1);
    const delayMs = Math.floor(baseMs * (0.5 + Math.random()));
    return this.#clock.sleep(delayMs);
  }

  // ============ READ OPERATIONS (thin wrappers retained for backward compat) ============

  async listServers(): Promise<unknown> {
    return this.call("read", "ListServers");
  }
  async listStacks(): Promise<unknown> {
    return this.call("read", "ListStacks");
  }
  async listDeployments(): Promise<unknown> {
    return this.call("read", "ListDeployments");
  }
  async getStack(stack: string): Promise<unknown> {
    return this.call("read", "GetStack", { stack });
  }
  async getStackLog(stack: string): Promise<unknown> {
    return this.call("read", "GetStackLog", { stack });
  }
  async getContainerLog(server: string, container: string, tail?: number): Promise<unknown> {
    return this.call("read", "GetContainerLog", { server, container, tail: tail ?? 100 });
  }
  async listDockerContainers(server: string): Promise<unknown> {
    return this.call("read", "ListDockerContainers", { server });
  }
  async inspectDockerContainer(server: string, container: string): Promise<unknown> {
    return this.call("read", "InspectDockerContainer", { server, container });
  }
  async getSystemStats(server: string): Promise<unknown> {
    return this.call("read", "GetSystemStats", { server });
  }
  async listDockerImages(server: string): Promise<unknown> {
    return this.call("read", "ListDockerImages", { server });
  }
  async listDockerNetworks(server: string): Promise<unknown> {
    return this.call("read", "ListDockerNetworks", { server });
  }
  async listDockerVolumes(server: string): Promise<unknown> {
    return this.call("read", "ListDockerVolumes", { server });
  }
  async listAlerts(): Promise<unknown> {
    return this.call("read", "ListAlerts");
  }
  async searchContainerLog(server: string, container: string, terms: string[]): Promise<unknown> {
    return this.call("read", "SearchContainerLog", { server, container, terms });
  }
  async getStacksSummary(): Promise<unknown> {
    return this.call("read", "GetStacksSummary");
  }

  // ============ EXECUTE OPERATIONS ============

  async deployStack(stack: string): Promise<unknown> {
    return this.call("execute", "DeployStack", { stack });
  }
  async startStack(stack: string): Promise<unknown> {
    return this.call("execute", "StartStack", { stack });
  }
  async stopStack(stack: string): Promise<unknown> {
    return this.call("execute", "StopStack", { stack });
  }
  async restartStack(stack: string): Promise<unknown> {
    return this.call("execute", "RestartStack", { stack });
  }
  async destroyStack(stack: string): Promise<unknown> {
    return this.call("execute", "DestroyStack", { stack });
  }
  async pullStackImages(stack: string): Promise<unknown> {
    return this.call("execute", "PullStackImages", { stack });
  }
  async startContainer(server: string, container: string): Promise<unknown> {
    return this.call("execute", "StartContainer", { server, container });
  }
  async stopContainer(server: string, container: string): Promise<unknown> {
    return this.call("execute", "StopContainer", { server, container });
  }
  async restartContainer(server: string, container: string): Promise<unknown> {
    return this.call("execute", "RestartContainer", { server, container });
  }
  async pruneDockerImages(server: string): Promise<unknown> {
    return this.call("execute", "PruneDockerImages", { server });
  }
  async pruneDockerNetworks(server: string): Promise<unknown> {
    return this.call("execute", "PruneDockerNetworks", { server });
  }
  async pruneDockerSystem(server: string): Promise<unknown> {
    return this.call("execute", "PruneDockerSystem", { server });
  }

  // ============ WRITE OPERATIONS ============

  async createStack(name: string, serverId: string, composeContents?: string): Promise<unknown> {
    return this.call("write", "CreateStack", {
      name,
      config: { server_id: serverId, file_contents: composeContents ?? "" },
    });
  }
  async updateStack(id: string, config: Record<string, unknown>): Promise<unknown> {
    return this.call("write", "UpdateStack", { id, config });
  }
  async deleteStack(id: string): Promise<unknown> {
    return this.call("write", "DeleteStack", { id });
  }
  async writeStackFileContents(stack: string, contents: string): Promise<unknown> {
    return this.call("write", "WriteStackFileContents", { stack, contents });
  }
  async createServer(name: string, address: string): Promise<unknown> {
    return this.call("write", "CreateServer", { name, config: { address } });
  }
  async updateServer(id: string, config: Record<string, unknown>): Promise<unknown> {
    return this.call("write", "UpdateServer", { id, config });
  }
  async deleteServer(id: string): Promise<unknown> {
    return this.call("write", "DeleteServer", { id });
  }
  async renameStack(id: string, name: string): Promise<unknown> {
    return this.call("write", "RenameStack", { id, name });
  }
}
