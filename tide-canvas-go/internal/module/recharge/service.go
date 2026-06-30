package recharge

import (
	"errors"
	"math/rand"
	"strconv"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

// sys_config 配置项 key（对齐 PaymentServiceImpl / OrderServiceImpl 常量）。
const (
	keyEnabled            = "pay.epay.enabled"
	keyGateway            = "pay.epay.gateway"
	keyPID                = "pay.epay.pid"
	keyMerchantPrivateKey = "pay.epay.merchant_private_key"
	keyPlatformPublicKey  = "pay.epay.platform_public_key"
	keyNotifyURL          = "pay.epay.notify_url"
	keyReturnURL          = "pay.epay.return_url"
	keyPayTypes           = "pay.epay.pay_types"
	keyRechargeRatio      = "points.recharge.ratio"
)

// configKeys 一次性加载的全部配置项（对齐 CONFIG_KEYS）。
var configKeys = []string{
	keyEnabled, keyGateway, keyPID, keyMerchantPrivateKey,
	keyPlatformPublicKey, keyNotifyURL, keyReturnURL, keyPayTypes,
	keyRechargeRatio,
}

const (
	// defaultRechargeRatio 默认充值比例：1 元 = 100 积分（对齐 DEFAULT_RECHARGE_RATIO）。
	defaultRechargeRatio = 100

	// txTypeRecharge 积分交易类型「充值」（对齐 points.TxRecharge = 1，避免直接耦合 points 包）。
	txTypeRecharge = 1

	// tradeSuccess 易支付通知交易成功标记（对齐 TRADE_SUCCESS）。
	tradeSuccess = "TRADE_SUCCESS"
	// notifySuccess 通知应答：已受理（对齐 NOTIFY_SUCCESS）。
	notifySuccess = "success"
	// notifyFail 通知应答：失败，网关将重试（对齐 NOTIFY_FAIL）。
	notifyFail = "fail"

	// notifyTimestampToleranceSeconds 通知时间戳允许的最大偏差(秒)，防重放（对齐 NOTIFY_TIMESTAMP_TOLERANCE_SECONDS）。
	notifyTimestampToleranceSeconds = 900

	// orderTimeoutMinutes 支付超时分钟数（对齐 OrderTimeoutTask.TIMEOUT_MINUTES）。
	orderTimeoutMinutes = 15
)

// Service 充值订单 + 易支付业务（对齐 OrderServiceImpl + PaymentServiceImpl）。业务错误返回 *ecode.Error。
//
// 事务边界与旧实现一致：创建订单 / 入账确认 / 取消订单走事务；发起支付 / 回调 / 查单同步含网关 HTTP 调用，
// 不占用数据库事务，落库统一走 confirmOrderPaid（自带事务 + 幂等条件更新）。
type Service struct {
	repo   *Repository
	db     *gorm.DB
	points PointsService
	logger logger
}

// NewService 构造充值服务。points 为支付成功加积分能力（由 router 注入 points.Service）；logger 可为 nil。
func NewService(repo *Repository, points PointsService, logger *logrus.Logger) *Service {
	return &Service{repo: repo, db: repo.DB(), points: points, logger: resolveLogger(logger)}
}

// ===== 订单（对齐 OrderServiceImpl） =====

// CreateOrder 创建充值订单（事务）。按充值比例换算积分，向下取整（对齐 createOrder）。
func (s *Service) CreateOrder(userID int64, req *RechargeCreateReq) (*RechargeOrderVO, error) {
	if err := validateRechargeAmount(req.Amount); err != nil {
		return nil, err
	}
	if len([]rune(req.PaymentMethod)) > 16 {
		return nil, ecode.BadRequest.WithMessage("支付方式无效")
	}

	ratio := s.rechargeRatio()
	// pointsAmount = floor(amount * ratio)（对齐 setScale(0, DOWN)）。
	pointsAmount := int(req.Amount.Mul(decimal.NewFromInt(int64(ratio))).Truncate(0).IntPart())

	order := &model.RechargeOrder{
		OrderNo:       generateOrderNo(),
		UserID:        userID,
		Amount:        req.Amount,
		PointsAmount:  pointsAmount,
		PaymentMethod: req.PaymentMethod,
		Status:        StatusPending,
	}
	if err := s.repo.Create(order); err != nil {
		return nil, err
	}
	s.logger.Infof("Recharge order created: orderNo=%s, userId=%d, amount=%s, pointsAmount=%d",
		order.OrderNo, userID, req.Amount.String(), pointsAmount)
	return toOrderVO(order), nil
}

// CancelOrder 取消订单（事务 + 条件更新防并发，对齐 cancelOrder）。
func (s *Service) CancelOrder(userID int64, publicID string) error {
	order, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if order == nil {
		return ecode.NotFound.WithMessage("订单不存在")
	}
	if order.UserID != userID {
		return ecode.Forbidden.WithMessage("无权操作该订单")
	}
	// 条件更新防并发：避免「取消」与「支付回调」竞态时覆盖已支付状态。
	updated, err := s.repo.MarkCancelledIfPending(order.ID, StatusPending, StatusCancelled)
	if err != nil {
		return err
	}
	if updated == 0 {
		return ecode.OrderStatusError
	}
	s.logger.Infof("Recharge order cancelled: orderNo=%s, userId=%d", order.OrderNo, userID)
	return nil
}

// GetUserOrder 获取用户订单详情（校验所属权，对齐 getUserOrder）。
func (s *Service) GetUserOrder(userID int64, publicID string) (*RechargeOrderVO, error) {
	order, err := s.requireOrder(publicID)
	if err != nil {
		return nil, err
	}
	if order.UserID != userID {
		return nil, ecode.Forbidden.WithMessage("无权查看该订单")
	}
	return toOrderVO(order), nil
}

// ListOrders 分页查询用户订单列表（对齐 listOrders）。
func (s *Service) ListOrders(userID int64, q *OrderQuery) ([]RechargeOrderVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageUserOrders(userID, q)
	if err != nil {
		return nil, 0, err
	}
	vos, err := s.toOrderVOList(records)
	return vos, total, err
}

// ListAllOrders 管理端分页查询全部订单列表（对齐 listAllOrders）。
func (s *Service) ListAllOrders(q *AdminOrderQuery) ([]RechargeOrderVO, int64, error) {
	q.normalize()
	records, total, err := s.repo.PageAllOrders(q)
	if err != nil {
		return nil, 0, err
	}
	vos, err := s.toOrderVOList(records)
	return vos, total, err
}

// GetOrderForAdmin 管理端按 public_id 查订单详情（不校验所属用户，对齐管理端 selectById）。
func (s *Service) GetOrderForAdmin(publicID string) (*RechargeOrderVO, error) {
	order, err := s.requireOrder(publicID)
	if err != nil {
		return nil, err
	}
	return toOrderVO(order), nil
}

// AdminConfirmPaid 管理端手动确认订单已支付（线下/未收到回调时人工入账）。
// 复用 confirmOrderPaid 的幂等条件更新 + 发积分（paymentMethod 记为 manual），返回入账后的最新订单。
func (s *Service) AdminConfirmPaid(publicID string) (*RechargeOrderVO, error) {
	order, err := s.requireOrder(publicID)
	if err != nil {
		return nil, err
	}
	method := "manual"
	if _, err := s.confirmOrderPaid(order.ID, nil, &method); err != nil {
		return nil, err
	}
	latest, err := s.repo.FindByID(order.ID)
	if err != nil {
		return nil, err
	}
	if latest == nil {
		return nil, ecode.NotFound.WithMessage("订单不存在")
	}
	return toOrderVO(latest), nil
}

// confirmOrderPaid 幂等确认订单已支付：仅当订单处于「待支付/已超时」时标记已支付并发放积分（对齐 doConfirmPaid）。
//
// 幂等核心是条件更新 markPaidIfPayable：WHERE status IN(待支付,已超时) 的影响行数为 1 时才发积分，
// 并发/重复调用下保证「待支付/超时 → 已支付」的状态跃迁只发生一次，故积分只发一次。
//
// 事务边界：本方法用 s.db.Transaction 包裹「条件更新 + 加积分」，二者复用同一 tx（积分变动改用 AddPointsTx），
// 为同一物理事务——加积分失败则连同状态更新一起回滚（订单维持可入账，等网关重试），不会出现「订单已支付却没加积分」
// 或「加了积分但状态未提交」的中间态。防重复入账仍由上面的条件更新（影响行数=1 才发分）保证。
//
// 返回 true=本次完成支付确认；false=订单已不在可入账状态（未做任何变更）。
func (s *Service) confirmOrderPaid(orderID int64, paymentNo, paymentMethod *string) (bool, error) {
	confirmed := false
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var order model.RechargeOrder
		if err := tx.First(&order, orderID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ecode.NotFound.WithMessage("订单不存在")
			}
			return err
		}
		updated, err := s.repo.MarkPaidIfPayable(tx, orderID, StatusPending, StatusTimeout, StatusPaid, paymentNo, paymentMethod)
		if err != nil {
			return err
		}
		if updated == 0 {
			return nil
		}
		// 加积分并写流水：用 *Tx 变体复用本事务（points 内部对 sys_user 行加锁）。bizID 传订单主键。
		bizID := order.ID
		remark := "充值订单: " + order.OrderNo
		if err := s.points.AddPointsTx(tx, order.UserID, order.PointsAmount, txTypeRecharge, &bizID, remark); err != nil {
			return err
		}
		confirmed = true
		s.logger.Infof("Recharge order paid: orderNo=%s, userId=%d, pointsAmount=%d, paymentNo=%s",
			order.OrderNo, order.UserID, order.PointsAmount, derefOr(paymentNo, ""))
		return nil
	})
	if err != nil {
		return false, err
	}
	return confirmed, nil
}

// CloseTimeoutOrders 关闭超时未支付订单：把创建早于 (now - 15min) 仍待支付的订单标记为已超时，返回关闭笔数
// （对齐 OrderTimeoutTask.closeTimeoutOrders，供定时任务调用）。
func (s *Service) CloseTimeoutOrders() (int64, error) {
	cutoff := time.Now().Add(-orderTimeoutMinutes * time.Minute)
	closed, err := s.repo.MarkTimeoutBeforeCutoff(StatusPending, StatusTimeout, cutoff)
	if err != nil {
		s.logger.Warnf("订单超时任务执行失败: %v", err)
		return 0, err
	}
	if closed > 0 {
		s.logger.Infof("订单超时关闭: %d 笔(创建早于 %s)", closed, cutoff.Format(dateTimeLayout))
	}
	return closed, nil
}

// ===== 支付（对齐 PaymentServiceImpl） =====

// GetRechargeConfig 获取充值配置（充值比例、在线支付开关、可用支付方式，对齐 getRechargeConfig）。
func (s *Service) GetRechargeConfig() (*RechargeConfigVO, error) {
	configs, err := s.loadConfigMap()
	if err != nil {
		return nil, err
	}
	epay := toEpayConfig(configs)
	return &RechargeConfigVO{
		Ratio:            parseRatio(configs[keyRechargeRatio], s.logger),
		OnlinePayEnabled: epay.Enabled && epay.isComplete(),
		PayTypes:         epay.PayTypes,
	}, nil
}

// InitiatePay 发起在线支付：校验订单后构建网关跳转参数（对齐 initiatePay）。
func (s *Service) InitiatePay(userID int64, publicID, payType string) (*PaymentInitiateVO, error) {
	configs, err := s.loadConfigMap()
	if err != nil {
		return nil, err
	}
	config := toEpayConfig(configs)
	if !config.Enabled {
		return nil, ecode.PaymentDisabled
	}
	if !config.isComplete() {
		return nil, ecode.PaymentConfigError
	}

	order, err := s.requireOrder(publicID)
	if err != nil {
		return nil, err
	}
	if order.UserID != userID {
		return nil, ecode.Forbidden.WithMessage("无权操作该订单")
	}
	if order.Status != StatusPending {
		return nil, ecode.OrderStatusError
	}

	resolvedType := payType
	if strings.TrimSpace(resolvedType) == "" {
		resolvedType = order.PaymentMethod
	}
	// 不在启用列表内则交给网关收银台，避免直接报错挡住老订单（对齐 initiatePay）。
	if strings.TrimSpace(resolvedType) != "" && len(config.PayTypes) > 0 && !containsString(config.PayTypes, resolvedType) {
		resolvedType = ""
	}
	if strings.TrimSpace(resolvedType) != "" && resolvedType != order.PaymentMethod {
		if err := s.repo.UpdatePaymentMethod(order.ID, resolvedType); err != nil {
			return nil, err
		}
	}

	productName := "积分充值" + strconv.Itoa(order.PointsAmount) + "分"
	params, err := buildSubmitParams(config, order.OrderNo, order.Amount, productName, resolvedType)
	if err != nil {
		// 私钥格式/内容错误属于配置问题，转为明确的业务提示而非 500（对齐 catch IllegalStateException）。
		s.logger.Errorf("Epay sign failed, check merchant private key: %v", err)
		return nil, ecode.PaymentConfigError
	}

	s.logger.Infof("Payment initiated: orderNo=%s, userId=%d, type=%s", order.OrderNo, userID, resolvedType)
	return &PaymentInitiateVO{
		PayURL:  epaySubmitURL(config),
		Params:  params,
		OrderNo: order.OrderNo,
	}, nil
}

// HandleNotify 处理易支付异步通知：验签 → pid/时间戳/金额校验 → 幂等入账（对齐 handleNotify）。
// 返回 success=已受理；其他=失败（网关将重试）。任何异常均吞掉并返回 fail，避免 500 触发无意义重试风暴。
func (s *Service) HandleNotify(params map[string]string) string {
	configs, err := s.loadConfigMap()
	if err != nil {
		s.logger.Errorf("Epay notify load config error: %v", err)
		return notifyFail
	}
	config := toEpayConfig(configs)
	if !config.isComplete() {
		s.logger.Warnf("Epay notify received but config incomplete")
		return notifyFail
	}

	sign := params["sign"]
	content := buildSignContent(params)
	if !verifyRSA(content, sign, config.PlatformPublicKey) {
		s.logger.Warnf("Epay notify sign verify failed: outTradeNo=%s", params["out_trade_no"])
		return notifyFail
	}
	if config.PID != params["pid"] {
		s.logger.Warnf("Epay notify pid mismatch: got=%s", params["pid"])
		return notifyFail
	}
	if !isTimestampValid(params["timestamp"]) {
		s.logger.Warnf("Epay notify timestamp out of range: ts=%s, outTradeNo=%s", params["timestamp"], params["out_trade_no"])
		return notifyFail
	}
	if params["trade_status"] != tradeSuccess {
		// 非成功状态确认收到即可，避免网关对无需处理的通知反复重试。
		return notifySuccess
	}

	outTradeNo := params["out_trade_no"]
	order, err := s.repo.FindByOrderNo(outTradeNo)
	if err != nil {
		s.logger.Errorf("Epay notify query order error: outTradeNo=%s, err=%v", outTradeNo, err)
		return notifyFail
	}
	if order == nil {
		s.logger.Warnf("Epay notify for unknown order: outTradeNo=%s", outTradeNo)
		return notifyFail
	}
	notifyMoney, err := decimal.NewFromString(strings.TrimSpace(params["money"]))
	if err != nil {
		s.logger.Warnf("Epay notify invalid money: %s", params["money"])
		return notifyFail
	}
	if !order.Amount.Equal(notifyMoney) {
		s.logger.Errorf("Epay notify money mismatch: orderNo=%s, expect=%s, got=%s",
			outTradeNo, order.Amount.String(), notifyMoney.String())
		return notifyFail
	}

	confirmed, err := s.confirmOrderPaid(order.ID, strPtr(params["trade_no"]), strPtr(params["type"]))
	if err != nil {
		s.logger.Errorf("Epay notify handle error: orderNo=%s, err=%v", outTradeNo, err)
		return notifyFail
	}
	if confirmed {
		return notifySuccess
	}
	// 未发生变更：已支付的重复通知按成功应答；已取消等异常状态留给网关重试并告警。
	latest, err := s.repo.FindByID(order.ID)
	if err != nil {
		s.logger.Errorf("Epay notify reload order error: orderNo=%s, err=%v", outTradeNo, err)
		return notifyFail
	}
	alreadyPaid := latest != nil && latest.Status == StatusPaid
	if !alreadyPaid {
		latestStatus := -1
		if latest != nil {
			latestStatus = latest.Status
		}
		s.logger.Errorf("Epay notify on non-pending order: orderNo=%s, status=%d", outTradeNo, latestStatus)
	}
	if alreadyPaid {
		return notifySuccess
	}
	return notifyFail
}

// SyncOrderStatus 主动向网关查单同步支付状态（用户支付完成后未收到回调时的补偿，对齐 syncOrderStatus）。
func (s *Service) SyncOrderStatus(userID int64, publicID string) (*RechargeOrderVO, error) {
	order, err := s.requireOrder(publicID)
	if err != nil {
		return nil, err
	}
	if order.UserID != userID {
		return nil, ecode.Forbidden.WithMessage("无权操作该订单")
	}
	if order.Status != StatusPending {
		return toOrderVO(order), nil
	}

	configs, err := s.loadConfigMap()
	if err != nil {
		return nil, err
	}
	config := toEpayConfig(configs)
	if !config.isComplete() {
		return nil, ecode.PaymentConfigError
	}
	status, err := queryOrder(config, order.OrderNo)
	if err != nil {
		return nil, err
	}
	if status.isPaid() {
		if _, err := s.confirmOrderPaid(order.ID, strPtr(status.TradeNo), nil); err != nil {
			return nil, err
		}
		s.logger.Infof("Order synced as paid via query: orderNo=%s", order.OrderNo)
	}
	// 重新读取最新订单返回（入账后状态已变更）。
	latest, err := s.repo.FindByID(order.ID)
	if err != nil {
		return nil, err
	}
	if latest == nil {
		return nil, ecode.NotFound.WithMessage("订单不存在")
	}
	return toOrderVO(latest), nil
}

// ===== 内部辅助 =====

// requireOrder 按 public_id 读取订单，不存在返回 404（对齐 selectById + NOT_FOUND 校验）。
func (s *Service) requireOrder(publicID string) (*model.RechargeOrder, error) {
	order, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if order == nil {
		return nil, ecode.NotFound.WithMessage("订单不存在")
	}
	return order, nil
}

// loadConfigMap 一次性加载 pay.epay.* 与充值比例配置（对齐 loadConfigMap）。
func (s *Service) loadConfigMap() (map[string]string, error) {
	return s.repo.FindConfigValues(configKeys)
}

// rechargeRatio 读取充值比例，未配置/非法返回默认 100（对齐 getRechargeRatio）。
func (s *Service) rechargeRatio() int {
	configs, err := s.loadConfigMap()
	if err != nil {
		s.logger.Warnf("load recharge ratio config error: %v", err)
		return defaultRechargeRatio
	}
	return parseRatio(configs[keyRechargeRatio], s.logger)
}

// validateRechargeAmount 校验充值金额：0.01 <= amount <= 100000（对齐 RechargeCreateDTO 的 @DecimalMin/@DecimalMax/@NotNull）。
func validateRechargeAmount(amount decimal.Decimal) error {
	minAmount := decimal.RequireFromString("0.01")
	maxAmount := decimal.NewFromInt(100000)
	if amount.LessThan(minAmount) {
		return ecode.BadRequest.WithMessage("充值金额最小为0.01")
	}
	if amount.GreaterThan(maxAmount) {
		return ecode.BadRequest.WithMessage("单笔充值金额不能超过100000元")
	}
	return nil
}

// toEpayConfig 将配置 map 解析为 epayConfig（对齐 toEpayConfig）。
func toEpayConfig(configs map[string]string) *epayConfig {
	enabled, _ := strconv.ParseBool(strings.TrimSpace(getOrDefault(configs, keyEnabled, "false")))
	cfg := &epayConfig{
		Enabled:            enabled,
		Gateway:            trimToEmpty(configs[keyGateway]),
		PID:                trimToEmpty(configs[keyPID]),
		MerchantPrivateKey: trimToEmpty(configs[keyMerchantPrivateKey]),
		PlatformPublicKey:  trimToEmpty(configs[keyPlatformPublicKey]),
		NotifyURL:          trimToEmpty(configs[keyNotifyURL]),
		ReturnURL:          trimToEmpty(configs[keyReturnURL]),
		// 初始化为非 nil 空切片：对齐旧 Collectors.toList()，JSON 渲染为 [] 而非 null。
		PayTypes: []string{},
	}
	for _, t := range strings.Split(getOrDefault(configs, keyPayTypes, ""), ",") {
		if v := strings.TrimSpace(t); v != "" {
			cfg.PayTypes = append(cfg.PayTypes, v)
		}
	}
	return cfg
}

// parseRatio 解析充值比例字符串，空/非法返回默认 100（对齐 parseRatio）。
func parseRatio(value string, l logger) int {
	if strings.TrimSpace(value) != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
			return n
		}
		l.Warnf("Invalid recharge ratio config: %s", value)
	}
	return defaultRechargeRatio
}

// isTimestampValid 校验通知时间戳与当前时间偏差在容差内，防重放（对齐 isTimestampValid）。
func isTimestampValid(timestamp string) bool {
	if strings.TrimSpace(timestamp) == "" {
		return false
	}
	ts, err := strconv.ParseInt(strings.TrimSpace(timestamp), 10, 64)
	if err != nil {
		return false
	}
	diff := time.Now().Unix() - ts
	if diff < 0 {
		diff = -diff
	}
	return diff <= notifyTimestampToleranceSeconds
}

// generateOrderNo 生成订单业务单号：TC + 毫秒时间戳 + 4位随机（对齐 generateOrderNo: ThreadLocalRandom.nextInt(1000,10000)）。
func generateOrderNo() string {
	return "TC" + strconv.FormatInt(time.Now().UnixMilli(), 10) + strconv.Itoa(randInt4())
}

// randInt4 返回 [1000, 9999] 的随机整数（对齐 nextInt(1000, 10000)，上界开区间）。
func randInt4() int {
	return 1000 + rand.Intn(9000)
}

// toOrderVOList 批量转换订单 VO。
func (s *Service) toOrderVOList(records []model.RechargeOrder) ([]RechargeOrderVO, error) {
	names, err := s.repo.UserDisplayNames(orderUserIDs(records))
	if err != nil {
		return nil, err
	}
	out := make([]RechargeOrderVO, 0, len(records))
	for i := range records {
		out = append(out, *toOrderVOWithNames(&records[i], names))
	}
	return out, nil
}

// toOrderVO 转换单个订单 VO（id = public_id，对齐 toOrderVO）。
func toOrderVO(o *model.RechargeOrder) *RechargeOrderVO {
	return toOrderVOWithNames(o, nil)
}

func toOrderVOWithNames(o *model.RechargeOrder, names map[int64]string) *RechargeOrderVO {
	return &RechargeOrderVO{
		ID:            o.PublicID,
		OrderNo:       o.OrderNo,
		UserName:      names[o.UserID],
		Amount:        o.Amount,
		PointsAmount:  o.PointsAmount,
		PaymentMethod: o.PaymentMethod,
		PaymentNo:     o.PaymentNo,
		Status:        o.Status,
		StatusName:    orderStatusName(o.Status),
		PaidTime:      o.PaidTime,
		CreateTime:    o.CreateTime,
	}
}

func orderUserIDs(records []model.RechargeOrder) []int64 {
	seen := make(map[int64]struct{})
	ids := make([]int64, 0, len(records))
	for i := range records {
		id := records[i].UserID
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}

// getOrDefault 取 map 值，缺失返回默认值。
func getOrDefault(m map[string]string, key, def string) string {
	if v, ok := m[key]; ok {
		return v
	}
	return def
}

// trimToEmpty 去空白；全空白返回空串（对齐 trimToNull 的空值归一，Go 侧统一用空串表示无值）。
func trimToEmpty(s string) string { return strings.TrimSpace(s) }

// containsString 判断切片是否含某字符串。
func containsString(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}

// strPtr 非空白字符串转 *string；空白返回 nil（对齐回调中 params.get 可能为空 → COALESCE 保留原值）。
func strPtr(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}

// derefOr 解引用 *string，nil 返回默认值（仅用于日志）。
func derefOr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}
