package server

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type faviconTransport func(*http.Request) (*http.Response, error)

func (f faviconTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFetchFavicon(t *testing.T) {
	for _, tc := range []struct {
		name        string
		status      int
		contentType string
		body        string
		wantIcon    bool
	}{
		{"real icon", 200, "image/x-icon", "real icon bytes", true},
		{"missing icon with placeholder body", 404, "image/png", "generic globe image", false},
		{"upstream error", 503, "text/html", "service unavailable", false},
		{"non-image response", 200, "text/html", "<html></html>", false},
		{"empty image", 200, "image/png", "", false},
		{"oversized image", 200, "image/png", strings.Repeat("x", (1<<20)+1), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: faviconTransport(func(r *http.Request) (*http.Response, error) {
				if got := r.URL.String(); got != "https://icons.duckduckgo.com/ip3/example.com.ico" {
					t.Fatalf("requested %q", got)
				}
				return &http.Response{
					StatusCode: tc.status,
					Header:     http.Header{"Content-Type": {tc.contentType}},
					Body:       io.NopCloser(strings.NewReader(tc.body)),
				}, nil
			})}
			icon, contentType, err := fetchFavicon(context.Background(), "example.com:3000", client)
			if tc.wantIcon {
				if err != nil || string(icon) != tc.body || contentType != tc.contentType {
					t.Fatalf("got %q, %q, %v", icon, contentType, err)
				}
			} else if err == nil || len(icon) != 0 {
				t.Fatalf("expected no icon, got %d bytes and error %v", len(icon), err)
			}
		})
	}
}
