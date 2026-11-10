package store

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"math/rand/v2"
	"net/url"
	"os"
	"testing"
	"time"
)

// clickHouseTestDB creates a ClickHouse database for the test and returns
// its URL. Set TT_TEST_CLICKHOUSE to a server, e.g.
// clickhouse://localhost:9000, to run ClickHouse tests.
func clickHouseTestDB(t *testing.T) string {
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
	return u.String()
}

func openClickHouseStore(t *testing.T, url string) *Store {
	t.Helper()
	st, err := Open("", Options{ClickHouseURL: url})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if st.DB != nil || st.Events.Backend != ClickHouse {
		t.Fatal("store isn't ClickHouse-only")
	}
	return st
}

// Two processes on one ClickHouse database, as during a rolling deploy, see
// each other's changes and agree on salts.
func TestClickHouseSharedByTwoProcesses(t *testing.T) {
	url := clickHouseTestDB(t)
	a := openClickHouseStore(t, url)
	b := openClickHouseStore(t, url)

	site, err := a.CreateSite("example.com", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.SetSetting("password_hash", "x"); err != nil {
		t.Fatal(err)
	}
	key, token, err := a.CreateAPIKey("ci", ScopeRead)
	if err != nil {
		t.Fatal(err)
	}
	if err := b.reload(); err != nil { // what the refresh loop does
		t.Fatal(err)
	}
	if got, ok := b.SiteByDomain("example.com"); !ok || got.ID != site.ID {
		t.Errorf("other process doesn't see the site: %+v", got)
	}
	if v, _ := b.Setting("password_hash"); v != "x" {
		t.Errorf("other process doesn't see the setting: %q", v)
	}
	if got, ok := b.AuthenticateAPIKey(token); !ok || got.ID != key.ID {
		t.Errorf("other process doesn't accept the API key")
	}

	// The second site gets the next ID, even when created by the other
	// process, and deleted IDs aren't reused.
	other, err := b.CreateSite("other.com", "UTC")
	if err != nil || other.ID != site.ID+1 {
		t.Fatalf("second site: %+v, %v", other, err)
	}
	if err := b.DeleteSite(other.ID); err != nil {
		t.Fatal(err)
	}
	third, _ := a.CreateSite("third.com", "UTC")
	if third.ID != other.ID+1 {
		t.Errorf("third site got ID %d, want %d", third.ID, other.ID+1)
	}

	// A deleted key stays deleted, even if the other process records a use
	// of it afterwards.
	if err := a.DeleteAPIKey(key.ID); err != nil {
		t.Fatal(err)
	}
	b.meta.touchAPIKey(key.ID, time.Now())
	a.reload()
	b.reload()
	for _, st := range []*Store{a, b} {
		if _, ok := st.AuthenticateAPIKey(token); ok {
			t.Error("deleted API key still works")
		}
	}

	// Both processes making the same day's salt end up with the first one.
	s1, err := a.AddSalt("2026-11-10", []byte("first salt......"))
	if err != nil {
		t.Fatal(err)
	}
	s2, err := b.AddSalt("2026-11-10", []byte("second salt....."))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(s1, s2) || string(s1) != "first salt......" {
		t.Errorf("salts differ: %q and %q", s1, s2)
	}
	if err := b.DeleteSaltsBefore("2026-11-11"); err != nil {
		t.Fatal(err)
	}
	if s, _ := a.Salt("2026-11-10"); s != nil {
		t.Errorf("deleted salt still there: %q", s)
	}
}

func TestMigrateToClickHouse(t *testing.T) {
	url := clickHouseTestDB(t)
	ctx := context.Background()
	from, err := Open("", Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer from.Close()

	// What a DuckDB install has: sites (one renamed, one deleted), an API
	// key, settings and salts.
	s1, _ := from.CreateSite("one.com", "Europe/Berlin")
	s1, _ = from.UpdateSite(s1.ID, SiteUpdate{Domain: "uno.com"})
	gone, _ := from.CreateSite("gone.com", "UTC")
	from.DeleteSite(gone.ID)
	s3, _ := from.CreateSite("three.com", "UTC")
	s4, _ := from.CreateSite("four.com", "UTC")
	key, token, _ := from.CreateAPIKey("ci", ScopeWrite)
	from.AuthenticateAPIKey(token)
	time.Sleep(50 * time.Millisecond) // the last-used time is written in the background
	from.SetSetting("password_hash", "hash")
	from.SetSetting("session_secret", "secret")
	from.AddSalt("2026-11-10", []byte("today's salt...."))

	// Three sites over 14 months. Site 1 has runs of events sharing a
	// timestamp, more than a batch of them, to cross batch boundaries.
	defer func(n int) { migrateBatch = n }(migrateBatch)
	migrateBatch = 1000
	now := time.Date(2026, 11, 10, 12, 0, 0, 123456000, time.UTC)
	r := rand.New(rand.NewPCG(3, 4))
	ids := []int32{s1.ID, s3.ID, s4.ID}
	var events []Event
	for i := range 30_000 {
		site := ids[i%3]
		ts := now.Add(-time.Duration(r.Int64N(int64(420*24*time.Hour))) / time.Microsecond * time.Microsecond)
		if site == s1.ID && i%2 == 0 {
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
	if err := from.Events.Insert(ctx, events); err != nil {
		t.Fatal(err)
	}

	to := openClickHouseStore(t, url)
	ch := to.Events
	// An earlier run stopped partway: three.com's newest events are copied.
	if _, err := MigrateToClickHouse(ctx, from, to, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := ch.DB.Exec(`TRUNCATE TABLE events`); err != nil {
		t.Fatal(err)
	}
	var partial []Event
	for _, e := range events {
		if e.SiteID == s3.ID && e.Timestamp.After(now.AddDate(0, -2, 0)) {
			partial = append(partial, e)
		}
	}
	if err := ch.Insert(ctx, partial); err != nil {
		t.Fatal(err)
	}
	// Then the server ran on ClickHouse for a while: four.com has newer
	// events there, which must stay as they are.
	newer := Event{Timestamp: now.Add(time.Hour), SiteID: s4.ID, Name: "pageview", Pathname: "/new", VisitorID: 1, SessionID: 1}
	if err := ch.Insert(ctx, []Event{newer}); err != nil {
		t.Fatal(err)
	}

	n, err := MigrateToClickHouse(ctx, from, to, nil)
	if err != nil {
		t.Fatal(err)
	}
	if want := int64(len(events) - len(partial)); n != want {
		t.Errorf("copied %d events, want %d", n, want)
	}

	// A fresh process sees everything DuckDB had.
	after := openClickHouseStore(t, url)
	if got, ok := after.SiteByDomain("one.com"); !ok || got.ID != s1.ID || got.Domain != "uno.com" || got.Timezone != "Europe/Berlin" {
		t.Errorf("renamed site: %+v, %v", got, ok)
	}
	if _, ok := after.SiteByDomain("gone.com"); ok {
		t.Error("deleted site was copied")
	}
	if got, ok := after.SiteByID(s4.ID); !ok || got.Domain != "four.com" || !got.CreatedAt.Equal(s4.CreatedAt) {
		t.Errorf("site 4: %+v, want created at %s", got, s4.CreatedAt)
	}
	if got, ok := after.AuthenticateAPIKey(token); !ok || got.ID != key.ID || got.Scope != ScopeWrite || got.LastUsedAt == nil {
		t.Errorf("API key: %+v, %v", got, ok)
	}
	for k, want := range map[string]string{"password_hash": "hash", "session_secret": "secret"} {
		if v, _ := after.Setting(k); v != want {
			t.Errorf("setting %s = %q, want %q", k, v, want)
		}
	}
	if s, _ := after.Salt("2026-11-10"); string(s) != "today's salt...." {
		t.Errorf("salt: %q", s)
	}

	// Both databases now hold the same events (plus four.com's newer one).
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
	if got, want := summary(ch), summary(from.Events); got != want {
		t.Errorf("clickhouse:\n%sduckdb:\n%s", got, want)
	}
	var newCount int64
	ch.QueryRowContext(ctx, `SELECT count() FROM events WHERE pathname = '/new'`).Scan(&newCount)
	if newCount != 1 {
		t.Errorf("four.com's newer event: %d copies", newCount)
	}

	// Running it again copies nothing, and a site ID meaning different
	// sites stops it.
	if n, err := MigrateToClickHouse(ctx, from, to, nil); err != nil || n != 0 {
		t.Errorf("third run copied %d events (err %v)", n, err)
	}
	x, _ := to.CreateSite("clash.org", "UTC")
	y, _ := from.CreateSite("taken.com", "UTC")
	if x.ID != y.ID {
		t.Fatalf("test setup: IDs %d and %d", x.ID, y.ID)
	}
	if _, err := MigrateToClickHouse(ctx, from, to, nil); err == nil {
		t.Error("a site ID meaning different sites didn't stop the migration")
	}
}
