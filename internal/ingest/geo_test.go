package ingest

import (
	"net/netip"
	"os"
	"path/filepath"
	"testing"
)

// Runs against the npm DB-IP package when `bun install` has fetched it.
func TestGeoDBIP(t *testing.T) {
	dir := filepath.Join("..", "..", "node_modules", "@ip-location-db", "dbip-city-mmdb")
	v4, v6 := filepath.Join(dir, "dbip-city-ipv4.mmdb"), filepath.Join(dir, "dbip-city-ipv6.mmdb")
	if _, err := os.Stat(v4); err != nil {
		t.Skip("GeoIP package not installed; run `bun install`")
	}
	g, err := OpenGeo(v4, v6)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close()

	for _, c := range []struct{ ip, country string }{
		{"8.8.8.8", "US"},
		{"81.2.69.142", "GB"},
		{"2001:4860:4860::8888", "CA"},
		{"::ffff:81.2.69.142", "GB"}, // IPv4-mapped, as seen on dual-stack listeners
	} {
		ip := netip.MustParseAddr(c.ip).Unmap()
		loc := g.Lookup(ip)
		if loc.Country != c.country || loc.Region == "" || loc.City == "" || !loc.HasCoords {
			t.Errorf("Lookup(%s) = %+v; want country %q with region, city and coordinates", c.ip, loc, c.country)
		}
	}
	if loc := g.Lookup(netip.MustParseAddr("127.0.0.1")); loc.Country != "" || loc.HasCoords {
		t.Errorf("loopback resolved to %+v", loc)
	}
	if loc := g.Lookup(netip.MustParseAddr("81.2.69.142")); loc.Lat < 51 || loc.Lat > 52 || loc.Lon < -1 || loc.Lon > 1 {
		t.Errorf("London coordinates: %+v", loc)
	}
	if a := g.Attribution(); a.URL != "https://db-ip.com" {
		t.Errorf("attribution = %+v", a)
	}
}

func TestParseGeoRecordMaxMindLayout(t *testing.T) {
	rec := map[string]any{
		"country":      map[string]any{"iso_code": "DE"},
		"subdivisions": []any{map[string]any{"names": map[string]any{"en": "Berlin"}}},
		"city":         map[string]any{"names": map[string]any{"en": "Berlin"}},
		"location":     map[string]any{"latitude": 52.520008, "longitude": 13.404954},
	}
	want := Location{Country: "DE", Region: "Berlin", City: "Berlin", Lat: 52.52, Lon: 13.4, HasCoords: true}
	if got := parseGeoRecord(rec); got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}
