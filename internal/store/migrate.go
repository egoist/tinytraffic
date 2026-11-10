package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// MigrateProgress reports a site's copy: events copied so far and the month
// being copied.
type MigrateProgress struct {
	SiteID int32
	Copied int64
	Month  time.Time
	Done   bool
}

// migrateBatch is the most events per insert (a variable for tests).
var migrateBatch = 50_000

// MigrateToClickHouse copies the events in DuckDB to ClickHouse. The store
// must have been opened with a ClickHouse URL.
//
// For each site it copies only events older than the site's earliest event
// in ClickHouse, so it can run after the server already started writing to
// ClickHouse, and running it again copies nothing twice. Events are copied
// newest first, a month at a time, and each insert stays within one month
// (one ClickHouse partition) so it lands whole or not at all: if the copy is
// interrupted, running it again resumes where it stopped.
//
// The events stay in DuckDB.
func (s *Store) MigrateToClickHouse(ctx context.Context, progress func(MigrateProgress)) (int64, error) {
	if s.Events.Backend != ClickHouse {
		return 0, errors.New("clickhouse is not configured")
	}
	duck := &Events{DB: s.DB, Backend: DuckDB}
	rows, err := s.DB.QueryContext(ctx, `SELECT site_id, min(ts), max(ts) FROM events GROUP BY 1 ORDER BY 1`)
	if err != nil {
		return 0, err
	}
	type siteRange struct {
		id          int32
		first, last time.Time
	}
	var sites []siteRange
	for rows.Next() {
		var r siteRange
		if err := rows.Scan(&r.id, &r.first, &r.last); err != nil {
			rows.Close()
			return 0, err
		}
		sites = append(sites, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	var total int64
	for _, site := range sites {
		// Copy everything before the first event already in ClickHouse.
		var cutoff sql.NullTime
		if err := s.Events.QueryRowContext(ctx,
			`SELECT minOrNull(ts) FROM events WHERE site_id = ?`, site.id).Scan(&cutoff); err != nil {
			return total, err
		}
		end := site.last.Add(time.Microsecond)
		if cutoff.Valid && cutoff.Time.Before(end) {
			end = cutoff.Time
		}
		var copied int64
		// Timestamps have microsecond precision, so the newest event left
		// is at most end-1µs; copy its month, then the month before.
		for site.first.Before(end) {
			month := monthStart(end.Add(-time.Microsecond))
			n, err := copyRange(ctx, duck, s.Events, site.id, month, end)
			copied += n
			total += n
			if err != nil {
				return total, fmt.Errorf("site %d, %s: %w", site.id, month.Format("2006-01"), err)
			}
			if progress != nil {
				progress(MigrateProgress{SiteID: site.id, Copied: copied, Month: month})
			}
			end = month
		}
		if progress != nil {
			progress(MigrateProgress{SiteID: site.id, Copied: copied, Done: true})
		}
	}
	return total, nil
}

func monthStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// copyRange copies a site's events in [start, end), which lies within one
// month, newest first.
func copyRange(ctx context.Context, from, to *Events, siteID int32, start, end time.Time) (int64, error) {
	rows, err := from.QueryContext(ctx, `SELECT `+strings.Join(eventColumns, ", ")+`
FROM events WHERE site_id = ? AND ts >= ? AND ts < ? ORDER BY ts DESC`, siteID, start, end)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var copied int64
	batch := make([]Event, 0, migrateBatch)
	flush := func() error {
		if err := to.Insert(ctx, batch); err != nil {
			return err
		}
		copied += int64(len(batch))
		batch = batch[:0]
		return nil
	}
	for rows.Next() {
		var e Event
		var lat, lon sql.NullFloat64
		if err := rows.Scan(
			&e.Timestamp, &e.SiteID, &e.Name, &e.Hostname, &e.Pathname,
			&e.VisitorID, &e.SessionID, &e.Referrer, &e.ReferrerSource,
			&e.UTMSource, &e.UTMMedium, &e.UTMCampaign, &e.UTMContent, &e.UTMTerm,
			&e.Country, &e.Region, &e.City,
			&e.Browser, &e.BrowserVersion, &e.OS, &e.OSVersion, &e.Device,
			&e.ScreenWidth, &e.Props, &lat, &lon,
		); err != nil {
			return copied, err
		}
		if lat.Valid && lon.Valid {
			e.HasLocation, e.Latitude, e.Longitude = true, float32(lat.Float64), float32(lon.Float64)
		}
		// Never split events with the same timestamp across inserts: a
		// resumed copy starts strictly before the oldest copied event.
		if len(batch) >= migrateBatch && !e.Timestamp.Equal(batch[len(batch)-1].Timestamp) {
			if err := flush(); err != nil {
				return copied, err
			}
		}
		batch = append(batch, e)
	}
	if err := rows.Err(); err != nil {
		return copied, err
	}
	if len(batch) > 0 {
		return copied, flush()
	}
	return copied, nil
}
