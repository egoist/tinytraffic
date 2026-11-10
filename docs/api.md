# tinytraffic API

An HTTP API for scripts, reports and other apps. It returns the same numbers
as the dashboard and can manage sites.

## Authentication

Create a key in the dashboard under **Account → API keys**. A key is shown
once, starts with `tt_`, and works for every site. There are two kinds:

| Access | Can |
|---|---|
| **Read only** | Read stats |
| **Read & write** | Also [add, change and delete sites](#sites), and [send events on behalf of visitors](#sending-events) |

Send the key as a bearer token:

```sh
curl -H "Authorization: Bearer $TINYTRAFFIC_KEY" \
  "https://stats.example.com/api/v1/sites/example.com/aggregate?period=30d"
```

A missing, wrong or revoked key gets `401`, and a read-only key used for a
write gets `403`:

```json
{ "error": "missing or invalid API key" }
```

Revoking a key in the dashboard takes effect immediately.

### Browsers

The API allows cross-origin requests (CORS) and uses no cookies, so it can be
called from a web page. Anyone who can load that page can read the key, though,
so only do that for stats you're happy to make public. Otherwise call the API
from a server.

### Rate limit

Each key can make 600 requests per minute. Every response carries
`X-RateLimit-Limit` and `X-RateLimit-Remaining`. Over the limit you get `429`
with a `Retry-After` header (in seconds).

## Common parameters

All stats endpoints accept these query parameters.

| Parameter | Values | Default |
|---|---|---|
| `period` | `today`, `yesterday`, `24h`, `7d`, `30d`, `90d`, `month` (this month), `lastmonth`, `12mo`, `all`, `custom` | `30d` |
| `from`, `to` | `YYYY-MM-DD`, both days included. Required for `period=custom` | |
| `interval` | `hour`, `day`, `month`. Timeseries only; picked from the period by default | |
| `f` | A filter, `dimension:value`. Repeat it for several filters, which must all match | |

Periods and buckets use the site's reporting timezone.

**Filters** use the dimensions listed under [breakdown](#breakdown). A `*` in
the value is a wildcard, e.g. `f=page:/blog/*`. Use an empty value for "none",
e.g. `f=source:` for direct traffic. URL-encode values:

```
/api/v1/sites/example.com/aggregate?period=7d&f=source:Hacker%20News&f=page:/blog/*
```

Every stats response includes a `query` object describing the resolved range:

```json
{ "period": "30d", "from": "2026-10-12", "to": "2026-11-10", "interval": "day", "timezone": "Asia/Singapore", "filters": [] }
```

## Endpoints

### List sites

`GET /api/v1/sites`

```json
[
  {
    "id": 1,
    "domain": "example.com",
    "timezone": "Asia/Singapore",
    "created_at": "2026-11-10T10:20:57.79529Z",
    "visitors_24h": 1478,
    "sparkline": [88, 92, 95, "… 24 hourly values, oldest first"]
  }
]
```

### Sites

Write access needed. Bodies are JSON (`Content-Type: application/json`).

`POST /api/v1/sites` adds a site. The domain is normalized (no scheme, no
`www.`); `timezone` is an IANA name and defaults to `UTC`. Returns `201`, or
`409` if the site exists.

```sh
curl -X POST https://stats.example.com/api/v1/sites \
  -H "Authorization: Bearer $TINYTRAFFIC_KEY" -H "Content-Type: application/json" \
  -d '{"domain": "example.com", "timezone": "Europe/Berlin"}'
```

```json
{ "id": 1, "domain": "example.com", "timezone": "Europe/Berlin", "created_at": "2026-11-10T10:27:15.652313Z" }
```

`PATCH /api/v1/sites/{domain}` changes the reporting timezone:
`{"timezone": "Asia/Tokyo"}`.

`DELETE /api/v1/sites/{domain}` deletes the site and all of its stats. This
can't be undone.

### Aggregate

`GET /api/v1/sites/{domain}/aggregate`

Totals for the period, plus the same metrics for the previous period of equal
length (`null` for `period=all`).

```json
{
  "current": {
    "visitors": 53730,
    "visits": 53730,
    "pageviews": 137339,
    "views_per_visit": 2.556,
    "bounce_rate": 44.28,
    "visit_duration": 202.06
  },
  "previous": { "visitors": 48120, "...": "same fields" },
  "query": { "...": "see above" }
}
```

| Metric | Meaning |
|---|---|
| `visitors` | Unique visitors. Visitor IDs rotate daily, so someone who visits on two days counts twice |
| `visits` | Sessions: a visit ends after 30 minutes without activity |
| `pageviews` | Pageview events |
| `views_per_visit` | `pageviews / visits` |
| `bounce_rate` | Percentage of visits with a single event |
| `visit_duration` | Average visit length in seconds |

### Timeseries

`GET /api/v1/sites/{domain}/timeseries`

The same metrics per bucket. `date` is the bucket's start in the site's
timezone. Every bucket in the range is included, so empty ones have zeros.

```json
{
  "points": [
    { "date": "2026-11-04T00:00:00", "visitors": 3914, "visits": 3914, "pageviews": 9969, "views_per_visit": 2.547, "bounce_rate": 44.58, "visit_duration": 201.77 }
  ],
  "query": { "...": "see above" }
}
```

### Breakdown

`GET /api/v1/sites/{domain}/breakdown/{dimension}?limit=10`

Top values of a dimension, sorted by visitors. `limit` is 1–1000 (default 10).
`total_visitors` is the total for the same period and filters, for computing
shares.

```json
{
  "rows": [
    { "value": "", "visitors": 17173, "count": 43846 },
    { "value": "Google", "visitors": 11878, "count": 30634 }
  ],
  "total_visitors": 53730
}
```

An empty `value` means none or unknown, e.g. direct traffic for `source`.

| Dimension | Values | `count` is |
|---|---|---|
| `page` | Page path | pageviews |
| `entry_page`, `exit_page` | First / last page of a visit | visits |
| `source` | Friendly source name: `Google`, `Hacker News`, or the referrer domain | pageviews |
| `referrer` | Referrer domain. Rows also have `links`: how many distinct `referrer_url`s exist under it | pageviews |
| `referrer_url` | Referrer domain + path, e.g. `someblog.dev/posts/tools`, when the browser sent one | pageviews |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | UTM tags | pageviews |
| `country` | ISO 3166-1 alpha-2 code, e.g. `US` | pageviews |
| `region`, `city` | English names | pageviews |
| `browser`, `os` | e.g. `Chrome`, `macOS` | pageviews |
| `device` | `Mobile`, `Tablet`, `Laptop`, `Desktop` (by screen width) | pageviews |
| `event` | Custom event name (excludes pageviews) | completions |

To list the links under one referrer domain:

```
/api/v1/sites/example.com/breakdown/referrer_url?f=referrer:someblog.dev
```

### Realtime

`GET /api/v1/sites/{domain}/realtime`

Visitors seen in the last 5 minutes.

```json
{ "visitors": 12 }
```

## Errors

Errors are JSON with an `error` message:

| Status | When |
|---|---|
| `400` | Bad parameter, e.g. an unknown `period`, filter or dimension |
| `401` | Missing, wrong or revoked API key |
| `403` | A read-only key tried to write |
| `404` | No such site or endpoint |
| `409` | The site already exists |
| `429` | Rate limit exceeded |

## Sending events

`POST /api/event` records events. It's what the tracker script calls, so it
needs no key. Your own code can use it too:

```sh
curl -X POST https://stats.example.com/api/event \
  -H "Authorization: Bearer $TINYTRAFFIC_KEY" \
  -H "User-Agent: $VISITOR_USER_AGENT" \
  -H "X-Forwarded-For: $VISITOR_IP" \
  -d '{"name": "Signup", "url": "https://example.com/pricing", "domain": "example.com", "props": {"plan": "pro"}}'
```

It accepts Plausible's event format (`name`, `url`, `domain`, `referrer`,
`props`, or the short `n`, `u`, `d`, `r`, `p`) and always answers `202`.

Visitors are identified by IP and user agent, and their location comes from
the IP. When you send events from a server, pass the visitor's user agent as
`User-Agent` and their IP as `X-Forwarded-For`, **with a read & write key**.
Without one, `X-Forwarded-For` is ignored (anyone could fake it), so every
event would look like your server visiting. The IP is used for the visitor
hash and location, then discarded.
