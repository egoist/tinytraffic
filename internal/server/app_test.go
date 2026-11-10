package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
