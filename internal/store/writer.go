package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/duckdb/duckdb-go/v2"
)

// Event is one row of the events table. Field order matches the column order.
type Event struct {
	Timestamp      time.Time
	SiteID         int32
	Name           string
	Hostname       string
	Pathname       string
	VisitorID      uint64
	SessionID      uint64
	Referrer       string
	ReferrerSource string
	UTMSource      string
	UTMMedium      string
	UTMCampaign    string
	UTMContent     string
	UTMTerm        string
	Country        string
	Region         string
	City           string
	Browser        string
	BrowserVersion string
	OS             string
	OSVersion      string
	Device         string
	ScreenWidth    uint16
	Props          string
}

const (
	bufferSize    = 100_000
	maxBatch      = 5_000
	flushInterval = time.Second
)

// Writer buffers events in memory and bulk-inserts them with the DuckDB
// appender, so a traffic spike costs one insert per second instead of one per
// request.
type Writer struct {
	db  *sql.DB
	log *slog.Logger
	ch  chan Event

	mu      sync.RWMutex
	closed  bool
	done    chan struct{}
	dropped atomic.Uint64
}

func NewWriter(db *sql.DB, log *slog.Logger) *Writer {
	w := &Writer{db: db, log: log, ch: make(chan Event, bufferSize), done: make(chan struct{})}
	go w.run()
	return w
}

// Write queues an event. It never blocks; when the buffer is full the event
// is dropped and counted.
func (w *Writer) Write(e Event) bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	if w.closed {
		return false
	}
	select {
	case w.ch <- e:
		return true
	default:
		if n := w.dropped.Add(1); n%1000 == 1 {
			w.log.Warn("event buffer full, dropping events", "dropped_total", n)
		}
		return false
	}
}

// Close flushes everything still buffered.
func (w *Writer) Close() {
	w.mu.Lock()
	if !w.closed {
		w.closed = true
		close(w.ch)
	}
	w.mu.Unlock()
	<-w.done
}

func (w *Writer) run() {
	defer close(w.done)
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	batch := make([]Event, 0, maxBatch)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := w.insert(batch); err != nil {
			w.log.Error("insert events", "count", len(batch), "err", err)
		}
		batch = batch[:0]
	}
	for {
		select {
		case e, ok := <-w.ch:
			if !ok {
				flush()
				return
			}
			batch = append(batch, e)
			if len(batch) >= maxBatch {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (w *Writer) insert(batch []Event) error {
	return InsertEvents(context.Background(), w.db, batch)
}

// InsertEvents appends events in one batch.
func InsertEvents(ctx context.Context, db *sql.DB, events []Event) error {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	return conn.Raw(func(dc any) error {
		a, err := duckdb.NewAppenderFromConn(dc.(driver.Conn), "", "events")
		if err != nil {
			return err
		}
		for _, e := range events {
			if err := a.AppendRow(
				e.Timestamp, e.SiteID, e.Name, e.Hostname, e.Pathname,
				e.VisitorID, e.SessionID, e.Referrer, e.ReferrerSource,
				e.UTMSource, e.UTMMedium, e.UTMCampaign, e.UTMContent, e.UTMTerm,
				e.Country, e.Region, e.City,
				e.Browser, e.BrowserVersion, e.OS, e.OSVersion, e.Device,
				e.ScreenWidth, e.Props,
			); err != nil {
				a.Close()
				return err
			}
		}
		return a.Close()
	})
}
