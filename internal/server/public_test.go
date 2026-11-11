package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
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
	return callJSON(h, method, path, token, "")
}

func callJSON(h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
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
	st.Events.Insert(context.Background(), []store.Event{
		{Timestamp: now.Add(-time.Hour), SiteID: site.ID, Name: "pageview", Pathname: "/", VisitorID: 1, SessionID: 1},
		{Timestamp: now.Add(-time.Hour), SiteID: site.ID, Name: "pageview", Pathname: "/docs", VisitorID: 2, SessionID: 2},
	})
	h := testServer(t, st)
	key, token, err := st.CreateAPIKey("my app", store.ScopeRead)
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
	var l rateLimiter[int32]
	now := time.Now()
	for i := 1; i <= rateLimit; i++ {
		if left, _ := l.take(1, rateLimit, now); left != rateLimit-i {
			t.Fatalf("request %d: %d left", i, left)
		}
	}
	if left, reset := l.take(1, rateLimit, now.Add(10*time.Second)); left >= 0 || reset != 50*time.Second {
		t.Errorf("over limit: %d left, reset in %v", left, reset)
	}
	if left, _ := l.take(2, rateLimit, now); left != rateLimit-1 {
		t.Errorf("other keys have their own budget: %d", left)
	}
	if left, _ := l.take(1, rateLimit, now.Add(rateWindow)); left != rateLimit-1 {
		t.Errorf("after the window: %d", left)
	}
	// Finished windows are forgotten.
	l.take(3, rateLimit, now.Add(3*rateWindow))
	if len(l.windows) != 1 {
		t.Errorf("%d windows kept, want only the current one", len(l.windows))
	}
}

func TestAPIKeysPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "db.duckdb")
	st, err := store.Open(path, store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	_, token, _ := st.CreateAPIKey("ci", store.ScopeRead)
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

func TestWriteScope(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	h := testServer(t, st)
	_, readKey, _ := st.CreateAPIKey("reader", store.ScopeRead)
	_, writeKey, _ := st.CreateAPIKey("writer", store.ScopeWrite)
	if _, _, err := st.CreateAPIKey("bad", "admin"); err == nil {
		t.Error("unknown scope accepted")
	}

	if rec := callJSON(h, "POST", "/api/v1/sites", readKey, `{"domain":"new.com"}`); rec.Code != 403 {
		t.Errorf("read key creating a site: %d %s", rec.Code, rec.Body)
	}
	if rec := callJSON(h, "POST", "/api/v1/sites", writeKey, `{"domain":"https://www.New.com/","timezone":"Europe/Berlin"}`); rec.Code != 201 || !strings.Contains(rec.Body.String(), `"domain":"new.com"`) {
		t.Fatalf("write key creating a site: %d %s", rec.Code, rec.Body)
	}
	if rec := callJSON(h, "PATCH", "/api/v1/sites/new.com", writeKey, `{"timezone":"Asia/Tokyo"}`); rec.Code != 200 || !strings.Contains(rec.Body.String(), "Asia/Tokyo") {
		t.Errorf("update: %d %s", rec.Code, rec.Body)
	}
	// Changing the domain keeps the old one working, and sites can be
	// addressed by ID.
	rec := callJSON(h, "PATCH", "/api/v1/sites/new.com", writeKey, `{"domain":"renamed.com"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"domain":"renamed.com","name":"","title":"","timezone":"Asia/Tokyo","aliases":["new.com"]`) {
		t.Errorf("rename: %d %s", rec.Code, rec.Body)
	}
	site, _ := st.SiteByDomain("renamed.com")
	for _, ref := range []string{"renamed.com", "new.com", strconv.Itoa(int(site.ID))} {
		if rec := call(h, "GET", "/api/v1/sites/"+ref+"/realtime", writeKey); rec.Code != 200 {
			t.Errorf("realtime via %s: %d", ref, rec.Code)
		}
	}
	if rec := callJSON(h, "PATCH", "/api/v1/sites/renamed.com", writeKey, `{"domain":"not a domain"}`); rec.Code != 400 {
		t.Errorf("invalid domain: %d %s", rec.Code, rec.Body)
	}
	if rec := callJSON(h, "POST", "/api/v1/sites", writeKey, `{"domain":"new.com"}`); rec.Code != 409 {
		t.Errorf("creating a site on an alias: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "DELETE", "/api/v1/sites/renamed.com/aliases/new.com", writeKey); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"aliases":[]`) {
		t.Errorf("remove alias: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "DELETE", "/api/v1/sites/renamed.com/aliases/new.com", writeKey); rec.Code != 404 {
		t.Errorf("remove missing alias: %d", rec.Code)
	}

	// Write keys can read too.
	if rec := call(h, "GET", "/api/v1/sites/renamed.com/aggregate?period=7d", writeKey); rec.Code != 200 {
		t.Errorf("write key reading: %d", rec.Code)
	}
	if rec := call(h, "DELETE", "/api/v1/sites/renamed.com", readKey); rec.Code != 403 {
		t.Errorf("read key deleting: %d", rec.Code)
	}
	if rec := call(h, "DELETE", "/api/v1/sites/renamed.com", writeKey); rec.Code != 200 {
		t.Errorf("delete: %d %s", rec.Code, rec.Body)
	}
	if _, ok := st.SiteByDomain("renamed.com"); ok {
		t.Error("site still exists after delete")
	}

	trusted := TrustedEventSender(st)
	for name, c := range map[string]struct {
		token string
		want  bool
	}{"write": {writeKey, true}, "read": {readKey, false}, "none": {"", false}} {
		req := httptest.NewRequest("POST", "/api/event", nil)
		if c.token != "" {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}
		if got := trusted(req); got != c.want {
			t.Errorf("%s key trusted = %v, want %v", name, got, c.want)
		}
	}
}
