// Package store owns the database: sites, settings, API keys, salts and the
// events table with its batched writer. Everything lives in one DuckDB file,
// or in ClickHouse when Options.ClickHouseURL is set.
package store

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sync"
	"time"

	"database/sql"
)

type Site struct {
	ID     int32  `json:"id"`
	Domain string `json:"domain"`
	// Name is what the owner calls the site. Empty means the dashboard
	// shows Title instead.
	Name string `json:"name"`
	// Title is the <title> of the site's homepage, as its visitors' browsers
	// reported it.
	Title    string `json:"title"`
	Timezone string `json:"timezone"`
	// Aliases are the site's previous domains. Events sent to them still
	// count, so a snippet that wasn't updated after a rename keeps working.
	Aliases []string `json:"aliases"`
	// Public sites' dashboards can be viewed without signing in.
	Public    bool      `json:"public"`
	CreatedAt time.Time `json:"created_at"`
}

var ErrNotFound = errors.New("not found")
var ErrExists = errors.New("already exists")

type Store struct {
	// DB is the DuckDB database, nil when everything lives in ClickHouse.
	DB *sql.DB
	// Events is the events table.
	Events *Events

	meta meta

	mu       sync.RWMutex
	sites    map[int32]Site
	byDomain map[string]int32 // domains and aliases
	// siteWrite serializes changes to sites and API keys, and reloads of
	// them, since a domain must be unique across both sites and aliases.
	siteWrite sync.Mutex

	keysMu sync.RWMutex
	keys   map[string]*APIKey // by hash

	stop      chan struct{}
	closeOnce sync.Once

	hooksMu sync.Mutex
	hooks   []func()
}

// meta stores everything but events: sites, aliases, API keys, settings and
// salts. Store keeps sites and API keys cached in memory and checks
// uniqueness itself; meta only persists.
type meta interface {
	loadSites() (map[int32]Site, error)
	createSite(domain, timezone string) (Site, error)
	updateSite(old, next Site) error
	removeAlias(id int32, domain string) error
	deleteSite(site Site) error // and its events

	loadAPIKeys() (map[string]*APIKey, error)
	createAPIKey(k *APIKey) error // sets ID and CreatedAt
	deleteAPIKey(id int32) error
	touchAPIKey(id int32, t time.Time) error

	setting(key string) (string, error)
	setSetting(key, value string) error

	salt(day string) ([]byte, error)
	addSalt(day string, salt []byte) ([]byte, error)
	deleteSaltsBefore(day string) error

	close() error
}

type Options struct {
	// MemoryLimit caps DuckDB's memory use, e.g. "1GB". DuckDB's own default
	// is 80% of system RAM, which is too greedy for a small VPS.
	MemoryLimit string
	// ClickHouseURL, when set, keeps everything in ClickHouse instead of
	// DuckDB, e.g. clickhouse://user:password@host:9000/tinytraffic. Several
	// processes can then use the database at once, e.g. during a deploy.
	ClickHouseURL string
}

var memoryLimitPattern = regexp.MustCompile(`^(?i)\d+(\.\d+)?\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$`)

// refreshInterval is how often a ClickHouse store reloads sites and API keys,
// to see changes made by another process.
const refreshInterval = 10 * time.Second

// Open opens (or creates) the DuckDB database at path, or the ClickHouse
// database in opts.ClickHouseURL, in which case path is ignored. An empty
// path opens an in-memory DuckDB database.
func Open(path string, opts Options) (*Store, error) {
	s := &Store{sites: map[int32]Site{}, byDomain: map[string]int32{}, keys: map[string]*APIKey{}}
	if opts.ClickHouseURL != "" {
		db, err := openClickHouse(opts.ClickHouseURL)
		if err != nil {
			return nil, err
		}
		s.meta = &clickhouseMeta{db: db}
		s.Events = &Events{DB: db, Backend: ClickHouse}
	} else {
		db, err := openDuckDB(path, opts)
		if err != nil {
			return nil, err
		}
		s.DB = db
		s.meta = &duckMeta{db: db}
		s.Events = &Events{DB: db, Backend: DuckDB}
	}
	if err := s.reload(); err != nil {
		s.meta.close()
		return nil, err
	}
	if s.Events.Backend == ClickHouse {
		s.stop = make(chan struct{})
		go s.refresh()
	}
	return s, nil
}

func (s *Store) Close() error {
	var err error
	s.closeOnce.Do(func() {
		if s.stop != nil {
			close(s.stop)
		}
		err = s.meta.close()
	})
	return err
}

func (s *Store) reload() error {
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	sites, err := s.meta.loadSites()
	if err != nil {
		return fmt.Errorf("load sites: %w", err)
	}
	keys, err := s.meta.loadAPIKeys()
	if err != nil {
		return fmt.Errorf("load api keys: %w", err)
	}
	s.mu.Lock()
	s.sites = sites
	s.reindexLocked()
	s.mu.Unlock()
	s.keysMu.Lock()
	s.keys = keys
	s.keysMu.Unlock()
	return nil
}

func (s *Store) refresh() {
	t := time.NewTicker(refreshInterval)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
			s.Refresh()
		}
	}
}

// Refresh picks up changes made by other processes, such as the previous
// instance during a rolling deploy or a command run alongside the server:
// it reloads sites and API keys, then runs the OnRefresh callbacks. A
// ClickHouse store does this every 10 seconds on its own.
func (s *Store) Refresh() error {
	err := s.reload()
	s.hooksMu.Lock()
	hooks := slices.Clone(s.hooks)
	s.hooksMu.Unlock()
	for _, fn := range hooks {
		fn()
	}
	return err
}

// OnRefresh registers fn to run on every Refresh, to update data cached
// outside the store.
func (s *Store) OnRefresh(fn func()) {
	s.hooksMu.Lock()
	s.hooks = append(s.hooks, fn)
	s.hooksMu.Unlock()
}

// --- settings ---

// Setting returns a setting, or "" if it isn't set.
func (s *Store) Setting(key string) (string, error) { return s.meta.setting(key) }

func (s *Store) SetSetting(key, value string) error { return s.meta.setSetting(key, value) }

// --- salts ---

// Salt returns the salt for a day (YYYY-MM-DD), or nil if there is none.
func (s *Store) Salt(day string) ([]byte, error) { return s.meta.salt(day) }

// AddSalt stores a salt for a day unless it has one already, and returns the
// day's salt. When processes race to add one, they all get the same salt.
func (s *Store) AddSalt(day string, salt []byte) ([]byte, error) { return s.meta.addSalt(day, salt) }

// DeleteSaltsBefore deletes the salts of days before day.
func (s *Store) DeleteSaltsBefore(day string) error { return s.meta.deleteSaltsBefore(day) }
