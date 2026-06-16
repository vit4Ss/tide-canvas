package auth

import (
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/internal/module/user"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/password"
)

const (
	defaultAPIQuota     = 100
	defaultStorageQuota = int64(1073741824)
	maxUA               = 500
)

// Service 认证业务逻辑（对齐 AuthServiceImpl）。
type Service struct {
	users     *user.Repository
	jwt       *appjwt.Provider
	code      CodeVerifier
	teamPrice TeamPriceProvider
	db        *gorm.DB // 写登录日志
}

// NewService 构造认证服务。
func NewService(users *user.Repository, jwtProvider *appjwt.Provider, code CodeVerifier, teamPrice TeamPriceProvider) *Service {
	return &Service{users: users, jwt: jwtProvider, code: code, teamPrice: teamPrice, db: users.DB()}
}

// SendEmailCode 发送邮箱注册验证码。
func (s *Service) SendEmailCode(email string) error { return s.code.SendEmailCode(email) }

// Register 注册：校验验证码 → 邮箱/用户名唯一 → 创建用户。
func (s *Service) Register(req *RegisterReq) (*UserVO, error) {
	if err := s.code.VerifyEmailCode(req.Email, req.Code); err != nil {
		return nil, err
	}
	if exists, err := s.users.ExistsByEmail(req.Email); err != nil {
		return nil, err
	} else if exists {
		return nil, ecode.EmailExists
	}
	if exists, err := s.users.ExistsByUsername(req.Username); err != nil {
		return nil, err
	} else if exists {
		return nil, ecode.UsernameExists
	}

	hashed, err := password.Hash(req.Password)
	if err != nil {
		return nil, err
	}
	nickname := req.Nickname
	if nickname == "" {
		nickname = req.Username
	}
	u := &model.SysUser{
		Username:     req.Username,
		Email:        req.Email,
		Password:     hashed,
		Nickname:     nickname,
		Phone:        req.Phone,
		Role:         0,
		Status:       1,
		APIQuota:     defaultAPIQuota,
		Points:       defaultAPIQuota,
		IsAuthor:     0,
		StorageQuota: defaultStorageQuota,
	}
	if err := s.users.Create(u); err != nil {
		return nil, err
	}
	return s.toUserVO(u), nil
}

// Login 登录：校验存在/禁用/密码 → 更新最后登录时间 → 记录登录日志 → 签发双令牌。
func (s *Service) Login(req *LoginReq, ip, ua string) (*LoginVO, error) {
	u, err := s.users.FindByAccount(req.Account)
	if err != nil {
		return nil, err
	}
	if u == nil {
		s.recordLogin(req.Account, nil, "", false, "账号不存在", ip, ua)
		return nil, ecode.AccountNotFound
	}
	if u.Status == 0 {
		s.recordLogin(req.Account, &u.ID, u.Username, false, "账号已禁用", ip, ua)
		return nil, ecode.AccountDisabled
	}
	if !password.Verify(u.Password, req.Password) {
		s.recordLogin(req.Account, &u.ID, u.Username, false, "密码错误", ip, ua)
		return nil, ecode.PasswordIncorrect
	}

	now := time.Now()
	_ = s.users.UpdateColumns(u.ID, map[string]interface{}{"last_login_time": now})
	u.LastLoginTime = &now
	s.recordLogin(req.Account, &u.ID, u.Username, true, "", ip, ua)

	return s.buildLoginVO(u)
}

// RefreshToken 用 refresh token 换发新令牌（access token 不可用于刷新）。
func (s *Service) RefreshToken(req *RefreshReq) (*LoginVO, error) {
	claims, err := s.jwt.Parse(req.RefreshToken)
	if err != nil || claims.Type != appjwt.TypeRefresh {
		return nil, ecode.Unauthorized.WithMessage("RefreshToken无效或已过期")
	}
	userID, err := claims.UserID()
	if err != nil {
		return nil, ecode.Unauthorized
	}
	u, err := s.users.FindByID(userID)
	if err != nil {
		return nil, err
	}
	if u == nil || u.Status == 0 {
		return nil, ecode.Unauthorized
	}
	return s.buildLoginVO(u)
}

// CurrentUser 获取当前用户信息。
func (s *Service) CurrentUser(userID int64) (*UserVO, error) {
	u, err := s.users.FindByID(userID)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, ecode.AccountNotFound
	}
	return s.toUserVO(u), nil
}

// UpdatePassword 修改密码（校验原密码）。
func (s *Service) UpdatePassword(userID int64, req *UpdatePasswordReq) error {
	u, err := s.users.FindByID(userID)
	if err != nil {
		return err
	}
	if u == nil {
		return ecode.AccountNotFound
	}
	if !password.Verify(u.Password, req.OldPassword) {
		return ecode.PasswordIncorrect.WithMessage("原密码不正确")
	}
	hashed, err := password.Hash(req.NewPassword)
	if err != nil {
		return err
	}
	return s.users.UpdateColumns(userID, map[string]interface{}{"password": hashed})
}

func (s *Service) buildLoginVO(u *model.SysUser) (*LoginVO, error) {
	access, err := s.jwt.GenerateAccessToken(u.ID, u.Username, u.Role)
	if err != nil {
		return nil, err
	}
	refresh, err := s.jwt.GenerateRefreshToken(u.ID)
	if err != nil {
		return nil, err
	}
	return &LoginVO{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    s.jwt.AccessTTL(),
		UserInfo:     s.toUserVO(u),
	}, nil
}

// recordLogin 记录登录日志（成功/失败），失败不影响主流程。
func (s *Service) recordLogin(account string, userID *int64, username string, success bool, failReason, ip, ua string) {
	defer func() { _ = recover() }()
	name := username
	if name == "" {
		name = account
	}
	status := 0
	if success {
		status = 1
	}
	if len(ua) > maxUA {
		ua = ua[:maxUA]
	}
	_ = s.db.Create(&model.LoginLog{
		UserID:     userID,
		Username:   name,
		Status:     status,
		FailReason: failReason,
		IP:         ip,
		UserAgent:  ua,
	}).Error
}

func (s *Service) toUserVO(u *model.SysUser) *UserVO {
	inTeam := u.TeamID != nil
	factor := decimal.NewFromInt(1)
	if inTeam {
		factor = s.teamPrice.GetPriceFactor(u.ID)
	}
	return &UserVO{
		ID:              u.PublicID,
		Username:        u.Username,
		Email:           u.Email,
		Phone:           u.Phone,
		Nickname:        u.Nickname,
		Avatar:          u.Avatar,
		Role:            u.Role,
		Status:          u.Status,
		APIQuota:        u.APIQuota,
		Points:          u.Points,
		IsAuthor:        u.IsAuthor,
		StorageQuota:    u.StorageQuota,
		InTeam:          inTeam,
		TeamPriceFactor: factor,
		CreateTime:      u.CreateTime,
		LastLoginTime:   u.LastLoginTime,
	}
}
