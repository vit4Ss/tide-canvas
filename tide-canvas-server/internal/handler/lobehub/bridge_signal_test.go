package lobehub

import (
	"strings"
	"testing"
)

func TestBridgeSignalsBindingAndFailureToTheEmbeddingChatPage(t *testing.T) {
	for _, contract := range []string{
		"source:'flowinglight-ai-chat'",
		"await documentLoaded",
		"notify('bound')",
		"notify('error',error.message)",
		"new URL(config.mainURL).origin",
	} {
		if !strings.Contains(bridgeHTML, contract) {
			t.Fatalf("bridge is missing parent hand-off contract %q", contract)
		}
	}
}

func TestTokenCostLabelUsesIntegersForNewChargesAndKeepsLegacyPrecision(t *testing.T) {
	if got := tokenCostLabel(1_000_000); got != "1" {
		t.Fatalf("whole-point label = %q", got)
	}
	if got := tokenCostLabel(68_400); got != "0.068400" {
		t.Fatalf("legacy fractional label = %q", got)
	}
}
