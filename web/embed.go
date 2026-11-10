// Package web embeds the built dashboard (web/dist) and tracker
// (web/static/script.js). Both are produced by `bun run build`.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

//go:embed all:static
var static embed.FS

func Dist() fs.FS {
	sub, _ := fs.Sub(dist, "dist")
	return sub
}

func Tracker() []byte {
	b, _ := static.ReadFile("static/script.js")
	return b
}
