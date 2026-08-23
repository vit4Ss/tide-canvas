package toolartifact

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/xml"
	"io"
	"regexp"
	"strconv"
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
	data, err := RenderDOCX(Document{Title: "项目复盘", Summary: "核心结论", Sections: []DocumentSection{{Heading: "结论", Paragraphs: []string{"按计划完成。"}, Bullets: []string{"保留做法"}, Numbered: []string{"确认负责人"}, Table: &DocumentTable{Headers: []string{"指标", "结果"}, Rows: [][]string{{"进度", "完成"}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/header1.xml", "word/footer1.xml")
	document := string(packagePart(t, data, "word/document.xml"))
	for _, required := range []string{`w:numId w:val="1"`, `w:numId w:val="2"`, `w:tblW w:w="9360"`, `w:tblHeader`, `w:cantSplit`} {
		if !strings.Contains(document, required) {
			t.Fatalf("professional Word structure is missing %s", required)
		}
	}
	if strings.Contains(document, "•保留做法") || strings.Contains(document, "• 保留做法") {
		t.Fatal("Word bullets must use numbering definitions, not fake bullet text")
	}
}

func TestRenderXLSXBuildsWorkbookPackage(t *testing.T) {
	data, err := RenderXLSX(Workbook{Title: "预算", Sheets: []Sheet{
		{Name: "明细", Purpose: "金额单位：元", Columns: []SheetColumn{{Header: "项目", Type: "text"}, {Header: "金额", Type: "currency"}, {Header: "占比", Type: "percent"}}, Rows: [][]any{{"设计\x01", 1200.0, map[string]any{"formula": "=B5/SUM(B5:B6)", "value": 0.5}}, {"开发", 1200.0, map[string]any{"formula": "=B6/SUM(B5:B6)", "value": 0.5}}}},
		{Name: "明细", Rows: [][]any{{"重复工作表名"}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/theme/theme1.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml")
	worksheet := string(packagePart(t, data, "xl/worksheets/sheet1.xml"))
	for _, required := range []string{`ySplit="4"`, `<autoFilter ref="A4:C6"/>`, `<f>B5/SUM(B5:B6)</f>`, `<cols>`, `showGridLines="0"`} {
		if !strings.Contains(worksheet, required) {
			t.Fatalf("professional workbook structure is missing %s", required)
		}
	}
	styles := string(packagePart(t, data, "xl/styles.xml"))
	for _, required := range []string{"0.0%", "¥#,##0.00", `<cellXfs count="9">`} {
		if !strings.Contains(styles, required) {
			t.Fatalf("workbook styles are missing %s", required)
		}
	}
	if strings.Contains(worksheetXML([][]any{{nil}}), "nil") {
		t.Fatal("JSON null must render as an empty cell, not a Go diagnostic string")
	}
}

func TestSpreadsheetFormulaSafetyRejectsExternalAndActiveContent(t *testing.T) {
	for _, formula := range []string{
		`=HYPERLINK("https://example.com","open")`,
		`='[external.xlsx]Sheet1'!A1`,
		`=WEBSERVICE("https://example.com")`,
	} {
		if value, ok := safeSpreadsheetFormula(formula); ok {
			t.Fatalf("unsafe formula was accepted: %s", value)
		}
	}
	if value, ok := safeSpreadsheetFormula(`=SUM(B5:B8)`); !ok || value != "SUM(B5:B8)" {
		t.Fatalf("safe formula was rejected: %q %v", value, ok)
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
	if !strings.Contains(cover, `r:embed="rId2"`) || !strings.Contains(cover, `sz="6200"`) {
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

func TestRenderPPTXAutoPlacesEveryReferenceAndKeepsTimelineInsideCanvas(t *testing.T) {
	imageData, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	data, err := RenderPPTX(Presentation{
		Title: "Visual system", Theme: "launch", Accent: "AUTO",
		Images: []PresentationImage{
			{Data: imageData, Extension: "png", ContentType: "image/png", Width: 1, Height: 1},
			{Data: imageData, Extension: "png", ContentType: "image/png", Width: 1, Height: 1},
		},
		Slides: []Slide{
			{Kind: "cover", Title: "Evidence-led narrative"},
			{Kind: "timeline", Title: "Four bounded steps", Bullets: []string{"Discover", "Frame", "Design", "Deliver"}},
			{Kind: "content", Title: "The second reference is assigned automatically", Bullets: []string{"No source image disappears silently"}},
			{Kind: "closing", Title: "Decide and act"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	assertPackageParts(t, data, "ppt/media/image1.png", "ppt/media/image2.png")
	coverRels := string(packagePart(t, data, "ppt/slides/_rels/slide1.xml.rels"))
	contentRels := string(packagePart(t, data, "ppt/slides/_rels/slide3.xml.rels"))
	if !strings.Contains(coverRels, "image1.png") || !strings.Contains(contentRels, "image2.png") {
		t.Fatal("reference images were not assigned to visible slides")
	}

	timeline := string(packagePart(t, data, "ppt/slides/slide2.xml"))
	geometry := regexp.MustCompile(`<a:off x="(\d+)" y="(\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>`)
	for _, match := range geometry.FindAllStringSubmatch(timeline, -1) {
		x, _ := strconv.Atoi(match[1])
		y, _ := strconv.Atoi(match[2])
		width, _ := strconv.Atoi(match[3])
		height, _ := strconv.Atoi(match[4])
		if x < 0 || y < 0 || x+width > pptSlideWidth || y+height > pptSlideHeight {
			t.Fatalf("timeline shape exceeds slide bounds: x=%d y=%d width=%d height=%d", x, y, width, height)
		}
	}
}
