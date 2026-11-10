package ingest

import (
	"fmt"
	"math"
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

// Location is what an IP resolves to. Coordinates are rounded to two
// decimals (~1 km); GeoIP is only city-accurate anyway.
type Location struct {
	Country, Region, City string
	Lat, Lon              float64
	HasCoords             bool
}

func (g *Geo) Lookup(ip netip.Addr) Location {
	if g == nil || !ip.IsValid() {
		return Location{}
	}
	for _, r := range g.dbs {
		if ip.Is6() && r.Metadata.IPVersion == 4 {
			continue
		}
		var rec map[string]any
		if err := r.Lookup(ip).Decode(&rec); err != nil || len(rec) == 0 {
			continue
		}
		if loc := parseGeoRecord(rec); loc.Country != "" {
			return loc
		}
	}
	return Location{}
}

func parseGeoRecord(rec map[string]any) Location {
	var loc Location
	var lat, lon any
	if c, ok := rec["country_code"].(string); ok {
		// Flat: {country_code, state1, city, latitude, longitude}
		loc.Country = c
		loc.Region, _ = rec["state1"].(string)
		loc.City, _ = rec["city"].(string)
		lat, lon = rec["latitude"], rec["longitude"]
	} else {
		// Nested (MaxMind): {country: {iso_code}, subdivisions: [{names}],
		// city: {names}, location: {latitude, longitude}}
		if c, ok := rec["country"].(map[string]any); ok {
			loc.Country, _ = c["iso_code"].(string)
		}
		if subs, ok := rec["subdivisions"].([]any); ok && len(subs) > 0 {
			loc.Region = englishName(subs[0])
		}
		loc.City = englishName(rec["city"])
		if l, ok := rec["location"].(map[string]any); ok {
			lat, lon = l["latitude"], l["longitude"]
		}
	}
	la, ok1 := toFloat(lat)
	lo, ok2 := toFloat(lon)
	if ok1 && ok2 && (la != 0 || lo != 0) {
		loc.Lat, loc.Lon, loc.HasCoords = round2(la), round2(lo), true
	}
	return loc
}

func toFloat(v any) (float64, bool) {
	switch v := v.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	}
	return 0, false
}

func round2(f float64) float64 { return math.Round(f*100) / 100 }

func englishName(v any) string {
	m, ok := v.(map[string]any)
	if !ok {
		return ""
	}
	names, _ := m["names"].(map[string]any)
	name, _ := names["en"].(string)
	return name
}
