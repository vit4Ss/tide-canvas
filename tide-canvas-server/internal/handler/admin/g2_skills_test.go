package admin

import "testing"

func TestValidDefaultParams(t *testing.T) {
	ok := []string{"", `{}`, `{"aspectRatio":"16:9"}`, `{"duration":5,"resolution":"720P"}`}
	for _, v := range ok {
		if !validDefaultParams(v) {
			t.Errorf("validDefaultParams(%q) = false, want true", v)
		}
	}
	bad := []string{`[`, `[]`, `"x"`, `123`, `{"a":}`, `not json`}
	for _, v := range bad {
		if validDefaultParams(v) {
			t.Errorf("validDefaultParams(%q) = true, want false", v)
		}
	}
}
