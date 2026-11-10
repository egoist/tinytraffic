package store

import (
	"crypto/rand"
	"crypto/sha256"
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
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	if err := s.meta.createAPIKey(k); err != nil {
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
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	if !slices.ContainsFunc(s.APIKeys(), func(k APIKey) bool { return k.ID == id }) {
		return ErrNotFound
	}
	if err := s.meta.deleteAPIKey(id); err != nil {
		return err
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
		go s.meta.touchAPIKey(key.ID, now)
	}
	return key, true
}
