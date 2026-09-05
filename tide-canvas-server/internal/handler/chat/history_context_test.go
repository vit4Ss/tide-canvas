package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
)

func TestTextCallsSendThreeHistoryMessagesPlusCurrentWithoutLegacySummary(t *testing.T) {
	for _, tc := range []struct {
		stream      bool
		currentType string
		historySize int
		attachments bool
	}{
		{false, "text", 6, false}, {true, "text", 6, false},
		{false, "image", 6, false}, {false, "file", 6, false},
		{false, "file", 6, true}, {true, "text", 6, true},
		{false, "text", 0, false}, {true, "text", 0, false},
		{false, "text", 2, false}, {true, "text", 2, false},
	} {
		t.Run(fmt.Sprintf("stream=%t/current=%s/history=%d/attachments=%t", tc.stream, tc.currentType, tc.historySize, tc.attachments), func(t *testing.T) {
			db := openPersistTurnTestDB(t)
			if err := db.AutoMigrate(&model.MarketModel{}, &model.SysConfig{}, &model.SkillRunArtifact{}); err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.MarketModel{Name: "test", ModelKey: "test", Type: "text", Status: 1}).Error; err != nil {
				t.Fatal(err)
			}
			owner := idgen.Next()
			conv := &model.IMConversation{BaseModel: model.BaseModel{ID: idgen.Next()}, OwnerID: owner, Type: "ai", ContextSummary: strings.Repeat("old summary", 1000)}
			if err := db.Create(conv).Error; err != nil {
				t.Fatal(err)
			}
			var current idgen.ID
			for i := 0; i < tc.historySize+2; i++ {
				content := fmt.Sprintf("message-%d", i)
				if i < tc.historySize-3 {
					content = strings.Repeat("older context", 1000)
				}
				sender := owner
				if i%2 == 1 {
					sender = assistantSenderID
				}
				row := &model.IMMessage{ConversationID: conv.ID, SenderID: sender, ContentType: "text", Content: content}
				if i == tc.historySize {
					row.ContentType = tc.currentType
				}
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
				if i == tc.historySize {
					current = row.ID
				}
				conv.SummaryUptoID = row.ID // A legacy summary covering these rows must be ignored.
			}
			if err := db.Model(conv).Update("summary_upto_id", conv.SummaryUptoID).Error; err != nil {
				t.Fatal(err)
			}
			// A foreign conversation must never supply history.
			if err := db.Create(&model.IMMessage{ConversationID: idgen.Next(), SenderID: owner, ContentType: "text", Content: "foreign"}).Error; err != nil {
				t.Fatal(err)
			}
			requests := make(chan []relaychat.Msg, 2)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload struct {
					Messages []relaychat.Msg `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				requests <- payload.Messages
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")
			}))
			defer srv.Close()
			svc := &service{repo: newRepo(db), relay: relaychat.New(srv.URL, "test"), systemPrompt: "system policy", ctxTokenLimit: 100}
			// Neither old rows nor the old summary should make the small current window full.
			if err := svc.guardContext(conv, "next"); err != nil {
				t.Fatal(err)
			}
			usage, err := svc.contextUsage(conv.ID, owner)
			if err != nil || usage.Compressed || usage.Full {
				t.Fatalf("context usage = %#v, %v", usage, err)
			}
			var reply string
			currentContent := fmt.Sprintf("message-%d", tc.historySize)
			var images []string
			var files []relaychat.FileAttachment
			docNote := ""
			if tc.attachments {
				images = []string{"https://example.com/current.png"}
				files = []relaychat.FileAttachment{{Filename: "current.txt", DataURI: "data:text/plain;base64,Y3VycmVudA=="}}
				docNote = "current attachment note"
			}
			if tc.stream {
				reply, _ = svc.streamReply(context.Background(), conv, owner, current, currentContent, docNote, files, images, "test", "skill policy", false, nil, nil)
			} else {
				reply = svc.generateReply(context.Background(), conv, owner, current, currentContent, docNote, files, images, "test", "skill policy", false, nil)
			}
			if reply != "ok" {
				t.Fatalf("reply = %q", reply)
			}
			messages := <-requests
			want := []relaychat.Msg{relaychat.TextMsg("system", "system policy"), relaychat.TextMsg("system", "skill policy")}
			for i := max(0, tc.historySize-3); i < tc.historySize; i++ {
				role := "user"
				if i%2 == 1 {
					role = "assistant"
				}
				want = append(want, relaychat.TextMsg(role, fmt.Sprintf("message-%d", i)))
			}
			if docNote != "" {
				currentContent += "\n\n" + docNote
			}
			want = append(want, relaychat.UserWithAttachments(currentContent, images, files))
			// Normalize typed attachment parts to the JSON representation captured upstream.
			encoded, _ := json.Marshal(want)
			_ = json.Unmarshal(encoded, &want)
			if len(messages) != len(want) {
				t.Fatalf("sent %d messages, want %d", len(messages), len(want))
			}
			for i := range want {
				if !reflect.DeepEqual(messages[i], want[i]) {
					t.Fatalf("message %d differs from expected historical window: %#v", i, messages[i])
				}
			}
			var count int64
			if err := db.Model(&model.IMMessage{}).Where("conversation_id = ?", conv.ID).Count(&count).Error; err != nil || count != int64(tc.historySize+2) {
				t.Fatalf("history was altered: %d, %v", count, err)
			}
		})
	}
}
