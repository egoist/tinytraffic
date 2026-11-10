package store

import (
	"context"
	"database/sql"
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

// Events is the events table, in DuckDB or in ClickHouse.
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

func (ev *Events) args(args []any) []any {
	if ev.Backend != ClickHouse {
		return args
	}
	return clickHouseArgs(args)
}
