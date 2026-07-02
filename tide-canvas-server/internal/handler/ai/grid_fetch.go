package ai

// grid_fetch.go: an SSRF-guarded downloader for *user-supplied* image URLs used
// by the grid-split endpoint. Unlike fetchRemote (provider_relay.go), which
// fetches trusted, server-generated relay result URLs, grid-split's source URL
// comes straight from the request body, so it must never be allowed to reach
// internal/loopback/link-local addresses (cloud metadata, intranet services).
//
// The guard checks the *resolved* IP of every actual connection via a
// net.Dialer.Control hook — this runs after DNS resolution and on every redirect
// hop, so it defeats DNS-rebinding and redirect-based bypasses that a plain
// string/host check would miss.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// errUnsafeFetchTarget marks a source URL whose scheme or resolved IP is not
// allowed. Callers wrap it into errGridSplitUnavailable so the client only ever
// sees a generic message (no internal-address probing oracle).
var errUnsafeFetchTarget = errors.New("fetch target not allowed")

// maxGridSourceBytes caps a grid-split source download. Much smaller than the
// 256 MB relay-rehost cap because a source image to be sliced is never that big,
// and the whole body is buffered in memory before the dimension guard runs — so
// this bounds per-request memory for an authenticated caller.
const maxGridSourceBytes = 32 << 20 // 32 MB

// isDisallowedIP reports whether a user-supplied URL must never be allowed to
// reach ip: loopback, private (RFC1918), link-local, unique-local, unspecified,
// multicast, or the IPv4 CGNAT range (100.64.0.0/10, not covered by IsPrivate).
func isDisallowedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return true // 100.64.0.0/10 carrier-grade NAT
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast()
}

// safeImageHC downloads user-supplied image URLs. Dialer.Control re-checks the
// resolved IP of every connection (initial + each redirect hop), defeating DNS
// rebinding and redirect SSRF; redirects are also capped and re-scheme-checked.
var safeImageHC = &http.Client{
	Timeout: 30 * time.Second,
	Transport: &http.Transport{
		DialContext: (&net.Dialer{Timeout: 10 * time.Second, Control: dialControlGuard}).DialContext,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errUnsafeFetchTarget
		}
		return nil
	},
}

// dialControlGuard rejects a connection whose resolved remote IP is non-public.
// address is always "ip:port" here (post-DNS), so ParseIP sees the real target.
func dialControlGuard(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if isDisallowedIP(net.ParseIP(host)) {
		return errUnsafeFetchTarget
	}
	return nil
}

// safeFetchImage downloads srcURL with the SSRF guard and the shared byte cap.
// It returns the bytes and response Content-Type. Errors are intentionally terse
// (no target URL / status) so the endpoint can't be used to probe the network.
func safeFetchImage(ctx context.Context, srcURL string) ([]byte, string, error) {
	u, err := url.Parse(strings.TrimSpace(srcURL))
	if err != nil {
		return nil, "", errUnsafeFetchTarget
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return nil, "", errUnsafeFetchTarget
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", errUnsafeFetchTarget
	}
	resp, err := safeImageHC.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("fetch source: HTTP %d", resp.StatusCode)
	}
	// Read one byte past the cap so an oversized body is rejected, not truncated.
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxGridSourceBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxGridSourceBytes {
		return nil, "", fmt.Errorf("source exceeds %d MB cap", maxGridSourceBytes>>20)
	}
	return data, strings.TrimSpace(resp.Header.Get("Content-Type")), nil
}
