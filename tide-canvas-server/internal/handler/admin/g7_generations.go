package admin

// g7_generations.go: 生成记录 —— 面向运营的「每一次模型调用」审计视图。
//
// 数据源与日志管理的模型日志同为 model_call_log（chat/assistant/optimize/
// image/video/audio 全场景），但按「生成记录」的形态组装：
//   - 列表行：从请求体提取 prompt 摘要，批量解析平台积分消耗
//     （upstream_task_id → ai_generation_logs → ai_tasks.point_cost）；
//   - 详情：请求体解析成 prompt / 生成参数 / 输入素材（chat 附件、参考图），
//     响应体解析成可预览的生成结果（媒体 URL / 文本回复），异步任务结果
//     沿 upstream_task_id 回查 generation_logs / ai_tasks 兜底。
//
// 请求/响应体是 eventlog 截断过的（16KB + "…(truncated)"），解析必须容错：
// JSON 完整走结构化提取，截断行退回正则提取（URL / prompt / filename）。

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// RegisterGenerations mounts the 生成记录 routes.
//
//	GET /generations      (userId?, scene?, success?, keyword?, startDate?, endDate?) -> PageData<GenerationRowVO>
//	GET /generations/:id                                                       -> GenerationDetailVO
func RegisterGenerations(g *gin.RouterGroup, d *app.Deps) {
	g.GET("/generations", func(c *gin.Context) { listGenerations(c, d) })
	g.GET("/generations/:id", func(c *gin.Context) { generationDetail(c, d) })
}

// ---- 解析 ------------------------------------------------------------------

// genAsset 是详情里「输入素材 / 生成结果」的一项。
type genAsset struct {
	URL  string `json:"url,omitempty"`
	Name string `json:"name,omitempty"`
	Kind string `json:"kind"` // image | video | audio | file
}

// genParam 是「生成参数」网格的一项（已从请求体拍平成标量）。
type genParam struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// parsedRequest 是从请求体提取的结构化信息。
type parsedRequest struct {
	Prompt string
	Params []genParam
	Inputs []genAsset
}

// parsedResponse 是从响应体提取的结构化信息。
type parsedResponse struct {
	Results []genAsset
	Reply   string // 文本场景:助手回复(可能不是 JSON,直接是纯文本)
}

// mediaKindByExt 按扩展名识别可预览媒体。
var mediaKindByExt = map[string]string{
	".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image",
	".mp4": "video", ".mov": "video", ".webm": "video",
	".mp3": "audio", ".wav": "audio", ".m4a": "audio", ".ogg": "audio",
}

// textScenes 是纯文本场景:响应体是裸文本回复而非 JSON。
var textScenes = map[string]bool{
	"chat": true, "assistant": true, "optimize": true, "compact": true, "blog-polish": true,
}

// kindOfURL 按扩展名推断媒体类型;非媒体返回 ""。
func kindOfURL(u string) string {
	p := u
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	dot := strings.LastIndex(p, ".")
	if dot < 0 || dot+1 >= len(p) {
		return ""
	}
	ext := strings.ToLower(p[dot:])
	if len(ext) > 6 {
		return ""
	}
	return mediaKindByExt[ext]
}

func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// onAnyHost 报告 URL 是否落在给定 host 集合（本站存储域）内。
func onAnyHost(u string, hosts []string) bool {
	for _, h := range hosts {
		if h != "" && strings.Contains(u, "://"+h+"/") {
			return true
		}
	}
	return false
}

// walkStrings 深度遍历解码后的 JSON,对每个字符串值回调（path 仅供调试,不用）。
func walkStrings(v any, fn func(s string)) {
	switch t := v.(type) {
	case map[string]any:
		for _, val := range t {
			walkStrings(val, fn)
		}
	case []any:
		for _, val := range t {
			walkStrings(val, fn)
		}
	case string:
		fn(t)
	}
}

// decodeJSON 尝试完整解析;body 可能被 eventlog 截断（带 "…(truncated)" 尾巴）。
func decodeJSON(body string) (any, bool) {
	var v any
	if err := json.Unmarshal([]byte(strings.TrimSpace(body)), &v); err != nil {
		return nil, false
	}
	return v, true
}

// ---- 请求体解析 -------------------------------------------------------------

// paramDenyKeys 不进「生成参数」网格的键：prompt 正文、密钥、URL 大字段。
var paramDenyKeys = map[string]bool{
	"prompt": true, "text": true, "messages": true, "stream": true,
	"api_key": true, "apikey": true, "key": true, "token": true, "authorization": true,
	"image": true, "images": true, "image_url": true, "image_urls": true,
	"url": true, "urls": true, "references": true, "files": true, "file": true,
}

// maxParamValueLen 参数值长度上限——超过的多半是 prompt 或 URL,不是参数。
const maxParamValueLen = 60

// collectParams 拍平顶层及一层嵌套对象里的标量字段为参数网格。
func collectParams(obj map[string]any) []genParam {
	var out []genParam
	add := func(k string, v any) {
		if paramDenyKeys[strings.ToLower(k)] || len(out) >= 24 {
			return
		}
		var s string
		switch t := v.(type) {
		case string:
			s = t
		case float64:
			s = strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			s = strconv.FormatBool(t)
		default:
			return
		}
		if s == "" || len(s) > maxParamValueLen || isHTTPURL(s) {
			return
		}
		out = append(out, genParam{Key: k, Value: s})
	}
	// json 遍历 map 无序——先收集键排序,保证详情页参数顺序稳定。
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sortStrings(keys)
	for _, k := range keys {
		v := obj[k]
		if nested, ok := v.(map[string]any); ok {
			subKeys := make([]string, 0, len(nested))
			for sk := range nested {
				subKeys = append(subKeys, sk)
			}
			sortStrings(subKeys)
			for _, sk := range subKeys {
				add(k+"."+sk, nested[sk])
			}
			continue
		}
		add(k, v)
	}
	return out
}

// sortStrings 是排序辅助（避免为两行代码引 sort 包造成的阅读跳跃）。
func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// messagesOf 从请求 JSON 里找 OpenAI 形态的 messages 数组:
// chat 场景落库的是 json.Marshal(msgs)（顶层即数组）,也可能是 {messages:[…]}。
func messagesOf(v any) []any {
	if arr, ok := v.([]any); ok {
		return arr
	}
	if obj, ok := v.(map[string]any); ok {
		if arr, ok := obj["messages"].([]any); ok {
			return arr
		}
	}
	return nil
}

// parseMessageParts 解析一条消息的 content（字符串或 parts 数组）,
// 返回文本与该条消息携带的附件。
func parseMessageParts(content any, hosts []string) (text string, atts []genAsset) {
	if s, ok := content.(string); ok {
		return s, nil
	}
	parts, ok := content.([]any)
	if !ok {
		return "", nil
	}
	var texts []string
	for _, p := range parts {
		part, ok := p.(map[string]any)
		if !ok {
			continue
		}
		typ, _ := part["type"].(string)
		switch typ {
		case "text":
			if t, _ := part["text"].(string); t != "" {
				texts = append(texts, t)
			}
		case "image_url":
			// {image_url:{url}} —— 图片附件（可能是加速域名/区域域名/CDN 形态）
			if iu, ok := part["image_url"].(map[string]any); ok {
				if u, _ := iu["url"].(string); isHTTPURL(u) {
					atts = append(atts, genAsset{URL: u, Kind: "image"})
				}
			}
		case "file":
			// {file:{filename, file_data}} —— 文档附件;base64 已被日志净化成占位
			if f, ok := part["file"].(map[string]any); ok {
				name, _ := f["filename"].(string)
				atts = append(atts, genAsset{Name: name, Kind: "file"})
			}
		}
	}
	return strings.Join(texts, "\n"), atts
}

// parseRequestBody 提取 prompt / 生成参数 / 输入素材。hosts 是本站存储域
// （无扩展名的存储 URL 也能认出是输入素材）。
func parseRequestBody(body string, hosts []string) parsedRequest {
	var out parsedRequest
	v, ok := decodeJSON(body)
	if !ok {
		return parseRequestFallback(body, hosts)
	}

	if msgs := messagesOf(v); msgs != nil {
		// 取最后一条 user 消息:附件只挂在当前轮,历史消息是纯文本。
		for i := len(msgs) - 1; i >= 0; i-- {
			m, ok := msgs[i].(map[string]any)
			if !ok {
				continue
			}
			role, _ := m["role"].(string)
			if role != "user" {
				continue
			}
			text, atts := parseMessageParts(m["content"], hosts)
			out.Prompt = text
			out.Inputs = atts
			break
		}
		return out
	}

	if obj, ok := v.(map[string]any); ok {
		// 生成类请求:prompt 主字段 + 标量参数 + 全文 URL 扫描。
		// 部分供应商把 prompt 嵌在 input/params 子对象里,主字段为空时下探一层。
		for _, k := range []string{"prompt", "text"} {
			if s, _ := obj[k].(string); s != "" {
				out.Prompt = s
				break
			}
		}
		if out.Prompt == "" {
			for _, wrap := range []string{"input", "params", "request"} {
				if sub, ok := obj[wrap].(map[string]any); ok {
					if s, _ := sub["prompt"].(string); s != "" {
						out.Prompt = s
						break
					}
				}
			}
		}
		out.Params = collectParams(obj)
		seen := map[string]bool{}
		walkStrings(v, func(s string) {
			if !isHTTPURL(s) || seen[s] {
				return
			}
			kind := kindOfURL(s)
			if kind == "" && onAnyHost(s, hosts) {
				kind = "image" // 本站存储无扩展名 URL 多为图片素材
			}
			if kind != "" {
				seen[s] = true
				out.Inputs = append(out.Inputs, genAsset{URL: s, Kind: kind})
			}
		})
	}
	return out
}

// ---- 截断容错(正则提取) ------------------------------------------------------

var (
	genURLRe      = regexp.MustCompile(`https?://[^\s"'\\)\]]+`)
	genPromptRe   = regexp.MustCompile(`"(?:prompt|text)"\s*:\s*"((?:[^"\\]|\\.)*)`)
	genFilenameRe = regexp.MustCompile(`"filename"\s*:\s*"((?:[^"\\]|\\.)*)"`)
)

// unescapeJSONString 尽力还原 JSON 字符串内容的转义。
func unescapeJSONString(s string) string {
	if u, err := strconv.Unquote(`"` + s + `"`); err == nil {
		return u
	}
	return s
}

// regexAssets 从（可能截断的）文本里提取 URL 资产。onlyMedia 区分输入/结果口径。
func regexAssets(body string, hosts []string, seen map[string]bool) []genAsset {
	var out []genAsset
	for _, u := range genURLRe.FindAllString(body, -1) {
		u = strings.TrimRight(u, ".,;")
		if seen[u] {
			continue
		}
		kind := kindOfURL(u)
		if kind == "" && onAnyHost(u, hosts) {
			kind = "image"
		}
		if kind == "" {
			continue
		}
		seen[u] = true
		out = append(out, genAsset{URL: u, Kind: kind})
	}
	return out
}

// parseRequestFallback 处理被 eventlog 截断（非法 JSON）的请求体。
func parseRequestFallback(body string, hosts []string) parsedRequest {
	var out parsedRequest
	if m := genPromptRe.FindStringSubmatch(body); m != nil {
		out.Prompt = unescapeJSONString(m[1])
	}
	seen := map[string]bool{}
	out.Inputs = regexAssets(body, hosts, seen)
	for _, m := range genFilenameRe.FindAllStringSubmatch(body, -1) {
		out.Inputs = append(out.Inputs, genAsset{Name: unescapeJSONString(m[1]), Kind: "file"})
	}
	return out
}

// parseResponseBody 提取生成结果(媒体 URL)或文本回复。
func parseResponseBody(scene, body string, hosts []string) parsedResponse {
	var out parsedResponse
	body = strings.TrimSpace(body)
	if body == "" {
		return out
	}
	v, ok := decodeJSON(body)
	if !ok {
		// 文本场景的响应是裸文本回复;生成类截断行退回 URL 扫描。
		if textScenes[scene] {
			out.Reply = strings.TrimSuffix(body, "…(truncated)")
			return out
		}
		out.Results = regexAssets(body, hosts, map[string]bool{})
		return out
	}
	// chat 形态:choices[0].message.content(字符串或 parts)。
	if obj, ok := v.(map[string]any); ok {
		if choices, ok := obj["choices"].([]any); ok && len(choices) > 0 {
			if ch, ok := choices[0].(map[string]any); ok {
				if msg, ok := ch["message"].(map[string]any); ok {
					text, _ := parseMessageParts(msg["content"], hosts)
					out.Reply = text
				}
			}
		}
	}
	seen := map[string]bool{}
	walkStrings(v, func(s string) {
		if !isHTTPURL(s) || seen[s] {
			return
		}
		if kind := kindOfURL(s); kind != "" {
			seen[s] = true
			out.Results = append(out.Results, genAsset{URL: s, Kind: kind})
		}
	})
	return out
}

// ---- 平台积分解析 -------------------------------------------------------------

// resolvePointCosts 批量把 upstream_task_id 映射到平台积分消耗:
// model_call_log.upstream_task_id → ai_generation_logs(同上游 id,取最新一条的
// task_id) → ai_tasks.point_cost（任务创建时预扣的准确金额,崩溃退款另算）。
// 文本场景没有上游任务 id,天然不在映射里（前端显示「—」）。
func resolvePointCosts(db *gorm.DB, upstreamIDs []string) map[string]int64 {
	out := map[string]int64{}
	uniq := make([]string, 0, len(upstreamIDs))
	seen := map[string]bool{}
	for _, u := range upstreamIDs {
		if u != "" && !seen[u] {
			seen[u] = true
			uniq = append(uniq, u)
		}
	}
	if len(uniq) == 0 {
		return out
	}
	var logs []struct {
		UpstreamTaskID string
		TaskID         idgen.ID
	}
	if err := db.Model(&model.AiGenerationLog{}).
		Select("upstream_task_id, task_id").
		Where("upstream_task_id IN ?", uniq).
		Order("id DESC").
		Scan(&logs).Error; err != nil {
		return out
	}
	upstreamToTask := map[string]idgen.ID{}
	taskIDs := make([]idgen.ID, 0, len(logs))
	taskSeen := map[idgen.ID]bool{}
	for _, l := range logs {
		if _, ok := upstreamToTask[l.UpstreamTaskID]; !ok && l.TaskID != 0 {
			upstreamToTask[l.UpstreamTaskID] = l.TaskID
		}
		if l.TaskID != 0 && !taskSeen[l.TaskID] {
			taskSeen[l.TaskID] = true
			taskIDs = append(taskIDs, l.TaskID)
		}
	}
	if len(taskIDs) == 0 {
		return out
	}
	var tasks []struct {
		ID        idgen.ID
		PointCost int64
	}
	if err := db.Model(&model.AiTask{}).
		Select("id, point_cost").
		Where("id IN ?", taskIDs).
		Scan(&tasks).Error; err != nil {
		return out
	}
	costByTask := map[idgen.ID]int64{}
	for _, t := range tasks {
		costByTask[t.ID] = t.PointCost
	}
	for up, tid := range upstreamToTask {
		if cost, ok := costByTask[tid]; ok {
			out[up] = cost
		}
	}
	return out
}

// resolveUpstreamResult 异步/转存任务的结果兜底:沿 upstream_task_id 回查
// generation_logs 拿 task_id,再从 ai_tasks 取转存后的稳定 URL——
// result_meta.urls 是全量结果集(MXAPI 双图),result_meta.tracks 是 Suno
// 分轨(带标题)。优先用它们而不是响应体里的 relay 原始 URL:relay CDN
// 域名客户端可能被墙,转存后的本站 URL 永远可达。
func resolveUpstreamResult(db *gorm.DB, upstreamID string) []genAsset {
	if upstreamID == "" {
		return nil
	}
	var urls []genAsset
	seen := map[string]bool{}
	add := func(u, name string) {
		if u == "" || seen[u] {
			return
		}
		kind := kindOfURL(u)
		if kind == "" {
			kind = "image"
		}
		seen[u] = true
		urls = append(urls, genAsset{URL: u, Name: name, Kind: kind})
	}

	var gl model.AiGenerationLog
	if err := db.Where("upstream_task_id = ?", upstreamID).
		Order("id DESC").First(&gl).Error; err == nil {
		if gl.TaskID != 0 {
			var t model.AiTask
			if err := db.Select("result_url, result_meta").First(&t, "id = ?", gl.TaskID).Error; err == nil {
				// result_meta:{"urls":[…], "tracks":[{url,title,…}], …}
				if t.ResultMeta != "" {
					var meta struct {
						URLs   []string `json:"urls"`
						Tracks []struct {
							URL   string `json:"url"`
							Title string `json:"title"`
						} `json:"tracks"`
					}
					if json.Unmarshal([]byte(t.ResultMeta), &meta) == nil {
						for _, u := range meta.URLs {
							add(u, "")
						}
						for _, tr := range meta.Tracks {
							add(tr.URL, tr.Title)
						}
					}
				}
				add(t.ResultUrl, "")
			}
		}
		add(gl.ResultUrl, "")
	}
	return urls
}

// ---- VO + handlers -----------------------------------------------------------

// GenerationRowVO 是生成记录列表行。
type GenerationRowVO struct {
	ID             idgen.ID `json:"id"`
	UserID         idgen.ID `json:"userId"`
	Username       string   `json:"username"`
	Scene          string   `json:"scene"`
	Model          string   `json:"model"`
	ModelName      string   `json:"modelName"` // 目录显示名,查不到为空→前端回退 key
	Prompt         string   `json:"prompt"`
	Success        int      `json:"success"`
	HttpStatus     int      `json:"httpStatus"`
	ErrorMsg       string   `json:"errorMsg"`
	PointCost      *int64   `json:"pointCost"` // nil = 无计费记录（文本场景/未关联到任务）
	DurationMs     int64    `json:"durationMs"`
	UpstreamTaskID string   `json:"upstreamTaskId"`
	CreateTime     string   `json:"createTime"`
}

// GenerationDetailVO 是生成记录详情（结构化解析 + 原始报文）。
type GenerationDetailVO struct {
	GenerationRowVO
	StartTime    string     `json:"startTime"`
	Endpoint     string     `json:"endpoint"`
	Cost         string     `json:"cost"` // 上游成本（供应商侧,非平台积分）
	Params       []genParam `json:"params"`
	Inputs       []genAsset `json:"inputs"`
	Results      []genAsset `json:"results"`
	Reply        string     `json:"reply"`
	RequestBody  string     `json:"requestBody"`
	ResponseBody string     `json:"responseBody"`
}

// genListQuery 在共享分页参数上加日期范围。
type genListQuery struct {
	g5PageQuery
	StartDate string `form:"startDate"`
	EndDate   string `form:"endDate"`
}

// promptExcerpt 列表用的 prompt 摘要（限长,避免长 prompt 撑爆行）。
func promptExcerpt(p string, n int) string {
	p = strings.TrimSpace(p)
	r := []rune(p)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return p
}

// storageHosts 取当前存储策略的本站资产 host 列表（识别无扩展名的存储 URL）。
func storageHosts(d *app.Deps) []string {
	if d.Storage == nil {
		return nil
	}
	return d.Storage.FetchHosts()
}

// pointCostOf 取该行的平台积分口径:优先 point_cost 列(写日志时就地记录,
// 同步调用/文本场景也准);老数据列为 0 时回退 upstream 任务链反查。
// 返回 nil 表示无计费记录(前端显示「—」)。
func pointCostOf(r *model.ModelCallLog, chain map[string]int64) *int64 {
	if r.PointCost > 0 {
		v := r.PointCost
		return &v
	}
	if chain != nil {
		if cost, ok := chain[r.UpstreamTaskID]; ok && cost > 0 {
			v := cost
			return &v
		}
	}
	return nil
}

func listGenerations(c *gin.Context, d *app.Deps) {
	var q genListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	db := d.DB
	tx := applyUserFilter(db.Model(&model.ModelCallLog{}), q.UserID)
	if q.Scene != "" {
		tx = tx.Where("scene = ?", q.Scene)
	}
	if q.Success != "" {
		tx = tx.Where("success = ?", q.Success)
	}
	if q.Keyword != "" {
		tx = tx.Where("model LIKE ? OR request_body LIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}
	if t := g5ParseTime(&q.StartDate); !t.IsZero() {
		tx = tx.Where("create_time >= ?", t)
	}
	if t := g5ParseTime(&q.EndDate); !t.IsZero() {
		end := t
		if len(strings.TrimSpace(q.EndDate)) <= 10 {
			end = t.Add(24 * time.Hour) // 纯日期 → 含当天,右开区间
		}
		tx = tx.Where("create_time < ?", end)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count records")
		return
	}
	var rows []model.ModelCallLog
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list records")
		return
	}

	ids := make([]idgen.ID, 0, len(rows))
	ups := make([]string, 0, len(rows))
	keys := make([]string, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].UserID)
		ups = append(ups, rows[i].UpstreamTaskID)
		keys = append(keys, rows[i].Model)
	}
	names := resolveUserNames(db, ids)
	costs := resolvePointCosts(db, ups)
	modelNames := resolveModelNames(db, keys)
	hosts := storageHosts(d)

	vos := make([]GenerationRowVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		prompt := promptExcerpt(parseRequestBody(r.RequestBody, hosts).Prompt, 200)
		vos = append(vos, GenerationRowVO{
			ID: r.ID, UserID: r.UserID, Username: names[r.UserID], Scene: r.Scene, Model: r.Model,
			ModelName: modelNames[r.Model],
			Prompt:    prompt, Success: r.Success, HttpStatus: r.HttpStatus, ErrorMsg: r.ErrorMsg,
			PointCost:  pointCostOf(r, costs),
			DurationMs: r.DurationMs, UpstreamTaskID: r.UpstreamTaskID, CreateTime: g5FmtTime(r.CreateTime),
		})
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func generationDetail(c *gin.Context, d *app.Deps) {
	id, ok := g5ParseID(c)
	if !ok {
		return
	}
	db := d.DB
	var r model.ModelCallLog
	if err := db.First(&r, "id = ?", id).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "record not found")
		return
	}
	hosts := storageHosts(d)
	req := parseRequestBody(r.RequestBody, hosts)
	resp := parseResponseBody(r.Scene, r.ResponseBody, hosts)
	// 结果优先取转存后的本站 URL(稳定可达),查不到再用响应体里的原始 URL。
	if upstream := resolveUpstreamResult(db, r.UpstreamTaskID); len(upstream) > 0 {
		resp.Results = upstream
	}

	names := resolveUserNames(db, []idgen.ID{r.UserID})
	vo := GenerationDetailVO{
		GenerationRowVO: GenerationRowVO{
			ID: r.ID, UserID: r.UserID, Username: names[r.UserID], Scene: r.Scene, Model: r.Model,
			ModelName: resolveModelNames(db, []string{r.Model})[r.Model],
			Prompt:    req.Prompt, Success: r.Success, HttpStatus: r.HttpStatus, ErrorMsg: r.ErrorMsg,
			PointCost:      pointCostOf(&r, resolvePointCosts(db, []string{r.UpstreamTaskID})),
			DurationMs:     r.DurationMs,
			UpstreamTaskID: r.UpstreamTaskID, CreateTime: g5FmtTime(r.CreateTime),
		},
		StartTime:    g5FmtTime(r.StartTime),
		Endpoint:     r.Endpoint,
		Cost:         r.Cost,
		Params:       req.Params,
		Inputs:       req.Inputs,
		Results:      resp.Results,
		Reply:        resp.Reply,
		RequestBody:  r.RequestBody,
		ResponseBody: r.ResponseBody,
	}
	response.OK(c, vo)
}
