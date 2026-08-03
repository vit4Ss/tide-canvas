// Package boundedtext contains allocation-safe text transformations for
// administrator-authored templates combined with user-controlled values.
package boundedtext

import (
	"errors"
	"strings"
)

var ErrLimitExceeded = errors.New("rendered text exceeds size limit")

// Replace has strings.NewReplacer's single-pass, leftmost-match semantics, but
// refuses to build output larger than maxBytes. Checking while scanning avoids
// a small template with many placeholders expanding to gigabytes in memory.
func Replace(input string, maxBytes int, oldnew ...string) (string, error) {
	if maxBytes < 0 || len(oldnew)%2 != 0 {
		return "", errors.New("invalid bounded replacement arguments")
	}
	for i := 0; i < len(oldnew); i += 2 {
		if oldnew[i] == "" {
			return "", errors.New("replacement token is empty")
		}
	}
	var out strings.Builder
	if len(input) < maxBytes {
		out.Grow(len(input))
	} else {
		out.Grow(maxBytes)
	}
	written := 0
	appendValue := func(value string) error {
		if len(value) > maxBytes-written {
			return ErrLimitExceeded
		}
		written += len(value)
		_, _ = out.WriteString(value)
		return nil
	}
	for offset := 0; offset < len(input); {
		bestAt, bestPair := -1, -1
		for pair := 0; pair < len(oldnew); pair += 2 {
			at := strings.Index(input[offset:], oldnew[pair])
			if at >= 0 && (bestAt < 0 || at < bestAt || (at == bestAt && pair < bestPair)) {
				bestAt, bestPair = at, pair
			}
		}
		if bestAt < 0 {
			if err := appendValue(input[offset:]); err != nil {
				return "", err
			}
			break
		}
		if err := appendValue(input[offset : offset+bestAt]); err != nil {
			return "", err
		}
		if err := appendValue(oldnew[bestPair+1]); err != nil {
			return "", err
		}
		offset += bestAt + len(oldnew[bestPair])
	}
	return out.String(), nil
}
