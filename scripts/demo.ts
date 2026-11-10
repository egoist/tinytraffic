// `bun run demo`: creates (or recreates) a demo site full of realistic
// traffic in the local data directory, then you can `bun dev` and look at it.
//
//   bun run demo                        # demo.tinytraffic.local, 90 days
//   bun run demo -- --days 365 --visitors 5000
//   bun run demo -- my-demo.test
//
// Env: TT_DATA_DIR (default ./data), TT_ADDR (to detect a running server).

import { spawnSync } from "bun";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = join(import.meta.dir, "..");
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    days: { type: "string", default: "90" },
    visitors: { type: "string", default: "1500" },
  },
});
const domain = positionals[0] ?? "demo.tinytraffic.local";
const dataDir = process.env.TT_DATA_DIR ?? join(root, "data");
const port = (process.env.TT_ADDR ?? ":8080").split(":").pop() || "8080";

// DuckDB allows one process per database file, so the server must be stopped.
const running = await fetch(`http://localhost:${port}/healthz`, { signal: AbortSignal.timeout(500) })
  .then((r) => r.ok)
  .catch(() => false);
if (running) {
  console.error(`A tinytraffic server is running on :${port}. Stop \`bun dev\` first, then run this again.`);
  process.exit(1);
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
console.log(`Seeding ${domain} with ${values.days} days of traffic (~${values.visitors} visitors/day, ${timezone})…`);

const result = spawnSync({
  cmd: [
    "go", "run", "./cmd/tinytraffic", "seed",
    "-data", dataDir,
    "-days", values.days!,
    "-visitors", values.visitors!,
    "-timezone", timezone,
    "-reset",
    domain,
  ],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);

console.log(`\nDone. Run \`bun dev\` and open http://localhost:3000/${domain}`);
