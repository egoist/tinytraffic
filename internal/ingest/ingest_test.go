package ingest

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/egoist/tinytraffic/internal/store"
)

func TestParseReferrer(t *testing.T) {
	cases := []struct{ ref, page, host, source string }{
		{"https://www.google.co.uk/", "example.com", "google.co.uk", "Google"},
		{"https://news.ycombinator.com/item?id=1", "example.com", "news.ycombinator.com", "Hacker News"},
		{"https://m.facebook.com/", "example.com", "m.facebook.com", "Facebook"},
		{"https://gemini.google.com/app", "example.com", "gemini.google.com", "Gemini"},
		{"https://blog.someone.dev/post", "example.com", "blog.someone.dev", "blog.someone.dev"},
		{"https://www.example.com/other", "example.com", "", ""},
		{"", "example.com", "", ""},
	}
	for _, c := range cases {
		host, source := parseReferrer(c.ref, c.page)
		if host != c.host || source != c.source {
			t.Errorf("parseReferrer(%q) = %q, %q; want %q, %q", c.ref, host, source, c.host, c.source)
		}
	}
}

const chromeUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"

func TestHandler(t *testing.T) {
	st, err := store.Open("", store.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	site, _ := st.CreateSite("example.com", "UTC")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	w := store.NewWriter(st.DB, log)
	h := NewHandler(Handler{Store: st, Writer: w, Salts: NewSalts(st.DB), Log: log})

	send := func(ua, body string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/event", strings.NewReader(body))
		req.Header.Set("User-Agent", ua)
		req.RemoteAddr = "203.0.113.7:1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	page := `{"n":"pageview","u":"https://www.example.com/docs?utm_source=hn","d":"example.com","r":"https://news.ycombinator.com/","w":390}`
	if code := send(chromeUA, page); code != http.StatusAccepted {
		t.Fatalf("status %d", code)
	}
	// No referrer or UTM tags (an SPA navigation): keeps the session's source.
	send(chromeUA, `{"n":"Signup","u":"https://example.com/docs","d":"example.com","p":{"plan":"pro","seats":3}}`)
	send("curl/8.4.0", page)                                                    // bot
	send(chromeUA, `{"n":"pageview","u":"https://other.com/","d":"other.com"}`) // unknown site
	if code := send(chromeUA, `{"n":"pageview","u":"javascript:alert(1)"}`); code != http.StatusBadRequest {
		t.Errorf("bad url: status %d", code)
	}
	w.Close()

	rows, err := st.DB.Query(`SELECT name, pathname, hostname, referrer_source, device, props, visitor_id, session_id FROM events WHERE site_id = ? ORDER BY ts`, site.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type row struct {
		name, path, host, source, device, props string
		visitor, session                        uint64
	}
	var got []row
	for rows.Next() {
		var r row
		rows.Scan(&r.name, &r.path, &r.host, &r.source, &r.device, &r.props, &r.visitor, &r.session)
		got = append(got, r)
	}
	if len(got) != 2 {
		t.Fatalf("got %d events, want 2: %+v", len(got), got)
	}
	if got[0].path != "/docs" || got[0].host != "example.com" || got[0].source != "Hacker News" || got[0].device != "Mobile" {
		t.Errorf("pageview: %+v", got[0])
	}
	if got[1].source != "Hacker News" {
		t.Errorf("later events should keep the session's source, got %q", got[1].source)
	}
	if got[1].props != `{"plan":"pro","seats":"3"}` {
		t.Errorf("props: %s", got[1].props)
	}
	if got[0].visitor != got[1].visitor || got[0].session != got[1].session {
		t.Errorf("events of one visit should share visitor and session ids")
	}
}
