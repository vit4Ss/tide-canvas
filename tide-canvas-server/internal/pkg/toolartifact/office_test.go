package toolartifact

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

func packagePart(t *testing.T, data []byte, name string) []byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		stream, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		value, err := io.ReadAll(stream)
		_ = stream.Close()
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	t.Fatalf("package is missing %s", name)
	return nil
}

func assertPackageParts(t *testing.T, data []byte, parts ...string) {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open OOXML package: %v", err)
	}
	seen := map[string]bool{}
	for _, file := range reader.File {
		seen[file.Name] = true
		if file.Name == "[Content_Types].xml" || strings.HasSuffix(file.Name, ".xml") || strings.HasSuffix(file.Name, ".rels") {
			stream, openErr := file.Open()
			if openErr != nil {
				t.Fatalf("open %s: %v", file.Name, openErr)
			}
			decoder := xml.NewDecoder(stream)
			for {
				if _, decodeErr := decoder.Token(); decodeErr != nil {
					if decodeErr != io.EOF {
						_ = stream.Close()
						t.Fatalf("%s is not well-formed XML: %v", file.Name, decodeErr)
					}
					break
				}
			}
			_ = stream.Close()
		}
	}
	for _, part := range parts {
		if !seen[part] {
			t.Errorf("package is missing %s", part)
		}
	}
}

func TestRenderDOCXBuildsWordPackage(t *testing.T) {
	data, err := RenderDOCX(Document{Title: "项目复盘", Sections: []DocumentSection{{Heading: "结论", Paragraphs: []string{"按计划完成。"}}}})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "[Content_Types].xml", "word/document.xml", "word/styles.xml")
}

func TestRenderXLSXBuildsWorkbookPackage(t *testing.T) {
	data, err := RenderXLSX(Workbook{Title: "预算", Sheets: []Sheet{
		{Name: "明细", Rows: [][]any{{"项目", "金额", "备注"}, {"设计\x01", 1200.0, nil}}},
		{Name: "明细", Rows: [][]any{{"重复工作表名"}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml")
	if strings.Contains(worksheetXML([][]any{{nil}}), "nil") {
		t.Fatal("JSON null must render as an empty cell, not a Go diagnostic string")
	}
}

func TestRenderPPTXBuildsPresentationPackage(t *testing.T) {
	data, err := RenderPPTX(Presentation{Title: "发布计划", Slides: []Slide{{Title: "目标", Bullets: []string{"稳定上线", "完成复盘"}}}})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/slideMasters/slideMaster1.xml")
}

func TestRenderPPTXBuildsCommercialLayoutsAndEmbedsReferenceImage(t *testing.T) {
	imageData, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderPPTX(Presentation{
		Title: "产品发布", Subtitle: "面向企业客户", Accent: "3D8DFF",
		Images: []PresentationImage{{Data: imageData, Extension: "png", ContentType: "image/png", Width: 1, Height: 1}},
		Slides: []Slide{
			{Kind: "cover", Title: "让复杂工作更简单", Subtitle: "新一代协作平台", ImageIndex: 1},
			{Kind: "metrics", Title: "效率提升来自三个关键指标", Metrics: []PresentationMetric{{Value: "42%", Label: "交付周期缩短"}, {Value: "3.2×", Label: "协作效率"}}},
			{Kind: "comparison", Title: "新方案减少重复交接", Columns: []PresentationColumn{{Heading: "过去", Body: "信息分散"}, {Heading: "现在", Body: "统一协作"}}},
			{Kind: "closing", Title: "从一个团队开始", Takeaway: "本周确认试点范围", Bullets: []string{"确定负责人", "启动试点"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "ppt/media/image1.png", "ppt/slides/_rels/slide1.xml.rels")
	cover := string(packagePart(t, data, "ppt/slides/slide1.xml"))
	if !strings.Contains(cover, `r:embed="rId2"`) || !strings.Contains(cover, `sz="5000"`) {
		t.Fatalf("cover lost image or commercial title hierarchy: %s", cover)
	}
	metrics := string(packagePart(t, data, "ppt/slides/slide2.xml"))
	if !strings.Contains(metrics, "42%") || !strings.Contains(metrics, "3.2×") {
		t.Fatal("metrics layout lost supplied evidence")
	}
}

func TestRenderPPTXPreservesDeckDefaultsAndStatementTitle(t *testing.T) {
	data, err := RenderPPTX(Presentation{
		Title: "默认标题", Subtitle: "默认副标题",
		Slides: []Slide{{Kind: "cover"}, {Kind: "statement", Title: "核心判断", Takeaway: "进一步解释"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	cover := string(packagePart(t, data, "ppt/slides/slide1.xml"))
	if !strings.Contains(cover, "默认标题") || !strings.Contains(cover, "默认副标题") {
		t.Fatal("cover did not inherit presentation title and subtitle")
	}
	statement := string(packagePart(t, data, "ppt/slides/slide2.xml"))
	if !strings.Contains(statement, "核心判断") || !strings.Contains(statement, "进一步解释") {
		t.Fatal("statement layout dropped its title or supporting takeaway")
	}
}
