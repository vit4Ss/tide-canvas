package auth

import "testing"

func TestValidateUsername(t *testing.T) {
	valid := []string{"alice", "Bob_2024", "user_name", "Zhang_san1", "abcd"}
	for _, v := range valid {
		if err := validateUsername(v); err != nil {
			t.Errorf("validateUsername(%q) = %v, want nil", v, err)
		}
	}
	invalid := map[string]string{
		"abc":                    "太短(3位)",
		"a234567890123456789012": "超长(>20)",
		"1abcd":                  "数字开头",
		"_abcd":                  "下划线开头",
		"ab cd":                  "含空格",
		"ab-cd":                  "含连字符",
		"张三abcd":                 "含非 ASCII",
		"a@b.com":                "邮箱形态",
		"12345678":               "纯数字(数字开头)",
		"admin":                  "保留前缀",
		"Administrator":          "保留前缀(大小写)",
		"admin_ops":              "admin 前缀",
		"official_x":             "official 前缀",
		"root":                   "保留字",
		"FlowingLight":           "保留字(大小写)",
	}
	for v, why := range invalid {
		if err := validateUsername(v); err == nil {
			t.Errorf("validateUsername(%q) = nil, want error (%s)", v, why)
		}
	}
}

func TestValidatePasswordStrict(t *testing.T) {
	ok := []struct{ pw, uname string }{
		{"Fl0wing!ight", "alice"},
		{"abcDEF12", "alice"},  // 小写+大写+数字 = 三类
		{"abc123!@#", "alice"}, // 小写+数字+符号 = 三类
		{"Xy9#kQ2m", "bob_2024"},
		{"S3cure_Pass_2026", "carol"},
	}
	for _, c := range ok {
		if err := validatePasswordStrict(c.pw, c.uname); err != nil {
			t.Errorf("validatePasswordStrict(%q, %q) = %v, want nil", c.pw, c.uname, err)
		}
	}
	bad := []struct {
		pw, uname, why string
	}{
		{"Ab1!x", "alice", "过短"},
		{"abcdefgh", "alice", "仅一类"},
		{"abcd1234", "alice", "仅两类"},
		{"ABCD1234", "alice", "仅两类(大写+数字)"},
		{"Abc 1234!", "alice", "含空格"},
		{"Alice#2024", "alice", "包含用户名(大小写不敏感)"},
		{"xxBob_2024!7", "Bob_2024", "包含用户名"},
		{"P@ssw0rd", "alice", "常见弱密码(三类也拦)"},
		{"Admin@123", "alice", "常见弱密码"},
		{"1q2w3e4r", "alice", "常见弱密码"},
		{"密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密码密", "alice", "超过 72 字节"},
	}
	for _, c := range bad {
		if err := validatePasswordStrict(c.pw, c.uname); err == nil {
			t.Errorf("validatePasswordStrict(%q, %q) = nil, want error (%s)", c.pw, c.uname, c.why)
		}
	}
}
