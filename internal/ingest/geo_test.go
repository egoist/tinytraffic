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
		country, region, city := g.Lookup(ip)
		if country != c.country || region == "" || city == "" {
			t.Errorf("Lookup(%s) = %q, %q, %q; want country %q with region and city", c.ip, country, region, city, c.country)
		}
	}
	if country, _, _ := g.Lookup(netip.MustParseAddr("127.0.0.1")); country != "" {
		t.Errorf("loopback resolved to %q", country)
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
	}
	if c, r, ci := parseGeoRecord(rec); c != "DE" || r != "Berlin" || ci != "Berlin" {
		t.Errorf("got %q, %q, %q", c, r, ci)
	}
}
