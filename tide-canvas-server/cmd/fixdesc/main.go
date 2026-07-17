// fixdesc — 一次性运维工具：为 market_model 里描述为空的模型批量写入默认副标题。
//
//	go run ./cmd/fixdesc          # 只列出（dry-run）
//	go run ./cmd/fixdesc -apply   # 实际写库（仅覆盖 description 为空的行）
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"tidecanvas/internal/config"
	"tidecanvas/internal/db"
	"tidecanvas/internal/pkg/logger"
)

type row struct {
	ID          string
	Name        string
	ModelKey    string
	Type        string
	Description string
}

// 默认描述表：按模型名精确匹配（只在 description 为空时写入）。
// 文案原则：一句话副标题，先说定位、再说特点，避免营销话术。
var defaults = map[string]string{
	// 文本
	"GPT-5.5 (官方)":  "OpenAI 官方通道 · 对话与文案首选",
	"GPT-5.5":       "通用对话与创作 · 高性价比",
	"DeepSeek-V3.2": "深度求索旗舰 · 中文理解出色",

	// 图片
	"GPT Image 2(低价)":    "日常出图首选 · 低价通道",
	"GPT Image 2 (官方)":   "OpenAI 官方通道 · 指令理解精准",
	"GPT Image 2 (稳定)":   "稳定通道 · 高峰期成功率优先",
	"Nano Banana 2":      "谷歌极速出图 · 改图能力强",
	"Nano Banana 2 (2K)": "2K 高清出图 · 细节更丰富",
	"Nano Banana 2 (4K)": "4K 超清出图 · 大图打印级画质",
	"Midjourney":         "艺术风格标杆 · 氛围光影出色",

	// 视频
	"Seedance-2.0":                "字节视频旗舰 · 动作自然运镜流畅",
	"Seedance-2.0-Fast":           "快速出片 · 适合预览与试稿",
	"Seedance 2.0 VIP":            "高质量视频 · 画面细节优先",
	"Seedance 2.0 Fast VIP":       "快速通道 · 速度与画质兼顾",
	"Seedance 2.0 Mini":           "轻量视频生成 · 更省积分",
	"Seedance 2.0 Beta Face":      "人脸参考生成 · 人物形象一致",
	"Seedance 2.0 Fast Beta Face": "人脸参考 · 快速版",

	// 音频
	"Gemini Flash TTS": "谷歌语音合成 · 自然流畅",
	"MAI-Voice-2":      "微软语音合成 · 拟真人声",
	"Voxtral Mini TTS": "轻量语音合成 · 快速朗读",
	"Lyria 3 Pro":      "谷歌音乐生成 · 完整曲目",
	"Lyria 3 Clip":     "谷歌音乐生成 · 短片段配乐",

	// 音频 · Suno（音乐生成：描述一句话区分版本定位；音效卡单独说明用法）
	"Suno V4 (MXAPI)":   "完整歌曲生成 · 词曲唱一体",
	"Suno V4.5 (MXAPI)": "曲风更丰富 · 人声更自然",
	"Suno V5 (MXAPI)":   "新一代音质 · 编曲层次分明",
	"Suno V5.5 (MXAPI)": "旗舰版本 · 情感表达细腻",
	"Suno 音效 (MXAPI)":   "文字生成音效 · 短促干净可循环",
}

func main() {
	apply := flag.Bool("apply", false, "实际写库（默认 dry-run 只打印）")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "config:", err)
		os.Exit(1)
	}
	logger.Init(true)
	gdb, err := db.Open(cfg.MySQL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "db:", err)
		os.Exit(1)
	}

	var rows []row
	if err := gdb.Raw(
		"SELECT id, name, model_key, type, description FROM market_model WHERE deleted IS NULL ORDER BY type, name",
	).Scan(&rows).Error; err != nil {
		fmt.Fprintln(os.Stderr, "query:", err)
		os.Exit(1)
	}

	for _, r := range rows {
		mark := " "
		if strings.TrimSpace(r.Description) == "" {
			mark = "*"
		}
		fmt.Printf("%s [%s] %-32s key=%-28s desc=%q\n", mark, r.Type, r.Name, r.ModelKey, r.Description)
	}

	if !*apply {
		fmt.Println("\n(dry-run；带 * 的行 description 为空。-apply 后按 defaults 表写入)")
		return
	}
	n := 0
	for _, r := range rows {
		if strings.TrimSpace(r.Description) != "" {
			continue
		}
		d, ok := defaults[r.Name]
		if !ok {
			fmt.Printf("SKIP（defaults 表无此模型）: %s\n", r.Name)
			continue
		}
		if err := gdb.Exec(
			"UPDATE market_model SET description = ? WHERE id = ? AND (description IS NULL OR description = '')",
			d, r.ID,
		).Error; err != nil {
			fmt.Fprintln(os.Stderr, "update", r.Name, ":", err)
			os.Exit(1)
		}
		n++
		fmt.Printf("OK %-32s ← %s\n", r.Name, d)
	}
	fmt.Printf("已更新 %d 个模型\n", n)
}
