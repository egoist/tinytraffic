package ingest

import (
	"fmt"
	"net/netip"
	"path/filepath"
	"strings"

	"github.com/oschwald/maxminddb-golang/v2"
)

// Geo resolves IPs with one or more MaxMind-format (.mmdb) databases, tried
// in order. It reads both MaxMind's nested layout (GeoLite2, DB-IP's own
// downloads) and the flat layout of the ip-location-db npm packages, which
// ship IPv4 and IPv6 as separate files. A nil *Geo resolves nothing.
type Geo struct {
	dbs         []*maxminddb.Reader
	attribution Attribution
}

// Attribution is the credit line the database's license asks for.
type Attribution struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

func OpenGeo(paths ...string) (*Geo, error) {
	g := &Geo{}
	for _, p := range paths {
		r, err := maxminddb.Open(p)
		if err != nil {
			g.Close()
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		g.dbs = append(g.dbs, r)
		hint := strings.ToLower(filepath.Base(p) + " " + r.Metadata.DatabaseType)
		switch {
		case strings.Contains(hint, "dbip") || strings.Contains(hint, "db-ip"):
			g.attribution = Attribution{"IP geolocation by DB-IP", "https://db-ip.com"}
		case strings.Contains(hint, "geolite") || strings.Contains(hint, "geoip2"):
			g.attribution = Attribution{"GeoLite2 data by MaxMind", "https://www.maxmind.com"}
		}
	}
	return g, nil
}

func (g *Geo) Close() error {
	if g == nil {
		return nil
	}
	for _, r := range g.dbs {
		r.Close()
	}
	return nil
}

func (g *Geo) Attribution() Attribution {
	if g == nil {
		return Attribution{}
	}
	return g.attribution
}

func (g *Geo) Lookup(ip netip.Addr) (country, region, city string) {
	if g == nil || !ip.IsValid() {
		return "", "", ""
	}
	for _, r := range g.dbs {
		if ip.Is6() && r.Metadata.IPVersion == 4 {
			continue
		}
		var rec map[string]any
		if err := r.Lookup(ip).Decode(&rec); err != nil || len(rec) == 0 {
			continue
		}
		if country, region, city = parseGeoRecord(rec); country != "" {
			return country, region, city
		}
	}
	return "", "", ""
}

func parseGeoRecord(rec map[string]any) (country, region, city string) {
	// Flat: {country_code, state1, city}
	if c, ok := rec["country_code"].(string); ok {
		region, _ = rec["state1"].(string)
		city, _ = rec["city"].(string)
		return c, region, city
	}
	// Nested (MaxMind): {country: {iso_code}, subdivisions: [{names}], city: {names}}
	if c, ok := rec["country"].(map[string]any); ok {
		country, _ = c["iso_code"].(string)
	}
	if subs, ok := rec["subdivisions"].([]any); ok && len(subs) > 0 {
		region = englishName(subs[0])
	}
	city = englishName(rec["city"])
	return country, region, city
}

func englishName(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	names, _ := m["names"].(map[string]any)
	name, _ := names["en"].(string)
	return name
}
