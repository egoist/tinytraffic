package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Scopes an API key can have. Write includes read.
const (
	ScopeRead  = "read"
	ScopeWrite = "write"
)

// APIKey grants access to the public API (/api/v1).
type APIKey struct {
	ID         int32      `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Scope      string     `json:"scope"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at"`

	hash string
}

const keyPrefix = "tt_"

func hashKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Store) loadAPIKeys() error {
	rows, err := s.DB.Query(`SELECT id, name, prefix, scope, hash, created_at, last_used_at FROM api_keys`)
	if err != nil {
		return err
	}
	defer rows.Close()
	keys := map[string]*APIKey{}
	for rows.Next() {
		k := &APIKey{}
		var last sql.NullTime
		if err := rows.Scan(&k.ID, &k.Name, &k.Prefix, &k.Scope, &k.hash, &k.CreatedAt, &last); err != nil {
			return err
		}
		if last.Valid {
			k.LastUsedAt = &last.Time
		}
		keys[k.hash] = k
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.keysMu.Lock()
	s.keys = keys
	s.keysMu.Unlock()
	return nil
}

// CreateAPIKey returns the new key and its secret token. The token is only
// available now; afterwards just its hash is kept.
func (s *Store) CreateAPIKey(name, scope string) (APIKey, string, error) {
	if scope != ScopeRead && scope != ScopeWrite {
		return APIKey{}, "", fmt.Errorf("unknown scope %q", scope)
	}
	b := make([]byte, 24)
	rand.Read(b)
	token := keyPrefix + base64.RawURLEncoding.EncodeToString(b)
	k := &APIKey{Name: name, Prefix: token[:len(keyPrefix)+6], Scope: scope, hash: hashKey(token)}
	err := s.DB.QueryRow(
		`INSERT INTO api_keys (name, prefix, scope, hash) VALUES (?, ?, ?, ?) RETURNING id, created_at`,
		k.Name, k.Prefix, k.Scope, k.hash,
	).Scan(&k.ID, &k.CreatedAt)
	if err != nil {
		return APIKey{}, "", err
	}
	s.keysMu.Lock()
	s.keys[k.hash] = k
	s.keysMu.Unlock()
	return *k, token, nil
}

// APIKeys lists keys, newest first.
func (s *Store) APIKeys() []APIKey {
	s.keysMu.RLock()
	defer s.keysMu.RUnlock()
	out := make([]APIKey, 0, len(s.keys))
	for _, k := range s.keys {
		out = append(out, *k)
	}
	slices.SortFunc(out, func(a, b APIKey) int { return int(b.ID - a.ID) })
	return out
}

func (s *Store) DeleteAPIKey(id int32) error {
	res, err := s.DB.Exec(`DELETE FROM api_keys WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	s.keysMu.Lock()
	for h, k := range s.keys {
		if k.ID == id {
			delete(s.keys, h)
		}
	}
	s.keysMu.Unlock()
	return nil
}

// CanWrite reports whether the key may change data.
func (k APIKey) CanWrite() bool { return k.Scope == ScopeWrite }

// AuthenticateAPIKey resolves a token to its key and records the use. The
// last-used time is written at most once a minute per key.
func (s *Store) AuthenticateAPIKey(token string) (APIKey, bool) {
	if !strings.HasPrefix(token, keyPrefix) {
		return APIKey{}, false
	}
	h := hashKey(token)
	now := time.Now().UTC()
	s.keysMu.Lock()
	k, ok := s.keys[h]
	var touch bool
	if ok && (k.LastUsedAt == nil || now.Sub(*k.LastUsedAt) > time.Minute) {
		k.LastUsedAt = &now
		touch = true
	}
	var key APIKey
	if ok {
		key = *k
	}
	s.keysMu.Unlock()
	if !ok {
		return APIKey{}, false
	}
	if touch {
		go s.DB.Exec(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`, now, key.ID)
	}
	return key, true
}
