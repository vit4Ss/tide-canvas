// Package idgen provides snowflake-based 64-bit IDs and an ID type that
// (un)marshals to/from JSON as a quoted decimal string. The frontend relies on
// string IDs to avoid JavaScript number precision loss, so EVERY id / foreign
// key field across models and VOs uses idgen.ID.
package idgen

import (
	"errors"
	"strconv"
	"sync"

	"github.com/bwmarrin/snowflake"
)

// ID is a snowflake identifier. JSON representation is a quoted decimal string
// ("123"); on unmarshal it also accepts a bare number (123) and null / "" (=> 0).
type ID int64

var (
	node     *snowflake.Node
	nodeOnce sync.Once
	nodeErr  error
)

// init lazily initializes a default node (node 1). Call InitNode explicitly to
// override before the first Next() if a different node id is required.
func init() {
	ensureNode(1)
}

func ensureNode(n int64) {
	nodeOnce.Do(func() {
		node, nodeErr = snowflake.NewNode(n)
	})
}

// InitNode initializes the snowflake node with the given node id. It is a no-op
// if a node has already been initialized (including the default from init()).
func InitNode(n int64) error {
	ensureNode(n)
	return nodeErr
}

// Next returns a new unique snowflake ID.
func Next() ID {
	if node == nil {
		// Node failed to initialize; fall back to a fresh node-0 attempt so we
		// never panic. nodeErr (if any) is surfaced via InitNode.
		if n, err := snowflake.NewNode(0); err == nil {
			node = n
		} else {
			return 0
		}
	}
	return ID(node.Generate().Int64())
}

// Parse parses a decimal string into an ID. Empty string parses to 0.
func Parse(s string) (ID, error) {
	if s == "" {
		return 0, nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, err
	}
	return ID(v), nil
}

// String returns the decimal representation of the ID.
func (id ID) String() string { return strconv.FormatInt(int64(id), 10) }

// Int64 returns the underlying int64 value.
func (id ID) Int64() int64 { return int64(id) }

// MarshalJSON renders the ID as a quoted decimal string, e.g. "123".
func (id ID) MarshalJSON() ([]byte, error) {
	return []byte(`"` + strconv.FormatInt(int64(id), 10) + `"`), nil
}

// UnmarshalJSON accepts "123", 123, null or "" (the latter two => 0).
func (id *ID) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" || s == `""` || s == "" {
		*id = 0
		return nil
	}
	// Strip surrounding quotes if present.
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}
	if s == "" {
		*id = 0
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return errors.New("idgen: invalid ID " + string(b))
	}
	*id = ID(v)
	return nil
}
