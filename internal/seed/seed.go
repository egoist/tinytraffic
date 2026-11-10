// Package seed fills a site with realistic-looking demo traffic, for trying
// the dashboard locally.
package seed

import (
	"context"
	"encoding/json"
	"math"
	"math/rand/v2"
	"time"

	"github.com/egoist/tinytraffic/internal/store"
)

type weighted[T any] struct {
	v T
	w float64
}

func pick[T any](r *rand.Rand, items []weighted[T]) T {
	var total float64
	for _, it := range items {
		total += it.w
	}
	x := r.Float64() * total
	for _, it := range items {
		if x -= it.w; x <= 0 {
			return it.v
		}
	}
	return items[len(items)-1].v
}

type source struct{ referrer, source, utmSource, utmMedium, utmCampaign string }
type place struct{ country, region, city string }
type agent struct{ browser, version, os, osVersion string }

var (
	pages = []weighted[string]{
		{"/", 40}, {"/blog", 12}, {"/blog/building-a-tiny-analytics-tool", 14},
		{"/blog/duckdb-in-production", 9}, {"/blog/why-i-quit-cookies", 6},
		{"/projects", 8}, {"/about", 6}, {"/uses", 4}, {"/now", 2}, {"/contact", 2},
	}
	sources = []weighted[source]{
		{source{}, 34},
		{source{"google.com", "Google", "", "", ""}, 24},
		{source{"news.ycombinator.com", "Hacker News", "", "", ""}, 9},
		{source{"t.co", "Twitter", "", "", ""}, 7},
		{source{"github.com", "GitHub", "", "", ""}, 6},
		{source{"reddit.com", "Reddit", "", "", ""}, 4},
		{source{"duckduckgo.com", "DuckDuckGo", "", "", ""}, 4},
		{source{"bing.com", "Bing", "", "", ""}, 2},
		{source{"chatgpt.com", "ChatGPT", "", "", ""}, 3},
		{source{"bsky.app", "Bluesky", "", "", ""}, 2},
		{source{"", "newsletter", "newsletter", "email", "november-issue"}, 3},
		{source{"lobste.rs/s/x7kq2m/building_tiny_analytics_tool", "Lobsters", "", "", ""}, 2},
		{source{"t.co/Xk2pQ9vLmA", "Twitter", "", "", ""}, 2},
		{source{"someblog.dev/posts/my-favorite-tools", "someblog.dev", "", "", ""}, 2},
		{source{"someblog.dev/posts/self-hosting-in-2026", "someblog.dev", "", "", ""}, 1},
		{source{"devweekly.io/issues/142", "devweekly.io", "", "", ""}, 2},
		{source{"discuss.example.org/t/privacy-friendly-analytics/381", "discuss.example.org", "", "", ""}, 1},
	}
	places = []weighted[place]{
		{place{"US", "California", "San Francisco"}, 10}, {place{"US", "New York", "New York"}, 8},
		{place{"US", "Washington", "Seattle"}, 4}, {place{"US", "Texas", "Austin"}, 3},
		{place{"DE", "Berlin", "Berlin"}, 7}, {place{"GB", "England", "London"}, 7},
		{place{"FR", "Île-de-France", "Paris"}, 4}, {place{"NL", "North Holland", "Amsterdam"}, 3},
		{place{"CA", "Ontario", "Toronto"}, 4}, {place{"IN", "Karnataka", "Bengaluru"}, 6},
		{place{"JP", "Tokyo", "Tokyo"}, 4}, {place{"CN", "Shanghai", "Shanghai"}, 4},
		{place{"BR", "São Paulo", "São Paulo"}, 3}, {place{"AU", "New South Wales", "Sydney"}, 2},
		{place{"SE", "Stockholm", "Stockholm"}, 2}, {place{"KR", "Seoul", "Seoul"}, 2},
		{place{"SG", "", "Singapore"}, 2}, {place{"PL", "Mazovia", "Warsaw"}, 2},
	}
	agents = []weighted[agent]{
		{agent{"Chrome", "142", "macOS", "15.6"}, 22}, {agent{"Chrome", "142", "Windows", "10"}, 18},
		{agent{"Safari", "26", "macOS", "26.1"}, 12}, {agent{"Mobile Safari", "26", "iOS", "26.1"}, 16},
		{agent{"Firefox", "145", "Linux", ""}, 5}, {agent{"Firefox", "145", "Windows", "10"}, 4},
		{agent{"Chrome", "142", "Android", "16"}, 12}, {agent{"Edge", "142", "Windows", "10"}, 6},
		{agent{"Chrome", "142", "Linux", ""}, 3}, {agent{"Arc", "1", "macOS", "15.6"}, 2},
	}
	events = []weighted[string]{{"Signup", 3}, {"Outbound Link: Click", 6}, {"Copy Code", 2}}
)

// Run generates about visitorsPerDay visitors per day for the given number
// of days, ending now.
func Run(ctx context.Context, db *store.Store, site store.Site, days, visitorsPerDay int) (int, error) {
	r := rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), 42))
	now := time.Now().UTC()
	start := now.AddDate(0, 0, -days)
	var batch []store.Event
	total := 0
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		err := store.InsertEvents(ctx, db.DB, batch)
		total += len(batch)
		batch = batch[:0]
		return err
	}

	for d := 0; d <= days; d++ {
		day := start.AddDate(0, 0, d)
		// Gentle growth, weekday bump and noise, plus an occasional spike.
		growth := 0.6 + 0.4*float64(d)/float64(max(days, 1))
		weekday := 1.0
		if wd := day.Weekday(); wd == time.Saturday || wd == time.Sunday {
			weekday = 0.7
		}
		n := float64(visitorsPerDay) * growth * weekday * (0.85 + 0.3*r.Float64())
		if r.Float64() < 0.06 {
			n *= 2.5 + 2*r.Float64()
		}
		for range int(n) {
			// Diurnal curve peaking mid-afternoon UTC.
			var hour float64
			for {
				hour = r.Float64() * 24
				if r.Float64() < 0.35+0.65*math.Pow(math.Sin(math.Pi*hour/24), 2) {
					break
				}
			}
			ts := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC).
				Add(time.Duration(hour * float64(time.Hour)))
			if ts.After(now) {
				continue
			}
			batch = append(batch, visit(r, site, ts)...)
			if len(batch) >= 5000 {
				if err := flush(); err != nil {
					return total, err
				}
			}
		}
	}
	return total, flush()
}

func visit(r *rand.Rand, site store.Site, ts time.Time) []store.Event {
	src := pick(r, sources)
	pl := pick(r, places)
	ag := pick(r, agents)
	width := []uint16{390, 414, 820, 1280, 1440, 1512, 1920, 2560}[r.IntN(8)]
	if ag.os == "iOS" || ag.os == "Android" {
		width = []uint16{375, 390, 414, 430}[r.IntN(4)]
	}
	device := "Desktop"
	switch {
	case width < 576:
		device = "Mobile"
	case width < 992:
		device = "Tablet"
	case width < 1440:
		device = "Laptop"
	}
	base := store.Event{
		SiteID: site.ID, Hostname: site.Domain,
		VisitorID: r.Uint64(), SessionID: r.Uint64(),
		Referrer: src.referrer, ReferrerSource: src.source,
		UTMSource: src.utmSource, UTMMedium: src.utmMedium, UTMCampaign: src.utmCampaign,
		Country: pl.country, Region: pl.region, City: pl.city,
		Browser: ag.browser, BrowserVersion: ag.version, OS: ag.os, OSVersion: ag.osVersion,
		Device: device, ScreenWidth: width,
	}
	// Roughly half the visits bounce.
	views := 1
	if r.Float64() > 0.48 {
		views = 2 + r.IntN(5)
	}
	page := pick(r, pages)
	if src.source == "Hacker News" || src.source == "Lobsters" {
		page = "/blog/building-a-tiny-analytics-tool"
	}
	var out []store.Event
	for i := range views {
		e := base
		e.Name, e.Pathname, e.Timestamp = "pageview", page, ts
		out = append(out, e)
		if r.Float64() < 0.08 {
			ev := base
			ev.Name, ev.Pathname, ev.Timestamp = pick(r, events), page, ts.Add(5*time.Second)
			if ev.Name == "Outbound Link: Click" {
				b, _ := json.Marshal(map[string]string{"url": "https://example.org/docs"})
				ev.Props = string(b)
			}
			out = append(out, ev)
		}
		if i < views-1 {
			ts = ts.Add(time.Duration(10+r.IntN(240)) * time.Second)
			page = pick(r, pages)
		}
	}
	return out
}
