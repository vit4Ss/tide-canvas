package email

import (
	"html"
	"math/rand"
	"strconv"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/module/auth"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// 验证码与防滥用默认值（对齐旧 AppMailProperties 默认）。
const (
	defaultCodeTTLSeconds     = 600 // 验证码有效期
	minCodeTTLSeconds         = 60  // 有效期下限（对齐 Math.max(60, ttl)）
	defaultResendCooldownSecs = 60  // 同邮箱重发冷却
	defaultMaxAttempts        = 5   // 验证码最大错误次数，达到后作废
)

// Service 邮箱验证码服务（忠实迁移 VerificationCodeService），实现 auth.CodeVerifier。
//
// 发码：生成 6 位码 → 校验同邮箱重发冷却 → 存储（带 TTL）→ 渲染 register_code 模板（停用回退内置文案）→ SMTP 发送；
//
//	邮件渠道未启用/未配置时降级开发模式（验证码打日志）。
//
// 校验：比对验证码 → 累计错误次数达上限作废（防爆破）→ 过期自动失效。
type Service struct {
	store    CodeStore
	tplRepo  *templateRepo
	sender   *smtpSender
	logger   *logrus.Logger
	codeTTL  time.Duration
	cooldown time.Duration
	maxTries int
}

// NewService 构造邮箱验证码服务。
//
//   - db     用于读取邮件模板（email_template）与站点名（sys_config）。
//   - conf   读取 mail.* 配置（enabled/host/port/username/password/from_*/reply_to/code_ttl_seconds/
//     resend_cooldown_seconds/max_attempts）。
//   - logger 开发模式与发送失败日志，可为 nil。
//
// 验证码存储默认用进程内 MemoryCodeStore；多实例部署须改注入 RedisCodeStore（见 store.go TODO(redis)）。
func NewService(db *gorm.DB, conf *viper.Viper, logger *logrus.Logger, store CodeStore) *Service {
	mc := mailConfig{
		Enabled:     conf.GetBool("mail.enabled"),
		Host:        conf.GetString("mail.host"),
		Port:        conf.GetInt("mail.port"),
		Username:    conf.GetString("mail.username"),
		Password:    conf.GetString("mail.password"),
		FromAddress: conf.GetString("mail.from_address"),
		FromName:    conf.GetString("mail.from_name"),
		ReplyTo:     conf.GetString("mail.reply_to"),
	}
	if mc.Port == 0 {
		mc.Port = 587
	}

	if store == nil {
		store = NewMemoryCodeStore()
	}
	return &Service{
		store:    store,
		tplRepo:  newTemplateRepo(db),
		sender:   newSMTPSender(mc, logger),
		logger:   logger,
		codeTTL:  codeTTL(conf),
		cooldown: secondsOrDefault(conf, "mail.resend_cooldown_seconds", defaultResendCooldownSecs),
		maxTries: intOrDefault(conf, "mail.max_attempts", defaultMaxAttempts),
	}
}

// SendEmailCode 生成并下发邮箱注册验证码（对齐 sendEmailCode）。
func (s *Service) SendEmailCode(email string) error {
	// 同邮箱重发冷却：抢占失败说明仍在冷却窗口内。
	if s.cooldown > 0 && !s.store.AcquireCooldown(email, s.cooldown) {
		return ecode.RateLimit.WithMessage(
			"验证码发送过于频繁，请 " + strconv.Itoa(int(s.cooldown.Seconds())) + " 秒后再试")
	}

	code := generateCode()
	s.store.SetCode(email, code, s.codeTTL) // 内部清空该邮箱既有错误计数
	ttlMinutes := int64(s.codeTTL / time.Minute)

	if !s.sender.enabled() {
		// 渠道关闭或未配置 SMTP → 开发模式：验证码打日志，便于本地联调。
		s.warnf("【开发模式·邮件未启用】邮箱 %s 的注册验证码：%s（%d 分钟内有效）", email, code, ttlMinutes)
		return nil
	}

	if err := s.sendCodeMail(email, code, ttlMinutes); err != nil {
		s.errorf("发送邮箱验证码失败: %s, err=%v", email, err)
		// 发送失败不应占用冷却窗口，释放后允许用户立即重试（对齐旧 delete(cooldownKey)）。
		s.store.ReleaseCooldown(email)
		return ecode.ServerError.WithMessage("验证码发送失败，请稍后重试")
	}
	return nil
}

// VerifyEmailCode 校验邮箱验证码（对齐 verifyEmailCode）。
func (s *Service) VerifyEmailCode(email, code string) error {
	stored, ok := s.store.GetCode(email)
	if !ok {
		return ecode.BadRequest.WithMessage("验证码不存在或已过期")
	}
	if stored != code {
		if s.registerFailedAttempt(email) {
			// 错误次数达上限：验证码已作废，提示重新获取（对齐旧 "错误次数过多" 分支）。
			return ecode.BadRequest.WithMessage("验证码错误次数过多，已失效，请重新获取")
		}
		return ecode.BadRequest.WithMessage("验证码错误")
	}
	s.store.DelCode(email)
	return nil
}

// registerFailedAttempt 累计错误次数；达上限时作废验证码并返回 true（防 6 位码窗口内爆破，对齐 registerFailedAttempt）。
// maxTries<=0 表示不限次，恒返回 false。
func (s *Service) registerFailedAttempt(email string) bool {
	if s.maxTries <= 0 {
		return false
	}
	fails := s.store.IncrFail(email, s.codeTTL)
	if fails >= s.maxTries {
		s.store.DelCode(email)
		return true
	}
	return false
}

// sendCodeMail 渲染并发送验证码邮件：优先后台可编辑的 register_code 模板，缺失/停用时回退内置纯文本
// （对齐 sendCodeMail）。
func (s *Service) sendCodeMail(email, code string, ttlMinutes int64) error {
	siteName := s.tplRepo.siteName()
	rendered, err := s.tplRepo.renderByCode(templateRegisterCode, map[string]string{
		"code":       code,
		"siteName":   siteName,
		"ttlMinutes": strconv.FormatInt(ttlMinutes, 10),
		"email":      email,
	})
	if err != nil {
		// 模板读取异常不阻断发信，回退内置文案（rendered 为 nil 时走 fallback）。
		s.warnf("读取邮件模板失败，回退内置文案: %v", err)
	}

	var subject, htmlBody string
	if rendered != nil {
		subject = rendered.Subject
		htmlBody = rendered.HTML
	} else {
		subject = siteName + " 注册验证码"
		htmlBody = "您的验证码是：" + code + "，" + strconv.FormatInt(ttlMinutes, 10) +
			" 分钟内有效。如非本人操作请忽略。"
	}
	return s.sender.sendHTML(email, subject, htmlBody)
}

// SendPasswordReset 发送密码重置邮件；SMTP 未启用时只写日志，方便本地调试完整流程。
func (s *Service) SendPasswordReset(email, resetURL string, ttl time.Duration) error {
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	if !s.sender.enabled() {
		s.warnf("【开发模式·邮件未启用】邮箱 %s 的密码重置链接：%s（%d 分钟内有效）", email, resetURL, durationMinutes(ttl))
		return nil
	}
	if err := s.sendPasswordResetMail(email, resetURL, durationMinutes(ttl)); err != nil {
		s.errorf("发送密码重置邮件失败: %s, err=%v", email, err)
		return ecode.ServerError.WithMessage("密码重置邮件发送失败，请稍后重试")
	}
	return nil
}

// sendPasswordResetMail 渲染并发送密码重置邮件；模板缺失时回退内置 HTML。
func (s *Service) sendPasswordResetMail(email, resetURL string, ttlMinutes int64) error {
	siteName := s.tplRepo.siteName()
	rendered, err := s.tplRepo.renderByCode(templatePasswordReset, map[string]string{
		"siteName":   siteName,
		"resetUrl":   resetURL,
		"ttlMinutes": strconv.FormatInt(ttlMinutes, 10),
		"email":      email,
	})
	if err != nil {
		s.warnf("读取密码重置邮件模板失败，回退内置文案: %v", err)
	}

	var subject, htmlBody string
	if rendered != nil {
		subject = rendered.Subject
		htmlBody = rendered.HTML
	} else {
		escapedURL := html.EscapeString(resetURL)
		subject = siteName + " 密码重置"
		htmlBody = "<p>您正在重置 " + html.EscapeString(siteName) + " 账号（" + html.EscapeString(email) + "）的登录密码。</p>" +
			"<p><a href=\"" + escapedURL + "\">点击这里重置密码</a></p>" +
			"<p>链接 " + strconv.FormatInt(ttlMinutes, 10) + " 分钟内有效。如非本人操作，请忽略本邮件。</p>"
	}
	return s.sender.sendHTML(email, subject, htmlBody)
}

func durationMinutes(d time.Duration) int64 {
	mins := int64(d / time.Minute)
	if mins <= 0 {
		return 1
	}
	return mins
}

// generateCode 生成 6 位数字验证码（对齐 ThreadLocalRandom.nextInt(100000, 1000000)）。
func generateCode() string {
	return strconv.Itoa(100000 + rand.Intn(900000))
}

// codeTTL 验证码有效期：mail.code_ttl_seconds（未配置取默认 600），下限 60 秒（对齐 Math.max(60, ttl)）。
func codeTTL(conf *viper.Viper) time.Duration {
	secs := defaultCodeTTLSeconds
	if conf.IsSet("mail.code_ttl_seconds") {
		secs = conf.GetInt("mail.code_ttl_seconds")
	}
	if secs < minCodeTTLSeconds {
		secs = minCodeTTLSeconds
	}
	return time.Duration(secs) * time.Second
}

// secondsOrDefault 读取秒级配置：未显式配置取默认；显式配置（含 <=0 表禁用）尊重原值。
func secondsOrDefault(conf *viper.Viper, key string, def int) time.Duration {
	return time.Duration(intOrDefault(conf, key, def)) * time.Second
}

// intOrDefault 读取整型配置：未显式配置取默认；显式配置（含 0）尊重原值。
func intOrDefault(conf *viper.Viper, key string, def int) int {
	if conf.IsSet(key) {
		return conf.GetInt(key)
	}
	return def
}

func (s *Service) warnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

func (s *Service) errorf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Errorf(format, args...)
	}
}

// 编译期断言：Service 满足 auth.CodeVerifier（替换 router 中的 auth.DevCodeVerifier）。
var _ auth.CodeVerifier = (*Service)(nil)
var _ auth.PasswordResetMailer = (*Service)(nil)
