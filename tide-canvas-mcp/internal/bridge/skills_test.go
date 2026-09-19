package bridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestSkillHTTPEndpointsBindToolsAndUserCredentials(t *testing.T) {
	var mu sync.Mutex
	disabled := false
	var submissions []string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path == "/api/mcp/config" {
			writeDefaultTestPolicy(w)
			return
		}
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if key != "key-a" && key != "key-b" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/api/integrations/identity" {
			_ = json.NewEncoder(w).Encode(Identity{UserID: key, Points: 100})
			return
		}
		ok := func(v any) { _ = json.NewEncoder(w).Encode(map[string]any{"success": true, "code": 200, "data": v}) }
		prefix := "/api/open/v1/mcp/skills/"
		rest := strings.TrimPrefix(r.URL.Path, prefix)
		if !strings.Contains(rest, "/") && (rest == "101" || rest == "102") {
			if disabled {
				owned := false
				for _, submitted := range submissions {
					if strings.HasPrefix(submitted, rest+"/runs:"+key+":") {
						owned = true
						break
					}
				}
				if !owned {
					w.WriteHeader(404)
					return
				}
			}
			ok(map[string]any{"id": rest, "enabled": !disabled, "title": "Skill " + rest, "description": "公开能力说明", "inputSchema": map[string]any{"type": "object"}, "outputTypes": []string{"text"}, "versionId": "11", "promptTemplate": "private-source"})
			return
		}
		if r.Method == "POST" && rest == "101/runs/9001/actions" && key == "key-a" {
			var action SkillActionInput
			if json.NewDecoder(r.Body).Decode(&action) != nil || action.Action != "cancel" {
				t.Error("closed Skill forwarded a non-cancel action")
				w.WriteHeader(403)
				return
			}
			ok(map[string]any{"id": "9001", "skillId": "101", "status": "cancelled", "progress": 100, "revision": 2, "pointCost": 0, "artifacts": []any{}})
			return
		}
		if r.Method == "POST" && (rest == "101/runs" || rest == "102/runs") {
			var input RunSkillInput
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				w.WriteHeader(400)
				return
			}
			submissions = append(submissions, rest+":"+key+":"+input.ClientRequestID)
			ok(map[string]any{"id": "9001", "skillId": strings.Split(rest, "/")[0], "status": "queued", "revision": 0, "progress": 0, "pointCost": 0, "artifacts": []any{}})
			return
		}
		if rest == "101/runs/9001" && key == "key-a" {
			ok(map[string]any{"id": "9001", "skillId": "101", "status": "succeeded", "revision": 1, "progress": 100, "pointCost": 7, "artifacts": []any{map[string]any{"type": "text", "text": "public result", "isFinal": true}}})
			return
		}
		w.WriteHeader(404)
	}))
	defer api.Close()
	c, err := NewClient(api.URL)
	if err != nil {
		t.Fatal(err)
	}
	h, err := NewHTTPHandler(c, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()
	connectSkill := func(id, key string) *mcp.ClientSession {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		t.Cleanup(cancel)
		client := mcp.NewClient(&mcp.Implementation{Name: "skill-test", Version: "1"}, nil)
		session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: srv.URL + "/mcp/skills/" + id, HTTPClient: &http.Client{Transport: bearerTransport{key: key}}}, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = session.Close() })
		return session
	}
	a, b := connectSkill("101", "key-a"), connectSkill("102", "key-b")
	listed, err := a.ListTools(context.Background(), nil)
	if err != nil || len(listed.Tools) != 5 {
		t.Fatalf("tools=%+v err=%v", listed, err)
	}
	encoded, _ := json.Marshal(listed)
	if strings.Contains(string(encoded), "private-source") || strings.Contains(string(encoded), "generate_image") {
		t.Fatalf("wrong skill tools: %s", encoded)
	}
	info := call(t, a, "get_skill_info", map[string]any{})
	encoded, _ = json.Marshal(info)
	if info.IsError || strings.Contains(string(encoded), "private-source") || !strings.Contains(string(encoded), "101") {
		t.Fatalf("unsafe skill info: %s", encoded)
	}
	args := RunSkillInput{ClientRequestID: "one", Input: SkillRunInput{Prompt: "make report"}}
	if call(t, a, "run_skill", args).IsError || call(t, b, "run_skill", args).IsError {
		t.Fatal("skill run submission failed")
	}
	mu.Lock()
	got := append([]string{}, submissions...)
	mu.Unlock()
	if len(got) != 2 || got[0] != "101/runs:key-a:one" || got[1] != "102/runs:key-b:one" {
		t.Fatalf("scope/credential mixup: %v", got)
	}
	if call(t, a, "get_skill_run", SkillRunQuery{RunID: "9001"}).IsError {
		t.Fatal("owner query failed")
	}
	if !call(t, b, "get_skill_run", SkillRunQuery{RunID: "9001"}).IsError {
		t.Fatal("foreign skill run exposed")
	}
	if !call(t, a, "get_skill_run", SkillRunQuery{RunID: "../../102"}).IsError {
		t.Fatal("path injection accepted")
	}
	if call(t, a, "run_skill", map[string]any{"clientRequestId": "asset-only", "input": map[string]any{"assets": []any{map[string]any{"type": "image", "url": "https://cdn.test/owned.png"}}}}).IsError {
		t.Fatal("asset-only skill was rejected by MCP before applying its own input schema")
	}
	mu.Lock()
	disabled = true
	mu.Unlock()
	result, err := a.CallTool(context.Background(), &mcp.CallToolParams{Name: "run_skill", Arguments: args})
	if err == nil && !result.IsError {
		t.Fatal("disabled skill remained callable on existing connection")
	}
	listed, err = a.ListTools(context.Background(), nil)
	if err != nil || len(listed.Tools) != 4 {
		t.Fatalf("closed Skill management tools unavailable: %+v %v", listed, err)
	}
	for _, tool := range listed.Tools {
		if tool.Name == "run_skill" {
			t.Fatal("disabled submission tool remains listed")
		}
	}
	if call(t, a, "get_skill_run", SkillRunQuery{RunID: "9001"}).IsError {
		t.Fatal("owner cannot read accepted result after closing Skill")
	}
	if !call(t, a, "respond_skill_run", SkillActionInput{RunID: "9001", Action: "retry", ExpectedRevision: 1, ClientRequestID: "retry-closed"}).IsError {
		t.Fatal("closed Skill allowed continuation")
	}
	if call(t, a, "respond_skill_run", SkillActionInput{RunID: "9001", Action: "cancel", ExpectedRevision: 1, ClientRequestID: "cancel-closed"}).IsError {
		t.Fatal("owner cannot cancel accepted task after closing Skill")
	}
}

func TestSkillResultValidationRejectsMalformedOrUnrelatedTasks(t *testing.T) {
	valid := `{"id":"9001","skillId":"101","status":"running","revision":2,"progress":25,"pointCost":7,"artifacts":[]}`
	for _, raw := range []string{
		`null`, `{}`, strings.Replace(valid, `"id":"9001"`, `"id":9001`, 1), strings.Replace(valid, `"skillId":"101"`, `"skillId":"102"`, 1),
		strings.Replace(valid, `"id":"9001"`, `"id":"9002"`, 1), strings.Replace(valid, `"status":"running"`, `"status":"unknown"`, 1),
		strings.Replace(valid, `"revision":2`, `"revision":2.5`, 1), strings.Replace(valid, `"revision":2`, `"revision":-1`, 1),
		strings.Replace(valid, `"progress":25`, `"progress":101`, 1), strings.Replace(valid, `"pointCost":7`, `"pointCost":-7`, 1),
		strings.Replace(valid, `"status":"running"`, `"status":"waiting_input"`, 1),
		strings.Replace(valid, `"status":"running"`, `"status":"succeeded"`, 1),
	} {
		if _, err := parseSkillRun([]byte(raw), "101", "9001"); err == nil {
			t.Fatalf("accepted invalid response: %s", raw)
		}
	}
	if out, err := parseSkillRun([]byte(valid), "101", "9001"); err != nil || out.Status != "running" || out.PointCost != 7 {
		t.Fatalf("valid=%+v %v", out, err)
	}
	withPrivateFields := strings.TrimSuffix(valid, "}") + `,"promptTemplate":"private-internal","requestBody":"private-request"}`
	out, err := parseSkillRun([]byte(withPrivateFields), "101", "9001")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(out)
	if strings.Contains(string(encoded), "private-") {
		t.Fatal("unknown upstream fields were exposed")
	}
	confirmation := strings.Replace(valid, `"status":"running"`, `"status":"waiting_confirmation","pendingAction":{"type":"confirmation","schema":{"type":"object"}}`, 1)
	if _, err := parseSkillRun([]byte(confirmation), "101", "9001"); err != nil {
		t.Fatal(err)
	}
}

func TestAmbiguousSkillSubmissionRetainsRetryInstruction(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"success":true,"data":null}`)) }))
	defer api.Close()
	c, err := NewClient(api.URL)
	if err != nil {
		t.Fatal(err)
	}
	ctx := WithCredentials(context.Background(), Credentials{APIKey: "key-a"})
	if _, _, err := skillRequest(ctx, c, "POST", "/api/open/v1/mcp/skills/101/runs", "101", "", RunSkillInput{ClientRequestID: "one"}); err == nil || !strings.Contains(err.Error(), "原 clientRequestId") {
		t.Fatalf("ambiguous paid submit lost retry guard: %v", err)
	}
}
