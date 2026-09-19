package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"tidecanvas/mcp/internal/bridge"
)

func env(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func main() {
	if err := run(); err != nil {
		slog.Error("MCP server stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	transport := flag.String("transport", env("MCP_TRANSPORT", "http"), "http 或 stdio")
	addr := flag.String("addr", env("MCP_ADDR", "127.0.0.1:8082"), "HTTP 监听地址")
	base := flag.String("base-url", env("FLOWLIGHT_BASE_URL", "http://127.0.0.1:8081"), "主站地址，不带 /api/open/v1")
	flag.Parse()
	client, err := bridge.NewClient(*base)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *transport == "stdio" {
		key := strings.TrimSpace(os.Getenv("FLOWLIGHT_API_KEY"))
		if key == "" {
			return errors.New("stdio 模式需要在环境变量 FLOWLIGHT_API_KEY 配置用户自己的主站 Key")
		}
		ctx = bridge.WithCredentials(ctx, bridge.Credentials{APIKey: key})
		// stdout belongs exclusively to MCP; slog uses stderr.
		return bridge.NewServer(client).Run(ctx, &mcp.StdioTransport{MaxLineLength: 2 << 20})
	}
	if *transport != "http" {
		return errors.New("transport 只能是 http 或 stdio")
	}
	handler, err := bridge.NewHTTPHandler(client, strings.Split(os.Getenv("MCP_ALLOWED_ORIGINS"), ","))
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("无法监听 MCP 地址: %w", err)
	}
	srv := &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 45 * time.Second, WriteTimeout: 75 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	done := make(chan error, 1)
	go func() { done <- srv.Serve(listener) }()
	slog.Info("MCP server listening", "address", listener.Addr().String(), "endpoint", "/mcp", "transport", "Streamable HTTP")
	select {
	case <-ctx.Done():
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}
