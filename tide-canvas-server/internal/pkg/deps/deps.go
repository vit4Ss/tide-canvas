// Package deps anchors module dependencies that the foundation pins but does
// not yet import directly. The domain packages added in the next phase use
// these (bcrypt for password hashing, decimal for AI cost accounting); the
// blank imports here keep the exact pinned versions in go.mod / go.sum across a
// `go mod tidy` before those usages exist.
//
// Remove an entry once the corresponding package imports the dependency for
// real — the blank import is only a version anchor, not a runtime dependency.
package deps

import (
	_ "github.com/shopspring/decimal"
	_ "golang.org/x/crypto/bcrypt"
)
