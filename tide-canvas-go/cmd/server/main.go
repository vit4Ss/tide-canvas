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

	// ---- Redis（多副本的限流/验证码/在线状态共享；连不上则回退单机内存）----
	rdb, rerr := redisx.New(conf, logg)
	if rerr != nil {
		logg.Warnf("redis 连接失败，回退单机内存实现: %v", rerr)
		rdb = nil
	}

	// ---- 路由 ----
	r := router.New(db, conf, logg, rdb)

	port := conf.GetString("server.port")
	logg.Infof("tide-canvas-go listening on :%s", port)
	if err := r.Run(":" + port); err != nil {
		logg.Fatalf("server exit: %v", err)
	}
}
