package auth

// local.go — 用户名+密码本地账号(免邮箱)注册与配套校验。
//
// 与邮箱注册(register)的差异:无验证码环节,注册成功直接签发 token(注册即登录)。
// 因为少了邮箱验证这道摩擦,用户名与密码策略从严(validateUsername /
// validatePasswordStrict),并由路由层挂 IP 限速防批量灌号。
//
// User.Email 有唯一索引且列不可空,本地账号写入 "u<id>@noemail.internal" 占位
// (id 保证唯一);auth VO 层把该占位统一抹成空串,前台一律显示为「未绑定邮箱」。
// 该域名不可送达,验证码/找回密码流程天然对其无效——本地账号忘记密码无法自助
// 找回,注册页已作显著提醒。

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"

	"go.uber.org/zap"
)

// noEmailSuffix 标记「未绑定邮箱」的本地账号占位邮箱;toUserVO 据此抹空展示。
const noEmailSuffix = "@noemail.internal"

// policyError 是可直接展示给用户的校验失败原因(中文);handler 原样透出 400。
type policyError struct{ msg string }

func (e *policyError) Error() string { return e.msg }

func policyErr(msg string) error { return &policyError{msg: msg} }

// usernameRe:4-20 位,字母开头,仅字母/数字/下划线。天然排除纯数字(避免与
// 手机号登录混淆)、邮箱形态(无 @)与空白/特殊字符。
var usernameRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{3,19}$`)

// reservedUsernames:系统保留与易冒充身份,小写比对;另有 admin/official 前缀拦截。
var reservedUsernames = map[string]struct{}{
	"root": {}, "system": {}, "api": {}, "support": {}, "service": {},
	"operator": {}, "moderator": {}, "superuser": {}, "guest": {}, "test": {},
	"user": {}, "users": {}, "null": {}, "undefined": {}, "anonymous": {},
	"flowinglight": {}, "liuguang": {}, "kefu": {}, "customer": {},
}

// validateUsername 是本地注册用户名的服务端权威校验(前端仅镜像提示)。
func validateUsername(name string) error {
	if !usernameRe.MatchString(name) {
		return policyErr("用户名需 4-20 位，以字母开头，仅可包含字母、数字和下划线")
	}
	lower := strings.ToLower(name)
	if _, hit := reservedUsernames[lower]; hit ||
		strings.HasPrefix(lower, "admin") || strings.HasPrefix(lower, "official") {
		return policyErr("该用户名为系统保留，请更换")
	}
	return nil
}

// commonPasswords:高频弱密码黑名单(小写比对)。注重「即便满足字符类别也必须
// 拦下」的常见组合;非穷举,字符类别规则挡住其余大头。
var commonPasswords = map[string]struct{}{
	"password": {}, "password1": {}, "password123": {}, "passw0rd": {}, "p@ssw0rd": {}, "p@ssword1": {},
	"12345678": {}, "123456789": {}, "1234567890": {}, "87654321": {},
	"qwerty123": {}, "qwertyuiop": {}, "1q2w3e4r": {}, "1q2w3e4r5t": {}, "1qaz2wsx": {}, "qazwsxedc": {},
	"q1w2e3r4": {}, "1234qwer": {}, "qwer1234": {}, "123qweasd": {}, "asd123456": {},
	"abc12345": {}, "abcd1234": {}, "asdf1234": {}, "zxcvbnm123": {}, "a1b2c3d4": {},
	"admin123": {}, "admin@123": {}, "root1234": {}, "root@123": {}, "letmein123": {},
	"iloveyou": {}, "iloveyou1": {}, "welcome123": {}, "monkey123": {}, "dragon123": {},
	"woaini520": {}, "woaini1314": {}, "wang123456": {}, "aa123456": {}, "abc123456": {},
	"a12345678": {}, "12345678a": {}, "123456aa": {}, "5201314520": {}, "1314520520": {},
	"11111111": {}, "00000000": {}, "66666666": {}, "88888888": {}, "aaaa1111": {},
}

// validatePasswordStrict 是本地账号(注册即登录、无邮箱可找回)的密码策略,
// 比邮箱流程的 validatePasswordStrength 更严:
//   - 长度 8-64 字符(且 ≤72 字节,bcrypt 上限)
//   - 大写/小写/数字/特殊符号至少三类
//   - 不含空白字符;不包含用户名(不区分大小写)
//   - 不在常见弱密码黑名单
func validatePasswordStrict(pw, username string) error {
	if len(pw) > 72 {
		return policyErr("密码过长，请控制在 72 字节以内")
	}
	var n, lower, upper, digit, special int
	for _, r := range pw {
		n++
		switch {
		case r >= 'a' && r <= 'z':
			lower = 1
		case r >= 'A' && r <= 'Z':
			upper = 1
		case r >= '0' && r <= '9':
			digit = 1
		case r == ' ' || r == '\t' || r == '\n' || r == '\r':
			return policyErr("密码不能包含空格")
		default:
			special = 1
		}
	}
	if n < 8 || n > 64 {
		return policyErr("密码长度需 8-64 位")
	}
	if lower+upper+digit+special < 3 {
		return policyErr("密码需包含大写字母、小写字母、数字、特殊符号中的至少三类")
	}
	pwLower := strings.ToLower(pw)
	if username != "" && strings.Contains(pwLower, strings.ToLower(username)) {
		return policyErr("密码不能包含用户名")
	}
	if _, hit := commonPasswords[pwLower]; hit {
		return policyErr("该密码过于常见，请更换更安全的密码")
	}
	return nil
}

// registerLocal 创建用户名+密码本地账号并直接签发 token(注册即登录)。
func (s *service) registerLocal(ctx context.Context, dto RegisterLocalDTO) (*LoginVO, error) {
	username := strings.TrimSpace(dto.Username)
	if err := validateUsername(username); err != nil {
		return nil, err
	}
	if err := validatePasswordStrict(dto.Password, username); err != nil {
		return nil, err
	}
	// 用户名唯一(users.username 唯一索引 + utf8mb4 CI 排序规则,大小写不敏感)
	if exists, err := s.repo.existsUsername(username); err != nil {
		return nil, err
	} else if exists {
		return nil, errUsernameExists
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(dto.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	id := idgen.Next()
	u := &model.User{
		ID:            id,
		Username:      username,
		Email:         "u" + id.String() + noEmailSuffix, // 列非空且唯一,按 id 生成占位
		Nickname:      username,
		PasswordHash:  string(hash),
		Role:          0,
		RoleID:        model.RoleIDByCode(s.repo.db, model.RoleCodeUser),
		Status:        1,
		LastLoginTime: now,
	}
	if err := s.repo.create(u); err != nil {
		// 并发抢注同名(exists 检查与写入之间):唯一索引兜底,归一为「已存在」
		if strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return nil, errUsernameExists
		}
		return nil, err
	}

	// 新手积分与邮箱注册同口径(best-effort,失败不影响注册)。批量灌号风险由
	// 路由层 IP 限速兜底。
	if granted, err := points.GrantSignup(s.repo.db, u.ID); err != nil {
		logger.L().Warn("auth: signup point grant failed", zap.String("userId", u.ID.String()), zap.Error(err))
	} else {
		u.Points += int64(granted)
	}

	access, refresh, expiresIn, err := token.Issue(u.ID, u.Role)
	if err != nil {
		return nil, err
	}
	return &LoginVO{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    expiresIn,
		UserInfo:     toUserVO(u, 1, model.MenusForUser(s.repo.db, u), model.AdminPermsForUser(s.repo.db, u)),
	}, nil
}

// registerLocal handles POST /api/auth/register-local.
func (h *handler) registerLocal(c *gin.Context) {
	var dto RegisterLocalDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	vo, err := h.svc.registerLocal(c.Request.Context(), dto)
	if err != nil {
		logAuth(c, 0, dto.Username, "register", "local", err)
		var pe *policyError
		switch {
		case errors.As(err, &pe):
			response.Fail(c, response.CodeBadRequest, pe.msg)
		case errors.Is(err, errUsernameExists):
			response.Fail(c, response.CodeUsernameExists, "该用户名已被使用")
		default:
			response.Fail(c, response.CodeServerError, "registration failed")
		}
		return
	}
	response.OK(c, vo)
}
