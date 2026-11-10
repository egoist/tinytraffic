// Package store owns the DuckDB database: schema, sites, settings and the
// batched event writer.
package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/duckdb/duckdb-go/v2"
)

type Site struct {
	ID        int32     `json:"id"`
	Domain    string    `json:"domain"`
	Timezone  string    `json:"timezone"`
	CreatedAt time.Time `json:"created_at"`
}

var ErrNotFound = errors.New("not found")
var ErrExists = errors.New("already exists")

type Store struct {
	DB *sql.DB

	mu    sync.RWMutex
	sites map[string]Site // by domain
}

type Options struct {
	// MemoryLimit caps DuckDB's memory use, e.g. "1GB". DuckDB's own default
	// is 80% of system RAM, which is too greedy for a small VPS.
	MemoryLimit string
}

var memoryLimitPattern = regexp.MustCompile(`^(?i)\d+(\.\d+)?\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$`)

// Open opens (or creates) the database at path. An empty path opens an
// in-memory database.
func Open(path string, opts Options) (*Store, error) {
	if opts.MemoryLimit == "" {
		opts.MemoryLimit = "1GB"
	}
	if !memoryLimitPattern.MatchString(opts.MemoryLimit) {
		return nil, fmt.Errorf("invalid memory limit %q (use e.g. 512MB or 2GB)", opts.MemoryLimit)
	}
	// Every connection works in UTC so time.Time parameters and TIMESTAMPTZ
	// columns compare without surprises; local time is applied in queries.
	// Insertion order is irrelevant for us and keeping it costs memory.
	init := []string{
		"SET TimeZone = 'UTC'",
		"SET memory_limit = '" + opts.MemoryLimit + "'",
		"SET preserve_insertion_order = false",
	}
	connector, err := duckdb.NewConnector(path, func(execer driver.ExecerContext) error {
		for _, stmt := range init {
			if _, err := execer.ExecContext(context.Background(), stmt, nil); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("open duckdb: %w", err)
	}
	db := sql.OpenDB(connector)
	s := &Store{DB: db, sites: map[string]Site{}}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := s.loadSites(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// Each migration is a list of statements, applied once and in order.
var migrations = [][]string{
	{
		`CREATE SEQUENCE sites_id_seq START 1`,
		`CREATE TABLE sites (
			id         INTEGER PRIMARY KEY DEFAULT nextval('sites_id_seq'),
			domain     VARCHAR NOT NULL UNIQUE,
			timezone   VARCHAR NOT NULL DEFAULT 'UTC',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		// Append-only, one row per event. Empty strings instead of NULLs keep
		// grouping and scanning simple.
		`CREATE TABLE events (
			ts              TIMESTAMPTZ NOT NULL,
			site_id         INTEGER NOT NULL,
			name            VARCHAR NOT NULL,
			hostname        VARCHAR NOT NULL,
			pathname        VARCHAR NOT NULL,
			visitor_id      UBIGINT NOT NULL,
			session_id      UBIGINT NOT NULL,
			referrer        VARCHAR NOT NULL,
			referrer_source VARCHAR NOT NULL,
			utm_source      VARCHAR NOT NULL,
			utm_medium      VARCHAR NOT NULL,
			utm_campaign    VARCHAR NOT NULL,
			utm_content     VARCHAR NOT NULL,
			utm_term        VARCHAR NOT NULL,
			country         VARCHAR NOT NULL,
			region          VARCHAR NOT NULL,
			city            VARCHAR NOT NULL,
			browser         VARCHAR NOT NULL,
			browser_version VARCHAR NOT NULL,
			os              VARCHAR NOT NULL,
			os_version      VARCHAR NOT NULL,
			device          VARCHAR NOT NULL,
			screen_width    USMALLINT NOT NULL,
			props           VARCHAR NOT NULL
		)`,
		`CREATE TABLE salts (
			day  DATE PRIMARY KEY,
			salt BLOB NOT NULL
		)`,
		`CREATE TABLE settings (
			key   VARCHAR PRIMARY KEY,
			value VARCHAR NOT NULL
		)`,
	},
}

func (s *Store) migrate() error {
	if _, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	var version int
	if err := s.DB.QueryRow(`SELECT coalesce(max(version), 0) FROM schema_migrations`).Scan(&version); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	for i := version; i < len(migrations); i++ {
		tx, err := s.DB.Begin()
		if err != nil {
			return err
		}
		for _, stmt := range migrations[i] {
			if _, err := tx.Exec(stmt); err != nil {
				tx.Rollback()
				return fmt.Errorf("migration %d: %w", i+1, err)
			}
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations VALUES (?)`, i+1); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

// --- settings ---

func (s *Store) Setting(key string) (string, error) {
	var v string
	err := s.DB.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.DB.Exec(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, key, value)
	return err
}

// --- sites ---

func NormalizeDomain(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimPrefix(d, "http://")
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	return strings.TrimPrefix(d, "www.")
}

func (s *Store) loadSites() error {
	rows, err := s.DB.Query(`SELECT id, domain, timezone, created_at FROM sites`)
	if err != nil {
		return err
	}
	defer rows.Close()
	sites := map[string]Site{}
	for rows.Next() {
		var site Site
		if err := rows.Scan(&site.ID, &site.Domain, &site.Timezone, &site.CreatedAt); err != nil {
			return err
		}
		sites[site.Domain] = site
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	s.sites = sites
	s.mu.Unlock()
	return nil
}

// SiteByDomain is served from memory; it is on the hot ingest path.
func (s *Store) SiteByDomain(domain string) (Site, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	site, ok := s.sites[NormalizeDomain(domain)]
	return site, ok
}

func (s *Store) Sites() []Site {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Site, 0, len(s.sites))
	for _, site := range s.sites {
		out = append(out, site)
	}
	return out
}

func (s *Store) CreateSite(domain, timezone string) (Site, error) {
	domain = NormalizeDomain(domain)
	if _, ok := s.SiteByDomain(domain); ok {
		return Site{}, ErrExists
	}
	site := Site{Domain: domain, Timezone: timezone}
	err := s.DB.QueryRow(
		`INSERT INTO sites (domain, timezone) VALUES (?, ?) RETURNING id, created_at`,
		domain, timezone,
	).Scan(&site.ID, &site.CreatedAt)
	if err != nil {
		return Site{}, err
	}
	s.mu.Lock()
	s.sites[domain] = site
	s.mu.Unlock()
	return site, nil
}

func (s *Store) UpdateSiteTimezone(domain, timezone string) (Site, error) {
	site, ok := s.SiteByDomain(domain)
	if !ok {
		return Site{}, ErrNotFound
	}
	if _, err := s.DB.Exec(`UPDATE sites SET timezone = ? WHERE id = ?`, timezone, site.ID); err != nil {
		return Site{}, err
	}
	site.Timezone = timezone
	s.mu.Lock()
	s.sites[site.Domain] = site
	s.mu.Unlock()
	return site, nil
}

func (s *Store) DeleteSite(domain string) error {
	site, ok := s.SiteByDomain(domain)
	if !ok {
		return ErrNotFound
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM events WHERE site_id = ?`, site.ID); err != nil {
		tx.Rollback()
		return err
	}
	if _, err := tx.Exec(`DELETE FROM sites WHERE id = ?`, site.ID); err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.sites, site.Domain)
	s.mu.Unlock()
	return nil
}
