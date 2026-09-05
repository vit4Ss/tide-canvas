package file

import (
	"net/http"
	"strings"
)

// Keep the existing DNS/redirect/size protections. Only Bilibili's media CDN
// needs the public site's Referer to download a publicly playable MP4.
type remoteAssetTransport struct {
	*http.Transport
}

func (t *remoteAssetTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return t.Transport.RoundTrip(remoteAssetRequest(req))
}

func remoteAssetRequest(req *http.Request) *http.Request {
	host := strings.ToLower(strings.TrimSuffix(req.URL.Hostname(), "."))
	if host != "bilivideo.com" && !strings.HasSuffix(host, ".bilivideo.com") {
		return req
	}
	// RoundTrippers must not mutate the caller's request; reevaluate the host
	// on every redirect instead of applying these headers to arbitrary sites.
	copy := req.Clone(req.Context())
	copy.Header.Set("Referer", "https://www.bilibili.com/")
	copy.Header.Set("User-Agent", "Mozilla/5.0")
	return copy
}
