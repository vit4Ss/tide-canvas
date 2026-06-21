// Package logger provides a process-wide zap logger.
package logger

import (
	"sync"

	"go.uber.org/zap"
)

var (
	log  *zap.Logger
	once sync.Once
)

// Init builds the global logger. development=true uses a human-friendly config.
func Init(development bool) {
	once.Do(func() {
		var err error
		if development {
			log, err = zap.NewDevelopment()
		} else {
			log, err = zap.NewProduction()
		}
		if err != nil {
			log = zap.NewNop()
		}
	})
}

// L returns the global logger, initializing a no-op one if Init was not called.
func L() *zap.Logger {
	if log == nil {
		log = zap.NewNop()
	}
	return log
}

// Sync flushes any buffered log entries.
func Sync() {
	if log != nil {
		_ = log.Sync()
	}
}
