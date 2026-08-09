package admin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestModelCallLogOmitsEmptyRawPayloads(t *testing.T) {
	body, err := json.Marshal(ModelCallLogVO{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "requestBody") || strings.Contains(string(body), "responseBody") {
		t.Fatalf("empty raw payloads must be omitted from non-admin JSON: %s", body)
	}
}
