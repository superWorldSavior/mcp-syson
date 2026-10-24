/// <reference lib="deno.ns" />

/**
 * Capture the README images (docs/images/mcp-syson-requirements-viewer.png and
 * docs/images/mcp-syson-diagram-viewer.png) from the committed viewer bundles
 * through the documentation harness, so they are reproducible: same fixture,
 * same handshake, same viewport, headless Chrome.
 * Two runs agree on layout and text; Chrome's rasterizer still drifts by one
 * luma level on a few anti-aliased pixels, so the bytes are not identical.
 *
 * Usage: deno task docs:viewer-screenshot
 *   CHROME_BIN  headless-capable Chrome binary (default: local Chrome / shell)
 *   FFMPEG_BIN  optional ffmpeg; when found the PNG is re-encoded deterministically
 */

const scriptDir = new URL(".", import.meta.url).pathname;
const root = await Deno.realPath(scriptDir.replace(/\/scripts\/$/, ""));
const harnessPath = "/docs/fixtures/viewer-preview.html";
/** One image per committed fixture; `view` selects it in the harness. */
const TARGETS = [
  {
    view: "requirements",
    bundle: "requirements-viewer",
    image: "mcp-syson-requirements-viewer",
    window: { width: 900, height: 720 },
  },
  {
    view: "diagram",
    bundle: "diagram-viewer",
    image: "mcp-syson-diagram-viewer",
    window: { width: 900, height: 1240 },
  },
] as const;
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
  const ffmpeg = await findExecutable([
    Deno.env.get("FFMPEG_BIN"),
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ]).catch(() => undefined);
  for (const target of TARGETS) {
    const outputPath = `${root}/docs/images/${target.image}.png`;
    // The raw frame lands next to the output so the task only needs docs/images writable.
    const rawScreenshot = `${root}/docs/images/.${target.image}.raw.png`;
    try {
      await run(chrome, [
        "--headless=new",
        "--disable-background-networking",
        "--disable-gpu",
        "--force-color-profile=srgb",
        "--force-device-scale-factor=2",
        "--hide-scrollbars",
        // Locale-sensitive formatting must not follow the capturing machine.
        "--lang=en-US",
        "--run-all-compositor-stages-before-draw",
        "--timeout=8000",
        "--virtual-time-budget=8000",
        `--window-size=${target.window.width},${target.window.height}`,
        `--screenshot=${rawScreenshot}`,
        `http://127.0.0.1:${port}${harnessPath}?view=${target.view}`,
      ]);
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
