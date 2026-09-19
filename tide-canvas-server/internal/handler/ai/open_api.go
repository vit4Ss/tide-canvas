package ai

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/response"
)

// This namespace is independent of the LobeHub chat gateway. API keys do not
// grant access to JWT-only routes or administrator roles.
func (h *handler) registerOpenAPI(api *gin.RouterGroup, d *app.Deps) {
	g := api.Group("/open/v1", middleware.UserAPIKeyAuth(d.UserKeys))
	g.GET("/models", middleware.RateLimit(d, 120, time.Minute), h.listModels)
	g.GET("/handlers", middleware.RateLimit(d, 120, time.Minute), h.listHandlers)
	g.GET("/tools", middleware.RateLimit(d, 120, time.Minute), h.listSiteTools)
	g.POST("/generations", middleware.RateLimit(d, 30, time.Minute), h.openGenerate)
	g.GET("/tasks", middleware.RateLimit(d, 120, time.Minute), h.openListTasks)
	g.GET("/tasks/:id", middleware.RateLimit(d, 120, time.Minute), h.getTask)
	g.POST("/upscale-quote", middleware.RateLimit(d, 60, time.Minute), h.upscaleQuote)
	g.POST("/reference-video-quote", middleware.RateLimit(d, 60, time.Minute), h.referenceVideoQuote)
}

var openRequestIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$`)

// The public DTO deliberately cannot set user/project ids, internal skill-run
// metadata, billing, status or provenance. Input stays handler-specific.
func decodeOpenGeneration(r io.Reader, idempotencyKey string) (generateDTO, error) {
	var body struct {
		Handler         string                     `json:"handler"`
		ModelID         string                     `json:"modelId"`
		ClientRequestID string                     `json:"clientRequestId"`
		Input           map[string]json.RawMessage `json:"input"`
	}
	decoder := json.NewDecoder(r)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return generateDTO{}, errors.New("请求必须是 JSON 对象，仅支持 handler、modelId、clientRequestId 和 input")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return generateDTO{}, errors.New("请求体只能包含一个 JSON 对象")
	}
	body.Handler, body.ModelID = strings.TrimSpace(body.Handler), strings.TrimSpace(body.ModelID)
	if body.Handler == "" || body.ModelID == "" || body.Input == nil {
		return generateDTO{}, errors.New("handler、modelId 和 input 对象不能为空")
	}
	key := strings.TrimSpace(body.ClientRequestID)
	header := strings.TrimSpace(idempotencyKey)
	if key != "" && header != "" && key != header {
		return generateDTO{}, errors.New("clientRequestId 与 Idempotency-Key 必须一致")
	}
	if key == "" {
		key = header
	}
	if !openRequestIDPattern.MatchString(key) {
		return generateDTO{}, errors.New("请提供 clientRequestId 或 Idempotency-Key：1–80 位字母、数字、点、下划线、冒号或连字符，首位为字母或数字；重试沿用同一个值")
	}
	if err := normalizeOpenGenerationInput(body.Handler, body.Input); err != nil {
		return generateDTO{}, err
	}
	input, err := json.Marshal(body.Input)
	if err != nil {
		return generateDTO{}, err
	}
	return generateDTO{Handler: body.Handler, ModelID: body.ModelID, Input: input,
		ClientRequestID: "open-api:" + key, EntryPoint: "api", IsAPICall: true}, nil
}

// Canonicalize documented aliases before fingerprinting, pricing and dispatch.
// UI requests keep their established contract; API callers must not be charged
// for one specification while the provider reads a different alias.
func normalizeOpenGenerationInput(handler string, input map[string]json.RawMessage) error {
	count := 0
	for _, key := range []string{"batchCount", "batch", "n"} {
		raw, exists := input[key]
		if !exists {
			continue
		}
		var n float64
		if json.Unmarshal(raw, &n) != nil || n < 1 || n > 4 || math.Trunc(n) != n {
			return errors.New("图片生成数量必须是 1–4 的整数（batchCount 或 n）")
		}
		if count != 0 && count != int(n) {
			return errors.New("batchCount、batch 和 n 不能设置不同的生成数量")
		}
		count = int(n)
	}
	if count > 1 {
		gh, exists := newHandlerRegistry().get(handler)
		if !exists || (gh.OperationType() != "generation" && gh.OperationType() != "edits") {
			return errors.New("只有图片生成支持多张数量，其他生成能力请设置为 1")
		}
	}
	if count != 0 {
		input["batchCount"], _ = json.Marshal(count)
		delete(input, "n")
		delete(input, "batch")
	}
	resolution := ""
	for _, key := range []string{"resolution", "clarity"} {
		raw, exists := input[key]
		if !exists {
			continue
		}
		var text *string
		if json.Unmarshal(raw, &text) != nil || text == nil {
			return errors.New("resolution 和 clarity 必须是字符串")
		}
		value := strings.ToLower(strings.TrimSpace(*text))
		if value == "" {
			continue
		}
		if resolution != "" && resolution != value {
			return errors.New("resolution 与 clarity 的清晰度必须一致")
		}
		resolution = value
	}
	if resolution != "" {
		input["resolution"], _ = json.Marshal(resolution)
		delete(input, "clarity")
	}
	return nil
}

func (h *handler) openGenerate(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	dto, err := decodeOpenGeneration(c.Request.Body, c.GetHeader("Idempotency-Key"))
	if err != nil {
		response.Fail(c, response.CodeBadRequest, err.Error())
		return
	}
	h.startGeneration(c, dto)
}

func (h *handler) openListTasks(c *gin.Context) {
	var q taskQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query parameters")
		return
	}
	// A list of API submissions, always scoped to the authenticated owner.
	apiOnly := true
	q.IsAPICall, q.NoProject = &apiOnly, true
	offset, size := pagination(q.PageNum, q.PageSize)
	rows, total, err := h.svc.listTasks(c.Request.Context(), middleware.CurrentUserID(c), q, offset, size)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load tasks")
		return
	}
	response.Page(c, rows, total, normPage(q.PageNum), size)
}
