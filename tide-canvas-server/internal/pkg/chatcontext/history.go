// Package chatcontext defines the shared history policy for text-model calls.
package chatcontext

// HistoryLimit counts individual historical user/assistant messages, not turns.
// The current prompt, its attachments and system instructions are separate.
const HistoryLimit = 3

// Latest preserves chronology without modifying the persisted transcript.
func Latest[T any](messages []T) []T {
	if len(messages) > HistoryLimit {
		return messages[len(messages)-HistoryLimit:]
	}
	return messages
}
