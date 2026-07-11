// Command importusers migrates relay (ScarecrowToken, 库 scarecrowtoken) 的
// 用户账号到 TideCanvas（库 canvas）。只迁账号：邮箱 + BCrypt 密码哈希原样拷贝
// （两边同为 bcrypt，原密码可直接登录），全部落为普通 free 用户——
// role=0 / vipLevel=0 / points=0，不发注册积分，余额不折算。
//
// 规则：
//   - 邮箱统一小写；canvas 里已存在的邮箱跳过并列出
//   - username 从邮箱前缀派生（小写字母数字），冲突时追加数字后缀
//   - OAuth-only 用户（relay 里 password_hash 为 NULL）写入随机不可用哈希，
//     用户通过「邮箱验证码重置密码」自行设置
//   - createdAt（毫秒时间戳）保留为 canvas 的 createTime
//
// 用法（默认 dry-run 只打印，不落库）：
//
//	go run ./cmd/importusers            # 预览
//	go run ./cmd/importusers -apply     # 执行迁移
//
// relay 库默认复用 canvas 的 MySQL 连接参数、库名换成 scarecrowtoken；
// 不同实例时用 -relay-db 覆盖库名或直接改环境变量。
package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// relayUser mirrors the scarecrowtoken.users columns we need.
type relayUser struct {
	ID            string  `gorm:"column:id"`
	Email         string  `gorm:"column:email"`
	PasswordHash  *string `gorm:"column:password_hash"`
	Name          string  `gorm:"column:name"`
	Role          string  `gorm:"column:role"`
	CreatedAt     int64   `gorm:"column:created_at"`
	LastSeen      *int64  `gorm:"column:last_seen"`
	OauthProvider *string `gorm:"column:oauth_provider"`
}

func main() {
	apply := flag.Bool("apply", false, "write to canvas.users (default: dry-run)")
	relayDB := flag.String("relay-db", "scarecrowtoken", "relay database name on the same MySQL instance")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fatal("load config:", err)
	}
	if err := idgen.InitNode(3); err != nil {
		fatal("idgen:", err)
	}

	canvas, err := db.Open(cfg.MySQL)
	if err != nil {
		fatal("open canvas mysql:", err)
	}
	relayCfg := cfg.MySQL
	relayCfg.DSN = ""
	relayCfg.Database = *relayDB
	relay, err := db.Open(relayCfg)
	if err != nil {
		fatal("open relay mysql:", err)
	}

	var src []relayUser
	if err := relay.Table("users").Order("created_at ASC").Find(&src).Error; err != nil {
		fatal("read relay users:", err)
	}
	fmt.Printf("relay(%s).users: %d 条\n", *relayDB, len(src))

	// Existing canvas emails / usernames (lowercased) for dedup.
	takenEmail, takenUser := map[string]bool{}, map[string]bool{}
	{
		var rows []model.User
		if err := canvas.Select("email", "username").Find(&rows).Error; err != nil {
			fatal("read canvas users:", err)
		}
		for i := range rows {
			takenEmail[strings.ToLower(rows[i].Email)] = true
			takenUser[strings.ToLower(rows[i].Username)] = true
		}
	}

	var migrated, skipped, oauthOnly int
	for _, ru := range src {
		email := strings.TrimSpace(strings.ToLower(ru.Email))
		if email == "" {
			skipped++
			fmt.Printf("  跳过（空邮箱）: relay id=%s\n", ru.ID)
			continue
		}
		if takenEmail[email] {
			skipped++
			fmt.Printf("  跳过（邮箱已存在）: %s\n", email)
			continue
		}

		hash := ""
		if ru.PasswordHash != nil {
			hash = strings.TrimSpace(*ru.PasswordHash)
		}
		if hash == "" {
			// OAuth-only：随机不可用密码，用户走「邮箱验证码重置密码」。
			oauthOnly++
			h, err := bcrypt.GenerateFromPassword([]byte(randHex(32)), bcrypt.DefaultCost)
			if err != nil {
				fatal("bcrypt:", err)
			}
			hash = string(h)
		}

		username := deriveUsername(email, takenUser)
		nickname := strings.TrimSpace(ru.Name)
		if nickname == "" {
			nickname = username
		}
		if len([]rune(nickname)) > 64 {
			nickname = string([]rune(nickname)[:64])
		}

		created := time.UnixMilli(ru.CreatedAt)
		if ru.CreatedAt <= 0 {
			created = time.Now()
		}
		lastLogin := created
		if ru.LastSeen != nil && *ru.LastSeen > 0 {
			lastLogin = time.UnixMilli(*ru.LastSeen)
		}

		u := &model.User{
			ID:            idgen.Next(),
			Username:      username,
			Email:         email,
			Nickname:      nickname,
			PasswordHash:  hash,
			Role:          0, // relay 的 admin 一律迁为普通用户
			VipLevel:      0, // free 套餐
			Status:        1,
			Points:        0,
			CreateTime:    created,
			LastLoginTime: lastLogin,
		}

		tag := ""
		if ru.PasswordHash == nil || strings.TrimSpace(deref(ru.PasswordHash)) == "" {
			tag = "（OAuth-only，随机密码，需邮箱重置）"
		}
		if *apply {
			if err := canvas.Create(u).Error; err != nil {
				fmt.Printf("  写入失败: %s -> %v\n", email, err)
				skipped++
				continue
			}
			fmt.Printf("  已迁入: %-32s username=%s%s\n", email, username, tag)
		} else {
			fmt.Printf("  将迁入: %-32s username=%s%s\n", email, username, tag)
		}
		takenEmail[email], takenUser[strings.ToLower(username)] = true, true
		migrated++
	}

	mode := "DRY-RUN（未写库，加 -apply 执行）"
	if *apply {
		mode = "已写入 canvas.users"
	}
	fmt.Printf("\n%s：迁入 %d，跳过 %d，其中 OAuth-only %d\n", mode, migrated, skipped, oauthOnly)
}

// deriveUsername builds a unique username from the email local part:
// lowercase alnum only, fallback "user", numeric suffix on conflict.
func deriveUsername(email string, taken map[string]bool) string {
	base := email
	if i := strings.IndexByte(base, '@'); i > 0 {
		base = base[:i]
	}
	var b strings.Builder
	for _, r := range strings.ToLower(base) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	name := b.String()
	if name == "" {
		name = "user"
	}
	if len(name) > 32 {
		name = name[:32]
	}
	cand := name
	for i := 1; taken[cand]; i++ {
		cand = fmt.Sprintf("%s%d", name, i)
	}
	return cand
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func randHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

func fatal(msg string, err error) {
	fmt.Fprintln(os.Stderr, msg, err)
	os.Exit(1)
}
