package recharge

import (
	"testing"

	"github.com/tidwall/gjson"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

func TestVerifyResponseSignRequiresSignature(t *testing.T) {
	root := gjson.Parse(`{"code":0,"status":1,"trade_no":"gw_1"}`)
	if err := verifyResponseSign(root, &epayConfig{}); err != ecode.PaymentGatewayError {
		t.Fatalf("expected PaymentGatewayError for unsigned success response, got %v", err)
	}
}
