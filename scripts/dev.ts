// `bun dev`: runs the whole app for development.
//
//   tracker  bun build --watch → web/static/script.js (served live by the Go server)
//   server   go build + run, rebuilt and restarted when a .go file changes
//   web      Vite dev server with HMR, proxying /api and /js to the Go server
//
// Env: TT_ADDR (Go listen address, default :8080), TT_DATA_DIR (default ./data),
// plus anything else the server reads (TT_PASSWORD, TT_GEOIP_DB, ...).

import { spawn, type Subprocess } from "bun";
import { watch } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const addr = process.env.TT_ADDR ?? ":8080";
const apiPort = addr.split(":").pop() || "8080";
const env = { ...process.env, FORCE_COLOR: "1" };

const colors = { dev: 33, tracker: 35, server: 36, web: 32 } as const;
type Name = keyof typeof colors;

let stopping = false;

function log(name: Name, line: string) {
  if (stopping) return; // children complain about being killed; that's expected
  process.stdout.write(`\x1b[${colors[name]}m${name.padEnd(8)}\x1b[0m\x1b[2m│\x1b[0m ${line}\n`);
}

async function pipe(name: Name, stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) log(name, line);
  }
  if (buf.trim()) log(name, buf);
}

const children = new Set<Subprocess>();

function run(name: Name, cmd: string[], opts: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
  const proc = spawn({
    cmd,
    cwd: opts.cwd ?? root,
    env: opts.env ?? env,
    stdout: "pipe",
    stderr: "pipe",
  });
  children.add(proc);
  proc.exited.then(() => children.delete(proc));
  pipe(name, proc.stdout);
  pipe(name, proc.stderr);
  return proc;
}

// --- tracker ---

run("tracker", ["bun", "build", "src/script.ts", "--watch", "--target", "browser", "--format", "iife", "--outfile", "../../web/static/script.js"], {
  cwd: join(root, "packages/tracker"),
});

// --- Go server ---

let server: Subprocess | null = null;
let building = false;
let queued = false;

async function rebuildServer() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const started = performance.now();
  log("server", server ? "change detected, rebuilding…" : "building…");
  const build = run("server", ["go", "build", "-o", "bin/tinytraffic-dev", "./cmd/tinytraffic"]);
  if ((await build.exited) === 0) {
    log("server", `built in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    if (server) {
      server.kill("SIGTERM"); // graceful: flushes buffered events
      await server.exited;
    }
    const proc = run("server", ["bin/tinytraffic-dev", "serve"], {
      env: {
        ...env,
        TT_ADDR: addr,
        TT_DATA_DIR: process.env.TT_DATA_DIR ?? join(root, "data"),
        TT_TRACKER_PATH: join(root, "web/static/script.js"),
      },
    });
    server = proc;
    proc.exited.then((code) => {
      if (server === proc && code !== 0 && code !== null) log("server", `exited with code ${code}; save a .go file to restart`);
    });
  } else {
    log("server", server ? "build failed, the previous server is still running" : "build failed");
  }
  building = false;
  if (queued) {
    queued = false;
    rebuildServer();
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
for (const dir of ["cmd", "internal", "web"]) {
  watch(join(root, dir), { recursive: true }, (_event, file) => {
    if (!file || !file.endsWith(".go") || file.endsWith("_test.go")) return;
    clearTimeout(debounce);
    debounce = setTimeout(rebuildServer, 150);
  });
}
rebuildServer();

// --- dashboard ---

run("web", ["bun", "--bun", "vite", "dev", "--port", "3000", "--strictPort"], {
  cwd: join(root, "apps/dashboard"),
  env: { ...env, TT_API: `http://localhost:${apiPort}` },
});

log("dev", `dashboard → \x1b[1mhttp://localhost:3000\x1b[0m   (API on :${apiPort}, data in ${process.env.TT_DATA_DIR ?? "./data"})`);

// --- shutdown ---

async function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of children) p.kill("SIGTERM");
  await Promise.race([Promise.all([...children].map((p) => p.exited)), Bun.sleep(5000)]);
  for (const p of children) p.kill("SIGKILL");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
