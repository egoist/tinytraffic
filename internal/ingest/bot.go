package ingest

import (
	"net/http"
	"regexp"
)

var botPattern = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|scrap|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|curl|wget|httpie|python-|aiohttp|go-http-client|okhttp|java/|axios|node-fetch|undici|libwww|httpclient|facebookexternalhit|embedly|preview|vercel|netlify|cloudflare|feed|rss|validator|checker|archive|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|perplexitybot|ccbot`)

func isBot(r *http.Request, ua string) bool {
	if ua == "" || len(ua) < 20 || botPattern.MatchString(ua) {
		return true
	}
	// Browser prefetch / prerender requests are not real visits.
	if r.Header.Get("Sec-Purpose") == "prefetch" || r.Header.Get("X-Purpose") == "preview" || r.Header.Get("X-Moz") == "prefetch" {
		return true
	}
	return false
}
