package store

import (
	"context"
	"database/sql"
	"time"
)

// Backend is the database that holds the events table.
type Backend int

const (
	DuckDB Backend = iota
	ClickHouse
)

func (b Backend) String() string {
	if b == ClickHouse {
		return "clickhouse"
	}
	return "duckdb"
}

// Events is the events table. It lives in the main DuckDB database, or in
// ClickHouse when Options.ClickHouseURL is set. Sites, settings, API keys and
// salts stay in DuckDB either way: they are small, and change in ways
// ClickHouse is bad at (unique keys, updates in place).
type Events struct {
	DB      *sql.DB
	Backend Backend
}

// Insert appends events in one batch.
func (ev *Events) Insert(ctx context.Context, events []Event) error {
	if len(events) == 0 {
		return nil
	}
	if ev.Backend == ClickHouse {
		return insertClickHouse(ctx, ev.DB, events)
	}
	return insertDuckDB(ctx, ev.DB, events)
}

func (ev *Events) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return ev.DB.QueryContext(ctx, query, ev.args(args)...)
}

func (ev *Events) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return ev.DB.QueryRowContext(ctx, query, ev.args(args)...)
}

// chTimeLayout is how times are sent to ClickHouse. The driver would bind a
// time.Time with whole seconds only; a string compares against the
// DateTime64(6, 'UTC') column at full precision.
const chTimeLayout = "2006-01-02 15:04:05.000000"

func (ev *Events) args(args []any) []any {
	if ev.Backend != ClickHouse {
		return args
	}
	out := make([]any, len(args))
	for i, a := range args {
		if t, ok := a.(time.Time); ok {
			a = t.UTC().Format(chTimeLayout)
		}
		out[i] = a
	}
	return out
}
