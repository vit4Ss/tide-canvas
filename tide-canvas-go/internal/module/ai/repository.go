package ai

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// Repository AI 模块数据访问（GORM）：provider / model / handler 配置 / task / generation_log。
// 逻辑删除由各模型 deleted 字段自动过滤（AiGenerationLog 无逻辑删除）。
type Repository struct {
	db *gorm.DB
}

// NewRepository 构造。
func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }

// CountActiveTasksByUser 统计某用户「进行中」的 AI 任务数（用于并发上限校验）。
// deleted 由模型自动过滤；processingStatus 传 TaskProcessing。
func (r *Repository) CountActiveTasksByUser(userID int64, processingStatus int) (int64, error) {
	var n int64
	err := r.db.Model(&model.AiTask{}).
		Where("user_id = ? AND status = ?", userID, processingStatus).
		Count(&n).Error
	return n, err
}

// GetConfigInt 读取 sys_config 的整数配置；未配置 / 空值 / 非法时返回 def。
func (r *Repository) GetConfigInt(key string, def int) int {
	var cfg model.SysConfig
	if err := r.db.Where("config_key = ?", key).First(&cfg).Error; err != nil {
		return def
	}
	v := strings.TrimSpace(cfg.ConfigValue)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// GetConfigStr 读取 sys_config 字符串配置；未配置返回空串。
func (r *Repository) GetConfigStr(key string) string {
	var cfg model.SysConfig
	if err := r.db.Where("config_key = ?", key).First(&cfg).Error; err != nil {
		return ""
	}
	return cfg.ConfigValue
}

// GetUserTier 取用户等级信息（role / 会员等级 vip_level / 是否免并发限制 concurrency_unlimited），
// 用于并发上限分档与用户级豁免。
func (r *Repository) GetUserTier(userID int64) (role int, vipLevel int, concurrencyUnlimited int) {
	var u model.SysUser
	if err := r.db.Select("role", "vip_level", "concurrency_unlimited").First(&u, userID).Error; err != nil {
		return 0, 0, 0
	}
	return u.Role, u.VipLevel, u.ConcurrencyUnlimited
}

// DB 暴露底层连接（供上层做事务）。
func (r *Repository) DB() *gorm.DB { return r.db }

// =====================================================================
// Provider 供应商
// =====================================================================

// FindProviderByID 按主键查询供应商，未找到返回 (nil, nil)。
func (r *Repository) FindProviderByID(id int64) (*model.AiProvider, error) {
	var p model.AiProvider
	err := r.db.First(&p, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ListProvidersByPriority 全部供应商，按 priority 升序（管理列表，对齐 listProviders）。
func (r *Repository) ListProvidersByPriority() ([]model.AiProvider, error) {
	var list []model.AiProvider
	err := r.db.Order("priority ASC").Find(&list).Error
	return list, err
}

// TopEnabledProvider 取优先级最高的启用供应商（status=1，priority DESC LIMIT 1，对齐 resolveProvider 兜底）。
func (r *Repository) TopEnabledProvider() (*model.AiProvider, error) {
	var p model.AiProvider
	err := r.db.Where("status = ?", 1).Order("priority DESC").First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreateProvider 新增供应商（主键由模型 BeforeCreate 注入）。
func (r *Repository) CreateProvider(p *model.AiProvider) error {
	return r.db.Create(p).Error
}

// UpdateProviderColumns 局部更新供应商指定列。
func (r *Repository) UpdateProviderColumns(id int64, columns map[string]interface{}) error {
	if len(columns) == 0 {
		return nil
	}
	return r.db.Model(&model.AiProvider{}).Where("id = ?", id).Updates(columns).Error
}

// DeleteProvider 逻辑删除供应商（GORM 软删除，对齐 deleteById）。
func (r *Repository) DeleteProvider(id int64) error {
	return r.db.Delete(&model.AiProvider{}, id).Error
}

// =====================================================================
// Model 模型
// =====================================================================

// FindModelByPublicID 按 public_id 查询模型，未找到返回 (nil, nil)。
func (r *Repository) FindModelByPublicID(publicID string) (*model.AiModel, error) {
	var m model.AiModel
	err := r.db.Where("public_id = ?", publicID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// FindModelByID 按主键查询模型，未找到返回 (nil, nil)。
func (r *Repository) FindModelByID(id int64) (*model.AiModel, error) {
	var m model.AiModel
	err := r.db.First(&m, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// FindModelByModelID 按上游模型标识 model_id 查询（对齐 modelMapper.selectOne(eq model_id)），未找到返回 (nil, nil)。
func (r *Repository) FindModelByModelID(modelID string) (*model.AiModel, error) {
	var m model.AiModel
	err := r.db.Where("model_id = ?", modelID).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// FirstEnabledModelByProvider 取某供应商下首个启用模型（status=1 LIMIT 1，对齐 resolveModelName 兜底），未找到返回 (nil, nil)。
func (r *Repository) FirstEnabledModelByProvider(providerID int64) (*model.AiModel, error) {
	var m model.AiModel
	err := r.db.Where("provider_id = ? AND status = ?", providerID, 1).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// ListEnabledModels 全部启用模型（status=1，用户侧 listModels）。
func (r *Repository) ListEnabledModels() ([]model.AiModel, error) {
	var list []model.AiModel
	err := r.db.Where("status = ?", 1).Find(&list).Error
	return list, err
}

// ListAllModels 全部模型（管理列表，对齐 modelMapper.selectList(null)）。
func (r *Repository) ListAllModels() ([]model.AiModel, error) {
	var list []model.AiModel
	err := r.db.Find(&list).Error
	return list, err
}

// CreateModel 新增模型（public_id/主键由模型 BeforeCreate 注入）。
func (r *Repository) CreateModel(m *model.AiModel) error {
	return r.db.Create(m).Error
}

// UpdateModelColumns 局部更新模型指定列。
// 注意：supported_handlers 需要写 NULL（语义「不限制」）时用本方法（map 值传 nil 即写 NULL）。
func (r *Repository) UpdateModelColumns(id int64, columns map[string]interface{}) error {
	if len(columns) == 0 {
		return nil
	}
	return r.db.Model(&model.AiModel{}).Where("id = ?", id).Updates(columns).Error
}

// DeleteModel 逻辑删除模型。
func (r *Repository) DeleteModel(id int64) error {
	return r.db.Delete(&model.AiModel{}, id).Error
}

// ProviderNames 返回 providerID → name 映射（管理端模型列表展示用，对齐 listModels 的关联填充）。
func (r *Repository) ProviderNames() (map[int64]string, error) {
	var list []model.AiProvider
	if err := r.db.Select("id", "name").Find(&list).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]string, len(list))
	for i := range list {
		if _, ok := m[list[i].ID]; ok {
			continue
		}
		m[list[i].ID] = list[i].Name
	}
	return m, nil
}

// =====================================================================
// Handler 配置
// =====================================================================

// FindHandlerConfig 按 handler_name 查询 Handler 配置，未找到返回 (nil, nil)。
func (r *Repository) FindHandlerConfig(name string) (*model.AiHandlerConfig, error) {
	var c model.AiHandlerConfig
	err := r.db.Where("handler_name = ?", name).First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ListEnabledHandlers 启用的 Handler 配置，按 sort_order 升序（用户侧 listHandlers，对齐 status=1 orderByAsc sortOrder）。
func (r *Repository) ListEnabledHandlers() ([]model.AiHandlerConfig, error) {
	var list []model.AiHandlerConfig
	err := r.db.Where("status = ?", 1).Order("sort_order ASC").Find(&list).Error
	return list, err
}

// ListAllHandlers 全部 Handler 配置，按 sort_order 升序（管理列表）。
func (r *Repository) ListAllHandlers() ([]model.AiHandlerConfig, error) {
	var list []model.AiHandlerConfig
	err := r.db.Order("sort_order ASC").Find(&list).Error
	return list, err
}

// UpdateHandlerColumns 局部更新 Handler 配置指定列（按 handler_name）。
func (r *Repository) UpdateHandlerColumns(name string, columns map[string]interface{}) error {
	if len(columns) == 0 {
		return nil
	}
	return r.db.Model(&model.AiHandlerConfig{}).Where("handler_name = ?", name).Updates(columns).Error
}

// =====================================================================
// Task 任务
// =====================================================================

// FindTaskByID 按主键查询任务，未找到返回 (nil, nil)。
func (r *Repository) FindTaskByID(id int64) (*model.AiTask, error) {
	var t model.AiTask
	err := r.db.First(&t, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// FindTaskByPublicID 按 public_id 查询任务，未找到返回 (nil, nil)。
func (r *Repository) FindTaskByPublicID(publicID string) (*model.AiTask, error) {
	var t model.AiTask
	err := r.db.Where("public_id = ?", publicID).First(&t).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateTask 新增任务（public_id/主键由模型 BeforeCreate 注入）。须在事务中与扣分一起执行。
func (r *Repository) CreateTask(tx *gorm.DB, t *model.AiTask) error {
	return tx.Create(t).Error
}

// SaveTaskResult 任务完成后整行回写状态/结果（对齐 taskMapper.updateById）。
func (r *Repository) SaveTaskResult(t *model.AiTask) error {
	return r.db.Model(&model.AiTask{}).Where("id = ?", t.ID).Updates(map[string]interface{}{
		"status":        t.Status,
		"result_url":    t.ResultURL,
		"result_meta":   t.ResultMeta,
		"error_msg":     t.ErrorMsg,
		"progress":      t.Progress,
		"complete_time": t.CompleteTime,
	}).Error
}

// CancelIfProcessing CAS 取消：仅当 (id,user,处理中) 时置为已取消，返回受影响行数
// （对齐 AiTaskMapper.cancelIfProcessing）。
func (r *Repository) CancelIfProcessing(taskID, userID int64) (int64, error) {
	res := r.db.Model(&model.AiTask{}).
		Where("id = ? AND user_id = ? AND status = ?", taskID, userID, TaskProcessing).
		Updates(map[string]interface{}{
			"status":        TaskCancelled,
			"complete_time": time.Now(),
		})
	return res.RowsAffected, res.Error
}

// UpdateProgressIfProcessing 仅处理中状态回写进度（对齐 AiTaskMapper.updateProgress）。
func (r *Repository) UpdateProgressIfProcessing(taskID int64, progress int) error {
	return r.db.Model(&model.AiTask{}).
		Where("id = ? AND status = ?", taskID, TaskProcessing).
		Update("progress", progress).Error
}

// PageTasks 任务分页（团队共享：归属用户在 ownerIDs 内），按 create_time 倒序（对齐 listTasks）。
// handler/status/projectID 可选过滤；projectID 为 nil 表示不限项目。
func (r *Repository) PageTasks(ownerIDs []int64, handler string, status *int, projectID *int64, q *PageQuery) ([]model.AiTask, int64, error) {
	if len(ownerIDs) == 0 {
		return []model.AiTask{}, 0, nil
	}
	tx := r.db.Model(&model.AiTask{}).Where("user_id IN ?", ownerIDs)
	if handler != "" {
		tx = tx.Where("handler_name = ?", handler)
	}
	if status != nil {
		tx = tx.Where("status = ?", *status)
	}
	if projectID != nil {
		tx = tx.Where("project_id = ?", *projectID)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.AiTask
	if err := tx.Order("create_time DESC").
		Offset(q.Offset()).Limit(q.PageSize).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// ModelNames 返回 modelID(主键) → name 映射（任务列表 modelName 回填）。
func (r *Repository) ModelNames(ids []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var list []model.AiModel
	if err := r.db.Select("id", "name").Where("id IN ?", ids).Find(&list).Error; err != nil {
		return nil, err
	}
	for i := range list {
		result[list[i].ID] = list[i].Name
	}
	return result, nil
}

// ListProcessingBefore 列出 create_time 早于 before 且仍处理中的任务（启动/超时收尾，对齐 failProcessingBefore）。
func (r *Repository) ListProcessingBefore(before time.Time) ([]model.AiTask, error) {
	var list []model.AiTask
	err := r.db.Where("status = ? AND create_time < ?", TaskProcessing, before).Find(&list).Error
	return list, err
}

// FailIfProcessing CAS 收尾：仅当 (id,处理中) 时置失败，返回受影响行数（对齐收尾器的乐观更新）。
func (r *Repository) FailIfProcessing(taskID int64, reason string) (int64, error) {
	res := r.db.Model(&model.AiTask{}).
		Where("id = ? AND status = ?", taskID, TaskProcessing).
		Updates(map[string]interface{}{
			"status":        TaskFailed,
			"error_msg":     reason,
			"progress":      100,
			"complete_time": time.Now(),
		})
	return res.RowsAffected, res.Error
}

// =====================================================================
// 积分流水（任务退款幂等 / 收尾退款金额计算，对齐 AiTaskRecoveryRunner.refundIfNeeded）
// =====================================================================

// CountRefundByTask 统计某任务已存在的退款流水条数（AI_REFUND），>0 表示已退过。
func (r *Repository) CountRefundByTask(taskID int64) (int64, error) {
	var n int64
	err := r.db.Model(&model.PointsTransaction{}).
		Where("biz_id = ? AND type = ?", taskID, txTypeAIRefund).Count(&n).Error
	return n, err
}

// SumConsumeByTask 汇总某任务 AI 消耗扣分的绝对值之和（退款金额）。
func (r *Repository) SumConsumeByTask(taskID int64) (int, error) {
	var consumes []model.PointsTransaction
	if err := r.db.Where("biz_id = ? AND type = ?", taskID, txTypeAIConsume).Find(&consumes).Error; err != nil {
		return 0, err
	}
	sum := 0
	for i := range consumes {
		a := consumes[i].Amount
		if a < 0 {
			a = -a
		}
		sum += a
	}
	return sum, nil
}

// =====================================================================
// 生成 / 操作日志
// =====================================================================

// InsertLog 插入一条生成/操作日志（best-effort，由调用方吞错）。
func (r *Repository) InsertLog(lg *model.AiGenerationLog) error {
	return r.db.Create(lg).Error
}

// FindLogByID 按主键查询日志，未找到返回 (nil, nil)。
func (r *Repository) FindLogByID(id int64) (*model.AiGenerationLog, error) {
	var lg model.AiGenerationLog
	err := r.db.First(&lg, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &lg, nil
}

// PageLogsByOwners 用户侧日志分页（团队共享：user_id IN ownerIDs，可按 projectID 过滤），按 id 倒序
// （对齐 AiController.myLogs）。
func (r *Repository) PageLogsByOwners(ownerIDs []int64, projectID *int64, q *PageQuery) ([]model.AiGenerationLog, int64, error) {
	if len(ownerIDs) == 0 {
		return []model.AiGenerationLog{}, 0, nil
	}
	tx := r.db.Model(&model.AiGenerationLog{}).Where("user_id IN ?", ownerIDs)
	if projectID != nil {
		tx = tx.Where("project_id = ?", *projectID)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.AiGenerationLog
	if err := tx.Order("id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// logFilter 构建管理端日志查询条件（列表与成本汇总共用，保证筛选一致，对齐 AdminAiController.logFilter）。
func (r *Repository) logFilter(q *GenerationLogQuery) *gorm.DB {
	tx := r.db.Model(&model.AiGenerationLog{})
	if q.TaskID != nil {
		tx = tx.Where("task_id = ?", *q.TaskID)
	}
	if q.UserID != nil {
		tx = tx.Where("user_id = ?", *q.UserID)
	}
	if q.ProjectID != nil {
		tx = tx.Where("project_id = ?", *q.ProjectID)
	}
	if q.HandlerName != "" {
		tx = tx.Where("handler_name = ?", q.HandlerName)
	}
	if q.OperationType != "" {
		tx = tx.Where("operation_type = ?", q.OperationType)
	}
	if q.Success != nil {
		tx = tx.Where("success = ?", *q.Success)
	}
	return tx
}

// PageLogsAdmin 管理端日志分页（全字段过滤），按 id 倒序（对齐 AdminAiController.listLogs）。
func (r *Repository) PageLogsAdmin(q *GenerationLogQuery) ([]model.AiGenerationLog, int64, error) {
	var total int64
	if err := r.logFilter(q).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.AiGenerationLog
	if err := r.logFilter(q).Order("id DESC").
		Offset(q.Offset()).Limit(q.PageSize).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	return records, total, nil
}

// SumLogsCost 按当前筛选条件统计上游成本汇总（USD），对齐 AdminAiController.logsCostSum。
func (r *Repository) SumLogsCost(q *GenerationLogQuery) (string, error) {
	var sum string
	err := r.logFilter(q).Select("COALESCE(SUM(cost),0)").Scan(&sum).Error
	return sum, err
}

// ProjectNames 返回 projectID → name 映射（日志列表回填，对齐 enrich）。
func (r *Repository) ProjectNames(ids []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var list []model.CanvasProject
	if err := r.db.Select("id", "name").Where("id IN ?", ids).Find(&list).Error; err != nil {
		return nil, err
	}
	for i := range list {
		result[list[i].ID] = list[i].Name
	}
	return result, nil
}

// TaskStatuses 返回 taskID → status 映射（日志列表回填，对齐 enrich）。
func (r *Repository) TaskStatuses(ids []int64) (map[int64]int, error) {
	result := make(map[int64]int, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	type row struct {
		ID     int64
		Status int
	}
	var rows []row
	if err := r.db.Model(&model.AiTask{}).Select("id", "status").Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, x := range rows {
		result[x.ID] = x.Status
	}
	return result, nil
}

// TaskInputParams 取任务的 input_params（日志详情回填，对齐 getLog）。
func (r *Repository) TaskInputParams(taskID int64) (string, error) {
	type row struct {
		InputParams string
	}
	var x row
	err := r.db.Model(&model.AiTask{}).Select("input_params").Where("id = ?", taskID).Take(&x).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	return x.InputParams, err
}
