package social

import "strings"

// Read only error fields, never stringify the whole envelope: validation input,
// request params, headers and media URLs can contain credentials or signed URLs.
func tikHubResponseMessage(value any, depth int) string {
	if depth > 5 {
		return ""
	}
	switch typed := value.(type) {
	case string:
		if !tikHubGenericMessage(typed) {
			return strings.TrimSpace(typed)
		}
	case map[string]any:
		message := firstNonEmptyString(typed, "message_zh", "message", "msg", "error_description")
		if message != "" && !tikHubGenericMessage(message) {
			// FastAPI validation errors identify the rejected query field in loc.
			if loc, ok := typed["loc"].([]any); ok && len(loc) > 0 {
				if field, ok := loc[len(loc)-1].(string); ok {
					message = field + ": " + message
				}
			}
			return message
		}
		for _, key := range []string{"detail", "error", "errors"} {
			if nested := tikHubResponseMessage(typed[key], depth+1); nested != "" {
				return nested
			}
		}
	case []any:
		var messages []string
		for _, row := range typed {
			if message := tikHubResponseMessage(row, depth+1); message != "" {
				messages = append(messages, message)
				if len(messages) == 3 {
					break
				}
			}
		}
		return strings.Join(messages, "; ")
	}
	return ""
}

func tikHubGenericMessage(message string) bool {
	lower := strings.ToLower(strings.TrimSpace(message))
	return lower == "" || lower == "ok" || lower == "bad request" || lower == "error" ||
		strings.HasPrefix(lower, "request successful") || lower == "success" || strings.HasPrefix(message, "请求成功")
}

func tikHubResponseRequestID(envelope map[string]any) string {
	if value, ok := envelope["request_id"].(string); ok && value != "" {
		return value
	}
	if detail, ok := envelope["detail"].(map[string]any); ok {
		value, _ := detail["request_id"].(string)
		return value
	}
	return ""
}

func tikHubSafeDiagnostic(value, apiKey string) string {
	if value == "" {
		return ""
	}
	if apiKey != "" {
		value = strings.ReplaceAll(value, apiKey, "[redacted]")
	}
	value = sourceURLPattern.ReplaceAllString(value, "[url]")
	return safeMessage(value)
}
