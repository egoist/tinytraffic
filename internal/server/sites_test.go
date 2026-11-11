package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/egoist/tinytraffic/internal/store"
)

func TestSiteName(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	site, _ := st.CreateSite("example.com", "UTC")
	if err := st.SetTitle(site.ID, "Example Store"); err != nil {
		t.Fatal(err)
	}
	auth, err := NewAuth(st)
	if err != nil {
		t.Fatal(err)
	}
	if err := auth.SetPassword("correct horse"); err != nil {
		t.Fatal(err)
	}
	h := (&Server{Store: st, Auth: auth, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}).Handler()
	issue := httptest.NewRecorder()
	auth.IssueCookie(issue, httptest.NewRequest(http.MethodPost, "/", nil))
	cookie := issue.Result().Cookies()[0]

	patch := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPatch, "/api/sites/1", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	rec := patch(`{"name": "  Example   Shop "}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH name = %d: %s", rec.Code, rec.Body)
	}
	var got store.Site
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "Example Shop" || got.Title != "Example Store" {
		t.Errorf("after naming: name %q, title %q; want the name collapsed to %q and the title kept", got.Name, got.Title, "Example Shop")
	}

	if rec := patch(`{"name": "` + strings.Repeat("é", 101) + `"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("PATCH a 101-character name = %d, want 400", rec.Code)
	}

	if rec := patch(`{"name": ""}`); rec.Code != http.StatusOK {
		t.Fatalf("PATCH empty name = %d: %s", rec.Code, rec.Body)
	}
	if got, _ := st.SiteByID(site.ID); got.Name != "" || got.Title != "Example Store" {
		t.Errorf("after clearing: %+v", got)
	}

	if rec := patch(`{}`); rec.Code != http.StatusBadRequest {
		t.Errorf("PATCH with nothing to change = %d, want 400", rec.Code)
	}
}
