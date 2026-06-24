// Package chat owns the conversation (对话) routes (/api/im/*) plus their
// handler/service/repo/dto/vo. It mirrors the project domain's structure and
// conventions. All routes are authenticated: a conversation belongs to a single
// user (its owner) and only the owner may read or write it.
//
// Because there is no LLM key wired yet, sending a user message ALSO persists a
// canned, clearly-placeholder assistant reply so the chat UI has a round-trip.
package chat

import (
	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
)

// Register mounts the chat routes on the /api group under /im (matching the
// stub paths in internal/handler/stub/im.go).
//
// Frontend contract:
//
//	GET    /api/im/conversations               IMConversationQuery -> PageData<ConversationVO>  (auth)
//	POST   /api/im/conversations               {title?}            -> ConversationVO             (auth)
//	GET    /api/im/conversations/:id/messages  PageQuery           -> PageData<MessageVO>        (auth)
//	POST   /api/im/conversations/:id/messages  {content,type?}     -> MessageVO                  (auth)
//	POST   /api/im/conversations/:id/read                          -> void                       (auth)
//
// The :id param only ever appears under the static /conversations parent, so
// there is no static-vs-:param sibling conflict to make gin panic.
func Register(api *gin.RouterGroup, d *app.Deps) {
	svc := newService(d.DB, d.Cfg)
	h := newHandler(svc)

	g := api.Group("/im")
	g.Use(middleware.JWTAuth(d))

	conv := g.Group("/conversations")
	conv.GET("", h.listConversations)
	conv.POST("", h.createConversation)
	conv.GET("/:id/messages", h.listMessages)
	conv.POST("/:id/messages", h.sendMessage)
	conv.POST("/:id/read", h.markRead)
}
