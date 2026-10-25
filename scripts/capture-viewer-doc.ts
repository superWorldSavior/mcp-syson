/// <reference lib="deno.ns" />

/**
 * Capture the README images (docs/images/mcp-syson-<view>[-dark].png, light
 * and dark) from the committed viewer bundles through the documentation
 * harness, so they are reproducible: same fixture, same handshake, same
 * viewport, headless Chrome.
 * Two runs agree on layout and text; Chrome's rasterizer still drifts by one
 * luma level on a few anti-aliased pixels, so the bytes are not identical.
 *
 * Usage: deno task docs:viewer-screenshot [view…]  (no view: all of them)
 *   CHROME_BIN  headless-capable Chrome binary (default: local Chrome / shell)
 *   FFMPEG_BIN  optional ffmpeg; when found the PNG is re-encoded deterministically
 */

const scriptDir = new URL(".", import.meta.url).pathname;
const root = await Deno.realPath(scriptDir.replace(/\/scripts\/$/, ""));
const harnessPath = "/docs/fixtures/viewer-preview.html";
/**
 * One image per committed fixture and theme; `view` selects the fixture in
 * the harness. A diagram fills its size; a list viewer takes the height it
 * reports, up to its size. The image is the viewer with a 24 px margin.
 */
const VIEWS = [
  { view: "action-flow", bundle: "diagram-viewer", size: [1180, 760] },
  { view: "state-transition", bundle: "diagram-viewer", size: [760, 980] },
  { view: "interconnection", bundle: "diagram-viewer", size: [760, 980] },
  { view: "model-explorer", bundle: "model-explorer-viewer", size: [760, 640] },
  { view: "query-results", bundle: "query-results-viewer", size: [760, 640] },
  { view: "value-change", bundle: "value-change-viewer", size: [760, 640] },
  { view: "requirements", bundle: "requirements-viewer", size: [760, 640] },
  {
    view: "requirements-trace",
    bundle: "requirements-trace-viewer",
    size: [760, 640],
  },
  { view: "validation", bundle: "validation-viewer", size: [760, 640] },
] as const;
const unknown = Deno.args.filter((name) =>
  !VIEWS.some(({ view }) => view === name)
);
if (unknown.length > 0) {
  throw new Error(
    `CAPTURE_VIEW_UNKNOWN ${unknown.join(", ")} — known: ${
      VIEWS.map(({ view }) => view).join(", ")
    }`,
  );
}
const TARGETS = VIEWS.filter(({ view }) =>
  Deno.args.length === 0 || Deno.args.includes(view)
).flatMap(({ view, bundle, size }) =>
  (["light", "dark"] as const).map((theme) => ({
    view,
    bundle,
    theme,
    image: `mcp-syson-${view}${theme === "dark" ? "-dark" : ""}`,
    window: { width: size[0] + 48, height: size[1] + 48 },
  }))
);

/** Chrome and ffmpeg both finish in seconds; a deadline keeps a stuck one from hanging. */
const TOOL_DEADLINE_MS = 60_000;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

for (
  const required of [
    ...TARGETS.map((target) => `src/ui/dist/${target.bundle}/index.html`),
    harnessPath.slice(1),
  ]
) {
  await Deno.stat(`${root}/${required}`).catch(() => {
    throw new Error(
      `CAPTURE_INPUT_MISSING ${required} — run deno task ui:build first`,
    );
  });
}

let resolvePort!: (port: number) => void;
const listening = new Promise<number>((resolve) => resolvePort = resolve);
const server = Deno.serve(
  { hostname: "127.0.0.1", port: 0, onListen: ({ port }) => resolvePort(port) },
  async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const type = CONTENT_TYPES[pathname.slice(pathname.lastIndexOf("."))];
    if (!type) return new Response("Not found", { status: 404 });
    try {
      // Serve only what resolves inside the repository, whatever the URL spelled:
      // the real path collapses `..` segments and symlinks before the check.
      const file = await Deno.realPath(`${root}${pathname}`);
      if (!file.startsWith(root + "/")) {
        return new Response("Not found", { status: 404 });
      }
      const body = await Deno.readFile(file);
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
);

const port = await listening;
try {
  await Deno.mkdir(`${root}/docs/images`, { recursive: true });
  const chrome = await findExecutable(
    [
      Deno.env.get("CHROME_BIN"),
      "/opt/homebrew/bin/chrome-headless-shell",
      "/usr/local/bin/chrome-headless-shell",
      "/usr/bin/chrome-headless-shell",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ],
    "CHROME_BIN",
  );
  // ffmpeg is optional, unless FFMPEG_BIN names one: then it must exist.
  const ffmpegSearch = findExecutable([
    Deno.env.get("FFMPEG_BIN"),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ]);
  const ffmpeg = Deno.env.get("FFMPEG_BIN") !== undefined
    ? await ffmpegSearch
    : await ffmpegSearch.catch(() => undefined);
  for (const target of TARGETS) {
    const outputPath = `${root}/docs/images/${target.image}.png`;
    // The raw frame lands next to the output so the task only needs docs/images writable.
    const rawScreenshot = `${root}/docs/images/.${target.image}.raw.png`;
    try {
      await captureWhenReady(
        chrome,
        `http://127.0.0.1:${port}${harnessPath}?view=${target.view}&theme=${target.theme}&capture`,
        target.window,
        rawScreenshot,
      );
      if (ffmpeg) {
        await run(ffmpeg, [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-i",
          rawScreenshot,
          "-compression_level",
          "9",
          "-pred",
          "mixed",
          outputPath,
        ]);
      } else {
        await Deno.copyFile(rawScreenshot, outputPath);
      }
      const { size } = await Deno.stat(outputPath);
      console.log(
        `[docs:viewer-screenshot] wrote ${outputPath} (${
          (size / 1024).toFixed(1)
        } KiB)`,
      );
    } finally {
      await Deno.remove(rawScreenshot).catch(() => {});
    }
  }
} finally {
  await server.shutdown();
}

/**
 * Load the harness in headless Chrome and capture it once the harness says
 * the viewer is ready (`data-viewer-ready`): after the recorded session is
 * applied and, for diagrams, after the automatic layout (run by ELK in a
 * worker, which a fixed screenshot delay would race). Driven over the
 * DevTools protocol, so no browser automation package is needed.
 */
async function captureWhenReady(
  chrome: string,
  url: string,
  window: { width: number; height: number },
  outputPath: string,
): Promise<void> {
  const profile = await Deno.makeTempDir({ prefix: "syson-capture-" });
  const browser = new Deno.Command(chrome, {
    args: [
      "--headless=new",
      "--disable-background-networking",
      "--disable-gpu",
      "--force-color-profile=srgb",
      "--hide-scrollbars",
      // Locale-sensitive formatting must not follow the capturing machine.
      "--lang=en-US",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      `--window-size=${window.width},${window.height}`,
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();
  let exited = false;
  const status = browser.status.finally(() => exited = true);
  const deadline = Date.now() + TOOL_DEADLINE_MS;
  /** Settle with `promise`, or fail once the capture deadline has passed. */
  const beforeDeadline = <T>(promise: Promise<T>, what: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`CAPTURE_TOOL_FAILED ${what} timed out: ${url}`)),
          Math.max(0, deadline - Date.now()),
        );
      }),
    ]).finally(() => clearTimeout(timer));
  };
  let socket: WebSocket | undefined;
  try {
    let endpoint: string | undefined;
    while (!endpoint && Date.now() < deadline) {
      if (exited) {
        throw new Error("CAPTURE_TOOL_FAILED Chrome exited before DevTools");
      }
      const port = await Deno.readTextFile(`${profile}/DevToolsActivePort`)
        .then((text) => text.split("\n")[0].trim()).catch(() => "");
      if (port) {
        const pages = await fetch(`http://127.0.0.1:${port}/json/list`)
          .then((response) => response.json()).catch(() => []);
        endpoint = pages.find((page: { type?: string }) => page.type === "page")
          ?.webSocketDebuggerUrl;
      }
      if (!endpoint) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!endpoint) {
      throw new Error("CAPTURE_TOOL_FAILED Chrome DevTools unavailable");
    }
    const devtools = new WebSocket(endpoint);
    socket = devtools;
    let next = 0;
    const pending = new Map<
      number,
      {
        resolve: (result: Record<string, unknown>) => void;
        reject: (error: Error) => void;
      }
    >();
    // A closed or failed socket settles every call still waiting on it.
    const fail = () => {
      for (const call of pending.values()) {
        call.reject(new Error(`CAPTURE_TOOL_FAILED DevTools closed: ${url}`));
      }
      pending.clear();
    };
    devtools.onclose = fail;
    devtools.onmessage = (event) => {
      const message = JSON.parse(event.data);
      pending.get(message.id)?.resolve(message.result ?? {});
      pending.delete(message.id);
    };
    await beforeDeadline(
      new Promise((resolve, reject) => {
        devtools.onopen = resolve;
        devtools.onerror = () => {
          fail();
          reject(new Error(`CAPTURE_TOOL_FAILED DevTools socket: ${url}`));
        };
      }),
      "DevTools connection",
    );
    const send = (method: string, params: Record<string, unknown> = {}) =>
      beforeDeadline(
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const id = ++next;
          pending.set(id, { resolve, reject });
          devtools.send(JSON.stringify({ id, method, params }));
        }),
        method,
      );
    await send("Emulation.setDeviceMetricsOverride", {
      width: window.width,
      height: window.height,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await send("Page.navigate", { url });
    // The harness marks the page ready, or says why it is not.
    let state = "";
    while (!state && Date.now() < deadline) {
      const { result } = await send("Runtime.evaluate", {
        expression:
          "document.documentElement.dataset.viewerError ? 'error:' + document.documentElement.dataset.viewerError : document.documentElement.dataset.viewerReady === 'true' ? 'ready' : ''",
        returnByValue: true,
      }) as { result?: { value?: string } };
      state = result?.value ?? "";
      if (!state) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state !== "ready") {
      throw new Error(
        `CAPTURE_TOOL_FAILED viewer ${state || "not ready"}: ${url}`,
      );
    }
    // Let the last frame (fit, labels) settle before the capture.
    await new Promise((resolve) => setTimeout(resolve, 600));
    // The viewer and its margin, whatever height it took.
    const { result: frame } = await send("Runtime.evaluate", {
      expression:
        "(({ x, y, width, height }) => ({ x, y, width, height }))(document.querySelector('#viewer').getBoundingClientRect())",
      returnByValue: true,
    }) as {
      result?: {
        value?: { x: number; y: number; width: number; height: number };
      };
    };
    const box = frame?.value;
    if (!box) throw new Error("CAPTURE_TOOL_FAILED viewer frame not found");
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: Math.max(0, box.x - 24),
        y: Math.max(0, box.y - 24),
        width: box.width + 48,
        height: box.height + 48,
        scale: 1,
      },
    }) as { data?: string };
    if (!data) throw new Error("CAPTURE_TOOL_FAILED empty screenshot");
    await Deno.writeFile(
      outputPath,
      Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
    );
  } finally {
    socket?.close();
    // Ask Chrome to quit, then insist; its helpers release the profile last.
    try {
      browser.kill("SIGTERM");
    } catch { /* already gone */ }
    const quit = await Promise.race([
      status.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    if (!quit) {
      try {
        browser.kill("SIGKILL");
      } catch { /* already gone */ }
      await status;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await Deno.remove(profile, { recursive: true });
        break;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

async function findExecutable(
  candidates: readonly (string | undefined)[],
  variable = "FFMPEG_BIN",
): Promise<string> {
  // An explicit variable is a claim, not a hint: a bad path fails instead of
  // silently falling through to whatever the machine happens to have.
  const [explicit, ...fallbacks] = candidates;
  if (explicit !== undefined) {
    if (await isFile(explicit)) return explicit;
    throw new Error(
      `CAPTURE_TOOL_MISSING ${variable}=${explicit} is not a file`,
    );
  }
  for (const candidate of fallbacks) {
    if (candidate && await isFile(candidate)) return candidate;
  }
  throw new Error(`CAPTURE_TOOL_MISSING set ${variable} to a local executable`);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

async function run(command: string, args: readonly string[]): Promise<void> {
  const result = await new Deno.Command(command, {
    args: [...args],
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(TOOL_DEADLINE_MS),
  }).output();
  if (result.success) return;
  throw new Error(
    `CAPTURE_TOOL_FAILED ${command} exited ${result.code}: ${
      new TextDecoder().decode(result.stderr).trim()
    }`,
  );
}
