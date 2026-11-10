package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/ClickHouse/clickhouse-go/v2"
)

// The ClickHouse events table has the same columns as DuckDB's. Rows are
// sorted by site and day, so a dashboard query reads only its site's range;
// visitor_id last keeps a visitor's events together, which compresses well
// and speeds up uniqExact.
var clickHouseSchema = []string{
	`CREATE TABLE IF NOT EXISTS events (
		ts              DateTime64(6, 'UTC') CODEC(Delta, ZSTD),
		site_id         Int32,
		name            LowCardinality(String),
		hostname        LowCardinality(String),
		pathname        String,
		visitor_id      UInt64,
		session_id      UInt64,
		referrer        String,
		referrer_source LowCardinality(String),
		utm_source      LowCardinality(String),
		utm_medium      LowCardinality(String),
		utm_campaign    LowCardinality(String),
		utm_content     String,
		utm_term        String,
		country         LowCardinality(String),
		region          LowCardinality(String),
		city            LowCardinality(String),
		browser         LowCardinality(String),
		browser_version LowCardinality(String),
		os              LowCardinality(String),
		os_version      LowCardinality(String),
		device          LowCardinality(String),
		screen_width    UInt16,
		props           String,
		latitude        Nullable(Float32),
		longitude       Nullable(Float32)
	)
	ENGINE = MergeTree
	PARTITION BY toYYYYMM(ts)
	ORDER BY (site_id, toDate(ts), visitor_id)`,
	// Columns added later go here as ADD COLUMN IF NOT EXISTS, so this list
	// can run on every start.
}

// openClickHouse connects to the database in dsn, e.g.
// clickhouse://user:password@host:9000/tinytraffic or http://host:8123/db,
// and creates the events table if it's missing.
func openClickHouse(dsn string) (*sql.DB, error) {
	db, err := sql.Open("clickhouse", dsn)
	if err != nil {
		return nil, fmt.Errorf("open clickhouse: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect to clickhouse: %w", err)
	}
	for _, stmt := range clickHouseSchema {
		if _, err := db.Exec(stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("clickhouse schema: %w", err)
		}
	}
	return db, nil
}

func insertClickHouse(ctx context.Context, db *sql.DB, events []Event) error {
	// The driver sends the rows of a prepared INSERT in one block when the
	// transaction commits.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.PrepareContext(ctx, "INSERT INTO events ("+strings.Join(eventColumns, ", ")+")")
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, e := range events {
		var lat, lon *float32
		if e.HasLocation {
			lat, lon = &e.Latitude, &e.Longitude
		}
		if _, err := stmt.ExecContext(ctx,
			e.Timestamp.UTC(), e.SiteID, e.Name, e.Hostname, e.Pathname,
			e.VisitorID, e.SessionID, e.Referrer, e.ReferrerSource,
			e.UTMSource, e.UTMMedium, e.UTMCampaign, e.UTMContent, e.UTMTerm,
			e.Country, e.Region, e.City,
			e.Browser, e.BrowserVersion, e.OS, e.OSVersion, e.Device,
			e.ScreenWidth, e.Props, lat, lon,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}
