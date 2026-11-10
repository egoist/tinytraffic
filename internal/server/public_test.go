package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/tinytraffic/internal/store"
)

func testServer(t *testing.T, st *store.Store) http.Handler {
	t.Helper()
	auth, err := NewAuth(st)
	if err != nil {
		t.Fatal(err)
	}
	return (&Server{Store: st, Auth: auth, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}).Handler()
}

func call(h http.Handler, method, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestPublicAPI(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	site, _ := st.CreateSite("example.com", "UTC")
	now := time.Now().UTC()
	store.InsertEvents(context.Background(), st.DB, []store.Event{
		{Timestamp: now.Add(-time.Hour), SiteID: site.ID, Name: "pageview", Pathname: "/", VisitorID: 1, SessionID: 1},
		{Timestamp: now.Add(-time.Hour), SiteID: site.ID, Name: "pageview", Pathname: "/docs", VisitorID: 2, SessionID: 2},
	})
	h := testServer(t, st)
	key, token, err := st.CreateAPIKey("my app")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(token, "tt_") || !strings.HasPrefix(token, key.Prefix) {
		t.Fatalf("token %q, prefix %q", token, key.Prefix)
	}

	rec := call(h, "GET", "/api/v1/sites", token)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"domain":"example.com"`) {
		t.Fatalf("sites: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "*" || rec.Header().Get("X-RateLimit-Remaining") == "" {
		t.Errorf("missing CORS or rate limit headers: %v", rec.Header())
	}

	rec = call(h, "GET", "/api/v1/sites/example.com/aggregate?period=7d", token)
	var agg struct {
		Current struct{ Visitors int } `json:"current"`
	}
	json.Unmarshal(rec.Body.Bytes(), &agg)
	if rec.Code != 200 || agg.Current.Visitors != 2 {
		t.Errorf("aggregate: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/v1/sites/example.com/breakdown/page?period=7d&f=page:/docs", token); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"/docs"`) {
		t.Errorf("breakdown: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/v1/sites/nope.com/aggregate", token); rec.Code != 404 {
		t.Errorf("unknown site: %d", rec.Code)
	}

	for name, tok := range map[string]string{"missing": "", "wrong": "tt_wrong", "no prefix": "abc"} {
		if rec := call(h, "GET", "/api/v1/sites", tok); rec.Code != 401 || rec.Header().Get("WWW-Authenticate") == "" {
			t.Errorf("%s key: %d", name, rec.Code)
		}
	}
	// API keys don't open the dashboard API, which is cookie-only.
	if rec := call(h, "GET", "/api/sites", token); rec.Code != 401 {
		t.Errorf("dashboard API with key: %d", rec.Code)
	}
	if rec := call(h, "OPTIONS", "/api/v1/sites", ""); rec.Code != 204 || !strings.Contains(rec.Header().Get("Access-Control-Allow-Headers"), "Authorization") {
		t.Errorf("preflight: %d %v", rec.Code, rec.Header())
	}

	if err := st.DeleteAPIKey(key.ID); err != nil {
		t.Fatal(err)
	}
	if rec := call(h, "GET", "/api/v1/sites", token); rec.Code != 401 {
		t.Errorf("revoked key: %d", rec.Code)
	}
}

func TestRateLimiter(t *testing.T) {
	var l rateLimiter
	now := time.Now()
	for i := 1; i <= rateLimit; i++ {
		if left, _ := l.take(1, now); left != rateLimit-i {
			t.Fatalf("request %d: %d left", i, left)
		}
	}
	if left, reset := l.take(1, now.Add(10*time.Second)); left >= 0 || reset != 50*time.Second {
		t.Errorf("over limit: %d left, reset in %v", left, reset)
	}
	if left, _ := l.take(2, now); left != rateLimit-1 {
		t.Errorf("other keys have their own budget: %d", left)
	}
	if left, _ := l.take(1, now.Add(rateWindow)); left != rateLimit-1 {
		t.Errorf("after the window: %d", left)
	}
}

func TestAPIKeysPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.duckdb")
	st, err := store.Open(path, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	_, token, _ := st.CreateAPIKey("ci")
	st.Close()

	st, err = store.Open(path, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if k, ok := st.AuthenticateAPIKey(token); !ok || k.Name != "ci" {
		t.Errorf("key not found after reopening: %+v %v", k, ok)
	}
}
