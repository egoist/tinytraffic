package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var faviconClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func (s *Server) favicon(w http.ResponseWriter, r *http.Request) {
	site, ok := s.site(w, r)
	if !ok {
		return
	}
	icon, contentType, err := fetchFavicon(r.Context(), site.Domain, faviconClient)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if err != nil {
		// DuckDuckGo includes a placeholder image in its 404 response. Don't
		// forward it: the dashboard should keep showing the site's initial.
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Write(icon)
}

func fetchFavicon(ctx context.Context, domain string, client *http.Client) ([]byte, string, error) {
	host := (&url.URL{Host: domain}).Hostname()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://icons.duckduckgo.com/ip3/"+url.PathEscape(host)+".ico", nil)
	if err != nil {
		return nil, "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	contentType := res.Header.Get("Content-Type")
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(contentType, "image/") {
		return nil, "", fmt.Errorf("favicon unavailable: %s", res.Status)
	}
	const maxSize = 1 << 20
	icon, err := io.ReadAll(io.LimitReader(res.Body, maxSize+1))
	if err != nil {
		return nil, "", err
	}
	if len(icon) == 0 || len(icon) > maxSize {
		return nil, "", fmt.Errorf("invalid favicon size: %d", len(icon))
	}
	return icon, contentType, nil
}
