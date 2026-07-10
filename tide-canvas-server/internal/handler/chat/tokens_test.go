package chat

import "testing"

func TestEstimateTokens(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"abcd", 1},  // 4 narrow chars ≈ 1 token
		{"abcde", 2}, // ceil(5/4)
		{"你好", 2},    // CJK ≈ 1 token per rune
		{"你好ab", 3},  // mixed
		{"，。！", 3},   // fullwidth punctuation counts wide
	}
	for _, c := range cases {
		if got := estimateTokens(c.in); got != c.want {
			t.Errorf("estimateTokens(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestToContextUsageVO(t *testing.T) {
	if vo := toContextUsageVO(8000, 32000, false); vo.Percent != 25 || vo.Full || vo.Compressed {
		t.Errorf("25%% case: %+v", vo)
	}
	if vo := toContextUsageVO(32000, 32000, false); vo.Percent != 100 || !vo.Full {
		t.Errorf("at-limit case: %+v", vo)
	}
	if vo := toContextUsageVO(999999, 32000, false); vo.Percent != 100 || !vo.Full {
		t.Errorf("over-limit case: %+v", vo)
	}
	if vo := toContextUsageVO(0, 32000, false); vo.Percent != 0 || vo.Full {
		t.Errorf("empty case: %+v", vo)
	}
	if vo := toContextUsageVO(8000, 32000, true); !vo.Compressed {
		t.Errorf("compressed case: %+v", vo)
	}
}
