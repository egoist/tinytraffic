# tinytraffic

Simple, privacy-friendly web analytics for personal use. One binary, one
DuckDB file, no cookies.

- **Tracker**: ~1 KB gzipped. Pageviews (including SPA navigation), outbound
  link clicks and custom events. Accepts Plausible's event payload, so existing
  Plausible integrations work.
- **Privacy**: no cookies or storage. Visitors are identified by
  `hash(daily salt, site, IP, user agent)`; the salt rotates every day and the
  IP is never stored.
- **Dashboard**: visitors, visits, pageviews, bounce rate and visit duration,
  plus sources, pages, locations, devices and goals. Click any row to filter.
- **Stack**: Go + DuckDB backend; TanStack Start (SPA mode) + Solid +
  shadcn-style components for the dashboard, embedded in the binary.

## Quick start

```sh
bun install
bun run build                 # tracker + dashboard + bin/tinytraffic
./bin/tinytraffic             # http://localhost:8080
```

On first visit you choose a dashboard password. Then add a site and paste the
snippet into its `<head>`:

```html
<script defer data-domain="example.com" src="https://stats.example.com/js/script.js"></script>
```

Custom events:

```js
tinytraffic("Signup", { props: { plan: "pro" } });
```

Script attributes: `data-domain` (defaults to the current hostname),
`data-api` (event endpoint), `data-hash` (count `#/routes` as pages) and
`data-outbound="false"` (don't track outbound links). Visits from localhost
and automated browsers are ignored. To exclude yourself, run
`localStorage.tinytraffic_ignore = "true"` on your site.

## Configuration

| Flag | Env | Default | |
|---|---|---|---|
| `-addr` | `TT_ADDR` | `:8080` | Listen address |
| `-data` | `TT_DATA_DIR` | `./data` | Holds `tinytraffic.duckdb` |
| `-memory-limit` | `TT_MEMORY_LIMIT` | `1GB` | DuckDB memory cap |
| `-geoip` | `TT_GEOIP_DB` | `DATA/geo.mmdb` if present | MaxMind-format `.mmdb` (GeoLite2 or DB-IP Lite, country or city) |
| `-trust-proxy` | `TT_TRUST_PROXY=true` | off | Read client IPs from `CF-Connecting-IP` / `X-Real-IP` / `X-Forwarded-For`. Enable only behind a reverse proxy |
| | `TT_PASSWORD` | | Sets the password on first start, so nobody else can claim the setup screen |

Locations need a GeoIP database. The free DB-IP Lite one works (CC BY 4.0):

```sh
curl -L https://download.db-ip.com/free/dbip-city-lite-$(date +%Y-%m).mmdb.gz | gunzip > data/geo.mmdb
```

Other commands (stop the server first; DuckDB allows one process per file):

```sh
tinytraffic password                    # reset the dashboard password
tinytraffic seed -days 90 demo.local    # fill a site with demo traffic (-reset replaces it)
```

## Deploying

With Docker:

```sh
docker build -t tinytraffic .
docker run -d --name tinytraffic -p 8080:8080 -v tinytraffic:/data \
  -e TT_PASSWORD=change-me -e TT_TRUST_PROXY=true tinytraffic
```

Data lives in the `/data` volume. Put a GeoIP database at `/data/geo.mmdb` to
enable locations. Run the other subcommands against the same volume with the
container stopped, e.g.
`docker run --rm -it -v tinytraffic:/data tinytraffic password`.

Or run the binary directly. Either way, put it behind a TLS-terminating proxy,
e.g. Caddy:

```
stats.example.com {
  reverse_proxy localhost:8080
}
```

and start it with `TT_TRUST_PROXY=true`. Back up by stopping the server and
copying `data/`, or export to Parquet with the DuckDB CLI:
`duckdb data/tinytraffic.duckdb "EXPORT DATABASE 'backup' (FORMAT parquet)"`.

## Development

```sh
bun run demo         # optional: a demo site with 90 days of fake traffic
bun dev              # everything: open http://localhost:3000
bun run test         # Go tests
bun run typecheck
```

`bun dev` runs three processes with prefixed output: the tracker in watch
mode, the Go server on :8080 (rebuilt and restarted when a `.go` file
changes, using `./data`), and the Vite dashboard on :3000 with hot reload,
which proxies `/api` and `/js` to the Go server. Ctrl-C stops all three.

`bun run demo` (re)creates `demo.tinytraffic.local` in `./data`, replacing its
previous stats, so it's safe to run again. Pass a domain or options with
`bun run demo -- --days 365 --visitors 5000 my-demo.test`. Stop `bun dev`
first: DuckDB allows one process per database file.

Layout:

```
cmd/tinytraffic      entrypoint and subcommands
internal/ingest      /api/event: bot filter, UA/geo/referrer parsing, visitor hash, sessions
internal/store       DuckDB schema, sites, batched event writer (appender)
internal/stats       dashboard queries
internal/server      HTTP routes, auth, static files
web/                 embedded build output (dashboard + tracker)
apps/dashboard       TanStack Start + Solid SPA
packages/tracker     tracker script
```

## Performance and scaling

Events go into one append-only table. Ingest is buffered in memory and
flushed once a second with DuckDB's appender, so a traffic spike costs one
bulk insert per second. Session metrics (bounce rate, duration, entry and exit
pages) are derived from events at query time.

Measured on an Apple Silicon laptop with 25M events, about a year at ~30K
visitors/day: the database is 555 MB. 30-day dashboard queries take
10–100 ms. 12-month queries take 0.3–0.6 s, except entry/exit pages, which
take ~1 s. Expect a small VPS to be a few times slower.

Time buckets are computed with integer math, using UTC offsets precomputed in
Go, instead of `date_trunc`/`timezone()`: ICU timezone functions were about
20× slower than the scan itself. A test checks the results against DuckDB's
ICU functions across DST changes.

If you outgrow one machine: the storage layer is the writer plus a handful of
queries in `internal/stats`, written to translate to ClickHouse (`MergeTree`
ordered by `(site_id, toDate(ts), visitor_id)`), with stateless ingest nodes
in front.
