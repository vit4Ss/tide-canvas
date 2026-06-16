// Package im 即时通讯模块：统一私信/客服/后台三类会话，WebSocket 实时推送 + 在线状态。
package im

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"
)

// WebSocket 读写与心跳参数。
const (
	writeWait      = 10 * time.Second // 单次写超时
	pongWait       = 60 * time.Second // 读端等待 pong 的最长时间
	pingPeriod     = 54 * time.Second // ping 发送间隔（须 < pongWait）
	maxMessageSize = 8192             // 上行消息体上限
	sendBuffer     = 64               // 每连接出站缓冲
)

// 多实例（Redis）相关键与参数。
const (
	fanoutChannel  = "im:fanout"     // 跨实例消息广播频道
	presencePrefix = "im:presence:"  // 在线状态集合键前缀（值为各实例ID）
	presenceTTL    = 90 * time.Second // 在线集合 TTL，靠心跳刷新；防实例崩溃残留
)

func presenceKey(userID int64) string { return presencePrefix + strconv.FormatInt(userID, 10) }

// Client 表示某用户的单个 WebSocket 连接（同一用户允许多端同时在线）。
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	userID    int64
	send      chan []byte
	quit      chan struct{}
	closeOnce sync.Once
	onMessage func(userID int64, raw []byte) // 上行消息回调（由 WSHandler 注入，转交 service）
}

// close 幂等关闭 quit，通知 writePump 退出（不关闭 send，避免与 localSend 并发写竞态）。
func (c *Client) close() { c.closeOnce.Do(func() { close(c.quit) }) }

// fanoutMsg 跨实例广播的消息信封（经 Redis pub/sub 传递）。
type fanoutMsg struct {
	UserID  int64  `json:"u"`
	Payload string `json:"p"` // 下行 WSEvent 的 JSON 文本
	Origin  string `json:"o"` // 发起实例ID，订阅方据此跳过自己（本地已直推）
}

// Hub 连接中心：管理本实例连接、判定在线状态、按用户推送。
//
// 单实例（rdb==nil）：纯内存，RWMutex 保护连接表。
// 多副本（rdb!=nil）：在线状态写 Redis presence 集合（跨实例可见）；
// 推送时本地直推 + Redis pub/sub 广播，使连在其他实例的用户也能收到。
type Hub struct {
	mu         sync.RWMutex
	clients    map[int64]map[*Client]struct{} // userID -> 本实例连接集合
	logger     *logrus.Logger
	onOnline   func(userID int64) // 用户全集群首次上线
	onOffline  func(userID int64) // 用户全集群最后下线
	rdb        *redis.Client      // 可选；nil = 单机内存模式
	instanceID string
	ctx        context.Context
	cancel     context.CancelFunc
}

// NewHub 构造连接中心。rdb 为 nil 时为单机内存模式；非 nil 时启用跨实例 presence + 广播。
func NewHub(logger *logrus.Logger, onOnline, onOffline func(int64), rdb *redis.Client) *Hub {
	ctx, cancel := context.WithCancel(context.Background())
	h := &Hub{
		clients:    make(map[int64]map[*Client]struct{}),
		logger:     logger,
		onOnline:   onOnline,
		onOffline:  onOffline,
		rdb:        rdb,
		instanceID: uuid.NewString(),
		ctx:        ctx,
		cancel:     cancel,
	}
	if rdb != nil {
		go h.subscribe()
		go h.presenceRefreshLoop()
	}
	return h
}

// Close 优雅关闭：停止订阅与心跳刷新（进程退出时可调）。
func (h *Hub) Close() { h.cancel() }

// register 登记连接；该用户「全集群首次上线」时触发 onOnline。
func (h *Hub) register(c *Client) {
	h.mu.Lock()
	set := h.clients[c.userID]
	localWasEmpty := len(set) == 0
	if set == nil {
		set = make(map[*Client]struct{})
		h.clients[c.userID] = set
	}
	set[c] = struct{}{}
	h.mu.Unlock()

	fireOnline := false
	if h.rdb != nil {
		key := presenceKey(c.userID)
		pipe := h.rdb.Pipeline()
		pipe.SAdd(h.ctx, key, h.instanceID)
		pipe.Expire(h.ctx, key, presenceTTL)
		cardCmd := pipe.SCard(h.ctx, key)
		if _, err := pipe.Exec(h.ctx); err != nil {
			h.warnf("presence sadd: %v", err)
		} else if card, e := cardCmd.Result(); e == nil && card == 1 {
			fireOnline = true // 全集群首次（集合从空变为 1）
		}
	} else if localWasEmpty {
		fireOnline = true
	}
	if fireOnline && h.onOnline != nil {
		h.onOnline(c.userID)
	}
}

// unregister 注销连接；该用户「全集群最后下线」时触发 onOffline。幂等。
func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	localNowEmpty := false
	if set := h.clients[c.userID]; set != nil {
		if _, ok := set[c]; ok {
			delete(set, c)
			c.close()
			if len(set) == 0 {
				delete(h.clients, c.userID)
				localNowEmpty = true
			}
		}
	}
	h.mu.Unlock()

	fireOffline := false
	if h.rdb != nil {
		if localNowEmpty {
			key := presenceKey(c.userID)
			h.rdb.SRem(h.ctx, key, h.instanceID)
			if card, e := h.rdb.SCard(h.ctx, key).Result(); e == nil && card == 0 {
				fireOffline = true
			}
		}
	} else if localNowEmpty {
		fireOffline = true
	}
	if fireOffline && h.onOffline != nil {
		h.onOffline(c.userID)
	}
}

// IsOnline 用户是否在线（本实例或——多副本下——任一实例有连接）。
func (h *Hub) IsOnline(userID int64) bool {
	h.mu.RLock()
	local := len(h.clients[userID]) > 0
	h.mu.RUnlock()
	if local {
		return true
	}
	if h.rdb == nil {
		return false
	}
	n, err := h.rdb.Exists(h.ctx, presenceKey(userID)).Result()
	return err == nil && n > 0
}

// OnlineFilter 返回给定用户集合各自的在线状态（本地优先，余者查 Redis）。
func (h *Hub) OnlineFilter(userIDs []int64) map[int64]bool {
	out := make(map[int64]bool, len(userIDs))
	h.mu.RLock()
	for _, id := range userIDs {
		out[id] = len(h.clients[id]) > 0
	}
	h.mu.RUnlock()
	if h.rdb == nil {
		return out
	}
	pipe := h.rdb.Pipeline()
	cmds := make(map[int64]*redis.IntCmd)
	for _, id := range userIDs {
		if !out[id] {
			cmds[id] = pipe.Exists(h.ctx, presenceKey(id))
		}
	}
	if len(cmds) == 0 {
		return out
	}
	if _, err := pipe.Exec(h.ctx); err != nil {
		h.warnf("presence exists pipeline: %v", err)
		return out
	}
	for id, cmd := range cmds {
		if n, e := cmd.Result(); e == nil && n > 0 {
			out[id] = true
		}
	}
	return out
}

// SendToUser 向某用户推送：本实例连接直推 + （多副本下）经 Redis 广播给其他实例。
func (h *Hub) SendToUser(userID int64, payload []byte) {
	h.localSend(userID, payload)
	if h.rdb != nil {
		if b, err := json.Marshal(fanoutMsg{UserID: userID, Payload: string(payload), Origin: h.instanceID}); err == nil {
			h.rdb.Publish(h.ctx, fanoutChannel, b)
		}
	}
}

// SendToUsers 批量推送给多个用户。
func (h *Hub) SendToUsers(userIDs []int64, payload []byte) {
	for _, id := range userIDs {
		h.SendToUser(id, payload)
	}
}

// localSend 仅向本实例上该用户的连接非阻塞推送（缓冲满则丢弃）。
func (h *Hub) localSend(userID int64, payload []byte) {
	h.mu.RLock()
	set := h.clients[userID]
	targets := make([]*Client, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		select {
		case c.send <- payload:
		default:
		}
	}
}

// subscribe 订阅跨实例广播频道，把发往本实例在线用户的消息投递到本地连接。
func (h *Hub) subscribe() {
	sub := h.rdb.Subscribe(h.ctx, fanoutChannel)
	defer func() { _ = sub.Close() }()
	ch := sub.Channel()
	for {
		select {
		case <-h.ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var fm fanoutMsg
			if json.Unmarshal([]byte(msg.Payload), &fm) != nil {
				continue
			}
			if fm.Origin == h.instanceID {
				continue // 本实例已直推，跳过避免重复
			}
			h.localSend(fm.UserID, []byte(fm.Payload))
		}
	}
}

// presenceRefreshLoop 周期刷新本实例在线用户的 presence TTL，防止实例崩溃后在线状态残留。
func (h *Hub) presenceRefreshLoop() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-h.ctx.Done():
			return
		case <-ticker.C:
			h.mu.RLock()
			ids := make([]int64, 0, len(h.clients))
			for id := range h.clients {
				ids = append(ids, id)
			}
			h.mu.RUnlock()
			for _, id := range ids {
				key := presenceKey(id)
				pipe := h.rdb.Pipeline()
				pipe.SAdd(h.ctx, key, h.instanceID)
				pipe.Expire(h.ctx, key, presenceTTL)
				_, _ = pipe.Exec(h.ctx)
			}
		}
	}
}

func (h *Hub) warnf(format string, args ...interface{}) {
	if h.logger != nil {
		h.logger.Warnf("[im/hub] "+format, args...)
	}
}

// readPump 读取上行消息并维护心跳；连接出错即注销。
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		if c.onMessage != nil {
			c.onMessage(c.userID, raw)
		}
	}
}

// writePump 写出站消息并定时 ping 保活；quit 关闭或写错误即退出。
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-c.quit:
			return
		}
	}
}
