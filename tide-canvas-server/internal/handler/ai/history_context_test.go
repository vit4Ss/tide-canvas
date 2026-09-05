package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/relaychat"
)

func TestCanvasAndSkillTextLimitHistoryAtExecution(t *testing.T) {
	for _, skill := range []bool{false, true} {
		for _, size := range []int{0, 2, 3, 7, 40} {
			t.Run(fmt.Sprintf("skill=%t/history=%d", skill, size), func(t *testing.T) {
				requests := make(chan []relaychat.Msg, 1)
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
				history := make([]map[string]string, size)
				for i := range history {
					history[i] = map[string]string{"role": "user", "content": fmt.Sprintf("history-%d", i)}
				}
				input := map[string]any{"prompt": "current", "systemPrompt": "skill policy", "messages": history}
				svc := &service{relay: relaychat.New(srv.URL, "test")}
				m := &model.AiModel{ModelID: "test"}
				var err error
				if skill {
					_, err = svc.runSkillTextCompletion(context.Background(), idgen.Next(), idgen.Next(), m, input, 0)
				} else {
					_, err = svc.runAssistantChat(context.Background(), idgen.Next(), idgen.Next(), m, input, 0)
				}
				if err != nil {
					t.Fatal(err)
				}
				messages := <-requests
				n := min(size, 3)
				if len(messages) != n+2 || messages[0].Role != "system" || messages[len(messages)-1].Content != "current" {
					t.Fatalf("bad history envelope: %+v", messages)
				}
				for i := 0; i < n; i++ {
					if messages[i+1].Content != history[size-n+i]["content"] {
						t.Fatalf("wrong history item: %+v", messages[i+1])
					}
				}
				if len(input["messages"].([]map[string]string)) != size {
					t.Fatal("persisted/retry input was mutated")
				}
			})
		}
	}
}
