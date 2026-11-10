package store

import (
	"errors"
	"path/filepath"
	"slices"
	"testing"
)

func TestRenameSite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.duckdb")
	st, err := Open(path, Options{})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := st.CreateSite("old.com", "UTC")
	b, _ := st.CreateSite("other.com", "UTC")

	a, err = st.UpdateSite(a.ID, SiteUpdate{Domain: "https://www.New.com/"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Domain != "new.com" || !slices.Equal(a.Aliases, []string{"old.com"}) || a.Timezone != "UTC" {
		t.Fatalf("after rename: %+v", a)
	}
	for _, d := range []string{"new.com", "old.com", "www.old.com"} {
		if got, ok := st.SiteByDomain(d); !ok || got.ID != a.ID {
			t.Errorf("SiteByDomain(%q) = %v, %v", d, got.ID, ok)
		}
	}
	if got, ok := st.LookupSite("1"); !ok || got.ID != a.ID {
		t.Errorf("LookupSite by ID = %+v, %v", got, ok)
	}

	// Domains are unique across sites and aliases.
	if _, err := st.UpdateSite(b.ID, SiteUpdate{Domain: "old.com"}); !errors.Is(err, ErrExists) {
		t.Errorf("taking another site's alias: %v", err)
	}
	if _, err := st.CreateSite("old.com", "UTC"); !errors.Is(err, ErrExists) {
		t.Errorf("creating a site on an alias: %v", err)
	}

	// Renaming back swaps the domain and the alias.
	a, err = st.UpdateSite(a.ID, SiteUpdate{Domain: "old.com", Timezone: "Asia/Tokyo"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Domain != "old.com" || !slices.Equal(a.Aliases, []string{"new.com"}) || a.Timezone != "Asia/Tokyo" {
		t.Fatalf("after renaming back: %+v", a)
	}

	// Survives a restart.
	st.Close()
	if st, err = Open(path, Options{}); err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if got, ok := st.SiteByDomain("new.com"); !ok || got.Domain != "old.com" || got.Timezone != "Asia/Tokyo" {
		t.Errorf("after reopen: %+v, %v", got, ok)
	}

	if _, err := st.RemoveAlias(a.ID, "new.com"); err != nil {
		t.Fatal(err)
	}
	if _, ok := st.SiteByDomain("new.com"); ok {
		t.Error("removed alias still resolves")
	}
	if _, err := st.CreateSite("new.com", "UTC"); err != nil {
		t.Errorf("creating a site on a freed domain: %v", err)
	}

	st.UpdateSite(b.ID, SiteUpdate{Domain: "other.org"})
	if err := st.DeleteSite(b.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := st.SiteByDomain("other.com"); ok {
		t.Error("deleted site's alias still resolves")
	}
}
