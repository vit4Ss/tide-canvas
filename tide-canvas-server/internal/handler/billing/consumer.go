package billing

import (
	"encoding/json"
	"errors"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/response"
)

// ConsumerInfo contains operator-authored promises, separate from payment rules.
// Empty policies are intentionally unpublished, never invented by the frontend.
type ConsumerInfo struct {
	SupportEmail    string `json:"supportEmail"`
	CommercialUse   string `json:"commercialUse"`
	Retention       string `json:"retention"`
	RefundTiming    string `json:"refundTiming"`
	CreditValidity  string `json:"creditValidity"`
	MembershipTerms string `json:"membershipTerms"`
}

func (v *ConsumerInfo) Validate() error {
	v.SupportEmail = strings.TrimSpace(v.SupportEmail)
	if v.SupportEmail != "" {
		address, err := mail.ParseAddress(v.SupportEmail)
		if err != nil || address.Address != v.SupportEmail || len(v.SupportEmail) > 254 || strings.ContainsAny(v.SupportEmail, "\r\n") {
			return errors.New("enter a valid support email address")
		}
	}
	for _, field := range []*string{&v.CommercialUse, &v.Retention, &v.RefundTiming, &v.CreditValidity, &v.MembershipTerms} {
		*field = strings.TrimSpace(*field)
		if utf8.RuneCountInString(*field) > 2000 {
			return errors.New("each policy must be at most 2000 characters")
		}
	}
	return nil
}

func LoadConsumerInfo(db *gorm.DB, markets ...string) (ConsumerInfo, error) {
	var row model.SysConfig
	err := db.Where("config_key = ?", marketConfigKey("pricing.consumer", markets...)).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		v := ConsumerInfo{}
		if model.BillingMarket(markets...) == model.BillingMarketEN {
			v.SupportEmail = "gudexin748@gmail.com"
		}
		return v, nil
	}
	if err != nil {
		return ConsumerInfo{}, err
	}
	var v ConsumerInfo
	if err = json.Unmarshal([]byte(row.ConfigValue), &v); err != nil {
		return v, err
	}
	return v, v.Validate()
}

func SaveConsumerInfo(db *gorm.DB, v ConsumerInfo, markets ...string) error {
	if err := v.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var row model.SysConfig
	err = db.Where("config_key = ?", marketConfigKey("pricing.consumer", markets...)).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return db.Create(&model.SysConfig{ConfigKey: marketConfigKey("pricing.consumer", markets...), ConfigValue: string(raw), Group: "pricing", Description: "Customer support and purchase policies"}).Error
	}
	if err != nil {
		return err
	}
	return db.Model(&row).Update("config_value", string(raw)).Error
}

func (h *handler) getConsumerInfo(c *gin.Context) {
	v, err := LoadConsumerInfo(h.svc.repo.db, h.market)
	if err != nil {
		response.Fail(c, response.CodeServerError, "Customer information is temporarily unavailable.")
		return
	}
	response.OK(c, v)
}
