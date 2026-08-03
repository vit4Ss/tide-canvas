// Package safefetch provides an HTTP client for fetching untrusted, public
// URLs without turning the server into an SSRF proxy.
package safefetch

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var ErrUnsafeURL = errors.New("unsafe remote URL")

// ValidateURL accepts ordinary public HTTP(S) endpoints only. DNS answers are
// intentionally not trusted here; NewClient repeats the IP policy after DNS
// resolution and dials the validated address directly.
func ValidateURL(raw string) (*url.URL, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil {
		return nil, ErrUnsafeURL
	}
	if err := ValidateParsedURL(parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// ValidateParsedURL applies the URL-level portion of the public fetch policy.
func ValidateParsedURL(parsed *url.URL) error {
	if parsed == nil || parsed.Hostname() == "" || parsed.User != nil {
		return ErrUnsafeURL
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return ErrUnsafeURL
	}
	if port := parsed.Port(); port != "" && port != "80" && port != "443" {
		return ErrUnsafeURL
	}
	if ip, err := netip.ParseAddr(parsed.Hostname()); err == nil && !IsPublicIP(ip) {
		return ErrUnsafeURL
	}
	return nil
}

// IsPublicIP rejects local, private, link-local and special-purpose ranges that
// must never be reachable through a server-side URL supplied by another party.
func IsPublicIP(ip netip.Addr) bool {
	if !ip.IsValid() {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	blocked := [...]netip.Prefix{
		netip.MustParsePrefix("100.64.0.0/10"), // carrier-grade NAT
		netip.MustParsePrefix("198.18.0.0/15"), // benchmarking
	}
	for _, prefix := range blocked {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

// NewClient returns a no-proxy client whose resolver answers are checked at
// dial time. The optional redirectPolicy can further restrict redirect hosts;
// the public-IP and scheme/port policy is always applied on every hop.
func NewClient(timeout time.Duration, redirectPolicy func(*url.URL) error) *http.Client {
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 nil,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 20 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, fmt.Errorf("safe fetch address: %w", err)
			}
			var ips []netip.Addr
			if literal, parseErr := netip.ParseAddr(host); parseErr == nil {
				ips = []netip.Addr{literal}
			} else {
				ips, err = net.DefaultResolver.LookupNetIP(ctx, "ip", host)
				if err != nil {
					return nil, fmt.Errorf("safe fetch resolve: %w", err)
				}
			}
			if len(ips) == 0 {
				return nil, errors.New("safe fetch resolve returned no addresses")
			}
			// Reject the hostname if any answer is unsafe. This prevents a mixed
			// public/private answer or DNS rebinding from selecting an internal IP.
			for _, ip := range ips {
				if !IsPublicIP(ip) {
					return nil, ErrUnsafeURL
				}
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
		},
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if err := ValidateParsedURL(req.URL); err != nil {
				return err
			}
			if redirectPolicy != nil {
				return redirectPolicy(req.URL)
			}
			return nil
		},
	}
}
