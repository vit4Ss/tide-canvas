package ai

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

func TestExtractXLSXResolvesSharedStrings(t *testing.T) {
	var data bytes.Buffer
	writer := zip.NewWriter(&data)
	shared, err := writer.Create("xl/sharedStrings.xml")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = shared.Write([]byte(`<sst><si><t>项目名称</t></si><si><t>TideCanvas</t></si></sst>`))
	sheet, err := writer.Create("xl/worksheets/sheet1.xml")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = sheet.Write([]byte(`<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>`))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	sections := extractXLSX(data.Bytes())
	if len(sections) != 1 {
		t.Fatalf("expected one sheet, got %d", len(sections))
	}
	if !strings.Contains(sections[0].Text, "A1=项目名称") || !strings.Contains(sections[0].Text, "B1=TideCanvas") {
		t.Fatalf("unexpected extracted sheet: %q", sections[0].Text)
	}
}

func TestSelectRelevantChunksPrefersPromptMatch(t *testing.T) {
	chunks := []documentChunk{
		{Index: 0, Text: "视频生成模型与时长参数"},
		{Index: 1, Text: "存储空间额度与附件清理策略"},
	}
	selected := selectRelevantChunks(chunks, "存储空间如何计算", 20)
	if len(selected) == 0 || selected[0].Index != 1 {
		t.Fatalf("expected storage chunk, got %#v", selected)
	}
}

func TestLegacyGPTCapabilityInference(t *testing.T) {
	gpt := &model.AiModel{ModelID: "gpt-5.5", Name: "GPT 5.5", Type: "text"}
	capabilities := decodeCapabilities(gpt)
	if !boolCapability(capabilities, "multimodal") || !boolCapability(capabilities, "nativeFiles") || !boolCapability(capabilities, "streaming") {
		t.Fatalf("expected inferred GPT capabilities, got %#v", capabilities)
	}
	deepseek := &model.AiModel{ModelID: "deepseek-chat", Name: "DeepSeek", Type: "text"}
	if boolCapability(decodeCapabilities(deepseek), "multimodal") {
		t.Fatal("DeepSeek must not be inferred as multimodal")
	}
}
