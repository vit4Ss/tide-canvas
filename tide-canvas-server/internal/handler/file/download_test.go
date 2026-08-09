package file

import "testing"

// 下载名补扩展名：按「结尾是否已是 URL 的扩展名」判定——模型名带版本点号
// （qwen-image-3.0-pro / Hunyuan 3D 3.1）时旧的「无点才补」会吞掉扩展名。
func TestDownloadFilename(t *testing.T) {
	cases := []struct {
		name    string
		urlPath string
		want    string
	}{
		// 版本点号不再抑制补扩展名（本次修复的主场景）
		{"qwen-image-3.0-pro", "/gen/abc.png", "qwen-image-3.0-pro.png"},
		{"Hunyuan 3D 3.1 (Tencent MaaS)", "/models/dog.glb", "Hunyuan 3D 3.1 (Tencent MaaS).glb"},
		// 已带同扩展名（含大小写差异）不重复追加
		{"photo.png", "/gen/abc.png", "photo.png"},
		{"photo.PNG", "/gen/abc.png", "photo.PNG"},
		// 前端已拼好扩展名的 3D 下载名，服务端不再二次追加
		{"Hunyuan 3D 3.1 (Tencent MaaS).glb", "/models/dog.glb", "Hunyuan 3D 3.1 (Tencent MaaS).glb"},
		// URL 无扩展名时保持原名
		{"qwen-image-3.0-pro", "/gen/abc", "qwen-image-3.0-pro"},
		// 空名回退 download（原有行为）
		{"", "/gen/abc.mp4", "download.mp4"},
		{"", "/gen/abc", "download"},
		// 扩展名不同则按实际字节的格式追加
		{"song.mp3", "/gen/track.wav", "song.mp3.wav"},
	}
	for _, tc := range cases {
		if got := downloadFilename(tc.name, tc.urlPath); got != tc.want {
			t.Errorf("downloadFilename(%q, %q) = %q, want %q", tc.name, tc.urlPath, got, tc.want)
		}
	}
}
