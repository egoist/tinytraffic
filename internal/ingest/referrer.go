package ingest

import (
	"net/url"
	"strings"
)

// knownSources maps referrer hosts (and their parent domains) to a
// friendly source name.
var knownSources = map[string]string{
	"t.co": "Twitter", "twitter.com": "Twitter", "x.com": "Twitter",
	"facebook.com": "Facebook", "fb.com": "Facebook", "fb.me": "Facebook",
	"instagram.com": "Instagram",
	"linkedin.com":  "LinkedIn", "lnkd.in": "LinkedIn",
	"reddit.com":           "Reddit",
	"news.ycombinator.com": "Hacker News",
	"github.com":           "GitHub",
	"youtube.com":          "YouTube", "youtu.be": "YouTube",
	"chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT",
	"perplexity.ai":         "Perplexity",
	"claude.ai":             "Claude",
	"gemini.google.com":     "Gemini",
	"copilot.microsoft.com": "Copilot",
	"bsky.app":              "Bluesky",
	"threads.net":           "Threads", "threads.com": "Threads",
	"mastodon.social": "Mastodon",
	"discord.com":     "Discord",
	"t.me":            "Telegram", "telegram.org": "Telegram",
	"pinterest.com":     "Pinterest",
	"medium.com":        "Medium",
	"substack.com":      "Substack",
	"dev.to":            "DEV",
	"lobste.rs":         "Lobsters",
	"producthunt.com":   "Product Hunt",
	"stackoverflow.com": "Stack Overflow",
	"v2ex.com":          "V2EX",
	"zhihu.com":         "Zhihu",
	"weibo.com":         "Weibo",
	"duckduckgo.com":    "DuckDuckGo",
	"search.brave.com":  "Brave Search",
	"ecosia.org":        "Ecosia",
	"kagi.com":          "Kagi",
	"startpage.com":     "Startpage",
	"mail.google.com":   "Gmail",
}

// searchEngines match on a label anywhere in the host, so country domains
// such as google.co.uk or bing.com.cn resolve too.
var searchEngines = []struct{ label, name string }{
	{"google", "Google"}, {"bing", "Bing"}, {"yahoo", "Yahoo!"},
	{"yandex", "Yandex"}, {"baidu", "Baidu"}, {"naver", "Naver"},
}

// utmAliases normalizes common utm_source / ref values.
var utmAliases = map[string]string{
	"google": "Google", "bing": "Bing", "twitter": "Twitter", "x": "Twitter",
	"facebook": "Facebook", "fb": "Facebook", "instagram": "Instagram",
	"linkedin": "LinkedIn", "reddit": "Reddit", "hn": "Hacker News",
	"hackernews": "Hacker News", "github": "GitHub", "youtube": "YouTube",
	"chatgpt": "ChatGPT", "chatgpt.com": "ChatGPT", "perplexity": "Perplexity",
	"bluesky": "Bluesky", "producthunt": "Product Hunt",
}

func sourceForHost(host string) string {
	for h := host; h != ""; {
		if name, ok := knownSources[h]; ok {
			return name
		}
		i := strings.IndexByte(h, '.')
		if i < 0 || !strings.Contains(h[i+1:], ".") {
			break
		}
		h = h[i+1:]
	}
	labels := strings.Split(host, ".")
	for _, se := range searchEngines {
		for _, l := range labels[:max(len(labels)-1, 0)] {
			if l == se.label {
				return se.name
			}
		}
	}
	return host
}

// parseReferrer returns the referrer host and its source name. Referrers
// from the tracked site itself are internal and count as direct.
func parseReferrer(raw, pageHost string) (host, source string) {
	if raw == "" {
		return "", ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", ""
	}
	if u.Scheme == "android-app" {
		// e.g. android-app://com.google.android.gm
		host = u.Host
		if host == "com.google.android.gm" {
			return host, "Gmail"
		}
		return host, host
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", ""
	}
	host = strings.TrimPrefix(strings.ToLower(u.Hostname()), "www.")
	if host == "" || host == strings.TrimPrefix(pageHost, "www.") {
		return "", ""
	}
	return host, sourceForHost(host)
}

func normalizeUTMSource(s string) string {
	if name, ok := utmAliases[strings.ToLower(s)]; ok {
		return name
	}
	return s
}
