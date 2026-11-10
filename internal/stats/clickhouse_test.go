package stats

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/egoist/tinytraffic/internal/store"
)

// openClickHouseStore opens a store whose events live in a fresh ClickHouse
// database. Set TT_TEST_CLICKHOUSE to a server, e.g.
// clickhouse://localhost:9000, to run these tests.
func openClickHouseStore(t *testing.T) *store.Store {
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
	st, err := store.Open("", store.Options{ClickHouseURL: u.String()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	if st.Events.Backend != store.ClickHouse {
		t.Fatal("events are not in ClickHouse")
	}
	return st
}

// randomTraffic makes a year of visits ending at now, with the last few
// minutes busy enough for the live view.
func randomTraffic(siteID int32, now time.Time) []store.Event {
	r := rand.New(rand.NewPCG(7, 11))
	pick := func(s ...string) string { return s[r.IntN(len(s))] }
	type place struct {
		country, region, city string
		lat, lon              float32
	}
	places := []place{
		{"DE", "Berlin", "Berlin", 52.52, 13.4},
		{"US", "California", "San Francisco", 37.77, -122.42},
		{"US", "New York", "New York", 40.71, -74.01},
		{"JP", "Tokyo", "Tokyo", 35.69, 139.69},
		{"GB", "", "", 0, 0}, // no coordinates
	}
	var events []store.Event
	for i := range 6000 {
		visitor := uint64(r.IntN(2500)) + 1
		ago := time.Duration(r.Int64N(int64(400 * 24 * time.Hour)))
		if i%20 == 0 {
			ago = time.Duration(r.Int64N(int64(6 * time.Minute)))
		}
		ts := now.Add(-ago)
		p := places[r.IntN(len(places))]
		base := store.Event{
			SiteID: siteID, Hostname: "example.com",
			VisitorID: visitor, SessionID: r.Uint64(),
			Referrer:       pick("", "", "google.com", "someblog.dev", "someblog.dev/posts/a", "someblog.dev/posts/b_c", "news.ycombinator.com/item"),
			ReferrerSource: pick("", "Google", "Twitter", "Hacker News"),
			UTMSource:      pick("", "", "newsletter"), UTMCampaign: pick("", "launch"),
			Country: p.country, Region: p.region, City: p.city,
			HasLocation: p.city != "", Latitude: p.lat, Longitude: p.lon,
			Browser: pick("Chrome", "Safari", "Firefox"), BrowserVersion: "1",
			OS: pick("macOS", "Windows", "iOS"), OSVersion: "1",
			Device: pick("Desktop", "Mobile"), ScreenWidth: 1440,
		}
		for range 1 + r.IntN(4) {
			e := base
			e.Timestamp = ts
			e.Name = "pageview"
			e.Pathname = pick("/", "/pricing", "/blog/a", "/blog/b", "/docs/100%_sure", "/about")
			if r.IntN(8) == 0 {
				e.Name = pick("Signup", "Outbound Link: Click")
			}
			events = append(events, e)
			ts = ts.Add(time.Duration(r.Int64N(int64(4 * time.Minute))))
		}
	}
	return events
}

// approxEqual compares two results as JSON, allowing for float rounding.
func approxEqual(a, b any) bool {
	var x, y any
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	json.Unmarshal(ja, &x)
	json.Unmarshal(jb, &y)
	return approx(x, y)
}

func approx(x, y any) bool {
	switch x := x.(type) {
	case float64:
		y, ok := y.(float64)
		return ok && math.Abs(x-y) <= 1e-6*math.Max(1, math.Abs(x))
	case []any:
		y, ok := y.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !approx(x[i], y[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		y, ok := y.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for k := range x {
			if !approx(x[k], y[k]) {
				return false
			}
		}
		return true
	default:
		return x == y
	}
}

// Every dashboard query must give the same answer on ClickHouse as on
// DuckDB.
func TestClickHouseMatchesDuckDB(t *testing.T) {
	ch := openClickHouseStore(t)
	duck := openTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()

	var site store.Site
	for _, st := range []*store.Store{duck, ch} {
		s, err := st.CreateSite("example.com", "UTC")
		if err != nil {
			t.Fatal(err)
		}
		site = s
		if err := st.Events.Insert(ctx, randomTraffic(s.ID, now)); err != nil {
			t.Fatal(err)
		}
	}

	check := func(name string, run func(ev *store.Events) (any, error)) {
		t.Helper()
		want, err := run(duck.Events)
		if err != nil {
			t.Fatalf("%s on duckdb: %v", name, err)
		}
		got, err := run(ch.Events)
		if err != nil {
			t.Fatalf("%s on clickhouse: %v", name, err)
		}
		if !approxEqual(got, want) {
			g, _ := json.Marshal(got)
			w, _ := json.Marshal(want)
			t.Errorf("%s:\nclickhouse %s\nduckdb     %s", name, g, w)
		}
	}

	check("first event", func(ev *store.Events) (any, error) {
		t, ok := FirstEvent(ctx, ev, site.ID)
		return []any{t.UnixMicro(), ok}, nil
	})
	check("first event, no events", func(ev *store.Events) (any, error) {
		t, ok := FirstEvent(ctx, ev, site.ID+100)
		return []any{t.UnixMicro(), ok}, nil
	})
	check("realtime", func(ev *store.Events) (any, error) { return Realtime(ctx, ev, site.ID, now) })
	check("overview", func(ev *store.Events) (any, error) { return Overview(ctx, ev, now) })
	check("live", func(ev *store.Events) (any, error) { return Live(ctx, ev, site.ID, now, 20) })

	filters := [][]string{
		nil,
		{"page:/blog/*"},
		{"page:/docs/100%_sure"},
		{"page:/docs/1*"},
		{"source:Google", "device:Mobile"},
		{"referrer:someblog.dev"},
		{"referrer_url:someblog.dev/posts/b_c"},
		{"entry_page:/"},
		{"exit_page:/pricing"},
		{"event:Signup"},
		{"country:US", "city:New York"},
		{"page:/nowhere"},
	}
	dims := []string{"page", "entry_page", "exit_page", "hostname", "source", "referrer", "referrer_url",
		"utm_source", "utm_medium", "utm_campaign", "country", "region", "city", "browser", "os", "device", "event"}
	for _, tz := range []string{"UTC", "America/New_York", "Asia/Kolkata"} {
		tzSite := site
		tzSite.Timezone = tz
		for _, period := range []string{"today", "24h", "30d", "12mo", "all"} {
			for _, f := range filters {
				v := url.Values{"period": {period}, "f": f}
				name := fmt.Sprintf("%s %s %s", tz, period, strings.Join(f, ","))
				q, err := ParseQuery(tzSite, v, now, func() (time.Time, bool) { return FirstEvent(ctx, duck.Events, site.ID) })
				if err != nil {
					t.Fatal(err)
				}
				check("aggregate "+name, func(ev *store.Events) (any, error) { return Aggregate(ctx, ev, q, now) })
				check("timeseries "+name, func(ev *store.Events) (any, error) { return Timeseries(ctx, ev, q) })
				check("locations "+name, func(ev *store.Events) (any, error) { return Locations(ctx, ev, q, 50) })
				if tz != "UTC" || period != "30d" && period != "all" {
					continue
				}
				for _, dim := range dims {
					check("breakdown "+dim+" "+name, func(ev *store.Events) (any, error) { return Breakdown(ctx, ev, q, dim, 10) })
				}
			}
		}
	}
	if t.Failed() {
		return
	}

	// Deleting a site removes its events from ClickHouse too.
	if err := ch.DeleteSite(site.ID); err != nil {
		t.Fatal(err)
	}
	var n int64
	if err := ch.Events.QueryRowContext(ctx, `SELECT count() FROM events WHERE site_id = ?`, site.ID).Scan(&n); err != nil || n != 0 {
		t.Errorf("after deleting the site: %d events left (err %v)", n, err)
	}
}
