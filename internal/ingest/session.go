package ingest

import (
	"math/rand/v2"
	"sync"
	"time"
)

const sessionTimeout = 30 * time.Minute

type session struct {
	id   uint64
	last time.Time
	// Where the visit came from, taken from its first event. Later events
	// in the session (e.g. SPA navigations without UTM tags) keep it.
	attr attribution
}

type attribution struct {
	referrer, source                                       string
	utmSource, utmMedium, utmCampaign, utmContent, utmTerm string
}

// sessions maps visitor IDs to their current session. A session ends after
// 30 minutes without events.
type sessions struct {
	mu sync.Mutex
	m  map[uint64]*session
}

func newSessions() *sessions {
	s := &sessions{m: map[uint64]*session{}}
	go s.janitor()
	return s
}

// touch returns the visitor ID, session ID and attribution for this event.
// When the daily salt rotated mid-session, the visitor's hash under
// yesterday's salt (prevVisitor) still finds the running session, and that
// visitor ID is kept for the event.
func (s *sessions) touch(visitor, prevVisitor uint64, now time.Time, attr attribution) (uint64, uint64, attribution) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, v := range []uint64{visitor, prevVisitor} {
		if v == 0 {
			continue
		}
		if sess, ok := s.m[v]; ok && now.Sub(sess.last) < sessionTimeout {
			sess.last = now
			return v, sess.id, sess.attr
		}
	}
	sess := &session{id: rand.Uint64(), last: now, attr: attr}
	s.m[visitor] = sess
	return visitor, sess.id, attr
}

func (s *sessions) janitor() {
	for range time.Tick(time.Minute) {
		now := time.Now()
		s.mu.Lock()
		for k, sess := range s.m {
			if now.Sub(sess.last) >= sessionTimeout {
				delete(s.m, k)
			}
		}
		s.mu.Unlock()
	}
}
