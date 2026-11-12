package server

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/html"
)

var faviconClient = &http.Client{
	Timeout:   5 * time.Second,
	Transport: faviconTransportForPublicSites(),
	CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !faviconURLAllowed(r.URL) {
			return fmt.Errorf("invalid favicon redirect")
		}
		return nil
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
	// Icons can be SVGs. Keep them inert even if opened as a document.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if err != nil {
		// Neither the provider nor the site has a usable icon. Keep the initial.
		w.Header().Set("Cache-Control", "private, max-age=300")
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Write(icon)
}

func fetchFavicon(ctx context.Context, domain string, client *http.Client) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	host := (&url.URL{Host: domain}).Hostname()
	provider := "https://icons.duckduckgo.com/ip3/" + url.PathEscape(host) + ".ico"
	if icon, contentType, err := fetchIcon(ctx, provider, client); err == nil {
		return icon, contentType, nil
	}

	page := &url.URL{Scheme: "https", Host: domain, Path: "/"}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, page.String(), nil)
	if err != nil {
		return nil, "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	contentType, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if res.StatusCode != http.StatusOK || (contentType != "text/html" && contentType != "application/xhtml+xml") {
		return nil, "", fmt.Errorf("favicon homepage unavailable: %s", res.Status)
	}
	// Relative icons and <base> tags resolve against the final page URL,
	// including redirects to www or a different homepage path.
	if res.Request != nil {
		page = res.Request.URL
	}
	for _, iconURL := range discoverFavicons(io.LimitReader(res.Body, 1<<20), page) {
		if icon, contentType, err := fetchIcon(ctx, iconURL, client); err == nil {
			return icon, contentType, nil
		}
	}
	return nil, "", fmt.Errorf("no usable favicon for %s", domain)
}

func fetchIcon(ctx context.Context, iconURL string, client *http.Client) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, iconURL, nil)
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

func faviconURLAllowed(u *url.URL) bool {
	return (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil
}

func discoverFavicons(r io.Reader, page *url.URL) []string {
	z := html.NewTokenizer(r)
	base := page
	baseSeen := false
	var icons, touchIcons []string
	for {
		tt := z.Next()
		if tt == html.ErrorToken {
			break
		}
		token := z.Token()
		if tt == html.EndTagToken && token.Data == "head" || tt == html.StartTagToken && token.Data == "body" {
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		attrs := make(map[string]string, len(token.Attr))
		for _, a := range token.Attr {
			attrs[a.Key] = a.Val
		}
		if token.Data == "base" && !baseSeen && strings.TrimSpace(attrs["href"]) != "" {
			if ref, err := url.Parse(strings.TrimSpace(attrs["href"])); err == nil {
				if resolved := page.ResolveReference(ref); faviconURLAllowed(resolved) {
					base, baseSeen = resolved, true
				}
			}
		}
		if token.Data != "link" || strings.TrimSpace(attrs["href"]) == "" {
			continue
		}
		for _, rel := range strings.Fields(strings.ToLower(attrs["rel"])) {
			switch rel {
			case "icon":
				icons = append(icons, attrs["href"])
			case "apple-touch-icon", "apple-touch-icon-precomposed":
				touchIcons = append(touchIcons, attrs["href"])
			}
		}
	}
	var out []string
	for _, href := range append(icons, touchIcons...) {
		ref, err := url.Parse(strings.TrimSpace(href))
		if err != nil {
			continue
		}
		resolved := base.ResolveReference(ref)
		if faviconURLAllowed(resolved) {
			out = append(out, resolved.String())
			if len(out) >= 8 {
				break
			}
		}
	}
	// Conventional fallback only after trying the explicitly declared icons.
	out = append(out, page.ResolveReference(&url.URL{Path: "/favicon.ico"}).String())
	return out
}
