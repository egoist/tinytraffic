package server

import (
	"database/sql"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	"github.com/egoist/tinytraffic/internal/store"
)

// A password changed by one process (another instance, or the password
// command) applies to a running server once its store refreshes.
func TestPasswordChangeReachesOtherProcess(t *testing.T) {
	dsn := os.Getenv("TT_TEST_CLICKHOUSE")
	if dsn == "" {
		t.Skip("TT_TEST_CLICKHOUSE not set")
	}
	admin, err := sql.Open("clickhouse", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("tinytraffic_test_%d", rand.Uint32())
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	u, _ := url.Parse(dsn)
	u.Path = "/" + name

	open := func() (*store.Store, *Auth) {
		st, err := store.Open("", store.Options{ClickHouseURL: u.String()})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { st.Close() })
		auth, err := NewAuth(st)
		if err != nil {
			t.Fatal(err)
		}
		return st, auth
	}
	_, server := open()
	if err := server.SetPassword("first password"); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.IssueCookie(rec, httptest.NewRequest(http.MethodPost, "/", nil))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(rec.Result().Cookies()[0])
	if !server.Valid(req) {
		t.Fatal("fresh cookie isn't valid")
	}

	// The password command, run while the server is up.
	_, cmd := open()
	if err := cmd.SetPassword("second password"); err != nil {
		t.Fatal(err)
	}
	if err := server.CheckPassword("1.2.3.4", "second password"); err == nil {
		t.Fatal("new password works before the refresh; the test doesn't test anything")
	}
	if err := server.store.Refresh(); err != nil {
		t.Fatal(err)
	}
	if err := server.CheckPassword("1.2.3.4", "second password"); err != nil {
		t.Errorf("new password after refresh: %v", err)
	}
	if err := server.CheckPassword("1.2.3.4", "first password"); err == nil {
		t.Error("old password still works after refresh")
	}
	if server.Valid(req) {
		t.Error("cookie from before the change is still valid")
	}
}
