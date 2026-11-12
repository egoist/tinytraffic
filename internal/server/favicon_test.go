package server

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"testing"
)

type faviconTransport func(*http.Request) (*http.Response, error)

func (f faviconTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFetchIcon(t *testing.T) {
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
			icon, contentType, err := fetchIcon(context.Background(), "https://icons.duckduckgo.com/ip3/example.com.ico", client)
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

func TestFetchFavicon(t *testing.T) {
	for _, providerHasIcon := range []bool{true, false} {
		t.Run(fmt.Sprint("providerHasIcon=", providerHasIcon), func(t *testing.T) {
			var requests []string
			client := &http.Client{Transport: faviconTransport(func(r *http.Request) (*http.Response, error) {
				requests = append(requests, r.URL.String())
				status, contentType, body := 200, "image/svg+xml", "<svg></svg>"
				switch r.URL.String() {
				case "https://icons.duckduckgo.com/ip3/mygo.run.ico":
					if !providerHasIcon {
						status, contentType, body = 404, "image/png", "generic placeholder"
					}
				case "https://mygo.run:443/":
					contentType = "text/html; charset=utf-8"
					body = `<html><head><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head></html>`
					// Model the final URL after a redirect from the original host.
					redirected := r.Clone(r.Context())
					redirected.URL, _ = url.Parse("https://www.mygo.run/app/")
					r = redirected
				case "https://www.mygo.run/favicon.svg":
				default:
					t.Fatalf("unexpected request: %s", r.URL)
				}
				return &http.Response{
					StatusCode: status,
					Header:     http.Header{"Content-Type": {contentType}},
					Body:       io.NopCloser(strings.NewReader(body)),
					Request:    r,
				}, nil
			})}
			icon, contentType, err := fetchFavicon(context.Background(), "mygo.run:443", client)
			if err != nil || string(icon) != "<svg></svg>" || contentType != "image/svg+xml" {
				t.Fatalf("got %q, %q, %v", icon, contentType, err)
			}
			want := []string{"https://icons.duckduckgo.com/ip3/mygo.run.ico"}
			if !providerHasIcon {
				want = append(want, "https://mygo.run:443/", "https://www.mygo.run/favicon.svg")
			}
			if !slices.Equal(requests, want) {
				t.Fatalf("requests = %v, want %v", requests, want)
			}
		})
	}
}

func TestDiscoverFavicons(t *testing.T) {
	page, _ := url.Parse("https://example.com/app/")
	for _, tc := range []struct {
		name string
		html string
		want []string
	}{
		{"SVG", `<link rel="icon" href="/favicon.svg">`, []string{"https://example.com/favicon.svg"}},
		{"relative and base", `<link href="icon.png" rel="shortcut ICON"><base href="https://cdn.example.com/assets/">`, []string{"https://cdn.example.com/assets/icon.png"}},
		{"relative to page", `<link rel="icon" href="icons/favicon.png">`, []string{"https://example.com/app/icons/favicon.png"}},
		{"icon before touch icon", `<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="//cdn.example.com/icon.png">`, []string{"https://cdn.example.com/icon.png", "https://example.com/touch.png"}},
		{"unsafe URLs", `<link rel="icon" href="javascript:alert(1)"><link rel="icon" href="file:///etc/passwd"><link rel="icon" href="https://user:pass@example.com/x">`, nil},
		{"ignore script contents", `<script>const icon = '<link rel="icon" href="/fake.png">';</script>`, nil},
		{"stop at body", `<head></head><body><link rel="icon" href="/fake.png">`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := discoverFavicons(strings.NewReader(tc.html), page)
			want := append(tc.want, "https://example.com/favicon.ico")
			if !slices.Equal(got, want) {
				t.Fatalf("got %v, want %v", got, want)
			}
		})
	}
}

func TestFetchFaviconMissingEverywhere(t *testing.T) {
	client := &http.Client{Transport: faviconTransport(func(r *http.Request) (*http.Response, error) {
		status, contentType, body := 404, "image/png", "generic placeholder"
		if r.URL.String() == "https://example.com/" {
			status, contentType, body = 200, "text/html", `<head><link rel="icon" href="/missing.svg"></head>`
		}
		return &http.Response{
			StatusCode: status,
			Header:     http.Header{"Content-Type": {contentType}},
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    r,
		}, nil
	})}
	icon, _, err := fetchFavicon(context.Background(), "example.com", client)
	if err == nil || len(icon) != 0 {
		t.Fatalf("expected no icon, got %d bytes and error %v", len(icon), err)
	}
}

func TestFaviconPublicIP(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1"} {
		if faviconPublicIP(netip.MustParseAddr(ip)) {
			t.Errorf("allowed non-public IP %s", ip)
		}
	}
	for _, ip := range []string{"1.1.1.1", "2606:4700:4700::1111"} {
		if !faviconPublicIP(netip.MustParseAddr(ip)) {
			t.Errorf("rejected public IP %s", ip)
		}
	}
}
