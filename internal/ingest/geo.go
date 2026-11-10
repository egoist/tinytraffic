package ingest

import (
	"net/netip"

	"github.com/oschwald/maxminddb-golang/v2"
)

// Geo resolves IPs with a MaxMind-format database (GeoLite2 or DB-IP Lite,
// country or city edition). A nil *Geo resolves nothing.
type Geo struct{ r *maxminddb.Reader }

func OpenGeo(path string) (*Geo, error) {
	r, err := maxminddb.Open(path)
	if err != nil {
		return nil, err
	}
	return &Geo{r: r}, nil
}

func (g *Geo) Close() error {
	if g == nil {
		return nil
	}
	return g.r.Close()
}

type geoRecord struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	Subdivisions []struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"subdivisions"`
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
}

func (g *Geo) Lookup(ip netip.Addr) (country, region, city string) {
	if g == nil || !ip.IsValid() {
		return "", "", ""
	}
	var rec geoRecord
	if err := g.r.Lookup(ip).Decode(&rec); err != nil {
		return "", "", ""
	}
	country = rec.Country.ISOCode
	if len(rec.Subdivisions) > 0 {
		region = rec.Subdivisions[0].Names["en"]
	}
	city = rec.City.Names["en"]
	return
}
