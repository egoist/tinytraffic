package server

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/tinytraffic/internal/store"
)

// The public API (/api/v1) serves the same stats as the dashboard to
// third-party apps, authenticated with an API key:
//
//	Authorization: Bearer tt_...
//
// Read keys can only read. Write keys can also manage sites, and their
// requests to /api/event may forward the visitor's IP (see TrustedEventSender).
// The API uses no cookies, so cross-origin requests are allowed.

const (
	rateLimit  = 600 // requests per key per window
	rateWindow = time.Minute
	// viewerRateLimit is for signed-out viewers of public dashboards, per IP
	// (IPv6 per /64). A page load takes about ten requests.
	viewerRateLimit = 300
)

func (s *Server) publicRoutes(mux *http.ServeMux) {
	mux.HandleFunc("OPTIONS /api/v1/", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w)
		w.WriteHeader(http.StatusNoContent)
	})
	read, write := store.ScopeRead, store.ScopeWrite
	mux.HandleFunc("GET /api/v1/sites", s.public(read, s.listSites))
	mux.HandleFunc("POST /api/v1/sites", s.public(write, s.createSite))
	mux.HandleFunc("PATCH /api/v1/sites/{site}", s.public(write, s.updateSite))
	mux.HandleFunc("DELETE /api/v1/sites/{site}", s.public(write, s.deleteSite))
	mux.HandleFunc("DELETE /api/v1/sites/{site}/aliases/{alias}", s.public(write, s.removeAlias))
	mux.HandleFunc("GET /api/v1/sites/{site}/aggregate", s.public(read, s.aggregate))
	mux.HandleFunc("GET /api/v1/sites/{site}/timeseries", s.public(read, s.timeseries))
	mux.HandleFunc("GET /api/v1/sites/{site}/breakdown/{dim}", s.public(read, s.breakdown))
	mux.HandleFunc("GET /api/v1/sites/{site}/realtime", s.public(read, s.realtime))

	// Key management, from the dashboard.
	mux.HandleFunc("GET /api/keys", s.private(s.listKeys))
	mux.HandleFunc("POST /api/keys", s.private(s.createKey))
	mux.HandleFunc("DELETE /api/keys/{id}", s.private(s.deleteKey))
}

func setCORS(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	h.Set("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After")
	h.Set("Access-Control-Max-Age", "86400")
}

// bearerKey returns the API key the request authenticates with, if any.
func bearerKey(st *store.Store, r *http.Request) (store.APIKey, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return store.APIKey{}, false
	}
	return st.AuthenticateAPIKey(strings.TrimSpace(token))
}

// TrustedEventSender reports whether an /api/event request comes from a
// write key. Those are servers sending events on behalf of visitors, so the
// visitor IP they forward in X-Forwarded-For is trusted.
func TrustedEventSender(st *store.Store) func(*http.Request) bool {
	return func(r *http.Request) bool {
		key, ok := bearerKey(st, r)
		return ok && key.CanWrite()
	}
}

// public requires a valid API key with the given scope and applies the
// per-key rate limit.
func (s *Server) public(scope string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setCORS(w)
		key, valid := bearerKey(s.Store, r)
		if !valid {
			w.Header().Set("WWW-Authenticate", `Bearer realm="tinytraffic"`)
			writeError(w, http.StatusUnauthorized, "missing or invalid API key")
			return
		}
		if scope == store.ScopeWrite && !key.CanWrite() {
			writeError(w, http.StatusForbidden, "this API key is read-only")
			return
		}
		if !limited(w, &s.limits, key.ID, rateLimit) {
			return
		}
		h(w, r)
	}
}

// limited counts a request against key's budget and sets the rate limit
// headers. Over the limit, it answers 429 and returns false.
func limited[K comparable](w http.ResponseWriter, l *rateLimiter[K], key K, limit int) bool {
	remaining, retryAfter := l.take(key, limit, time.Now())
	w.Header().Set("X-RateLimit-Limit", strconv.Itoa(limit))
	w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))
	if remaining < 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return false
	}
	return true
}

// rateLimiter is a fixed-window counter per key: an API key, or a viewer's
// IP address.
type rateLimiter[K comparable] struct {
	mu      sync.Mutex
	windows map[K]*rateWindowState
	swept   time.Time
}

type rateWindowState struct {
	start time.Time
	count int
}

// take records a request and returns how many of limit remain in the window
// (negative when over the limit) and when the window resets.
func (l *rateLimiter[K]) take(key K, limit int, now time.Time) (remaining int, reset time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows == nil {
		l.windows = map[K]*rateWindowState{}
	}
	// Forget finished windows now and then, so passing IPs don't pile up.
	if now.Sub(l.swept) >= rateWindow {
		for k, w := range l.windows {
			if now.Sub(w.start) >= rateWindow {
				delete(l.windows, k)
			}
		}
		l.swept = now
	}
	w, ok := l.windows[key]
	if !ok || now.Sub(w.start) >= rateWindow {
		w = &rateWindowState{start: now}
		l.windows[key] = w
	}
	w.count++
	return limit - w.count, rateWindow - now.Sub(w.start)
}

// --- key management ---

func (s *Server) listKeys(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Store.APIKeys())
}

func (s *Server) createKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name  string `json:"name"`
		Scope string `json:"scope"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		writeError(w, http.StatusBadRequest, "give the key a name (up to 100 characters)")
		return
	}
	if body.Scope == "" {
		body.Scope = store.ScopeRead
	}
	if body.Scope != store.ScopeRead && body.Scope != store.ScopeWrite {
		writeError(w, http.StatusBadRequest, `scope must be "read" or "write"`)
		return
	}
	key, token, err := s.Store.CreateAPIKey(name, body.Scope)
	if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"key": key, "token": token})
}

func (s *Server) deleteKey(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key id")
		return
	}
	if err := s.Store.DeleteAPIKey(int32(id)); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "key not found")
		return
	} else if err != nil {
		s.serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
