package stats

import (
	"context"
	"fmt"
	"math/rand/v2"
	"net/url"
	"testing"
	"time"

	"github.com/egoist/tinytraffic/internal/store"
)

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// The integer bucketing must agree with DuckDB's ICU-based
// date_trunc(timezone(...)) across DST changes.
func TestTimeseriesBucketsMatchICU(t *testing.T) {
	for _, tz := range []string{"America/New_York", "Europe/Berlin", "Asia/Shanghai", "Australia/Lord_Howe", "UTC"} {
		for _, tc := range []struct{ period, interval string }{
			{"12mo", "month"}, {"12mo", "day"}, {"30d", "hour"},
		} {
			t.Run(fmt.Sprintf("%s/%s", tz, tc.interval), func(t *testing.T) {
				st := openTestStore(t)
				site, err := st.CreateSite("example.com", tz)
				if err != nil {
					t.Fatal(err)
				}
				now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)
				r := rand.New(rand.NewPCG(1, 2))
				var events []store.Event
				for i := range 20000 {
					ts := now.Add(-time.Duration(r.Int64N(int64(366 * 24 * time.Hour))))
					events = append(events, store.Event{
						Timestamp: ts, SiteID: site.ID, Name: "pageview", Pathname: "/",
						VisitorID: uint64(i), SessionID: uint64(i),
					})
				}
				if err := store.InsertEvents(context.Background(), st.DB, events); err != nil {
					t.Fatal(err)
				}

				q, err := ParseQuery(site, url.Values{"period": {tc.period}, "interval": {tc.interval}}, now, nil)
				if err != nil {
					t.Fatal(err)
				}
				points, err := Timeseries(context.Background(), st.DB, q)
				if err != nil {
					t.Fatal(err)
				}

				want := map[string]int64{}
				rows, err := st.DB.Query(fmt.Sprintf(`
SELECT strftime(date_trunc('%s', timezone(?, ts)), '%%Y-%%m-%%dT%%H:%%M:%%S'), count(*)
FROM events WHERE ts >= ? AND ts < ? GROUP BY 1`, tc.interval), tz, q.Start.UTC(), q.End.UTC())
				if err != nil {
					t.Fatal(err)
				}
				for rows.Next() {
					var k string
					var n int64
					rows.Scan(&k, &n)
					want[k] = n
				}
				rows.Close()

				var total int64
				for _, p := range points {
					total += p.Pageviews
					if w, ok := want[p.Date]; ok && w != p.Pageviews {
						t.Errorf("%s: got %d pageviews, want %d", p.Date, p.Pageviews, w)
					}
				}
				var wantTotal int64
				for _, n := range want {
					wantTotal += n
				}
				// At a DST fall-back the repeated local hour appears twice in
				// the hourly series, so only compare totals for day/month.
				if tc.interval != "hour" && total != wantTotal {
					t.Errorf("total %d, want %d", total, wantTotal)
				}
			})
		}
	}
}

func TestFiltersAndBreakdown(t *testing.T) {
	st := openTestStore(t)
	site, _ := st.CreateSite("example.com", "UTC")
	now := time.Now().UTC()
	ev := func(visitor uint64, path, source string, offset time.Duration) store.Event {
		return store.Event{Timestamp: now.Add(-offset), SiteID: site.ID, Name: "pageview",
			Pathname: path, ReferrerSource: source, VisitorID: visitor, SessionID: visitor}
	}
	events := []store.Event{
		ev(1, "/", "Google", 3*time.Hour), ev(1, "/blog/a", "Google", 2*time.Hour),
		ev(2, "/blog/b", "", time.Hour),
		ev(3, "/", "Twitter", time.Hour),
	}
	if err := store.InsertEvents(context.Background(), st.DB, events); err != nil {
		t.Fatal(err)
	}
	q, err := ParseQuery(site, url.Values{"period": {"7d"}, "f": {"page:/blog/*"}}, now, nil)
	if err != nil {
		t.Fatal(err)
	}
	agg, err := Aggregate(context.Background(), st.DB, q, now)
	if err != nil {
		t.Fatal(err)
	}
	if agg.Current.Visitors != 2 || agg.Current.Pageviews != 2 {
		t.Errorf("wildcard filter: got %+v", agg.Current)
	}

	q, _ = ParseQuery(site, url.Values{"period": {"7d"}}, now, nil)
	res, err := Breakdown(context.Background(), st.DB, q, "entry_page", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 2 || res.Rows[0].Value != "/" || res.Rows[0].Visitors != 2 {
		t.Errorf("entry pages: got %+v", res.Rows)
	}
	agg, _ = Aggregate(context.Background(), st.DB, q, now)
	if agg.Current.Visits != 3 || int(agg.Current.BounceRate) != 66 {
		t.Errorf("aggregate: got %+v", agg.Current)
	}
}

func TestReferrerDomainsAndLinks(t *testing.T) {
	st := openTestStore(t)
	site, _ := st.CreateSite("example.com", "UTC")
	now := time.Now().UTC()
	var events []store.Event
	for i, ref := range []string{"someblog.dev/posts/a", "someblog.dev/posts/a", "someblog.dev/posts/b", "someblog.dev", "google.com", ""} {
		events = append(events, store.Event{Timestamp: now.Add(-time.Hour), SiteID: site.ID, Name: "pageview",
			Pathname: "/", Referrer: ref, VisitorID: uint64(i), SessionID: uint64(i)})
	}
	if err := store.InsertEvents(context.Background(), st.DB, events); err != nil {
		t.Fatal(err)
	}
	q, _ := ParseQuery(site, url.Values{"period": {"7d"}}, now, nil)
	res, err := Breakdown(context.Background(), st.DB, q, "referrer", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Rows) != 3 || res.Rows[0] != (Row{Value: "someblog.dev", Visitors: 4, Count: 4, Links: 2}) {
		t.Fatalf("domains: %+v", res.Rows)
	}
	for _, r := range res.Rows[1:] {
		if r.Links != 0 {
			t.Errorf("%q should have no links: %+v", r.Value, r)
		}
	}

	q, _ = ParseQuery(site, url.Values{"period": {"7d"}, "f": {"referrer:someblog.dev"}}, now, nil)
	res, err = Breakdown(context.Background(), st.DB, q, "referrer_url", 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []Row{{"someblog.dev/posts/a", 2, 2, 0}, {"someblog.dev", 1, 1, 0}, {"someblog.dev/posts/b", 1, 1, 0}}
	if fmt.Sprint(res.Rows) != fmt.Sprint(want) {
		t.Errorf("links under someblog.dev: got %+v, want %+v", res.Rows, want)
	}
}
