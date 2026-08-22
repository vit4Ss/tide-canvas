package toolartifact

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

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
