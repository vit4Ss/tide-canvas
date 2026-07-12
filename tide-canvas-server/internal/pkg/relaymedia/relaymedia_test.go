package relaymedia

import (
	"encoding/json"
	"testing"
)

// 上游错误体两种真实形态都必须能解析（2026-07-13 用户实测：部分 400 返回
// {"error":"..."} 字符串形，严格对象结构曾把真实原因吞成 json 解析错误）。
func TestMediaErrorFlexibleUnmarshal(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "object form",
			body: `{"status":"failed","error":{"message":"invalid resolution for quality low","type":"invalid_request_error","code":"bad_params"}}`,
			want: "invalid resolution for quality low",
		},
		{
			name: "string form",
			body: `{"error":"分辨率 2k 不支持 low 档"}`,
			want: "分辨率 2k 不支持 low 档",
		},
		{
			name: "numeric code",
			body: `{"error":{"message":"quota exceeded","code":400}}`,
			want: "quota exceeded",
		},
	}
	for _, tc := range cases {
		var mr mediaResp
		if err := json.Unmarshal([]byte(tc.body), &mr); err != nil {
			t.Errorf("%s: unmarshal failed: %v", tc.name, err)
			continue
		}
		if mr.Error == nil || mr.Error.Message != tc.want {
			t.Errorf("%s: error = %+v, want message %q", tc.name, mr.Error, tc.want)
		}
	}
	// numeric code round-trips as string
	var mr mediaResp
	_ = json.Unmarshal([]byte(`{"error":{"message":"m","code":400}}`), &mr)
	if mr.Error.Code != "400" {
		t.Errorf("numeric code = %q, want \"400\"", mr.Error.Code)
	}
}
