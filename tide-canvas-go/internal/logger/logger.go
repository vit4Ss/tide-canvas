// Package logger 基于 logrus + lumberjack 的可配置日志：级别 / 格式(text|json) / 输出(stdout|file|both) / 文件切割。
package logger

import (
	"io"
	"os"
	"path/filepath"

	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"gopkg.in/natefinch/lumberjack.v2"
)

// New 按配置构造 *logrus.Logger。
//
// 相关配置键（环境变量同名大写下划线）：
//
//	debug            true 时强制 debug 级别（覆盖 log.level）
//	log.level        debug|info|warn|error（默认 info）
//	log.format       text|json（默认 text；生产建议 json 便于采集）
//	log.output       stdout|file|both（默认 stdout）
//	log.file         文件路径（默认 ./logs/app.log）
//	log.max_size     单文件大小上限 MB（默认 100），超过则切割
//	log.max_backups  保留旧文件数（默认 7）
//	log.max_age      旧文件保留天数（默认 30）
//	log.compress     是否 gzip 压缩旧文件（默认 true）
func New(v *viper.Viper) *logrus.Logger {
	l := logrus.New()
	l.SetLevel(resolveLevel(v))
	l.SetFormatter(resolveFormatter(v))
	l.SetOutput(resolveWriter(v))
	return l
}

func resolveLevel(v *viper.Viper) logrus.Level {
	if v.GetBool("debug") {
		return logrus.DebugLevel
	}
	if lv, err := logrus.ParseLevel(v.GetString("log.level")); err == nil {
		return lv
	}
	return logrus.InfoLevel
}

func resolveFormatter(v *viper.Viper) logrus.Formatter {
	if v.GetString("log.format") == "json" {
		return &logrus.JSONFormatter{TimestampFormat: "2006-01-02 15:04:05"}
	}
	return &logrus.TextFormatter{FullTimestamp: true, TimestampFormat: "2006-01-02 15:04:05"}
}

func resolveWriter(v *viper.Viper) io.Writer {
	if v.GetString("log.output") == "stdout" {
		return os.Stdout
	}
	file := v.GetString("log.file")
	if dir := filepath.Dir(file); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	rotator := &lumberjack.Logger{
		Filename:   file,
		MaxSize:    v.GetInt("log.max_size"),
		MaxBackups: v.GetInt("log.max_backups"),
		MaxAge:     v.GetInt("log.max_age"),
		Compress:   v.GetBool("log.compress"),
	}
	if v.GetString("log.output") == "file" {
		return rotator
	}
	// both：同时写控制台与文件。
	return io.MultiWriter(os.Stdout, rotator)
}
