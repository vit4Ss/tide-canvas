package videodownload

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"tidecanvas/internal/pkg/safefetch"
)

// yt-dlp's redirects/manifests also pass through the application's public-IP
// policy. A per-operation loopback proxy pins validated DNS addresses at dial
// time, and disappears with the command. It never accepts external clients.
func publicProxy(ctx context.Context) (string, func(), error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", nil, err
	}
	secret := make([]byte, 24)
	if _, err = rand.Read(secret); err != nil {
		listener.Close()
		return "", nil, err
	}
	password := hex.EncodeToString(secret)
	transport := safefetch.NewClient(time.Minute, nil).Transport.(*http.Transport)
	var mu sync.Mutex
	closed := false
	conns := make(map[net.Conn]bool)
	track := func(c net.Conn) bool {
		mu.Lock()
		defer mu.Unlock()
		if closed {
			c.Close()
			return false
		}
		conns[c] = true
		return true
	}
	untrack := func(c net.Conn) { c.Close(); mu.Lock(); delete(conns, c); mu.Unlock() }
	slots := make(chan struct{}, 32)
	server := &http.Server{ReadHeaderTimeout: 10 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// BasicAuth reads Authorization; proxy credentials have their own header.
		auth := &http.Request{Header: http.Header{"Authorization": r.Header.Values("Proxy-Authorization")}}
		user, pass, ok := auth.BasicAuth()
		if !ok || user != "video" || pass != password {
			w.Header().Set("Proxy-Authenticate", `Basic realm="video"`)
			http.Error(w, "authentication required", 407)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			http.Error(w, "busy", 429)
			return
		}
		if r.Method != http.MethodConnect {
			if err := safefetch.ValidateParsedURL(r.URL); err != nil {
				http.Error(w, "unsafe destination", 403)
				return
			}
			request := r.Clone(r.Context())
			request.RequestURI = ""
			request.Header.Del("Proxy-Authorization")
			request.Header.Del("Proxy-Connection")
			response, err := transport.RoundTrip(request)
			if err != nil {
				http.Error(w, "public fetch failed", 502)
				return
			}
			defer response.Body.Close()
			for k, vv := range response.Header {
				for _, v := range vv {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(response.StatusCode)
			_, _ = io.Copy(w, response.Body)
			return
		}
		target, err := url.Parse("https://" + r.Host)
		if err != nil || safefetch.ValidateParsedURL(target) != nil || target.Port() != "443" && target.Port() != "80" {
			http.Error(w, "unsafe destination", 403)
			return
		}
		remote, err := transport.DialContext(ctx, "tcp", r.Host)
		if err != nil {
			http.Error(w, "public fetch failed", 502)
			return
		}
		if !track(remote) {
			http.Error(w, "closed", 503)
			return
		}
		defer untrack(remote)
		client, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		if !track(client) {
			return
		}
		defer untrack(client)
		deadline, ok := ctx.Deadline()
		if !ok {
			deadline = time.Now().Add(20 * time.Minute)
		}
		_ = client.SetDeadline(deadline)
		_ = remote.SetDeadline(deadline)
		_, _ = buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		if buffered.Flush() != nil {
			return
		}
		done := make(chan struct{})
		go func() { _, _ = io.Copy(remote, buffered); remote.Close(); close(done) }()
		_, _ = io.Copy(client, remote)
		client.Close()
		<-done
	})
	go func() { _ = server.Serve(listener) }()
	var once sync.Once
	closeProxy := func() {
		once.Do(func() {
			mu.Lock()
			closed = true
			for c := range conns {
				c.Close()
			}
			mu.Unlock()
			_ = server.Close()
			transport.CloseIdleConnections()
		})
	}
	stop := context.AfterFunc(ctx, closeProxy)
	return "http://video:" + password + "@" + listener.Addr().String(), func() { stop(); closeProxy() }, nil
}

func redactCommandError(raw []byte) string {
	// Only classify diagnostics. Never return command output (URLs/headers) to users.
	return strings.ToLower(string(raw))
}
