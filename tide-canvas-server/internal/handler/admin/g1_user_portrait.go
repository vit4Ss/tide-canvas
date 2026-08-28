package admin

// g1_user_portrait.go 管理端「用户画像」：把一个用户散落在各表的行为数据聚合成
// 一页可读的档案。所有查询都以 user_id 索引为锚（单用户量级），一次请求内并列
// 执行十余个小聚合是可接受的——这是低频的运营详情页，不是列表页。
//
// 口径说明（与全站其余统计保持一致）：
//   - 积分获得/消耗按 point_record.amount 的正负号统计，change_type 原样返回
//     （recharge/consume/checkin/reward/refund…），前端负责中文标签，未知类型
//     原样展示——新增类型不需要改这里。
//   - 生成行为与模型排行来自 ai_tasks：积分口径只累计 status=1（成功）的
//     point_cost——失败/取消的任务已按退款流程返还，计入会虚高消耗。
//   - 活跃度序列来自 ai_generation_logs 的 create_time：取近 90 天时间戳后在
//     Go 侧折叠（按天/按小时），避免 MySQL 与 sqlite 的日期函数方言差异。

import (
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

const (
	portraitDailyWindowDays = 90
	portraitRecentWindow    = 30 * 24 * time.Hour
	// 折叠活跃序列最多取多少条时间戳：重度用户 90 天也远到不了这个量级，
	// 上限只是防御异常数据把内存打爆。
	portraitTimestampCap = 50000
)

type portraitTypeStat struct {
	Key    string `json:"key"`
	Count  int64  `json:"count"`
	Points int64  `json:"points"`
}

type portraitPointsVO struct {
	Balance      int64              `json:"balance"`
	TotalEarned  int64              `json:"totalEarned"`
	TotalSpent   int64              `json:"totalSpent"` // 正数（消耗的绝对值）
	Earned30     int64              `json:"earned30"`
	Spent30      int64              `json:"spent30"`
	RefundCount  int64              `json:"refundCount"`
	ByType       []portraitTypeStat `json:"byType"`
	Transactions []portraitTxVO     `json:"transactions"`
}

type portraitTxVO struct {
	Time       string `json:"time"`
	ChangeType string `json:"changeType"`
	Amount     int    `json:"amount"`
	Balance    int    `json:"balance"`
	Remark     string `json:"remark"`
}

type portraitDayVO struct {
	Date  string `json:"date"` // YYYY-MM-DD（服务器时区）
	Count int64  `json:"count"`
}

type portraitLoginVO struct {
	Time    string `json:"time"`
	Action  string `json:"action"`
	Channel string `json:"channel"`
	Success int    `json:"success"`
	IP      string `json:"ip"`
}

type portraitActivityVO struct {
	Daily        []portraitDayVO   `json:"daily"` // 近 90 天，含 0 值日，升序
	ActiveDays30 int               `json:"activeDays30"`
	LoginDays30  int               `json:"loginDays30"`
	Hourly       [24]int64         `json:"hourly"` // 近 90 天生成时段分布
	RecentLogins []portraitLoginVO `json:"recentLogins"`
}

type portraitGenerationVO struct {
	Total      int64              `json:"total"`
	Success    int64              `json:"success"`
	Failed     int64              `json:"failed"`
	Cancelled  int64              `json:"cancelled"`
	Processing int64              `json:"processing"`
	Total30    int64              `json:"total30"`
	Failed30   int64              `json:"failed30"`
	ByHandler  []portraitTypeStat `json:"byHandler"` // Points 仅计成功任务
}

type portraitModelVO struct {
	Model    string `json:"model"`
	Count    int64  `json:"count"`
	Success  int64  `json:"success"`
	Points   int64  `json:"points"` // 仅计成功任务
	LastUsed string `json:"lastUsed"`
}

type portraitAssetsVO struct {
	ProjectCount    int64 `json:"projectCount"`
	WorkCount       int64 `json:"workCount"`
	FileCount       int64 `json:"fileCount"`
	StorageUsed     int64 `json:"storageUsed"`
	StorageQuota    int64 `json:"storageQuota"`
	SkillRunCount   int64 `json:"skillRunCount"`
	CollectionCount int64 `json:"collectionCount"`
}

type portraitOrderVO struct {
	OrderNo   string `json:"orderNo"`
	OrderType string `json:"orderType"`
	Cycle     string `json:"cycle"`
	Amount    string `json:"amount"`
	Status    int    `json:"status"`
	Time      string `json:"time"`
}

type portraitClaimVO struct {
	Time      string `json:"time"`
	BatchName string `json:"batchName"`
	CodeHint  string `json:"codeHint"`
	Points    int    `json:"points"`
}

type portraitCommerceVO struct {
	PaidOrderCount int64             `json:"paidOrderCount"`
	PaidAmount     string            `json:"paidAmount"`
	RecentOrders   []portraitOrderVO `json:"recentOrders"`
	ClaimCount     int64             `json:"claimCount"`
	ClaimPoints    int64             `json:"claimPoints"`
	RecentClaims   []portraitClaimVO `json:"recentClaims"`
	CheckinCount   int64             `json:"checkinCount"`
	CheckinPoints  int64             `json:"checkinPoints"`
	CheckinStreak  int64             `json:"checkinStreak"` // 历史最长连续签到
	LastCheckin    string            `json:"lastCheckin"`
}

type portraitCommunityVO struct {
	CommentCount int64 `json:"commentCount"`
	LikeCount    int64 `json:"likeCount"` // 该用户点出的赞
	Followers    int64 `json:"followers"`
	Following    int64 `json:"following"`
}

// UserPortraitVO 是画像页的完整载荷：一次请求拿全，避免详情页十几个瀑布请求。
type UserPortraitVO struct {
	User       AdminUserVO          `json:"user"`
	Points     portraitPointsVO     `json:"points"`
	Activity   portraitActivityVO   `json:"activity"`
	Generation portraitGenerationVO `json:"generation"`
	Models     []portraitModelVO    `json:"models"`
	Assets     portraitAssetsVO     `json:"assets"`
	Commerce   portraitCommerceVO   `json:"commerce"`
	Community  portraitCommunityVO  `json:"community"`
}

func (h *userHandler) userPortrait(c *gin.Context) {
	id, ok := g1ParseID(c, "user")
	if !ok {
		return
	}
	u, err := h.findUser(id)
	if err != nil {
		h.failLookup(c, err, "failed to load user")
		return
	}
	vo := UserPortraitVO{User: toAdminUserVO(u)}
	vo.User.PlanName = planNameFor(h.planNameByVip(), u.VipLevel)
	vo.User.ProjectCount = h.countByOwner(&model.Project{}, "owner_id", []idgen.ID{id})[id]
	vo.User.PostCount = h.countByOwner(&model.CommunityPost{}, "user_id", []idgen.ID{id})[id]

	now := time.Now()
	since30 := now.Add(-portraitRecentWindow)
	// 活跃序列窗口取「89 天前的零点」：窗口首日必须是完整一天，否则该日
	// 只统计到当前时刻之后的记录，热力图第一格会系统性偏低。
	first := now.AddDate(0, 0, -portraitDailyWindowDays+1)
	since90 := time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, first.Location())

	vo.Points = h.portraitPoints(id, u.Points, since30)
	vo.Activity = h.portraitActivity(id, since30, since90)
	vo.Generation = h.portraitGeneration(id, since30)
	vo.Models = h.portraitModels(id)
	vo.Assets = h.portraitAssets(id, u)
	vo.Commerce = h.portraitCommerce(id)
	vo.Community = h.portraitCommunity(id)
	response.OK(c, vo)
}

func (h *userHandler) portraitPoints(id idgen.ID, balance int64, since30 time.Time) portraitPointsVO {
	out := portraitPointsVO{Balance: balance, ByType: []portraitTypeStat{}, Transactions: []portraitTxVO{}}
	type signSum struct {
		Earned int64
		Spent  int64
	}
	var all, recent signSum
	const sumExpr = "COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) AS earned, " +
		"COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0) AS spent"
	h.db.Model(&model.PointRecord{}).Select(sumExpr).Where("user_id = ?", id).Scan(&all)
	h.db.Model(&model.PointRecord{}).Select(sumExpr).
		Where("user_id = ? AND create_time >= ?", id, since30).Scan(&recent)
	out.TotalEarned, out.TotalSpent = all.Earned, all.Spent
	out.Earned30, out.Spent30 = recent.Earned, recent.Spent

	var byType []struct {
		ChangeType string
		Count      int64
		Points     int64
	}
	h.db.Model(&model.PointRecord{}).
		Select("change_type, COUNT(*) AS count, COALESCE(SUM(amount),0) AS points").
		Where("user_id = ?", id).Group("change_type").Order("count DESC").Scan(&byType)
	for _, row := range byType {
		out.ByType = append(out.ByType, portraitTypeStat{Key: row.ChangeType, Count: row.Count, Points: row.Points})
		if row.ChangeType == "refund" {
			out.RefundCount = row.Count
		}
	}

	var txRows []model.PointRecord
	h.db.Where("user_id = ?", id).Order("create_time DESC").Limit(12).Find(&txRows)
	for i := range txRows {
		out.Transactions = append(out.Transactions, portraitTxVO{
			Time:       g5FmtTime(txRows[i].CreateTime),
			ChangeType: txRows[i].ChangeType,
			Amount:     txRows[i].Amount,
			Balance:    txRows[i].Balance,
			Remark:     txRows[i].Remark,
		})
	}
	return out
}

func (h *userHandler) portraitActivity(id idgen.ID, since30, since90 time.Time) portraitActivityVO {
	out := portraitActivityVO{Daily: []portraitDayVO{}, RecentLogins: []portraitLoginVO{}}

	// 时间戳在 Go 侧折叠：跨 MySQL/sqlite 无日期函数方言问题，时区统一按服务进程。
	// DESC + LIMIT：极端量级触顶时截掉的是最旧的天——热力图的近端永远完整。
	var stamps []time.Time
	h.db.Model(&model.AiGenerationLog{}).
		Where("user_id = ? AND create_time >= ?", id, since90).
		Order("create_time DESC").Limit(portraitTimestampCap).Pluck("create_time", &stamps)
	perDay := make(map[string]int64, portraitDailyWindowDays)
	activeDays30 := map[string]struct{}{}
	for _, t := range stamps {
		local := t.Local()
		day := local.Format("2006-01-02")
		perDay[day]++
		out.Hourly[local.Hour()]++
		if !local.Before(since30) {
			activeDays30[day] = struct{}{}
		}
	}
	for i := 0; i < portraitDailyWindowDays; i++ {
		day := since90.AddDate(0, 0, i).Format("2006-01-02")
		out.Daily = append(out.Daily, portraitDayVO{Date: day, Count: perDay[day]})
	}
	out.ActiveDays30 = len(activeDays30)

	var loginStamps []time.Time
	h.db.Model(&model.LoginLog{}).
		Where("user_id = ? AND success = 1 AND create_time >= ?", id, since30).
		Limit(portraitTimestampCap).Pluck("create_time", &loginStamps)
	loginDays := map[string]struct{}{}
	for _, t := range loginStamps {
		loginDays[t.Local().Format("2006-01-02")] = struct{}{}
	}
	out.LoginDays30 = len(loginDays)

	var logins []model.LoginLog
	h.db.Where("user_id = ?", id).Order("create_time DESC").Limit(10).Find(&logins)
	for i := range logins {
		out.RecentLogins = append(out.RecentLogins, portraitLoginVO{
			Time:    g5FmtTime(logins[i].CreateTime),
			Action:  logins[i].Action,
			Channel: logins[i].Channel,
			Success: logins[i].Success,
			IP:      logins[i].IP,
		})
	}
	return out
}

func (h *userHandler) portraitGeneration(id idgen.ID, since30 time.Time) portraitGenerationVO {
	out := portraitGenerationVO{ByHandler: []portraitTypeStat{}}
	var byStatus []struct {
		Status int
		Count  int64
	}
	h.db.Model(&model.AiTask{}).Select("status, COUNT(*) AS count").
		Where("user_id = ?", id).Group("status").Scan(&byStatus)
	for _, row := range byStatus {
		out.Total += row.Count
		switch row.Status {
		case 0:
			out.Processing = row.Count
		case 1:
			out.Success = row.Count
		case 2:
			out.Failed = row.Count
		case 3:
			out.Cancelled = row.Count
		}
	}
	var recent struct {
		Total  int64
		Failed int64
	}
	h.db.Model(&model.AiTask{}).
		Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END),0) AS failed").
		Where("user_id = ? AND create_time >= ?", id, since30).Scan(&recent)
	out.Total30, out.Failed30 = recent.Total, recent.Failed

	var byHandler []struct {
		Handler string
		Count   int64
		Points  int64
	}
	h.db.Model(&model.AiTask{}).
		Select("handler, COUNT(*) AS count, COALESCE(SUM(CASE WHEN status = 1 THEN point_cost ELSE 0 END),0) AS points").
		Where("user_id = ?", id).Group("handler").Order("count DESC").Scan(&byHandler)
	for _, row := range byHandler {
		out.ByHandler = append(out.ByHandler, portraitTypeStat{Key: row.Handler, Count: row.Count, Points: row.Points})
	}
	return out
}

func (h *userHandler) portraitModels(id idgen.ID) []portraitModelVO {
	var rows []struct {
		ModelName string
		Count     int64
		Success   int64
		Points    int64
		LastUsed  time.Time
	}
	h.db.Model(&model.AiTask{}).
		Select("model_name, COUNT(*) AS count, "+
			"COALESCE(SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END),0) AS success, "+
			"COALESCE(SUM(CASE WHEN status = 1 THEN point_cost ELSE 0 END),0) AS points, "+
			"MAX(create_time) AS last_used").
		Where("user_id = ?", id).Group("model_name").Order("count DESC").Limit(12).Scan(&rows)
	out := make([]portraitModelVO, 0, len(rows))
	for _, row := range rows {
		name := row.ModelName
		if name == "" {
			name = "（未记录模型）"
		}
		out = append(out, portraitModelVO{
			Model:    name,
			Count:    row.Count,
			Success:  row.Success,
			Points:   row.Points,
			LastUsed: g5FmtTime(row.LastUsed),
		})
	}
	return out
}

func (h *userHandler) portraitAssets(id idgen.ID, u *model.User) portraitAssetsVO {
	count := func(m any, cond string) int64 {
		var n int64
		h.db.Model(m).Where(cond, id).Count(&n)
		return n
	}
	return portraitAssetsVO{
		ProjectCount:    count(&model.Project{}, "owner_id = ?"),
		WorkCount:       count(&model.CommunityPost{}, "user_id = ?"),
		FileCount:       count(&model.File{}, "owner_id = ?"),
		StorageUsed:     u.StorageUsed,
		StorageQuota:    u.StorageQuota,
		SkillRunCount:   count(&model.SkillRun{}, "user_id = ?"),
		CollectionCount: count(&model.Collection{}, "user_id = ?"),
	}
}

func (h *userHandler) portraitCommerce(id idgen.ID) portraitCommerceVO {
	out := portraitCommerceVO{RecentOrders: []portraitOrderVO{}, RecentClaims: []portraitClaimVO{}, PaidAmount: "0"}

	var paid struct {
		Count  int64
		Amount string
	}
	// SUM(decimal) 以字符串接收，避免 float 精度损失（MySQL 返回 DECIMAL、sqlite 返回文本）。
	h.db.Model(&model.Order{}).
		Select("COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount").
		Where("user_id = ? AND status = 1", id).Scan(&paid)
	out.PaidOrderCount = paid.Count
	if paid.Amount != "" {
		out.PaidAmount = paid.Amount
	}
	var orders []model.Order
	h.db.Where("user_id = ?", id).Order("create_time DESC").Limit(5).Find(&orders)
	for i := range orders {
		out.RecentOrders = append(out.RecentOrders, portraitOrderVO{
			OrderNo:   orders[i].OrderNo,
			OrderType: orders[i].OrderType,
			Cycle:     orders[i].Cycle,
			Amount:    orders[i].Amount.String(),
			Status:    orders[i].Status,
			Time:      g5FmtTime(orders[i].CreateTime),
		})
	}

	var claims struct {
		Count  int64
		Points int64
	}
	h.db.Model(&model.ActivationCodeClaim{}).
		Select("COUNT(*) AS count, COALESCE(SUM(points),0) AS points").
		Where("user_id = ?", id).Scan(&claims)
	out.ClaimCount, out.ClaimPoints = claims.Count, claims.Points
	var claimRows []model.ActivationCodeClaim
	h.db.Where("user_id = ?", id).Order("create_time DESC").Limit(5).Find(&claimRows)
	for i := range claimRows {
		out.RecentClaims = append(out.RecentClaims, portraitClaimVO{
			Time:      g5FmtTime(claimRows[i].CreateTime),
			BatchName: claimRows[i].BatchName,
			CodeHint:  claimRows[i].CodeHint,
			Points:    claimRows[i].Points,
		})
	}

	var checkin struct {
		Count  int64
		Points int64
		Streak int64
		Last   string
	}
	h.db.Model(&model.CheckinRecord{}).
		Select("COUNT(*) AS count, COALESCE(SUM(points),0) AS points, "+
			"COALESCE(MAX(continuous_days),0) AS streak, COALESCE(MAX(checkin_date),'') AS last").
		Where("user_id = ?", id).Scan(&checkin)
	out.CheckinCount, out.CheckinPoints, out.CheckinStreak, out.LastCheckin =
		checkin.Count, checkin.Points, checkin.Streak, checkin.Last
	return out
}

func (h *userHandler) portraitCommunity(id idgen.ID) portraitCommunityVO {
	count := func(m any, cond string) int64 {
		var n int64
		h.db.Model(m).Where(cond, id).Count(&n)
		return n
	}
	return portraitCommunityVO{
		CommentCount: count(&model.PostComment{}, "user_id = ?"),
		LikeCount:    count(&model.PostLike{}, "user_id = ?"),
		Followers:    count(&model.UserFollow{}, "followee_id = ?"),
		Following:    count(&model.UserFollow{}, "follower_id = ?"),
	}
}
