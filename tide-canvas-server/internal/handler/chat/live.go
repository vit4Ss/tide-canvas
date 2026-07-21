package chat

import (
	"sync"

	"tidecanvas/internal/pkg/idgen"
)

// live.go — 生成中回复的内存缓存与订阅（GPT/Claude 式「断开重连续播」）。
//
// streamReply 已与客户端连接解耦（context.WithoutCancel）：断开后生成继续。
// 这里再把生成中的增量缓存在内存里，前端刷新/切页回来后通过
// GET /conversations/:id/stream 重新附着：先一次性补发已生成的快照，再逐字
// 续播后续增量，完成时下发与 POST /stream 相同的 done 帧。
//
// 广播用「快照 + 版本通知」而非每订阅者一条 channel：追加时关闭 wait 唤醒
// 所有等待者，订阅者按自己的 offset 从全量缓冲切片补差——没有背压、不丢帧，
// 慢读者最多多切几次。单机内存注册表即可（每实例一份；多实例部署时附着请求
// 需与生成请求同实例，当前测试/生产均为单实例）。

// liveReply is one in-progress assistant reply: the accumulated text plus a
// broadcast primitive for subscribers.
type liveReply struct {
	mu   sync.Mutex
	buf  []byte
	wait chan struct{} // closed (and replaced) on every append; closed for good on finish
	done bool
	// final is the persisted assistant message, set on successful finish; nil on
	// error terminations (subscribers fall back to a generic error frame).
	final *MessageVO
}

func newLiveReply() *liveReply {
	return &liveReply{wait: make(chan struct{})}
}

// append adds a delta and wakes all subscribers. No-op after finish.
func (lr *liveReply) append(d string) {
	lr.mu.Lock()
	if !lr.done {
		lr.buf = append(lr.buf, d...)
		close(lr.wait)
		lr.wait = make(chan struct{})
	}
	lr.mu.Unlock()
}

// finish marks the reply terminal (idempotent) and wakes all subscribers.
func (lr *liveReply) finish(final *MessageVO) {
	lr.mu.Lock()
	if !lr.done {
		lr.done = true
		lr.final = final
		close(lr.wait)
	}
	lr.mu.Unlock()
}

// state snapshots the current text/terminal state plus the wait channel valid
// for exactly this state (append/finish close it, so select{<-wait} wakes on
// any progress past the snapshot).
func (lr *liveReply) state() (text string, wait chan struct{}, done bool, final *MessageVO) {
	lr.mu.Lock()
	defer lr.mu.Unlock()
	return string(lr.buf), lr.wait, lr.done, lr.final
}

// liveStart registers a fresh live reply for the conversation (replacing any
// stale one) and returns it.
func (s *service) liveStart(conversationID idgen.ID) *liveReply {
	lr := newLiveReply()
	s.liveMu.Lock()
	s.live[conversationID] = lr
	s.liveMu.Unlock()
	return lr
}

// liveEnd removes the registry entry (only if still ours) and force-finishes
// the reply so no subscriber can wait forever — safety net for error returns.
func (s *service) liveEnd(conversationID idgen.ID, lr *liveReply) {
	s.liveMu.Lock()
	if s.live[conversationID] == lr {
		delete(s.live, conversationID)
	}
	s.liveMu.Unlock()
	lr.finish(nil)
}

// attachLive returns the conversation's in-progress reply after an ownership
// check; nil when nothing is generating (reply already persisted, never started
// or the server restarted).
func (s *service) attachLive(conversationID, ownerID idgen.ID) (*liveReply, error) {
	conv, err := s.repo.findConversation(conversationID)
	if err != nil {
		return nil, err
	}
	if conv.OwnerID != ownerID {
		return nil, errForbidden
	}
	s.liveMu.Lock()
	lr := s.live[conversationID]
	s.liveMu.Unlock()
	return lr, nil
}
