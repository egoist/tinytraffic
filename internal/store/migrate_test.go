package store

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand/v2"
	"net/url"
	"os"
	"testing"
	"time"
)

// openClickHouseStore opens an in-memory DuckDB store whose events live in a
// fresh ClickHouse database. Set TT_TEST_CLICKHOUSE to a server, e.g.
// clickhouse://localhost:9000, to run it.
func openClickHouseStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TT_TEST_CLICKHOUSE")
	if dsn == "" {
		t.Skip("TT_TEST_CLICKHOUSE not set")
	}
	admin, err := sql.Open("clickhouse", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	name := fmt.Sprintf("tinytraffic_test_%d", rand.Uint32())
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Exec("DROP DATABASE " + name) })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	st, err := Open("", Options{ClickHouseURL: u.String()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestMigrateToClickHouse(t *testing.T) {
	st := openClickHouseStore(t)
	ctx := context.Background()
	duck := &Events{DB: st.DB, Backend: DuckDB}
	ch := st.Events

	// Three sites over 14 months. Site 1 has runs of events sharing a
	// timestamp, more than a batch of them, to cross batch boundaries.
	defer func(n int) { migrateBatch = n }(migrateBatch)
	migrateBatch = 1000
	now := time.Date(2026, 11, 10, 12, 0, 0, 123456000, time.UTC)
	r := rand.New(rand.NewPCG(3, 4))
	var events []Event
	for i := range 30_000 {
		site := int32(1 + i%3)
		ts := now.Add(-time.Duration(r.Int64N(int64(420*24*time.Hour))) / time.Microsecond * time.Microsecond)
		if site == 1 && i%2 == 0 {
			ts = now.Add(-time.Duration(i%4) * 24 * time.Hour) // two shared timestamps
		}
		e := Event{Timestamp: ts, SiteID: site, Name: "pageview", Pathname: fmt.Sprintf("/%d", i%50),
			VisitorID: uint64(i), SessionID: r.Uint64(), Country: "DE", ScreenWidth: uint16(i % 2000),
			Props: `{"a":"b"}`}
		if i%3 == 0 {
			e.HasLocation, e.Latitude, e.Longitude = true, 52.52, 13.4
		}
		events = append(events, e)
	}
	if err := duck.Insert(ctx, events); err != nil {
		t.Fatal(err)
	}

	// The server already ran on ClickHouse for a while: site 3 has newer
	// events there, which must stay as they are.
	newer := Event{Timestamp: now.Add(time.Hour), SiteID: 3, Name: "pageview", Pathname: "/new", VisitorID: 1, SessionID: 1}
	if err := ch.Insert(ctx, []Event{newer}); err != nil {
		t.Fatal(err)
	}
	// An earlier run stopped partway: site 2's newest events are copied.
	var partial []Event
	for _, e := range events {
		if e.SiteID == 2 && e.Timestamp.After(now.AddDate(0, -2, 0)) {
			partial = append(partial, e)
		}
	}
	if err := ch.Insert(ctx, partial); err != nil {
		t.Fatal(err)
	}

	n, err := st.MigrateToClickHouse(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if want := int64(len(events) - len(partial)); n != want {
		t.Errorf("copied %d events, want %d", n, want)
	}

	// Both databases now hold the same events (plus site 3's newer one).
	summary := func(ev *Events) string {
		var out string
		rows, err := ev.QueryContext(ctx, `
SELECT site_id, count(*), sum(visitor_id), sum(screen_width), count(latitude), sum(length(pathname)),
	min(ts), max(ts), count(DISTINCT session_id), count(DISTINCT ts)
FROM events WHERE pathname <> '/new' GROUP BY 1 ORDER BY 1`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var site, count, visitors, widths, located, paths, sessions, stamps int64
			var first, last time.Time
			if err := rows.Scan(&site, &count, &visitors, &widths, &located, &paths, &first, &last, &sessions, &stamps); err != nil {
				t.Fatal(err)
			}
			out += fmt.Sprintln(site, count, visitors, widths, located, paths, first.UnixMicro(), last.UnixMicro(), sessions, stamps)
		}
		return out
	}
	if got, want := summary(ch), summary(duck); got != want {
		t.Errorf("clickhouse:\n%sduckdb:\n%s", got, want)
	}
	var newCount int64
	ch.QueryRowContext(ctx, `SELECT count() FROM events WHERE pathname = '/new'`).Scan(&newCount)
	if newCount != 1 {
		t.Errorf("site 3's newer event: %d copies", newCount)
	}

	// Running it again copies nothing.
	if n, err := st.MigrateToClickHouse(ctx, nil); err != nil || n != 0 {
		t.Errorf("second run copied %d events (err %v)", n, err)
	}
}
