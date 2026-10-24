/**
 * Runs ELK only when Auto layout is chosen (syson-diagram-design.md §4).
 *
 * The viewer ships as one HTML file, so ELK's code is bundled as an inert
 * string (Vite `?raw`, behind a lazy glob import): opening a diagram in the
 * default SysON layout never parses or runs it. On first use the string
 * starts a Web Worker from a Blob URL, keeping big views responsive; a host
 * whose content policy forbids Blob workers gets the same code run on the
 * page through ELK's own in-thread worker shim.
 */
import type { ElkNode } from "./diagram-elk.ts";

declare global {
  interface ImportMeta {
    /** Vite import-glob: one lazy loader per matched file. */
    glob(
      pattern: string,
      options: { query: string; import: string },
    ): Record<string, () => Promise<unknown>>;
  }
}

/** The worker script of elkjs (pinned in src/ui/package.json). */
const ELK_SOURCES = import.meta.glob(
  "../../node_modules/elkjs/lib/elk-worker.min.js",
  { query: "?raw", import: "default" },
);

const ALGORITHMS = ["layered", "rectpacking"];
const START_TIMEOUT_MS = 15_000;

interface WorkerLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate?: () => void;
}

export type ElkEngineKind = "worker" | "page";

interface ElkEngine {
  readonly kind: ElkEngineKind;
  layout(graph: ElkNode): Promise<ElkNode>;
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "g", "detailMessage"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
  }
  return String(value);
}

/** ELK's message protocol: `{ id, cmd, … }` answered by `{ id, data | error }`. */
function channel(worker: WorkerLike, kind: ElkEngineKind) {
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  worker.onmessage = (event) => {
    const answer = event.data as {
      id?: number;
      data?: unknown;
      error?: unknown;
    };
    const waiting = typeof answer?.id === "number"
      ? pending.get(answer.id)
      : undefined;
    if (!waiting) return;
    pending.delete(answer.id!);
    if (answer.error !== undefined) {
      waiting.reject(new Error(errorText(answer.error)));
    } else waiting.resolve(answer.data);
  };
  const send = (message: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...message, id });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  const fail = (error: Error) => {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  };
  const engine: ElkEngine = {
    kind,
    layout: async (graph) =>
      await send({
        cmd: "layout",
        graph,
        layoutOptions: {},
        options: {},
      }) as ElkNode,
  };
  return { send, fail, engine };
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function startWorker(source: string): Promise<ElkEngine> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  let worker: Worker | undefined;
  try {
    worker = new Worker(url);
    const started = worker;
    const link = channel(started as unknown as WorkerLike, "worker");
    const failed = new Promise<never>((_, reject) => {
      started.onerror = (event) => {
        const error = new Error(event.message || "ELK worker failed");
        link.fail(error);
        reject(error);
      };
    });
    await withTimeout(
      Promise.race([
        link.send({ cmd: "register", algorithms: ALGORITHMS }),
        failed,
      ]),
      START_TIMEOUT_MS,
      "ELK worker start",
    );
    return link.engine;
  } catch (error) {
    worker?.terminate();
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const PAGE_MODULE = "__sysonElkModule";

/** ELK's in-thread shim, evaluated once as an inline script. */
async function startOnPage(source: string): Promise<ElkEngine> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const script = document.createElement("script");
  script.textContent = `(function(module, exports) {\n${source}\n}).call(` +
    `self, self.${PAGE_MODULE} = { exports: {} }, self.${PAGE_MODULE}.exports);`;
  (document.head ?? document.documentElement).append(script);
  script.remove();
  const module = scope[PAGE_MODULE] as
    | { exports?: { Worker?: new () => WorkerLike } }
    | undefined;
  delete scope[PAGE_MODULE];
  const Shim = module?.exports?.Worker;
  if (typeof Shim !== "function") {
    throw new Error("ELK could not start on this page");
  }
  const link = channel(new Shim(), "page");
  await withTimeout(
    link.send({ cmd: "register", algorithms: ALGORITHMS }),
    START_TIMEOUT_MS,
    "ELK start",
  );
  return link.engine;
}

let engine: Promise<ElkEngine> | undefined;

async function loadEngine(): Promise<ElkEngine> {
  const load = Object.values(ELK_SOURCES)[0];
  if (!load) throw new Error("ELK is not bundled");
  const source = await load();
  if (typeof source !== "string" || !source) {
    throw new Error("ELK is not bundled");
  }
  if (typeof Worker === "function" && typeof Blob === "function") {
    try {
      return await startWorker(source);
    } catch { /* Content policy without Blob workers: run on the page. */ }
  }
  return await startOnPage(source);
}

export interface ElkLayoutRun {
  readonly graph: ElkNode;
  /** Wall time of this request, including the first engine start. */
  readonly ms: number;
  readonly engine: ElkEngineKind;
}

/** One layout request; the engine starts on first use and is then reused. */
export async function runElkLayout(graph: ElkNode): Promise<ElkLayoutRun> {
  const started = performance.now();
  engine ??= loadEngine();
  let ready: ElkEngine;
  try {
    ready = await engine;
  } catch (error) {
    engine = undefined;
    throw error;
  }
  const result = await ready.layout(graph);
  return { graph: result, ms: performance.now() - started, engine: ready.kind };
}
