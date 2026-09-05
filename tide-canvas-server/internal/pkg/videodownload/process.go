package videodownload

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type commandRunner func(context.Context, string, []string, string, int64) ([]byte, []byte, error)
type limitedOutput struct {
	// Do not embed bytes.Buffer: its promoted ReadFrom lets io.Copy bypass
	// Write and therefore the output cap when exec drains a child process.
	buffer   bytes.Buffer
	limit    int
	overflow bool
	cancel   context.CancelFunc
}

func (b *limitedOutput) Write(p []byte) (int, error) {
	n := len(p)
	left := b.limit - b.buffer.Len()
	if left < len(p) {
		b.overflow = true
		p = p[:max(left, 0)]
		b.cancel()
	}
	b.buffer.Write(p)
	return n, nil
}

func (b *limitedOutput) Bytes() []byte { return b.buffer.Bytes() }

func directoryExceedsBudget(dir string, limit int64) bool {
	var size int64
	exceeded := errors.New("disk budget exceeded")
	err := filepath.WalkDir(dir, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.Type().IsRegular() {
			return nil
		}
		if info, err := entry.Info(); err == nil {
			if info.Size() > limit-size {
				return exceeded
			}
			size += info.Size()
		}
		return nil
	})
	return errors.Is(err, exceeded)
}

// No shell is used. Cancellation kills the process tree, including FFmpeg.
func runCommand(ctx context.Context, binary string, args []string, dir string, maxDisk int64) ([]byte, []byte, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stdout := &limitedOutput{limit: 8 << 20, cancel: cancel}
	stderr := &limitedOutput{limit: 512 << 10, cancel: cancel}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.WaitDelay = time.Second
	if dir != "" {
		cmd.Dir = dir
	}
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	var wg sync.WaitGroup
	done := make(chan struct{})
	diskExceeded := false
	if dir != "" && maxDisk > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ticker := time.NewTicker(200 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-done:
					return
				case <-ctx.Done():
					return
				case <-ticker.C:
					if directoryExceedsBudget(dir, maxDisk) {
						diskExceeded = true
						cancel()
						return
					}
				}
			}
		}()
	}
	err := cmd.Wait()
	close(done)
	wg.Wait()
	// A fast command can create an oversized file and exit before the first
	// watchdog tick. Check again before accepting its result or starting a mux.
	if !diskExceeded && dir != "" && maxDisk > 0 {
		diskExceeded = directoryExceedsBudget(dir, maxDisk)
	}
	if diskExceeded {
		err = failure(400, "视频临时文件超过存储上限，请选择更低画质")
	} else if stdout.overflow || stderr.overflow {
		err = errors.New("video command output limit exceeded")
	}
	return stdout.Bytes(), stderr.Bytes(), err
}
