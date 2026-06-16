package main

import (
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"

	"github.com/tidecanvas/tide-canvas-go/internal/config"
	"github.com/tidecanvas/tide-canvas-go/internal/logger"
	"github.com/tidecanvas/tide-canvas-go/internal/router"
	"github.com/tidecanvas/tide-canvas-go/pkg/redisx"
	"github.com/tidecanvas/tide-canvas-go/pkg/snowflake"
)

func main() {
	// ---- 配置（.env / 环境变量 / config.yaml / 默认）----
	conf := config.Load()

	// ---- 日志（级别/格式/文件切割可配）----
	logg := logger.New(conf)

	// ---- 雪花节点 ----
	nodeID := conf.GetInt64("snowflake.node_id")
	if nodeID == 0 {
		nodeID = 1
	}
	if err := snowflake.Init(nodeID); err != nil {
		logg.Fatalf("init snowflake node: %v", err)
	}

	// ---- 数据库 ----
	gormLogLevel := gormlogger.Warn
	if conf.GetBool("debug") {
		gormLogLevel = gormlogger.Info
	}
	db, err := gorm.Open(mysql.Open(conf.GetString("db.dsn")), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormLogLevel),
	})
	if err != nil {
		logg.Fatalf("connect database: %v", err)
	}
	if sqlDB, e := db.DB(); e == nil {
		sqlDB.SetMaxIdleConns(conf.GetInt("db.max_idle_conns"))
		sqlDB.SetMaxOpenConns(conf.GetInt("db.max_open_conns"))
	}

	// ---- Redis（必需：限流/验证码/直传票据/IM 在线状态与跨实例推送的共享后端）----
	// 强制依赖 Redis：连不上直接退出，不再静默回退内存（务必配好 REDIS_ADDR / REDIS_PASSWORD）。
	rdb, rerr := redisx.New(conf, logg)
	if rerr != nil {
		logg.Fatalf("Redis 连接失败（请检查 REDIS_ADDR / REDIS_PASSWORD）: %v", rerr)
	}
	if rdb == nil {
		logg.Fatalf("Redis 未配置：请设置 REDIS_ADDR")
	}

	// ---- 路由 ----
	r := router.New(db, conf, logg, rdb)

	port := conf.GetString("server.port")
	logg.Infof("tide-canvas-go listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		logg.Fatalf("server exit: %v", err)
	}
}
