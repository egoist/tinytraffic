package ingest

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"sync"
	"time"
)

// Salts holds the daily rotating salt used to hash visitor IDs. Only today's
// and yesterday's salts exist at any time, so a visitor hash can never be
// linked across more than two days.
type Salts struct {
	db *sql.DB

	mu       sync.Mutex
	day      string
	current  []byte
	previous []byte
}

func NewSalts(db *sql.DB) *Salts { return &Salts{db: db} }

// Get returns today's salt and yesterday's (nil if there was none).
func (s *Salts) Get(now time.Time) (current, previous []byte, err error) {
	day := now.UTC().Format(time.DateOnly)
	s.mu.Lock()
	defer s.mu.Unlock()
	if day == s.day {
		return s.current, s.previous, nil
	}
	yesterday := now.UTC().AddDate(0, 0, -1).Format(time.DateOnly)

	cur, err := s.load(day)
	if err != nil {
		return nil, nil, err
	}
	if cur == nil {
		cur = make([]byte, 16)
		rand.Read(cur)
		if _, err := s.db.Exec(`INSERT OR REPLACE INTO salts (day, salt) VALUES (?, ?)`, day, cur); err != nil {
			return nil, nil, err
		}
	}
	prev, err := s.load(yesterday)
	if err != nil {
		return nil, nil, err
	}
	if _, err := s.db.Exec(`DELETE FROM salts WHERE day < ?`, yesterday); err != nil {
		return nil, nil, err
	}
	s.day, s.current, s.previous = day, cur, prev
	return cur, prev, nil
}

func (s *Salts) load(day string) ([]byte, error) {
	var salt []byte
	err := s.db.QueryRow(`SELECT salt FROM salts WHERE day = ?`, day).Scan(&salt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return salt, err
}
