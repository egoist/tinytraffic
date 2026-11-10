package ingest

import (
	"bytes"
	"crypto/rand"
	"maps"
	"slices"
	"testing"
	"time"
)

type memSalts map[string][]byte

func (m memSalts) Salt(day string) ([]byte, error) { return m[day], nil }

func (m memSalts) AddSalt(day string, salt []byte) ([]byte, error) {
	if m[day] == nil {
		m[day] = salt
	}
	return m[day], nil
}

func (m memSalts) DeleteSaltsBefore(day string) error {
	for d := range m {
		if d < day {
			delete(m, d)
		}
	}
	return nil
}

func TestSaltsFollowLocalDay(t *testing.T) {
	st := memSalts{}
	s := NewSalts(st)
	get := func(now, tz string) (cur, prev []byte) {
		t.Helper()
		at, _ := time.Parse(time.RFC3339, now)
		cur, prev, err := s.Get(at, tz)
		if err != nil || cur == nil {
			t.Fatalf("Get(%s, %s): %v, %v", now, tz, cur, err)
		}
		return cur, prev
	}

	// 00:30 and 23:30 on Nov 10 in Madrid (UTC+1) are on either side of UTC
	// midnight, but the same local day: same salt.
	a, _ := get("2026-11-09T23:30:00Z", "Europe/Madrid")
	b, prev := get("2026-11-10T22:30:00Z", "Europe/Madrid")
	if !bytes.Equal(a, b) {
		t.Error("salt changed within Madrid's day")
	}
	if prev == nil || !bytes.Equal(prev, st["2026-11-09"]) {
		t.Error("previous salt isn't yesterday's")
	}
	// Madrid's next day starts at 23:00 UTC.
	if c, prev := get("2026-11-10T23:00:00Z", "Europe/Madrid"); bytes.Equal(c, b) || !bytes.Equal(prev, b) {
		t.Error("salt didn't rotate at Madrid's midnight")
	}
	// At that time it's still Nov 10 in UTC and Nov 11 in Kiritimati (UTC+14).
	if c, _ := get("2026-11-10T23:00:00Z", "UTC"); !bytes.Equal(c, b) {
		t.Error("UTC site didn't get Nov 10's salt")
	}
	if c, _ := get("2026-11-10T23:00:00Z", "Pacific/Kiritimati"); !bytes.Equal(c, st["2026-11-11"]) {
		t.Error("UTC+14 site didn't get Nov 11's salt")
	}
	// Unknown timezones use UTC.
	if c, _ := get("2026-11-10T23:00:00Z", "Nowhere/Nothing"); !bytes.Equal(c, b) {
		t.Error("unknown timezone didn't fall back to UTC")
	}

	// On Nov 11 (UTC), Nov 10 to Nov 13 exist and older salts are gone.
	get("2026-11-11T00:00:00Z", "Pacific/Pago_Pago")
	days := slices.Sorted(maps.Keys(st))
	if want := []string{"2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"}; !slices.Equal(days, want) {
		t.Errorf("stored salts: %v, want %v", days, want)
	}
}

func TestSaltsKeepStoredSalt(t *testing.T) {
	st := memSalts{"2026-11-10": make([]byte, 16)}
	rand.Read(st["2026-11-10"])
	want := bytes.Clone(st["2026-11-10"])
	cur, _, err := NewSalts(st).Get(time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC), "UTC")
	if err != nil || !bytes.Equal(cur, want) {
		t.Errorf("got %x, %v; want stored salt %x", cur, err, want)
	}
}
