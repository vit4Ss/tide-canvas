package chat

// tokens.go — cheap context-size estimation for the conversation token cap.
// There is no upstream tokenizer available (the relay fronts many different
// models), so token usage is APPROXIMATED from the stored transcript: CJK and
// other wide-script runes count ≈1 token each, everything else ≈4 chars/token.
// The estimate is used for a UX guardrail ("start a new conversation"), not
// billing, so a rough upper-ish bound is fine.

// estimateTokens approximates the token count of a text.
func estimateTokens(s string) int {
	wide, narrow := 0, 0
	for _, r := range s {
		if r >= 0x2E80 { // CJK radicals onward: han, kana, hangul, fullwidth …
			wide++
		} else {
			narrow++
		}
	}
	return wide + (narrow+3)/4
}
