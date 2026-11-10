package store

import (
	"slices"
	"strconv"
	"strings"
)

// Sites are identified by their numeric ID. The domain is what the tracker
// sends, and it can change; the site's previous domains are kept as aliases.

func NormalizeDomain(d string) string {
	d = strings.ToLower(strings.TrimSpace(d))
	d = strings.TrimPrefix(d, "https://")
	d = strings.TrimPrefix(d, "http://")
	if i := strings.IndexAny(d, "/?#"); i >= 0 {
		d = d[:i]
	}
	return strings.TrimPrefix(d, "www.")
}

// reindexLocked rebuilds the domain lookup. Callers hold s.mu.
func (s *Store) reindexLocked() {
	s.byDomain = make(map[string]int32, len(s.sites))
	for _, site := range s.sites {
		for _, a := range site.Aliases {
			s.byDomain[a] = site.ID
		}
	}
	// Current domains win over aliases.
	for _, site := range s.sites {
		s.byDomain[site.Domain] = site.ID
	}
}

func (s *Store) putSite(site Site) {
	s.mu.Lock()
	s.sites[site.ID] = site
	s.reindexLocked()
	s.mu.Unlock()
}

// SiteByDomain finds a site by its domain or one of its aliases. It is served
// from memory; it is on the hot ingest path.
func (s *Store) SiteByDomain(domain string) (Site, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.byDomain[NormalizeDomain(domain)]
	if !ok {
		return Site{}, false
	}
	return s.sites[id], true
}

func (s *Store) SiteByID(id int32) (Site, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	site, ok := s.sites[id]
	return site, ok
}

// LookupSite finds a site by ID ("3") or by domain, as used in API paths.
func (s *Store) LookupSite(ref string) (Site, bool) {
	if id, err := strconv.ParseInt(ref, 10, 32); err == nil {
		return s.SiteByID(int32(id))
	}
	return s.SiteByDomain(ref)
}

func (s *Store) Sites() []Site {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Site, 0, len(s.sites))
	for _, site := range s.sites {
		out = append(out, site)
	}
	return out
}

func (s *Store) CreateSite(domain, timezone string) (Site, error) {
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	domain = NormalizeDomain(domain)
	if _, ok := s.SiteByDomain(domain); ok {
		return Site{}, ErrExists
	}
	site, err := s.meta.createSite(domain, timezone)
	if err != nil {
		return Site{}, err
	}
	s.putSite(site)
	return site, nil
}

// SiteUpdate changes a site. Empty fields are left as they are.
type SiteUpdate struct {
	Domain   string
	Timezone string
}

// UpdateSite applies u. A new domain keeps the old one as an alias. It
// returns ErrExists if another site uses the new domain.
func (s *Store) UpdateSite(id int32, u SiteUpdate) (Site, error) {
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	site, ok := s.SiteByID(id)
	if !ok {
		return Site{}, ErrNotFound
	}
	next := site
	next.Aliases = slices.Clone(site.Aliases)
	if u.Timezone != "" {
		next.Timezone = u.Timezone
	}
	if d := NormalizeDomain(u.Domain); d != "" && d != site.Domain {
		if owner, ok := s.SiteByDomain(d); ok && owner.ID != id {
			return Site{}, ErrExists
		}
		next.Domain = d
		next.Aliases = slices.DeleteFunc(next.Aliases, func(a string) bool { return a == d })
		next.Aliases = append(next.Aliases, site.Domain)
		slices.Sort(next.Aliases)
	}

	if err := s.meta.updateSite(site, next); err != nil {
		return Site{}, err
	}
	s.putSite(next)
	return next, nil
}

// RemoveAlias stops a site from accepting events for one of its old domains.
func (s *Store) RemoveAlias(id int32, domain string) (Site, error) {
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	site, ok := s.SiteByID(id)
	domain = NormalizeDomain(domain)
	if !ok || !slices.Contains(site.Aliases, domain) {
		return Site{}, ErrNotFound
	}
	if err := s.meta.removeAlias(id, domain); err != nil {
		return Site{}, err
	}
	site.Aliases = slices.DeleteFunc(slices.Clone(site.Aliases), func(a string) bool { return a == domain })
	s.putSite(site)
	return site, nil
}

func (s *Store) DeleteSite(id int32) error {
	s.siteWrite.Lock()
	defer s.siteWrite.Unlock()
	site, ok := s.SiteByID(id)
	if !ok {
		return ErrNotFound
	}
	if err := s.meta.deleteSite(site); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.sites, id)
	s.reindexLocked()
	s.mu.Unlock()
	return nil
}
