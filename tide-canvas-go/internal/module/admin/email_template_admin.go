package admin

import (
	"encoding/json"
	"net/mail"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// variablePattern 变量占位符 {{name}}，允许两侧空白（对齐 EmailTemplateServiceImpl.VARIABLE_PATTERN）。
var variablePattern = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_]+)\s*\}\}`)

// MailSender 测试邮件发送能力（对齐旧 JavaMailSender + AppMailProperties 组合）。
//
// 跨模块依赖：本模块不直接耦合 SMTP 具体实现。真实实现待 email/通知模块迁移后注入。
// 未配置/未启用时由 router 注入 NoopMailSender，sendTest 返回与旧版一致的“未启用”错误。
type MailSender interface {
	// Enabled SMTP 是否已启用并配置（对齐 mailProperties.isEnabled() && host 非空 && sender 可用）。
	Enabled() bool
	// Send 发送一封 HTML 邮件（subject 已含 [测试] 前缀）。
	Send(to, subject, html string) error
}

// NoopMailSender 占位邮件发送器：未启用，Send 不应被调用（Enabled=false 时 service 提前返回错误）。
type NoopMailSender struct{ Logger *logrus.Logger }

// Enabled 恒 false。
func (NoopMailSender) Enabled() bool { return false }

// Send 占位：打日志并报错（正常流程不会走到这里）。
func (n NoopMailSender) Send(to, subject, html string) error {
	if n.Logger != nil {
		n.Logger.Warnf("[mail] 未配置 SMTP，跳过测试邮件: to=%s subject=%s", to, subject)
	}
	return ecode.BadRequest.WithMessage("邮件服务未启用或未配置SMTP，无法发送测试邮件")
}

// EmailTemplateAdminService 邮件模板服务（忠实迁移 EmailTemplateServiceImpl）。
type EmailTemplateAdminService struct {
	repo   *Repository
	mail   MailSender
	logger *logrus.Logger
}

// NewEmailTemplateAdminService 构造。mailSender 可注入 NoopMailSender；logger 可为 nil。
func NewEmailTemplateAdminService(repo *Repository, mailSender MailSender, logger *logrus.Logger) *EmailTemplateAdminService {
	return &EmailTemplateAdminService{repo: repo, mail: mailSender, logger: logger}
}

// ListTemplates 模板列表（对齐 listTemplates）。
func (s *EmailTemplateAdminService) ListTemplates() ([]EmailTemplateVO, error) {
	list, err := s.repo.ListTemplates()
	if err != nil {
		return nil, err
	}
	out := make([]EmailTemplateVO, 0, len(list))
	for i := range list {
		out = append(out, s.toVO(&list[i]))
	}
	return out, nil
}

// GetTemplate 模板详情（对齐 getTemplate）。
func (s *EmailTemplateAdminService) GetTemplate(id int64) (*EmailTemplateVO, error) {
	t, err := s.requireTemplate(id)
	if err != nil {
		return nil, err
	}
	vo := s.toVO(t)
	return &vo, nil
}

// UpdateTemplate 更新模板（对齐 updateTemplate）：模板编码与变量定义系统内置，不可改。
func (s *EmailTemplateAdminService) UpdateTemplate(id int64, dto *EmailTemplateUpdateDTO) error {
	t, err := s.requireTemplate(id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(dto.TemplateName) == "" {
		return ecode.BadRequest.WithMessage("模板名称不能为空")
	}
	if strings.TrimSpace(dto.Subject) == "" {
		return ecode.BadRequest.WithMessage("邮件主题不能为空")
	}
	if strings.TrimSpace(dto.Content) == "" {
		return ecode.BadRequest.WithMessage("邮件正文不能为空")
	}
	enabled := 0
	if dto.Enabled != nil && *dto.Enabled == 1 {
		enabled = 1
	}
	columns := map[string]interface{}{
		"template_name": dto.TemplateName,
		"subject":       dto.Subject,
		"content":       dto.Content,
		"enabled":       enabled,
		"remark":        dto.Remark,
	}
	if err := s.repo.UpdateTemplateColumns(id, columns); err != nil {
		return err
	}
	s.logf("Email template updated: code=%s, enabled=%d", t.TemplateCode, enabled)
	return nil
}

// Preview 预览渲染（编辑中内容 + 变量测试值，不落库；对齐 preview）。
func (s *EmailTemplateAdminService) Preview(dto *EmailTemplatePreviewDTO) (*EmailRenderVO, error) {
	if strings.TrimSpace(dto.Subject) == "" {
		return nil, ecode.BadRequest.WithMessage("邮件主题不能为空")
	}
	if strings.TrimSpace(dto.Content) == "" {
		return nil, ecode.BadRequest.WithMessage("邮件正文不能为空")
	}
	vo := render(dto.Subject, dto.Content, dto.Params)
	return &vo, nil
}

// SendTest 发送测试邮件（使用已保存内容，对齐 sendTest）。
func (s *EmailTemplateAdminService) SendTest(id int64, dto *EmailTemplateSendTestDTO) error {
	if strings.TrimSpace(dto.To) == "" {
		return ecode.BadRequest.WithMessage("收件邮箱不能为空")
	}
	if _, err := mail.ParseAddress(dto.To); err != nil {
		return ecode.BadRequest.WithMessage("邮箱格式不正确")
	}
	t, err := s.requireTemplate(id)
	if err != nil {
		return err
	}
	rendered := render(t.Subject, t.Content, dto.Params)

	if s.mail == nil || !s.mail.Enabled() {
		return ecode.BadRequest.WithMessage("邮件服务未启用或未配置SMTP(spring.mail.* / mail.enabled)，无法发送测试邮件")
	}
	if err := s.mail.Send(dto.To, "[测试] "+rendered.Subject, rendered.HTML); err != nil {
		s.logf("Send test email failed: to=%s, err=%v", dto.To, err)
		// 旧版包装为 SERVER_ERROR；若已是业务错误则透传
		if _, ok := err.(*ecode.Error); ok {
			return err
		}
		return ecode.ServerError.WithMessage("测试邮件发送失败: " + err.Error())
	}
	s.logf("Test email sent: template=%s, to=%s", t.TemplateCode, dto.To)
	return nil
}

// render 变量替换：主题/正文中的 {{name}} 用 params 替换；未提供的保留原样并记入 missingVariables（对齐 render）。
func render(subject, content string, params map[string]string) EmailRenderVO {
	missing := newOrderedSet()
	renderedSubject := replaceVariables(subject, params, missing)
	renderedHTML := replaceVariables(content, params, missing)
	return EmailRenderVO{
		Subject:          renderedSubject,
		HTML:             renderedHTML,
		MissingVariables: missing.list(),
	}
}

// replaceVariables 替换文本中的变量占位符（对齐 replaceVariables）。
func replaceVariables(text string, params map[string]string, missing *orderedSet) string {
	if strings.TrimSpace(text) == "" {
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
		missing.add(name)
		return match // 未提供的保留原样
	})
}

func (s *EmailTemplateAdminService) requireTemplate(id int64) (*model.EmailTemplate, error) {
	t, err := s.repo.FindTemplateByID(id)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, ecode.NotFound.WithMessage("模板不存在")
	}
	return t, nil
}

// toVO 模板转 VO（解析 variables JSON，对齐 toVO + parseVariables）。
func (s *EmailTemplateAdminService) toVO(t *model.EmailTemplate) EmailTemplateVO {
	return EmailTemplateVO{
		ID:           t.ID,
		TemplateCode: t.TemplateCode,
		TemplateName: t.TemplateName,
		Subject:      t.Subject,
		Content:      t.Content,
		Variables:    s.parseVariables(t.Variables),
		Enabled:      t.Enabled,
		Remark:       t.Remark,
		UpdateTime:   t.UpdateTime,
	}
}

// parseVariables 解析变量定义 JSON，非法则返回空列表（对齐 parseVariables）。
func (s *EmailTemplateAdminService) parseVariables(j string) []EmailTemplateVariableVO {
	if strings.TrimSpace(j) == "" {
		return []EmailTemplateVariableVO{}
	}
	var vars []EmailTemplateVariableVO
	if err := json.Unmarshal([]byte(j), &vars); err != nil {
		s.logWarnf("Invalid email template variables json: %s", j)
		return []EmailTemplateVariableVO{}
	}
	return vars
}

func (s *EmailTemplateAdminService) logf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Infof(format, args...)
	}
}

func (s *EmailTemplateAdminService) logWarnf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Warnf(format, args...)
	}
}

// orderedSet 保持插入顺序的字符串集合（对齐旧 LinkedHashSet，用于 missingVariables 去重且有序）。
type orderedSet struct {
	seen  map[string]struct{}
	items []string
}

func newOrderedSet() *orderedSet {
	return &orderedSet{seen: make(map[string]struct{})}
}

func (s *orderedSet) add(v string) {
	if _, ok := s.seen[v]; ok {
		return
	}
	s.seen[v] = struct{}{}
	s.items = append(s.items, v)
}

func (s *orderedSet) list() []string {
	if s.items == nil {
		return []string{}
	}
	return s.items
}

// ---- HTTP handlers（挂载于 /api/admin/email-templates，已 JWTAuth + AdminOnly）----

// listTemplates GET /api/admin/email-templates 模板列表。
func (h *Handler) listTemplates(c *gin.Context) {
	vos, err := h.emailSvc.ListTemplates()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

// getTemplate GET /api/admin/email-templates/:id 模板详情（:id 为模板主键 int64）。
func (h *Handler) getTemplate(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.emailSvc.GetTemplate(id)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// updateTemplate PUT /api/admin/email-templates/:id 更新模板。
func (h *Handler) updateTemplate(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	var dto EmailTemplateUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.emailSvc.UpdateTemplate(id, &dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// previewTemplate POST /api/admin/email-templates/preview 预览渲染。
func (h *Handler) previewTemplate(c *gin.Context) {
	var dto EmailTemplatePreviewDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.emailSvc.Preview(&dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// sendTestTemplate POST /api/admin/email-templates/:id/send-test 发送测试邮件。
func (h *Handler) sendTestTemplate(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	var dto EmailTemplateSendTestDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.emailSvc.SendTest(id, &dto); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
