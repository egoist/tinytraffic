package server

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/egoist/tinytraffic/internal/store"
)

const (
	cookieName  = "tt_session"
	sessionTTL  = 30 * 24 * time.Hour
	maxFailures = 10
	failWindow  = 15 * time.Minute
)

// Auth is single-user password auth with stateless signed session cookies.
type Auth struct {
	store  *store.Store
	secret []byte

	mu       sync.Mutex
	hash     string
	failures map[string][]time.Time
}

func NewAuth(s *store.Store) (*Auth, error) {
	secretHex, err := s.Setting("session_secret")
	if err != nil {
		return nil, err
	}
	if secretHex == "" {
		b := make([]byte, 32)
		rand.Read(b)
		secretHex = hex.EncodeToString(b)
		if err := s.SetSetting("session_secret", secretHex); err != nil {
			return nil, err
		}
	}
	secret, err := hex.DecodeString(secretHex)
	if err != nil {
		return nil, err
	}
	hash, err := s.Setting("password_hash")
	if err != nil {
		return nil, err
	}
	return &Auth{store: s, secret: secret, hash: hash, failures: map[string][]time.Time{}}, nil
}

func (a *Auth) HasPassword() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.hash != ""
}

func (a *Auth) SetPassword(pw string) error {
	if len(pw) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	if err := a.store.SetSetting("password_hash", string(b)); err != nil {
		return err
	}
	a.mu.Lock()
	a.hash = string(b)
	a.mu.Unlock()
	return nil
}

var errRateLimited = errors.New("too many failed attempts, try again later")

func (a *Auth) CheckPassword(ip, pw string) error {
	a.mu.Lock()
	now := time.Now()
	recent := a.failures[ip][:0]
	for _, t := range a.failures[ip] {
		if now.Sub(t) < failWindow {
			recent = append(recent, t)
		}
	}
	a.failures[ip] = recent
	hash := a.hash
	a.mu.Unlock()

	if len(recent) >= maxFailures {
		return errRateLimited
	}
	if hash == "" || bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) != nil {
		a.mu.Lock()
		a.failures[ip] = append(a.failures[ip], now)
		a.mu.Unlock()
		return errors.New("wrong password")
	}
	return nil
}

// sign binds the token to the current password hash, so changing the
// password signs every session out.
func (a *Auth) sign(payload string) string {
	a.mu.Lock()
	hash := a.hash
	a.mu.Unlock()
	m := hmac.New(sha256.New, a.secret)
	m.Write([]byte(payload + "|" + hash))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

func (a *Auth) IssueCookie(w http.ResponseWriter, r *http.Request) {
	exp := time.Now().Add(sessionTTL).Unix()
	payload := strconv.FormatInt(exp, 10)
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    payload + "." + a.sign(payload),
		Path:     "/",
		Expires:  time.Unix(exp, 0),
		HttpOnly: true,
		Secure:   isHTTPS(r),
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *Auth) ClearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode,
	})
}

func (a *Auth) Valid(r *http.Request) bool {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	payload, sig, ok := strings.Cut(c.Value, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(a.sign(payload))) {
		return false
	}
	exp, err := strconv.ParseInt(payload, 10, 64)
	return err == nil && time.Now().Unix() < exp && a.HasPassword()
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}
