// devbackdate — 本地开发辅助工具：把指定订单的 create_time 回拨 N 分钟，
// 用于验证待支付订单的懒过期逻辑。只在开发环境手工使用。
//
//	go run ./cmd/devbackdate <orderNo> <minutes>
package main

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/logger"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 3 {
		return fmt.Errorf("usage: devbackdate <orderNo> <minutes>")
	}
	mins, err := strconv.Atoi(os.Args[2])
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger.Init(true)
	gdb, err := db.Open(cfg.MySQL)
	if err != nil {
		return err
	}
	res := gdb.Model(&model.Order{}).
		Where("order_no = ?", os.Args[1]).
		UpdateColumn("create_time", time.Now().Add(-time.Duration(mins)*time.Minute))
	if res.Error != nil {
		return res.Error
	}
	fmt.Printf("backdated %d row(s) by %d minutes\n", res.RowsAffected, mins)
	return nil
}
