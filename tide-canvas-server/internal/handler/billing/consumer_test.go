package billing

import (
	"context"
	"strings"
	"testing"
	"tidecanvas/internal/model"
)

func TestStripeRepeatPurchaseAddsCreditsWithoutDowngrading(t *testing.T) {
	s, fixture, dto := setupStripe(t)
	if err := s.repo.db.Model(&model.User{}).Where("id = 701").Update("vip_level", 3).Error; err != nil {
		t.Fatal(err)
	}
	first, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	paidSession(fixture, "cs_test_1")
	if _, err := s.verifyOrder(context.Background(), 701, first.OrderNo); err != nil {
		t.Fatal(err)
	}
	dto.Cycle = "yearly"
	second, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("paid order reused instead of a new purchase")
	}
	paidSession(fixture, "cs_test_2")
	for range 2 {
		if _, err := s.verifyOrder(context.Background(), 701, second.OrderNo); err != nil {
			t.Fatal(err)
		}
	}
	var buyer model.User
	if err := s.repo.db.First(&buyer, "id = 701").Error; err != nil {
		t.Fatal(err)
	}
	if buyer.Points != 7810 || buyer.VipLevel != 3 {
		t.Fatalf("unexpected repeat purchase: points=%d tier=%d", buyer.Points, buyer.VipLevel)
	}
}

func TestConsumerInfoRoundTripAndMarketIsolation(t *testing.T) {
	db := marketTestDB(t)
	if err := db.AutoMigrate(&model.SysConfig{}); err != nil {
		t.Fatal(err)
	}
	v, err := LoadConsumerInfo(db, "en")
	if err != nil || v.SupportEmail != "gudexin748@gmail.com" || v.Retention != "" {
		t.Fatalf("invented defaults: %+v %v", v, err)
	}
	v.Retention = "Operator-authored retention terms."
	if err := SaveConsumerInfo(db, v, "en"); err != nil {
		t.Fatal(err)
	}
	got, err := LoadConsumerInfo(db, "en")
	if err != nil || got != v {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	cn, err := LoadConsumerInfo(db, "cn")
	if err != nil || cn != (ConsumerInfo{}) {
		t.Fatal("English policies leaked to the Chinese site")
	}
	for _, email := range []string{"not an email", "Name <a@example.com>", "a@example.com\r\nBcc:other@example.com"} {
		bad := ConsumerInfo{SupportEmail: email}
		if bad.Validate() == nil {
			t.Fatalf("accepted %q", email)
		}
	}
	bad := ConsumerInfo{Retention: strings.Repeat("x", 2001)}
	if bad.Validate() == nil {
		t.Fatal("oversize policy accepted")
	}
}
