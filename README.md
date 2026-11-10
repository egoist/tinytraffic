# tinytraffic

Simple, privacy-friendly web analytics for personal use. One binary, one
DuckDB file, no cookies.

- **Tracker**: ~1 KB gzipped. Pageviews (including SPA navigation), outbound
  link clicks and custom events. Accepts Plausible's event format, so existing
  Plausible integrations work.
- **Privacy**: no cookies or storage. Visitors are identified by
  `hash(daily salt, site, IP, user agent)`. The salt rotates every day, and the
  IP is never stored. Referrers keep their domain and path; query strings are
  dropped.
- **Dashboard**: visitors, visits, pageviews, bounce rate and visit duration
  over time, plus sources, referrers, pages, locations, devices and goals.
  Click any row to filter. Light and dark themes, works on phones.
- **API**: API keys for scripts and other apps. Read stats, manage sites, and
  send events from your server. See [docs/api.md](docs/api.md).
- **Stack**: Go + DuckDB backend. The dashboard is TanStack Start (SPA mode)
  with Solid and shadcn-style components, embedded in the binary.

## Quick start

With Docker:

```sh
docker run -d --name tinytraffic -p 8080:8080 -v tinytraffic:/data \
  -e TT_PASSWORD=change-me ghcr.io/egoist/tinytraffic:main
```

Behind a reverse proxy (Traefik, Caddy, nginx or Dokploy), add
`-e TT_TRUST_PROXY=true` and drop `-p 8080:8080`, so the proxy is the only way
in. Visitors are then located by their real IP. Without the flag, every visitor
appears to come from the proxy and shows as "Unknown". In Dokploy, add
`TT_TRUST_PROXY=true` under the app's Environment tab.

Or from source. You need [Go](https://go.dev) 1.26+, [Bun](https://bun.sh)
1.4+ and a C compiler (DuckDB is a C++ library, so the Go build uses cgo):

```sh
bun install                   # also fetches the GeoIP database
bun run build                 # tracker + dashboard + bin/tinytraffic
./bin/tinytraffic             # http://localhost:8080
```

On first visit you choose a dashboard password, unless `TT_PASSWORD` set one.
Then add a site and paste its snippet into the site's `<head>`:

```html
<script defer data-domain="example.com" src="https://stats.example.com/js/script.js"></script>
```

## Tracking

Custom events show up under Goals:

```js
tinytraffic("Signup", { props: { plan: "pro" } });
```

Outbound link clicks are tracked as `Outbound Link: Click` automatically.

Script attributes:

| Attribute | |
|---|---|
| `data-domain` | Site to record to. Defaults to the current hostname without `www.` |
| `data-api` | Event endpoint. Defaults to the script's own origin |
| `data-hash` | Count `#/routes` as separate pages |
| `data-outbound="false"` | Don't track outbound link clicks |

If a site moves, change its domain in the site's settings. Stats are kept,
and the old domain keeps recording to the same site until you remove it, so
pages with the old snippet still count.

Visits from localhost and automated browsers are ignored. To exclude your own
visits, run `localStorage.tinytraffic_ignore = "true"` in the console on your
site.

To send events from a backend instead, see
[Sending events](docs/api.md#sending-events) in the API docs.

## Configuration

| Flag | Env | Default | |
|---|---|---|---|
| `-addr` | `TT_ADDR` | `:8080` | Listen address |
| `-data` | `TT_DATA_DIR` | `./data` | Holds `tinytraffic.duckdb` |
| `-memory-limit` | `TT_MEMORY_LIMIT` | `1GB` | DuckDB memory cap |
| `-geoip` | `TT_GEOIP_DB` | see below | Comma-separated `.mmdb` files (MaxMind or DB-IP format, country or city) |
| `-trust-proxy` | `TT_TRUST_PROXY=true` | off | Read client IPs from `CF-Connecting-IP` / `X-Real-IP` / `X-Forwarded-For`. Enable only behind a reverse proxy |
| | `TT_PASSWORD` | | Sets the password on first start, so nobody else can claim the setup screen |

### GeoIP

Locations come from DB-IP's free city database (CC BY 4.0), installed from npm
as [`@ip-location-db/dbip-city-mmdb`](https://www.npmjs.com/package/@ip-location-db/dbip-city-mmdb).
The Docker image includes it, and a source build finds it in `./node_modules`
when started from the repository. To use another database, e.g. MaxMind
GeoLite2, put it at `DATA/geo.mmdb` or pass `-geoip`. The Locations card shows
the credit line the database's license asks for.

To refresh it: `bun update @ip-location-db/dbip-city-mmdb`.

### Commands

These need the server stopped, since DuckDB allows one process per database
file:

```sh
tinytraffic password                    # set a new dashboard password
tinytraffic seed -days 90 demo.local    # fill a site with demo traffic (-reset replaces it)
```

With Docker, run them against the same volume:
`docker run --rm -it -v tinytraffic:/data ghcr.io/egoist/tinytraffic:main password`.

## Deploying

Put tinytraffic behind a TLS-terminating proxy, e.g. Caddy:

```
stats.example.com {
  reverse_proxy localhost:8080
}
```

and start it with `TT_TRUST_PROXY=true`, so visitors aren't all seen as the
proxy's IP.

**Docker images** are published to GHCR by `.github/workflows/docker.yml`, for
amd64 and arm64. Pushes to `main` publish `:main`; version tags (`v1.2.3`)
publish `:1.2.3`, `:1.2` and `:latest`. Data lives in the `/data` volume. To
build the image yourself: `docker build -t tinytraffic .`.

**Dokploy and Docker Swarm**: the database file is locked by one process at a
time, so the new container can't open `/data` while the old one still runs.
Dokploy updates services start-first by default, which makes the new container
fail with a DuckDB lock error, yet Dokploy still reports the deploy as done. In
the app's Swarm settings, set the Update Config and Rollback Config order to
`stop-first`. Each deploy then has a short outage.

**Backups**: stop the server and copy the data directory, or export to Parquet
with the DuckDB CLI:
`duckdb data/tinytraffic.duckdb "EXPORT DATABASE 'backup' (FORMAT parquet)"`.

## Development

```sh
bun run demo         # optional: a demo site with 90 days of fake traffic
bun dev              # everything; open http://localhost:3000
bun run test         # Go tests
bun run typecheck
```

`bun dev` runs three processes with prefixed output:

- the tracker, rebuilt on save
- the Go server on :8080, rebuilt and restarted when a `.go` file changes,
  using `./data`
- the Vite dashboard on :3000 with hot reload, proxying `/api` and `/js` to
  the Go server

Ctrl-C stops all three.

`bun run demo` (re)creates `demo.tinytraffic.local` in `./data`, replacing its
previous stats, so it's safe to run again. Pass a domain or options with
`bun run demo -- --days 365 --visitors 5000 my-demo.test`. Stop `bun dev`
first.

Layout:

```
cmd/tinytraffic      entrypoint and subcommands
internal/ingest      /api/event: bot filter, UA/geo/referrer parsing, visitor hash, sessions
internal/store       DuckDB schema, sites, API keys, batched event writer
internal/stats       dashboard queries
internal/server      HTTP routes: dashboard API, public API (/api/v1), auth, static files
internal/seed        demo traffic generator
web/                 embedded build output (dashboard + tracker)
apps/dashboard       TanStack Start + Solid SPA
packages/tracker     tracker script
scripts/             bun dev and bun run demo
docs/api.md          public API reference
```

## Performance and scaling

Events go into one append-only table. Ingest is buffered in memory and flushed
once a second with DuckDB's appender, so a traffic spike costs one bulk insert
per second. Session metrics (bounce rate, duration, entry and exit pages) are
derived from events at query time.

Measured on an Apple Silicon laptop with 25M events (about a year at ~30K
visitors a day), the database is 555 MB:

- 30-day dashboard queries take 10–100 ms.
- 12-month queries take 0.3–0.6 s.
- Entry/exit pages over 12 months take ~1 s.

Expect a small VPS to be a few times slower.

Time buckets are computed with integer math, using UTC offsets precomputed in
Go, instead of `date_trunc`/`timezone()`. DuckDB's ICU timezone functions were
about 20× slower than the scan itself. A test checks the results against them
across DST changes.

If you outgrow one machine: the storage layer is the writer plus a handful of
queries in `internal/stats`, written to translate to ClickHouse (`MergeTree`
ordered by `(site_id, toDate(ts), visitor_id)`), with stateless ingest nodes in
front.
