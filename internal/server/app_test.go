package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/egoist/tinytraffic/internal/store"
)

func TestAppSignInRedirects(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	auth, err := NewAuth(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.SetPassword("correct horse"); err != nil {
		t.Fatal(err)
	}
	s := &Server{
		Store: st,
		Auth:  auth,
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Dist:  fstest.MapFS{"_shell.html": {Data: []byte("<html></html>")}},
	}
	h := s.Handler()

	issue := httptest.NewRecorder()
	auth.IssueCookie(issue, httptest.NewRequest(http.MethodPost, "/", nil))
	cookie := issue.Result().Cookies()[0]

	cases := []struct {
		name     string
		path     string
		signedIn bool
		status   int
		location string
	}{
		{"signed out, page", "/sites/1?period=7d", false, http.StatusFound, "/login?redirect=%2Fsites%2F1%3Fperiod%3D7d"},
		{"signed out, root", "/", false, http.StatusFound, "/login"},
		{"signed out, sign-in page", "/login", false, http.StatusOK, ""},
		{"signed in, page", "/sites/1", true, http.StatusOK, ""},
		{"signed in, sign-in page", "/login?redirect=/sites/1", true, http.StatusFound, "/sites/1"},
		{"signed in, sign-in page, no target", "/login", true, http.StatusFound, "/"},
		{"signed in, sign-in page, off-site target", "/login?redirect=//evil.example", true, http.StatusFound, "/"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, c.path, nil)
			if c.signedIn {
				req.AddCookie(cookie)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != c.status {
				t.Fatalf("status = %d, want %d", rec.Code, c.status)
			}
			if got := rec.Header().Get("Location"); got != c.location {
				t.Fatalf("location = %q, want %q", got, c.location)
			}
		})
	}
}

func TestPublicDashboard(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	auth, err := NewAuth(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.SetPassword("correct horse"); err != nil {
		t.Fatal(err)
	}
	s := &Server{
		Store: st,
		Auth:  auth,
		Log:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		Dist:  fstest.MapFS{"_shell.html": {Data: []byte("<html></html>")}},
	}
	h := s.Handler()
	issue := httptest.NewRecorder()
	auth.IssueCookie(issue, httptest.NewRequest(http.MethodPost, "/", nil))
	cookie := issue.Result().Cookies()[0]

	open, _ := st.CreateSite("open.example", "UTC")
	st.CreateSite("closed.example", "UTC")
	st.UpdateSite(open.ID, store.SiteUpdate{Domain: "open.example.com"}) // leaves an alias
	yes := true
	if _, err := st.UpdateSite(open.ID, store.SiteUpdate{Public: &yes}); err != nil {
		t.Fatal(err)
	}

	get := func(path string, signedIn bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if signedIn {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	cases := []struct {
		path     string
		signedIn bool
		status   int
	}{
		{"/sites/1", false, http.StatusOK},
		{"/sites/1/", false, http.StatusOK},
		{"/sites/open.example.com?period=7d", false, http.StatusOK},
		{"/sites/1/live", false, http.StatusFound},
		{"/sites/1/settings", false, http.StatusFound},
		{"/sites/2", false, http.StatusFound},
		{"/sites/99", false, http.StatusFound},
		{"/", false, http.StatusFound},
		{"/api/sites/1", false, http.StatusOK},
		{"/api/sites/1/aggregate?period=7d", false, http.StatusOK},
		{"/api/sites/1/timeseries?period=7d", false, http.StatusOK},
		{"/api/sites/1/breakdown/page?period=7d", false, http.StatusOK},
		{"/api/sites/1/realtime", false, http.StatusOK},
		{"/api/sites/1/live", false, http.StatusUnauthorized},
		{"/api/sites/1/locations", false, http.StatusUnauthorized},
		{"/api/sites", false, http.StatusUnauthorized},
		{"/api/sites/2", false, http.StatusUnauthorized},
		{"/api/sites/2/aggregate?period=7d", false, http.StatusUnauthorized},
		{"/api/sites/99/aggregate?period=7d", false, http.StatusUnauthorized},
		{"/api/sites/2", true, http.StatusOK},
		{"/api/sites/99", true, http.StatusNotFound},
		{"/api/info", false, http.StatusOK},
	}
	for _, c := range cases {
		if rec := get(c.path, c.signedIn); rec.Code != c.status {
			t.Errorf("GET %s (signed in: %v) = %d, want %d", c.path, c.signedIn, rec.Code, c.status)
		}
	}

	var site store.Site
	if err := json.NewDecoder(get("/api/sites/1", false).Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	if !site.Public || len(site.Aliases) != 0 {
		t.Errorf("public view of site = %+v, want public and no aliases", site)
	}
	if err := json.NewDecoder(get("/api/sites/1", true).Body).Decode(&site); err != nil {
		t.Fatal(err)
	}
	if len(site.Aliases) != 1 {
		t.Errorf("signed-in view of site has aliases %v, want the old domain", site.Aliases)
	}

	// Making it private closes it again.
	req := httptest.NewRequest(http.MethodPatch, "/api/sites/1", strings.NewReader(`{"public": false}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH public=false = %d: %s", rec.Code, rec.Body)
	}
	if rec := get("/api/sites/1/aggregate?period=7d", false); rec.Code != http.StatusUnauthorized {
		t.Errorf("private site's stats = %d, want 401", rec.Code)
	}
	if rec := get("/sites/1", false); rec.Code != http.StatusFound {
		t.Errorf("private site's page = %d, want 302", rec.Code)
	}
}

func TestPublicDashboardRateLimit(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	auth, err := NewAuth(st)
	if err != nil {
		t.Fatal(err)
	}
	auth.SetPassword("correct horse")
	h := (&Server{Store: st, Auth: auth, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}).Handler()
	issue := httptest.NewRecorder()
	auth.IssueCookie(issue, httptest.NewRequest(http.MethodPost, "/", nil))
	cookie := issue.Result().Cookies()[0]
	site, _ := st.CreateSite("open.example", "UTC")
	yes := true
	st.UpdateSite(site.ID, store.SiteUpdate{Public: &yes})

	get := func(remote string, signedIn bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/sites/1/realtime", nil)
		req.RemoteAddr = remote
		if signedIn {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	for i := range viewerRateLimit {
		if rec := get("192.0.2.1:1234", false); rec.Code != http.StatusOK {
			t.Fatalf("request %d: %d", i+1, rec.Code)
		}
	}
	rec := get("192.0.2.1:1234", false)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Errorf("over the limit: %d, Retry-After %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	if rec := get("192.0.2.2:1234", false); rec.Code != http.StatusOK {
		t.Errorf("another IP: %d", rec.Code)
	}
	if rec := get("192.0.2.1:1234", true); rec.Code != http.StatusOK || rec.Header().Get("X-RateLimit-Limit") != "" {
		t.Errorf("signed in: %d, limit header %q", rec.Code, rec.Header().Get("X-RateLimit-Limit"))
	}

	// Addresses in one IPv6 /64 share a budget.
	for i := range viewerRateLimit {
		get("[2001:db8::"+strconv.Itoa(i+1)+"]:1234", false)
	}
	if rec := get("[2001:db8::ffff]:1234", false); rec.Code != http.StatusTooManyRequests {
		t.Errorf("same /64: %d", rec.Code)
	}
	if rec := get("[2001:db8:0:1::1]:1234", false); rec.Code != http.StatusOK {
		t.Errorf("another /64: %d", rec.Code)
	}
}
