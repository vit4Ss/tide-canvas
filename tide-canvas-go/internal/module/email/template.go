package email

import (
	"errors"
	"regexp"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// 注册验证码邮件模板编码（对齐 VerificationCodeService.TEMPLATE_REGISTER_CODE）。
const templateRegisterCode = "register_code"

// 密码重置邮件模板编码。
const templatePasswordReset = "password_reset"

// variablePattern 变量占位符 {{name}}，允许两侧空白（对齐 EmailTemplateServiceImpl.VARIABLE_PATTERN）。
var variablePattern = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_]+)\s*\}\}`)

// renderedMail 渲染产物：邮件主题 + 正文（HTML）。
type renderedMail struct {
	Subject string
	HTML    string
}

// templateRepo 邮件模板与站点配置的数据访问（GORM，自动过滤 deleted）。
//
// 仅供 email 模块内部使用，与 admin 模块的模板管理（增删改查）解耦，互不依赖。
type templateRepo struct {
	db *gorm.DB
}

func newTemplateRepo(db *gorm.DB) *templateRepo { return &templateRepo{db: db} }

// findByCode 按模板编码查询；未找到返回 (nil, nil)。
func (r *templateRepo) findByCode(code string) (*model.EmailTemplate, error) {
	if r.db == nil {
		return nil, nil
	}
	var t model.EmailTemplate
	err := r.db.Where("template_code = ?", code).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// siteName 读取站点名称配置（sys_config.config_key = site.name），缺失/出错回退默认值（对齐 getSiteName）。
func (r *templateRepo) siteName() string {
	const fallback = "TideCanvas"
	if r.db == nil {
		return fallback
	}
	var cfg model.SysConfig
	err := r.db.Where("config_key = ?", "site.name").First(&cfg).Error
	if err != nil || cfg.ConfigValue == "" {
		return fallback
	}
	return cfg.ConfigValue
}

// renderByCode 按模板编码渲染：模板存在且启用时做 {{var}} 替换返回结果；
// 模板缺失或停用返回 (nil, nil)，由调用方回退内置默认文案（对齐 EmailTemplateServiceImpl.renderByCode）。
func (r *templateRepo) renderByCode(code string, params map[string]string) (*renderedMail, error) {
	t, err := r.findByCode(code)
	if err != nil {
		return nil, err
	}
	if t == nil || t.Enabled != 1 {
		return nil, nil
	}
	return &renderedMail{
		Subject: replaceVariables(t.Subject, params),
		HTML:    replaceVariables(t.Content, params),
	}, nil
}

// replaceVariables 替换文本中的 {{name}} 占位符；未提供值的占位符保留原样
// （对齐 EmailTemplateServiceImpl.replaceVariables，发信场景不追踪 missingVariables）。
func replaceVariables(text string, params map[string]string) string {
	if text == "" {
		return ""
	}
	return variablePattern.ReplaceAllStringFunc(text, func(match string) string {
		sub := variablePattern.FindStringSubmatch(match)
		name := sub[1]
		if params != nil {
			if v, ok := params[name]; ok {
				return v
			}
		}
		return match // 未提供的保留原样
	})
}
