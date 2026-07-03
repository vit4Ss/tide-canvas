// mktoken — 本地开发辅助工具：为库里第一个用户铸一个访问令牌，用于
// 无头浏览器截图等需要已登录会话的开发场景。只打印 token，不写任何数据。
//
//	go run ./cmd/mktoken
package main

import (
	"fmt"
	"os"

	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/token"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger.Init(true)
	if err := idgen.InitNode(9); err != nil {
		return err
	}
	gdb, err := db.Open(cfg.MySQL)
	if err != nil {
		return err
	}

	var u model.User
	if err := gdb.Order("id ASC").First(&u).Error; err != nil {
		return fmt.Errorf("no user found: %w", err)
	}

	// rdb=nil：只签发，不落 refresh JTI（access 校验不需要）。
	token.Init(cfg.JWT, nil)
	access, _, _, err := token.Issue(u.ID, u.Role)
	if err != nil {
		return err
	}
	fmt.Printf("user=%s id=%s\n%s\n", u.Username, u.ID, access)
	return nil
}
