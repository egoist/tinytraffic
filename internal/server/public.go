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

// The public API (/api/v1) serves the same read-only stats as the dashboard
// to third-party apps, authenticated with an API key:
//
//	Authorization: Bearer tt_...
//
// It uses no cookies, so cross-origin requests are allowed.

const (
	rateLimit  = 600 // requests per key per window
	rateWindow = time.Minute
)

func (s *Server) publicRoutes(mux *http.ServeMux) {
	mux.HandleFunc("OPTIONS /api/v1/", func(w http.ResponseWriter, r *http.Request) {
		setCORS(w)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/v1/sites", s.public(s.listSites))
	mux.HandleFunc("GET /api/v1/sites/{domain}/aggregate", s.public(s.aggregate))
	mux.HandleFunc("GET /api/v1/sites/{domain}/timeseries", s.public(s.timeseries))
	mux.HandleFunc("GET /api/v1/sites/{domain}/breakdown/{dim}", s.public(s.breakdown))
	mux.HandleFunc("GET /api/v1/sites/{domain}/realtime", s.public(s.realtime))

	// Key management, from the dashboard.
	mux.HandleFunc("GET /api/keys", s.private(s.listKeys))
	mux.HandleFunc("POST /api/keys", s.private(s.createKey))
	mux.HandleFunc("DELETE /api/keys/{id}", s.private(s.deleteKey))
}

func setCORS(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Authorization")
	h.Set("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After")
	h.Set("Access-Control-Max-Age", "86400")
}

// public requires a valid API key and applies the per-key rate limit.
func (s *Server) public(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		setCORS(w)
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		key, valid := store.APIKey{}, false
		if ok {
			key, valid = s.Store.AuthenticateAPIKey(strings.TrimSpace(token))
		}
		if !valid {
			w.Header().Set("WWW-Authenticate", `Bearer realm="tinytraffic"`)
			writeError(w, http.StatusUnauthorized, "missing or invalid API key")
			return
		}
		remaining, retryAfter := s.limits.take(key.ID, time.Now())
		w.Header().Set("X-RateLimit-Limit", strconv.Itoa(rateLimit))
		w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(max(remaining, 0)))
		if remaining < 0 {
			w.Header().Set("Retry-After", strconv.Itoa(int(retryAfter.Seconds())+1))
			writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
			return
		}
		h(w, r)
	}
}

// rateLimiter is a fixed-window counter per API key.
type rateLimiter struct {
	mu      sync.Mutex
	windows map[int32]*rateWindowState
}

type rateWindowState struct {
	start time.Time
	count int
}

// take records a request and returns how many remain in the window
// (negative when over the limit) and when the window resets.
func (l *rateLimiter) take(id int32, now time.Time) (remaining int, reset time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.windows == nil {
		l.windows = map[int32]*rateWindowState{}
	}
	w, ok := l.windows[id]
	if !ok || now.Sub(w.start) >= rateWindow {
		w = &rateWindowState{start: now}
		l.windows[id] = w
	}
	w.count++
	return rateLimit - w.count, rateWindow - now.Sub(w.start)
}

// --- key management ---

func (s *Server) listKeys(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.Store.APIKeys())
}

func (s *Server) createKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" || len(name) > 100 {
		writeError(w, http.StatusBadRequest, "give the key a name (up to 100 characters)")
		return
	}
	key, token, err := s.Store.CreateAPIKey(name)
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
