package stats

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/egoist/tinytraffic/internal/store"
)

// bucketer assigns events to local-time buckets with integer math.
//
// date_trunc/timezone() on TIMESTAMPTZ go through ICU row by row and cost
// ~20x more than the scan itself, so instead the UTC offsets (including DST
// changes) for the query range are computed here and baked into the SQL.
type bucketer struct {
	interval    string
	transitions []transition // sorted; the first applies from -inf
}

type transition struct {
	fromUs   int64 // epoch microseconds
	offsetUs int64
}

func newBucketer(loc *time.Location, start, end time.Time, interval string) bucketer {
	offsetAt := func(sec int64) int64 {
		_, off := time.Unix(sec, 0).In(loc).Zone()
		return int64(off)
	}
	cur := offsetAt(start.Unix())
	ts := []transition{{math.MinInt64, cur * 1e6}}
	// Zones change offset at most once a day: step daily, then binary-search
	// the exact second.
	for t := start.Unix(); t < end.Unix(); t += 86400 {
		next := min(t+86400, end.Unix())
		if offsetAt(next) == cur {
			continue
		}
		lo, hi := t, next
		for hi-lo > 1 {
			mid := lo + (hi-lo)/2
			if offsetAt(mid) == cur {
				lo = mid
			} else {
				hi = mid
			}
		}
		cur = offsetAt(hi)
		ts = append(ts, transition{hi * 1e6, cur * 1e6})
	}
	return bucketer{interval: interval, transitions: ts}
}

// localUs returns SQL for the local wall-clock time, in epoch microseconds,
// of the UTC epoch-microsecond expression us.
func (b bucketer) localUs(us string) string {
	if len(b.transitions) == 1 {
		return fmt.Sprintf("(%s + %d)", us, b.transitions[0].offsetUs)
	}
	var sb strings.Builder
	sb.WriteString("(" + us + " + CASE")
	for i := len(b.transitions) - 1; i > 0; i-- {
		fmt.Fprintf(&sb, " WHEN %s >= %d THEN %d", us, b.transitions[i].fromUs, b.transitions[i].offsetUs)
	}
	fmt.Fprintf(&sb, " ELSE %d END)", b.transitions[0].offsetUs)
	return sb.String()
}

// keySQL returns SQL computing the integer bucket key of us.
func (b bucketer) keySQL(db store.Backend, us string) string {
	local := b.localUs(us)
	switch b.interval {
	case "hour":
		return intDiv(db, local, "3600000000")
	case "month":
		if db == store.ClickHouse {
			d := fmt.Sprintf("addDays(toDate('1970-01-01'), %s)", intDiv(db, local, "86400000000"))
			return fmt.Sprintf("(toYear(%s) * 12 + toMonth(%s) - 1)", d, d)
		}
		d := fmt.Sprintf("(DATE '1970-01-01' + CAST(%s // 86400000000 AS INTEGER))", local)
		return fmt.Sprintf("(year(%s) * 12 + month(%s) - 1)", d, d)
	default:
		return intDiv(db, local, "86400000000")
	}
}

// key computes the same bucket key in Go for a bucket's local start time.
func (b bucketer) key(t time.Time) int64 {
	_, off := t.Zone()
	local := t.Unix() + int64(off)
	switch b.interval {
	case "hour":
		return floorDiv(local, 3600)
	case "month":
		return int64(t.Year())*12 + int64(t.Month()) - 1
	default:
		return floorDiv(local, 86400)
	}
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}
