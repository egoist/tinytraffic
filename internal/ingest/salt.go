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

// Salts holds the daily rotating salt used to hash visitor IDs. Only
// yesterday's, today's and tomorrow's salts exist at any time, so a visitor
// hash can never be linked across more than two days.
//
// Tomorrow's salt is made a day ahead, so at midnight it already exists and
// processes sharing the database (e.g. during a rolling deploy) don't each
// make their own.
type Salts struct {
	store SaltStore

	mu       sync.Mutex
	day      string
	current  []byte
	previous []byte
}

func NewSalts(store SaltStore) *Salts { return &Salts{store: store} }

// Get returns today's salt and yesterday's (nil if there was none).
func (s *Salts) Get(now time.Time) (current, previous []byte, err error) {
	day := now.UTC().Format(time.DateOnly)
	s.mu.Lock()
	defer s.mu.Unlock()
	if day == s.day {
		return s.current, s.previous, nil
	}
	yesterday := now.UTC().AddDate(0, 0, -1).Format(time.DateOnly)
	tomorrow := now.UTC().AddDate(0, 0, 1).Format(time.DateOnly)

	cur, err := s.ensure(day)
	if err != nil {
		return nil, nil, err
	}
	if _, err := s.ensure(tomorrow); err != nil {
		return nil, nil, err
	}
	prev, err := s.store.Salt(yesterday)
	if err != nil {
		return nil, nil, err
	}
	if err := s.store.DeleteSaltsBefore(yesterday); err != nil {
		return nil, nil, err
	}
	s.day, s.current, s.previous = day, cur, prev
	return cur, prev, nil
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
