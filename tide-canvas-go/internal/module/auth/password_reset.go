package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/password"
)

const resetTokenBytes = 32

// RequestPasswordReset 创建一次性密码重置令牌并发送邮件。
// 为防止邮箱枚举，邮箱不存在、禁用账号或发送失败都对前端返回同一成功结果；详细原因仅记录在服务日志。
func (s *Service) RequestPasswordReset(req *PasswordResetRequestReq, ip, ua string) error {
	email := strings.TrimSpace(req.Email)
	if email == "" {
		return ecode.BadRequest
	}

	u, err := s.users.FindByEmail(email)
	if err != nil {
		return err
	}
	if u == nil || u.Status == 0 || s.resetMail == nil {
		return nil
	}

	plain, hash, err := newResetToken()
	if err != nil {
		return err
	}
	if len(ua) > maxUA {
		ua = ua[:maxUA]
	}
	now := time.Now()
	reset := &model.PasswordResetToken{
		UserID:    u.ID,
		Email:     email,
		TokenHash: hash,
		ExpiresAt: now.Add(s.resetTTL),
		RequestIP: ip,
		UserAgent: ua,
	}

	if err := s.db.Transaction(func(tx *gorm.DB) error {
		// 新邮件发出前，作废该用户尚未使用的旧链接，避免多个有效入口长期并存。
		if err := tx.Model(&model.PasswordResetToken{}).
			Where("user_id = ? AND used_at IS NULL", u.ID).
			Update("used_at", now).Error; err != nil {
			return err
		}
		return tx.Create(reset).Error
	}); err != nil {
		return err
	}

	if err := s.resetMail.SendPasswordReset(email, s.buildResetURL(plain), s.resetTTL); err != nil {
		// 不把发送失败暴露给请求方，避免通过响应差异判断邮箱是否存在。
		return nil
	}
	return nil
}

// ConfirmPasswordReset 校验邮件令牌并设置新密码。
func (s *Service) ConfirmPasswordReset(req *PasswordResetConfirmReq) error {
	token := strings.TrimSpace(req.Token)
	if token == "" {
		return ecode.PasswordResetInvalid
	}
	newHash, err := password.Hash(req.NewPassword)
	if err != nil {
		return err
	}

	now := time.Now()
	var reset model.PasswordResetToken
	if err := s.db.Where("token_hash = ? AND used_at IS NULL", hashResetToken(token)).First(&reset).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return ecode.PasswordResetInvalid
		}
		return err
	}
	if !reset.ExpiresAt.After(now) {
		_ = s.db.Model(&model.PasswordResetToken{}).Where("id = ?", reset.ID).Update("used_at", now).Error
		return ecode.PasswordResetInvalid
	}

	u, err := s.users.FindByID(reset.UserID)
	if err != nil {
		return err
	}
	if u == nil || u.Status == 0 {
		return ecode.PasswordResetInvalid
	}

	return s.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.PasswordResetToken{}).
			Where("id = ? AND used_at IS NULL AND expires_at > ?", reset.ID, now).
			Update("used_at", now)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ecode.PasswordResetInvalid
		}
		return tx.Model(&model.SysUser{}).Where("id = ?", reset.UserID).Update("password", newHash).Error
	})
}

func (s *Service) buildResetURL(token string) string {
	base := strings.TrimRight(strings.TrimSpace(s.publicURL), "/")
	if base == "" {
		base = "http://localhost:3000"
	}
	return base + "/reset-password?token=" + url.QueryEscape(token)
}

func newResetToken() (plain string, hash string, err error) {
	buf := make([]byte, resetTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	plain = base64.RawURLEncoding.EncodeToString(buf)
	return plain, hashResetToken(plain), nil
}

func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
