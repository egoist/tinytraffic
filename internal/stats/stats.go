package stats

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"strconv"
	"time"
)

type Metrics struct {
	Visitors      int64   `json:"visitors"`
	Visits        int64   `json:"visits"`
	Pageviews     int64   `json:"pageviews"`
	ViewsPerVisit float64 `json:"views_per_visit"`
	BounceRate    float64 `json:"bounce_rate"`    // percent
	VisitDuration float64 `json:"visit_duration"` // seconds
}

type AggregateResult struct {
	Current  Metrics  `json:"current"`
	Previous *Metrics `json:"previous"`
}

// Session metrics are derived from events at query time: a bounce is a
// session with a single event, duration is last event minus first.
const metricsSQL = `
WITH e AS (SELECT visitor_id, session_id, name, ts FROM events WHERE %s),
s AS (
	SELECT session_id, count(*) AS n, count(*) FILTER (WHERE name = 'pageview') AS pv,
	       (epoch_us(max(ts)) - epoch_us(min(ts))) / 1e6 AS dur
	FROM e GROUP BY session_id
)
SELECT
	(SELECT count(DISTINCT visitor_id) FROM e),
	(SELECT count(*) FROM s),
	(SELECT count(*) FROM e WHERE name = 'pageview'),
	coalesce((SELECT avg(CASE WHEN n <= 1 THEN 100.0 ELSE 0 END) FROM s), 0),
	coalesce((SELECT avg(dur) FROM s), 0)`

func metrics(ctx context.Context, db *sql.DB, q Query, start, end time.Time) (Metrics, error) {
	where, args := q.where(start, end)
	var m Metrics
	err := db.QueryRowContext(ctx, fmt.Sprintf(metricsSQL, where), args...).
		Scan(&m.Visitors, &m.Visits, &m.Pageviews, &m.BounceRate, &m.VisitDuration)
	if m.Visits > 0 {
		m.ViewsPerVisit = float64(m.Pageviews) / float64(m.Visits)
	}
	return m, err
}

func Aggregate(ctx context.Context, db *sql.DB, q Query, now time.Time) (AggregateResult, error) {
	var res AggregateResult
	cur, err := metrics(ctx, db, q, q.Start, q.End)
	if err != nil {
		return res, err
	}
	res.Current = cur
	if q.Period != "all" {
		end := q.clampedEnd(now)
		span := end.Sub(q.Start)
		prev, err := metrics(ctx, db, q, q.Start.Add(-span), q.Start)
		if err != nil {
			return res, err
		}
		res.Previous = &prev
	}
	return res, nil
}

type Point struct {
	Date string `json:"date"` // local time, ISO 8601 without offset
	Metrics
}

const bucketLayout = "2006-01-02T15:04:05"

const timeseriesSQL = `
WITH e AS (
	SELECT visitor_id, session_id, name, epoch_us(ts) AS us, %[1]s AS bucket
	FROM events WHERE %[2]s
),
v AS (
	SELECT bucket, count(DISTINCT visitor_id) AS visitors, count(*) FILTER (WHERE name = 'pageview') AS pageviews
	FROM e GROUP BY bucket
),
s AS (
	SELECT session_id, min(bucket) AS bucket, count(*) AS n, (max(us) - min(us)) / 1e6 AS dur
	FROM e GROUP BY session_id
),
sb AS (
	SELECT bucket, count(*) AS visits, avg(CASE WHEN n <= 1 THEN 100.0 ELSE 0 END) AS bounce, avg(dur) AS dur
	FROM s GROUP BY bucket
)
SELECT v.bucket, v.visitors, v.pageviews, coalesce(sb.visits, 0), coalesce(sb.bounce, 0), coalesce(sb.dur, 0)
FROM v LEFT JOIN sb USING (bucket)`

// Timeseries returns one point per interval, including empty ones. Sessions
// count toward the bucket they started in.
func Timeseries(ctx context.Context, db *sql.DB, q Query) ([]Point, error) {
	where, args := q.where(q.Start, q.End)
	b := newBucketer(q.Loc, q.Start, q.End, q.Interval)
	rows, err := db.QueryContext(ctx, fmt.Sprintf(timeseriesSQL, b.keySQL("epoch_us(ts)"), where), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byBucket := map[int64]Metrics{}
	for rows.Next() {
		var k int64
		var m Metrics
		if err := rows.Scan(&k, &m.Visitors, &m.Pageviews, &m.Visits, &m.BounceRate, &m.VisitDuration); err != nil {
			return nil, err
		}
		if m.Visits > 0 {
			m.ViewsPerVisit = float64(m.Pageviews) / float64(m.Visits)
		}
		byBucket[k] = m
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var points []Point
	for t := q.Start; t.Before(q.End); t = step(t, q.Interval) {
		points = append(points, Point{Date: t.Format(bucketLayout), Metrics: byBucket[b.key(t)]})
	}
	return points, nil
}

func step(t time.Time, interval string) time.Time {
	switch interval {
	case "hour":
		return t.Add(time.Hour)
	case "month":
		return t.AddDate(0, 1, 0)
	default:
		return t.AddDate(0, 0, 1)
	}
}

type Row struct {
	Value    string `json:"value"`
	Visitors int64  `json:"visitors"`
	// Count is pageviews for pages, visits for entry/exit pages, completions
	// for events and pageviews for everything else.
	Count int64 `json:"count"`
	// Links is, for referrer domains, how many distinct links with a path
	// were seen under the domain (see the referrer_url dimension).
	Links int64 `json:"links,omitempty"`
}

type BreakdownResult struct {
	Rows          []Row `json:"rows"`
	TotalVisitors int64 `json:"total_visitors"`
}

func Breakdown(ctx context.Context, db *sql.DB, q Query, dim string, limit int) (BreakdownResult, error) {
	where, args := q.where(q.Start, q.End)
	var sqlText, totalSQL string
	switch dim {
	case "entry_page", "exit_page":
		col := "entry"
		if dim == "exit_page" {
			col = "exit"
		}
		sqlText = fmt.Sprintf(`
WITH s AS (
	SELECT session_id, any_value(visitor_id) AS visitor_id,
	       arg_min(pathname, ts) AS entry, arg_max(pathname, ts) AS exit
	FROM events WHERE %s AND name = 'pageview' GROUP BY session_id
)
SELECT %s, count(DISTINCT visitor_id) AS visitors, count(*) AS c, 0 FROM s
GROUP BY 1 ORDER BY visitors DESC, c DESC, 1 LIMIT ?`, where, col)
		totalSQL = fmt.Sprintf(`SELECT count(DISTINCT visitor_id) FROM events WHERE %s AND name = 'pageview'`, where)
	case "event":
		sqlText = fmt.Sprintf(`
SELECT name, count(DISTINCT visitor_id) AS visitors, count(*) AS c, 0 FROM events
WHERE %s AND name <> 'pageview' GROUP BY 1 ORDER BY visitors DESC, c DESC, 1 LIMIT ?`, where)
		totalSQL = fmt.Sprintf(`SELECT count(DISTINCT visitor_id) FROM events WHERE %s`, where)
	default:
		col, ok := columns[dim]
		if !ok {
			return BreakdownResult{}, fmt.Errorf("unknown dimension %q", dim)
		}
		extra, links := "", "0"
		if dim == "page" {
			extra = " AND name = 'pageview'"
		}
		if dim == "referrer" {
			links = "count(DISTINCT referrer) FILTER (WHERE contains(referrer, '/'))"
		}
		sqlText = fmt.Sprintf(`
SELECT %s, count(DISTINCT visitor_id) AS visitors, count(*) FILTER (WHERE name = 'pageview') AS c, %s FROM events
WHERE %s%s GROUP BY 1 ORDER BY visitors DESC, c DESC, 1 LIMIT ?`, col, links, where, extra)
		totalSQL = fmt.Sprintf(`SELECT count(DISTINCT visitor_id) FROM events WHERE %s%s`, where, extra)
	}

	res := BreakdownResult{Rows: []Row{}}
	rows, err := db.QueryContext(ctx, sqlText, append(args, limit)...)
	if err != nil {
		return res, err
	}
	defer rows.Close()
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.Value, &r.Visitors, &r.Count, &r.Links); err != nil {
			return res, err
		}
		res.Rows = append(res.Rows, r)
	}
	if err := rows.Err(); err != nil {
		return res, err
	}
	err = db.QueryRowContext(ctx, totalSQL, args...).Scan(&res.TotalVisitors)
	return res, err
}

// Realtime counts visitors seen in the last five minutes.
func Realtime(ctx context.Context, db *sql.DB, siteID int32, now time.Time) (int64, error) {
	var n int64
	err := db.QueryRowContext(ctx,
		`SELECT count(DISTINCT visitor_id) FROM events WHERE site_id = ? AND ts >= ?`,
		siteID, now.Add(-5*time.Minute).UTC()).Scan(&n)
	return n, err
}

// FirstEvent returns the time of a site's earliest event.
func FirstEvent(ctx context.Context, db *sql.DB, siteID int32) (time.Time, bool) {
	var t sql.NullTime
	if err := db.QueryRowContext(ctx, `SELECT min(ts) FROM events WHERE site_id = ?`, siteID).Scan(&t); err != nil || !t.Valid {
		return time.Time{}, false
	}
	return t.Time, true
}

type SiteSummary struct {
	Visitors  int64   `json:"visitors"`
	Sparkline []int64 `json:"sparkline"` // hourly visitors, oldest first
}

// Overview returns visitors over the last 24 hours and an hourly sparkline
// of the 24 complete hours before the current one, for every site.
func Overview(ctx context.Context, db *sql.DB, now time.Time) (map[int32]*SiteSummary, error) {
	end := now.UTC().Truncate(time.Hour)
	start := end.Add(-24 * time.Hour)
	out := map[int32]*SiteSummary{}
	get := func(id int32) *SiteSummary {
		if s, ok := out[id]; ok {
			return s
		}
		s := &SiteSummary{Sparkline: make([]int64, 24)}
		out[id] = s
		return s
	}

	rows, err := db.QueryContext(ctx, `
SELECT site_id, CAST((epoch_us(ts) - ?) // 3600000000 AS INTEGER) AS h, count(DISTINCT visitor_id)
FROM events WHERE ts >= ? AND ts < ? GROUP BY 1, 2`, start.UnixMicro(), start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int32
		var h int
		var n int64
		if err := rows.Scan(&id, &h, &n); err != nil {
			return nil, err
		}
		if h >= 0 && h < 24 {
			get(id).Sparkline[h] = n
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	totals, err := db.QueryContext(ctx, `
SELECT site_id, count(DISTINCT visitor_id) FROM events WHERE ts >= ? GROUP BY 1`, now.UTC().Add(-24*time.Hour))
	if err != nil {
		return nil, err
	}
	defer totals.Close()
	for totals.Next() {
		var id int32
		var n int64
		if err := totals.Scan(&id, &n); err != nil {
			return nil, err
		}
		get(id).Visitors = n
	}
	return out, totals.Err()
}

type LocationPoint struct {
	Country  string  `json:"country"`
	City     string  `json:"city"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Visitors int64   `json:"visitors"`
}

// Locations returns one point per city, busiest first, for maps. Events
// without coordinates are left out.
func Locations(ctx context.Context, db *sql.DB, q Query, limit int) ([]LocationPoint, error) {
	where, args := q.where(q.Start, q.End)
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`
SELECT country, city, avg(latitude), avg(longitude), count(DISTINCT visitor_id) AS visitors
FROM events WHERE %s AND latitude IS NOT NULL
GROUP BY country, city ORDER BY visitors DESC, country, city LIMIT ?`, where), append(args, limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LocationPoint{}
	for rows.Next() {
		var p LocationPoint
		if err := rows.Scan(&p.Country, &p.City, &p.Lat, &p.Lon, &p.Visitors); err != nil {
			return nil, err
		}
		p.Lat, p.Lon = round2(p.Lat), round2(p.Lon)
		out = append(out, p)
	}
	return out, rows.Err()
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

// LiveWindow is how far back the live view looks, the same window as
// Realtime's "current visitors".
const LiveWindow = 5 * time.Minute

// LiveSession is a visit with activity in the live window.
type LiveSession struct {
	ID        string    `json:"id"`
	Country   string    `json:"country"`
	Region    string    `json:"region"`
	City      string    `json:"city"`
	Lat       *float64  `json:"lat"` // nil when the location is unknown
	Lon       *float64  `json:"lon"`
	Page      string    `json:"page"` // the last page viewed
	Source    string    `json:"source"`
	Referrer  string    `json:"referrer"`
	Browser   string    `json:"browser"`
	OS        string    `json:"os"`
	Device    string    `json:"device"`
	Pageviews int64     `json:"pageviews"`
	Events    int64     `json:"events"` // custom events
	StartedAt time.Time `json:"started_at"`
	LastSeen  time.Time `json:"last_seen"`
}

// LiveEvent is one entry of the live activity feed.
type LiveEvent struct {
	Timestamp time.Time `json:"ts"`
	Session   string    `json:"session"`
	Name      string    `json:"name"`
	Page      string    `json:"page"`
}

type LiveResult struct {
	Visitors int64         `json:"visitors"`
	Sessions []LiveSession `json:"sessions"`
	Events   []LiveEvent   `json:"events"` // newest first
}

// Live returns the sessions active in the last LiveWindow, most recently
// active first, and their latest events. Session details (entry source,
// start time, pageviews) cover the whole visit, not only the window.
func Live(ctx context.Context, db *sql.DB, siteID int32, now time.Time, limit int) (LiveResult, error) {
	res := LiveResult{Sessions: []LiveSession{}, Events: []LiveEvent{}}
	since := now.Add(-LiveWindow).UTC()
	// Sessions end after 30 minutes of inactivity but can run longer; a few
	// hours back covers all but marathon visits.
	visitStart := now.Add(-6 * time.Hour).UTC()

	if err := db.QueryRowContext(ctx,
		`SELECT count(DISTINCT visitor_id) FROM events WHERE site_id = ? AND ts >= ?`,
		siteID, since).Scan(&res.Visitors); err != nil {
		return res, err
	}

	rows, err := db.QueryContext(ctx, `
WITH active AS (
	SELECT session_id, max(ts) AS last_seen FROM events
	WHERE site_id = ? AND ts >= ? GROUP BY 1 ORDER BY 2 DESC LIMIT ?
)
SELECT e.session_id, any_value(a.last_seen),
	arg_max(e.country, e.ts), arg_max(e.region, e.ts), arg_max(e.city, e.ts),
	arg_max(e.latitude, e.ts), arg_max(e.longitude, e.ts),
	coalesce(arg_max(e.pathname, e.ts) FILTER (WHERE e.name = 'pageview'), arg_max(e.pathname, e.ts)),
	arg_min(e.referrer_source, e.ts), arg_min(e.referrer, e.ts),
	arg_max(e.browser, e.ts), arg_max(e.os, e.ts), arg_max(e.device, e.ts),
	count(*) FILTER (WHERE e.name = 'pageview'), count(*) FILTER (WHERE e.name <> 'pageview'),
	min(e.ts)
FROM events e JOIN active a USING (session_id)
WHERE e.site_id = ? AND e.ts >= ?
GROUP BY e.session_id ORDER BY 2 DESC`, siteID, since, limit, siteID, visitStart)
	if err != nil {
		return res, err
	}
	defer rows.Close()
	for rows.Next() {
		var s LiveSession
		var id uint64
		var lat, lon sql.NullFloat64
		if err := rows.Scan(&id, &s.LastSeen, &s.Country, &s.Region, &s.City, &lat, &lon,
			&s.Page, &s.Source, &s.Referrer, &s.Browser, &s.OS, &s.Device,
			&s.Pageviews, &s.Events, &s.StartedAt); err != nil {
			return res, err
		}
		s.ID = sessionKey(id)
		if lat.Valid && lon.Valid {
			la, lo := round2(lat.Float64), round2(lon.Float64)
			s.Lat, s.Lon = &la, &lo
		}
		res.Sessions = append(res.Sessions, s)
	}
	if err := rows.Err(); err != nil {
		return res, err
	}

	events, err := db.QueryContext(ctx, `
SELECT ts, session_id, name, pathname FROM events
WHERE site_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 50`, siteID, since)
	if err != nil {
		return res, err
	}
	defer events.Close()
	for events.Next() {
		var e LiveEvent
		var id uint64
		if err := events.Scan(&e.Timestamp, &id, &e.Name, &e.Page); err != nil {
			return res, err
		}
		e.Session = sessionKey(id)
		res.Events = append(res.Events, e)
	}
	return res, events.Err()
}

// Session IDs are 64-bit, beyond what a JavaScript number holds exactly.
func sessionKey(id uint64) string { return strconv.FormatUint(id, 36) }
