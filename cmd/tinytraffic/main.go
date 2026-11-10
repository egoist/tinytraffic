package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/egoist/tinytraffic/internal/ingest"
	"github.com/egoist/tinytraffic/internal/seed"
	"github.com/egoist/tinytraffic/internal/server"
	"github.com/egoist/tinytraffic/internal/store"
	"github.com/egoist/tinytraffic/web"
)

const usage = `tinytraffic — simple, privacy-friendly web analytics

Usage:
  tinytraffic [serve] [flags]        start the server
  tinytraffic seed [flags] DOMAIN    add demo traffic for DOMAIN (server must be stopped)
  tinytraffic password [flags]       set the dashboard password (server must be stopped)

Run "tinytraffic <command> -h" for flags. Flags can also be set with
environment variables: TT_ADDR, TT_DATA_DIR, TT_GEOIP_DB, TT_TRUST_PROXY,
TT_MEMORY_LIMIT, TT_PASSWORD.
`

func main() {
	args := os.Args[1:]
	cmd := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serve(args)
	case "seed":
		err = seedCmd(args)
	case "password":
		err = passwordCmd(args)
	case "help":
		fmt.Print(usage)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func dataDirFlag(fs *flag.FlagSet) *string {
	return fs.String("data", env("TT_DATA_DIR", "./data"), "data directory")
}

func openStore(dataDir string) (*store.Store, error) {
	return openStoreWith(dataDir, store.Options{MemoryLimit: os.Getenv("TT_MEMORY_LIMIT")})
}

func openStoreWith(dataDir string, opts store.Options) (*store.Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s, err := store.Open(filepath.Join(dataDir, "tinytraffic.duckdb"), opts)
	if err != nil && strings.Contains(err.Error(), "lock") {
		return nil, fmt.Errorf("%w\n(is the server still running? stop it first)", err)
	}
	return s, err
}

func serve(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	addr := fs.String("addr", env("TT_ADDR", ":8080"), "listen address")
	dataDir := dataDirFlag(fs)
	geoPath := fs.String("geoip", env("TT_GEOIP_DB", ""), "comma-separated .mmdb files (default: DATA/geo.mmdb, else the npm DB-IP package in ./node_modules)")
	memoryLimit := fs.String("memory-limit", env("TT_MEMORY_LIMIT", "1GB"), "DuckDB memory limit, e.g. 512MB or 2GB")
	trustProxy := fs.Bool("trust-proxy", env("TT_TRUST_PROXY", "") == "true", "read client IPs from X-Forwarded-For / CF-Connecting-IP")
	fs.Parse(args)

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	st, err := openStoreWith(*dataDir, store.Options{MemoryLimit: *memoryLimit})
	if err != nil {
		return err
	}
	defer st.Close()

	auth, err := server.NewAuth(st)
	if err != nil {
		return err
	}
	if pw := os.Getenv("TT_PASSWORD"); pw != "" && !auth.HasPassword() {
		if err := auth.SetPassword(pw); err != nil {
			return err
		}
	}

	geoFiles := splitList(*geoPath)
	if len(geoFiles) == 0 {
		geoFiles = defaultGeoFiles(*dataDir)
	}
	var geo *ingest.Geo
	if len(geoFiles) > 0 {
		if geo, err = ingest.OpenGeo(geoFiles...); err != nil {
			return fmt.Errorf("open geoip db: %w", err)
		}
		defer geo.Close()
		log.Info("geoip enabled", "files", strings.Join(geoFiles, ","))
	} else {
		log.Info("geoip disabled: run `bun install`, put a .mmdb at DATA/geo.mmdb, or pass -geoip")
	}

	writer := store.NewWriter(st.DB, log)
	srv := &server.Server{
		Store: st,
		Auth:  auth,
		Ingest: ingest.NewHandler(ingest.Handler{
			Store: st, Writer: writer, Salts: ingest.NewSalts(st.DB),
			Geo: geo, TrustProxy: *trustProxy, Log: log,
			TrustRequest: server.TrustedEventSender(st),
		}),
		Log:         log,
		Geo:         geo,
		Dist:        web.Dist(),
		Tracker:     web.Tracker(),
		TrackerPath: os.Getenv("TT_TRACKER_PATH"),
		TrustProxy:  *trustProxy,
	}
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", *addr, "data", *dataDir)
		errc <- httpServer.ListenAndServe()
	}()
	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			writer.Close()
			return err
		}
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	httpServer.Shutdown(shutdownCtx)
	writer.Close() // flush buffered events
	return nil
}

func seedCmd(args []string) error {
	fs := flag.NewFlagSet("seed", flag.ExitOnError)
	dataDir := dataDirFlag(fs)
	days := fs.Int("days", 90, "days of history")
	perDay := fs.Int("visitors", 1500, "average visitors per day")
	tz := fs.String("timezone", "UTC", "timezone when the site is created")
	reset := fs.Bool("reset", false, "delete the site's existing stats first")
	fs.Parse(args)
	if fs.NArg() != 1 {
		return errors.New("usage: tinytraffic seed [flags] DOMAIN")
	}
	st, err := openStore(*dataDir)
	if err != nil {
		return err
	}
	defer st.Close()
	site, ok := st.SiteByDomain(fs.Arg(0))
	if ok && *reset {
		if err := st.DeleteSite(site.ID); err != nil {
			return err
		}
		ok = false
	}
	if !ok {
		if site, err = st.CreateSite(fs.Arg(0), *tz); err != nil {
			return err
		}
	}
	start := time.Now()
	n, err := seed.Run(context.Background(), st, site, *days, *perDay)
	if err != nil {
		return err
	}
	fmt.Printf("inserted %d events for %s in %s\n", n, site.Domain, time.Since(start).Round(time.Millisecond))
	return nil
}

func passwordCmd(args []string) error {
	fs := flag.NewFlagSet("password", flag.ExitOnError)
	dataDir := dataDirFlag(fs)
	fs.Parse(args)
	st, err := openStore(*dataDir)
	if err != nil {
		return err
	}
	defer st.Close()
	auth, err := server.NewAuth(st)
	if err != nil {
		return err
	}
	fmt.Print("New password: ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return err
	}
	if err := auth.SetPassword(strings.TrimRight(line, "\r\n")); err != nil {
		return err
	}
	fmt.Println("Password updated. Existing sessions are signed out.")
	return nil
}

// defaultGeoFiles finds a GeoIP database when none is configured:
// DATA/geo.mmdb, or the DB-IP city database from the npm package
// @ip-location-db/dbip-city-mmdb (installed by `bun install`).
func defaultGeoFiles(dataDir string) []string {
	if p := filepath.Join(dataDir, "geo.mmdb"); fileExists(p) {
		return []string{p}
	}
	dir := filepath.Join("node_modules", "@ip-location-db", "dbip-city-mmdb")
	var files []string
	for _, name := range []string{"dbip-city-ipv4.mmdb", "dbip-city-ipv6.mmdb"} {
		if p := filepath.Join(dir, name); fileExists(p) {
			files = append(files, p)
		}
	}
	return files
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
