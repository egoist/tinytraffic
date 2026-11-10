package ingest

import (
	"crypto/rand"
	"sync"
	"time"
)

// SaltStore persists the daily salts (see store.Store).
type SaltStore interface {
	Salt(day string) ([]byte, error)
	// AddSalt stores salt unless the day has one, and returns the day's salt.
	AddSalt(day string, salt []byte) ([]byte, error)
	DeleteSaltsBefore(day string) error
}

// Salts holds the daily rotating salts used to hash visitor IDs. A site's
// salt changes at midnight in the site's timezone, so a visitor keeps one ID
// for the whole day the dashboard shows, and a visitor hash can never be
// linked across more than two of the site's days.
//
// Local days are at most a day behind or ahead of UTC, so the salts of
// yesterday, today and tomorrow (UTC) cover every timezone. The salt of the
// day after tomorrow is made a day ahead, so at UTC midnight tomorrow's
// already exists and processes sharing the database (e.g. during a rolling
// deploy) don't each make their own. Older salts are deleted: by UTC
// midnight, the last timezone left that day over 12 hours ago.
type Salts struct {
	store SaltStore

	mu    sync.Mutex
	day   string            // UTC day the salts were loaded for
	salts map[string][]byte // by day
	locs  map[string]*time.Location
}

func NewSalts(store SaltStore) *Salts {
	return &Salts{store: store, locs: map[string]*time.Location{}}
}

// Get returns the salts of today and yesterday in timezone tz (previous is
// nil if there was none). Unknown timezones use UTC.
func (s *Salts) Get(now time.Time, tz string) (current, previous []byte, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	utc := now.UTC()
	if day := utc.Format(time.DateOnly); day != s.day {
		salts := map[string][]byte{}
		for i := -1; i <= 2; i++ {
			d := utc.AddDate(0, 0, i).Format(time.DateOnly)
			salt, err := s.ensure(d)
			if err != nil {
				return nil, nil, err
			}
			salts[d] = salt
		}
		if err := s.store.DeleteSaltsBefore(utc.AddDate(0, 0, -1).Format(time.DateOnly)); err != nil {
			return nil, nil, err
		}
		s.day, s.salts = day, salts
	}
	local := now.In(s.location(tz))
	cur := s.salts[local.Format(time.DateOnly)]
	prev := s.salts[local.AddDate(0, 0, -1).Format(time.DateOnly)]
	return cur, prev, nil
}

// location returns the time.Location of tz, cached since loading one reads
// the timezone database.
func (s *Salts) location(tz string) *time.Location {
	if loc, ok := s.locs[tz]; ok {
		return loc
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	s.locs[tz] = loc
	return loc
}

// ensure returns a day's salt, making it if there is none.
func (s *Salts) ensure(day string) ([]byte, error) {
	salt, err := s.store.Salt(day)
	if err != nil || salt != nil {
		return salt, err
	}
	salt = make([]byte, 16)
	rand.Read(salt)
	return s.store.AddSalt(day, salt)
}
