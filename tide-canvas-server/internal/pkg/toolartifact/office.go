package toolartifact

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"
)

type Slide struct {
	Kind         string               `json:"kind"`
	Tone         string               `json:"tone"`
	Kicker       string               `json:"kicker"`
	Title        string               `json:"title"`
	Subtitle     string               `json:"subtitle"`
	Takeaway     string               `json:"takeaway"`
	Caption      string               `json:"caption"`
	Bullets      []string             `json:"bullets"`
	Metrics      []PresentationMetric `json:"metrics"`
	Columns      []PresentationColumn `json:"columns"`
	ImageIndex   int                  `json:"imageIndex"`
	ImageIndexes []int                `json:"imageIndexes"`
	Notes        string               `json:"notes"`
}

type Presentation struct {
	Title    string              `json:"title"`
	Subtitle string              `json:"subtitle"`
	Theme    string              `json:"theme"`
	Accent   string              `json:"accent"`
	Accent2  string              `json:"accent2"`
	Slides   []Slide             `json:"slides"`
	Images   []PresentationImage `json:"-"`
}

type PresentationMetric struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type PresentationColumn struct {
	Heading string   `json:"heading"`
	Body    string   `json:"body"`
	Bullets []string `json:"bullets"`
}

type PresentationImage struct {
	Data        []byte
	Extension   string
	ContentType string
	Name        string
	Width       int
	Height      int
}

type DocumentSection struct {
	Heading    string         `json:"heading"`
	Level      int            `json:"level"`
	Lead       string         `json:"lead"`
	Paragraphs []string       `json:"paragraphs"`
	Bullets    []string       `json:"bullets"`
	Numbered   []string       `json:"numbered"`
	Callout    string         `json:"callout"`
	Table      *DocumentTable `json:"table"`
}

type Document struct {
	Title    string            `json:"title"`
	Subtitle string            `json:"subtitle"`
	Author   string            `json:"author"`
	Date     string            `json:"date"`
	Summary  string            `json:"summary"`
	Accent   string            `json:"accent"`
	Sections []DocumentSection `json:"sections"`
}

type DocumentTable struct {
	Caption string     `json:"caption"`
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
}

type SheetColumn struct {
	Header string  `json:"header"`
	Type   string  `json:"type"`
	Format string  `json:"format"`
	Width  float64 `json:"width"`
}

type Sheet struct {
	Name       string        `json:"name"`
	Purpose    string        `json:"purpose"`
	Columns    []SheetColumn `json:"columns"`
	Rows       [][]any       `json:"rows"`
	FreezeRows int           `json:"freezeRows"`
	AutoFilter *bool         `json:"autoFilter"`
}

type Workbook struct {
	Title  string  `json:"title"`
	Accent string  `json:"accent"`
	Sheets []Sheet `json:"sheets"`
}

func xmlText(value string) string {
	value = strings.Map(func(r rune) rune {
		if r == '\t' || r == '\n' || r == '\r' || (r >= 0x20 && r <= 0xD7FF) || (r >= 0xE000 && r <= 0xFFFD) || (r >= 0x10000 && r <= 0x10FFFF) {
			return r
		}
		return -1
	}, value)
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(value))
	return b.String()
}

func zipFiles(files map[string]string) ([]byte, error) {
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, name := range sortedPartNames(files) {
		w, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(files[name])); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// sortedPartNames keeps package output deterministic without pulling another
// dependency into the server.
func sortedPartNames(files map[string]string) []string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
	return names
}

func renderLegacyDOCX(doc Document) ([]byte, error) {
	if strings.TrimSpace(doc.Title) == "" {
		doc.Title = "生成文档"
	}
	var body strings.Builder
	body.WriteString(paragraph(doc.Title, "Title"))
	if strings.TrimSpace(doc.Subtitle) != "" {
		body.WriteString(paragraph(doc.Subtitle, "Subtitle"))
	}
	for _, section := range doc.Sections {
		if strings.TrimSpace(section.Heading) != "" {
			body.WriteString(paragraph(section.Heading, "Heading1"))
		}
		for _, value := range section.Paragraphs {
			if strings.TrimSpace(value) != "" {
				body.WriteString(paragraph(value, ""))
			}
		}
		for _, value := range section.Bullets {
			if strings.TrimSpace(value) != "" {
				body.WriteString(paragraph("• "+strings.TrimSpace(value), ""))
			}
		}
	}
	files := map[string]string{
		"[Content_Types].xml":          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
		"_rels/.rels":                  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
		"word/document.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` + body.String() + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
		"word/styles.xml":              `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
		"docProps/core.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>` + xmlText(doc.Title) + `</dc:title><dc:creator>FlowingLight</dc:creator></cp:coreProperties>`,
		"docProps/app.xml":             `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FlowingLight</Application></Properties>`,
	}
	return zipFiles(files)
}

func paragraph(value, style string) string {
	styleXML := ""
	if style != "" {
		styleXML = `<w:pPr><w:pStyle w:val="` + style + `"/></w:pPr>`
	}
	return `<w:p>` + styleXML + `<w:r><w:t xml:space="preserve">` + xmlText(value) + `</w:t></w:r></w:p>`
}

func renderLegacyXLSX(book Workbook) ([]byte, error) {
	if len(book.Sheets) == 0 {
		book.Sheets = []Sheet{{Name: "Sheet1", Rows: [][]any{{"暂无数据"}}}}
	}
	var sheetsXML, relsXML, overrides strings.Builder
	files := map[string]string{}
	usedSheetNames := map[string]bool{}
	for i, sheet := range book.Sheets {
		name := uniqueSheetName(cleanSheetName(sheet.Name, i+1), usedSheetNames)
		id := i + 1
		sheetsXML.WriteString(fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlText(name), id, id))
		relsXML.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, id, id))
		overrides.WriteString(fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, id))
		files[fmt.Sprintf("xl/worksheets/sheet%d.xml", id)] = worksheetXML(sheet.Rows)
	}
	styleRelID := len(book.Sheets) + 1
	relsXML.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, styleRelID))
	files["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` + overrides.String() + `</Types>`
	files["_rels/.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
	files["xl/workbook.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` + sheetsXML.String() + `</sheets></workbook>`
	files["xl/_rels/workbook.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + relsXML.String() + `</Relationships>`
	files["xl/styles.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`
	return zipFiles(files)
}

func uniqueSheetName(base string, used map[string]bool) string {
	if !used[strings.ToLower(base)] {
		used[strings.ToLower(base)] = true
		return base
	}
	for index := 2; ; index++ {
		suffix := fmt.Sprintf(" (%d)", index)
		runes := []rune(base)
		if keep := 31 - len([]rune(suffix)); len(runes) > keep {
			runes = runes[:keep]
		}
		candidate := string(runes) + suffix
		key := strings.ToLower(candidate)
		if !used[key] {
			used[key] = true
			return candidate
		}
	}
}

func cleanSheetName(name string, index int) string {
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`[]:*?/\`, r) {
			return '-'
		}
		return r
	}, name)
	name = strings.Trim(strings.TrimSpace(name), "'")
	if name == "" {
		name = fmt.Sprintf("Sheet%d", index)
	} else if strings.EqualFold(name, "History") {
		name = "History 1"
	}
	runes := []rune(name)
	if len(runes) > 31 {
		name = string(runes[:31])
	}
	return name
}

func worksheetXML(rows [][]any) string {
	var body strings.Builder
	for r, row := range rows {
		body.WriteString(fmt.Sprintf(`<row r="%d">`, r+1))
		for c, value := range row {
			ref := columnName(c+1) + strconv.Itoa(r+1)
			switch v := value.(type) {
			case nil:
				// Preserve JSON null as an empty spreadsheet cell. Rendering the Go
				// diagnostic string "<nil>" would corrupt intentionally blank data.
				body.WriteString(fmt.Sprintf(`<c r="%s"/>`, ref))
			case float64:
				body.WriteString(fmt.Sprintf(`<c r="%s"><v>%s</v></c>`, ref, strconv.FormatFloat(v, 'f', -1, 64)))
			case float32:
				body.WriteString(fmt.Sprintf(`<c r="%s"><v>%s</v></c>`, ref, strconv.FormatFloat(float64(v), 'f', -1, 64)))
			case int:
				body.WriteString(fmt.Sprintf(`<c r="%s"><v>%d</v></c>`, ref, v))
			case int64:
				body.WriteString(fmt.Sprintf(`<c r="%s"><v>%d</v></c>`, ref, v))
			case bool:
				if v {
					body.WriteString(fmt.Sprintf(`<c r="%s" t="b"><v>1</v></c>`, ref))
				} else {
					body.WriteString(fmt.Sprintf(`<c r="%s" t="b"><v>0</v></c>`, ref))
				}
			default:
				text := []rune(fmt.Sprint(value))
				if len(text) > 32767 {
					text = text[:32767]
				}
				body.WriteString(fmt.Sprintf(`<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlText(string(text))))
			}
		}
		body.WriteString(`</row>`)
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` + body.String() + `</sheetData></worksheet>`
}

func columnName(value int) string {
	name := ""
	for value > 0 {
		value--
		name = string(rune('A'+value%26)) + name
		value /= 26
	}
	return name
}

func renderLegacyPPTX(deck Presentation) ([]byte, error) {
	if strings.TrimSpace(deck.Title) == "" {
		deck.Title = "生成演示文稿"
	}
	if len(deck.Slides) == 0 {
		deck.Slides = []Slide{{Kind: "cover", Title: deck.Title, Subtitle: deck.Subtitle}}
	}
	if strings.TrimSpace(deck.Slides[0].Title) == "" {
		deck.Slides[0].Title = deck.Title
	}
	if strings.TrimSpace(deck.Slides[0].Subtitle) == "" {
		deck.Slides[0].Subtitle = deck.Subtitle
	}
	accent := cleanPPTColor(deck.Accent, "3D8DFF")
	files := map[string]string{}
	var overrides, slideIDs, presentationRels, imageTypes strings.Builder
	seenImageTypes := map[string]bool{}
	for index, image := range deck.Images {
		extension, contentType := presentationImageType(image)
		if len(image.Data) == 0 || extension == "" {
			continue
		}
		files[fmt.Sprintf("ppt/media/image%d.%s", index+1, extension)] = string(image.Data)
		if !seenImageTypes[extension] {
			seenImageTypes[extension] = true
			imageTypes.WriteString(fmt.Sprintf(`<Default Extension="%s" ContentType="%s"/>`, extension, contentType))
		}
	}
	for i, slide := range deck.Slides {
		id := i + 1
		overrides.WriteString(fmt.Sprintf(`<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, id))
		slideIDs.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, 255+id, id))
		presentationRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, id, id))
		imageIndex := presentationSlideImageIndex(slide, i, len(deck.Images))
		var image *PresentationImage
		if imageIndex > 0 && imageIndex <= len(deck.Images) && len(deck.Images[imageIndex-1].Data) > 0 {
			image = &deck.Images[imageIndex-1]
		}
		files[fmt.Sprintf("ppt/slides/slide%d.xml", id)] = presentationSlideXML(slide, i, len(deck.Slides), accent, image)
		rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
		if image != nil {
			extension, _ := presentationImageType(*image)
			if extension != "" {
				rels += fmt.Sprintf(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image%d.%s"/>`, imageIndex, extension)
			}
		}
		files[fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", id)] = rels + `</Relationships>`
	}
	masterRelID := len(deck.Slides) + 1
	presentationRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`, masterRelID))
	files["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` + imageTypes.String() + `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>` + overrides.String() + `</Types>`
	files["_rels/.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
	files["ppt/presentation.xml"] = fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId%d"/></p:sldMasterIdLst><p:sldIdLst>%s</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`, masterRelID, slideIDs.String())
	files["ppt/_rels/presentation.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + presentationRels.String() + `</Relationships>`
	files["ppt/slideLayouts/slideLayout1.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
	files["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
	files["ppt/slideMasters/slideMaster1.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`
	files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
	files["ppt/theme/theme1.xml"] = themeXML
	files["ppt/presProps.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`
	files["ppt/viewProps.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr/><p:slideViewPr/><p:notesTextViewPr/><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`
	files["ppt/tableStyles.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`
	return zipFiles(files)
}

const (
	pptSlideWidth  = 12192000
	pptSlideHeight = 6858000
)

func presentationSlideImageIndex(slide Slide, index, imageCount int) int {
	if slide.ImageIndex > 0 && slide.ImageIndex <= imageCount {
		return slide.ImageIndex
	}
	kind := strings.ToLower(strings.TrimSpace(slide.Kind))
	if imageCount > 0 && (kind == "cover" || kind == "image" || kind == "visual") {
		return index%imageCount + 1
	}
	return 0
}

func presentationImageType(image PresentationImage) (string, string) {
	extension := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(image.Extension)), ".")
	contentType := strings.ToLower(strings.TrimSpace(image.ContentType))
	switch {
	case extension == "jpg" || extension == "jpeg" || strings.Contains(contentType, "jpeg"):
		return "jpeg", "image/jpeg"
	case extension == "png" || strings.Contains(contentType, "png"):
		return "png", "image/png"
	case extension == "gif" || strings.Contains(contentType, "gif"):
		return "gif", "image/gif"
	case extension == "webp" || strings.Contains(contentType, "webp"):
		return "webp", "image/webp"
	}
	return "", ""
}

func cleanPPTColor(value, fallback string) string {
	value = strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(value)), "#")
	if len(value) != 6 {
		return fallback
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'A' && r <= 'F')) {
			return fallback
		}
	}
	return value
}

func presentationSlideXML(slide Slide, index, total int, accent string, image *PresentationImage) string {
	hasImage := image != nil
	imageWidth, imageHeight := 0, 0
	if image != nil {
		imageWidth, imageHeight = image.Width, image.Height
	}
	kind := strings.ToLower(strings.TrimSpace(slide.Kind))
	if index == 0 {
		kind = "cover"
	} else if index == total-1 && (kind == "" || kind == "content") {
		kind = "closing"
	}
	if kind == "" {
		if hasImage {
			kind = "image"
		} else {
			kind = "content"
		}
	}
	titleLimit := 54
	if kind == "cover" {
		titleLimit = 36
	} else if kind == "section" || kind == "closing" {
		titleLimit = 46
	}
	title := presentationText(slide.Title, titleLimit)
	if title == "" {
		title = "未命名页面"
	}
	subtitle := presentationText(slide.Subtitle, 100)
	takeaway := presentationText(slide.Takeaway, 100)
	kicker := presentationText(slide.Kicker, 48)
	shapes := []string{}
	nextID := 2
	add := func(value string) { shapes = append(shapes, value); nextID++ }
	addText := func(name string, x, y, cx, cy, size int, color string, bold bool, text string) {
		if strings.TrimSpace(text) == "" {
			return
		}
		add(pptTextBox(nextID, name, x, y, cx, cy, pptParagraph(text, size, color, bold, false, "l"), "", "t"))
	}
	addFooter := func(color string) {
		addText("Page", 10950000, 6460000, 550000, 180000, 950, color, false, fmt.Sprintf("%02d", index+1))
		addText("Footer", 700000, 6460000, 2400000, 180000, 900, color, false, "FLOWINGLIGHT · PRESENTATION")
	}

	switch kind {
	case "cover":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "101114", ""))
		add(pptRect(nextID, "Accent", 650000, 700000, 90000, 5150000, accent, ""))
		addText("Kicker", 950000, 770000, 6100000, 300000, 1200, accent, true, nonEmptyText(kicker, "COMMERCIAL PRESENTATION"))
		addText("Title", 950000, 1280000, 6100000, 2300000, 5000, "FFFFFF", true, title)
		addText("Subtitle", 970000, 3800000, 5600000, 1150000, 2200, "B8BCC4", false, subtitle)
		if hasImage {
			add(pptPicture(nextID, "Reference image", 7450000, 650000, 4100000, 5450000, "rId2", imageWidth, imageHeight))
		} else {
			add(pptRect(nextID, "Visual field", 7700000, 900000, 3600000, 4700000, "20242B", ""))
			add(pptRect(nextID, "Visual accent", 8200000, 1450000, 2550000, 120000, accent, ""))
		}
		addFooter("6F7580")
	case "section":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "F4F5F6", ""))
		add(pptRect(nextID, "Section band", 0, 0, 2300000, pptSlideHeight, accent, ""))
		addText("Section number", 550000, 750000, 1200000, 800000, 4200, "FFFFFF", true, fmt.Sprintf("%02d", index))
		addText("Kicker", 2950000, 1150000, 7600000, 350000, 1300, accent, true, kicker)
		addText("Title", 2950000, 1750000, 7600000, 1800000, 4000, "111317", true, title)
		addText("Subtitle", 2980000, 3900000, 7000000, 900000, 1900, "555B65", false, subtitle)
		addFooter("7B8088")
	case "statement", "quote":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "FFFFFF", ""))
		addText("Kicker", 850000, 700000, 2400000, 300000, 1200, accent, true, kicker)
		claim := title
		addText("Statement", 850000, 1450000, 10100000, 2700000, 3800, "111317", true, claim)
		add(pptRect(nextID, "Rule", 850000, 4550000, 1850000, 75000, accent, ""))
		addText("Support", 850000, 4850000, 7800000, 850000, 1800, "555B65", false, nonEmptyText(takeaway, subtitle))
		addFooter("8A8F98")
	case "metrics":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "FFFFFF", ""))
		addText("Kicker", 750000, 420000, 2600000, 260000, 1100, accent, true, kicker)
		addText("Title", 750000, 760000, 10300000, 850000, 3500, "111317", true, title)
		metrics := slide.Metrics
		if len(metrics) > 3 {
			metrics = metrics[:3]
		}
		for i, metric := range metrics {
			x := 750000 + i*3650000
			add(pptRect(nextID, fmt.Sprintf("Metric rule %d", i+1), x, 2100000, 2900000, 65000, accent, ""))
			addText(fmt.Sprintf("Metric value %d", i+1), x, 2420000, 3100000, 1050000, 3900, "111317", true, presentationText(metric.Value, 24))
			addText(fmt.Sprintf("Metric label %d", i+1), x, 3600000, 3000000, 760000, 1600, "555B65", false, presentationText(metric.Label, 80))
		}
		addText("Takeaway", 750000, 5050000, 10100000, 600000, 1800, "30343A", true, takeaway)
		addFooter("8A8F98")
	case "comparison":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "FFFFFF", ""))
		addText("Title", 750000, 650000, 10300000, 800000, 3500, "111317", true, title)
		columns := slide.Columns
		if len(columns) > 2 {
			columns = columns[:2]
		}
		for i, column := range columns {
			x := 750000 + i*5650000
			fill := "F1F2F4"
			if i == 1 {
				fill = "EAF3FF"
			}
			add(pptRect(nextID, fmt.Sprintf("Column background %d", i+1), x, 1800000, 5000000, 3650000, fill, ""))
			addText(fmt.Sprintf("Column title %d", i+1), x+350000, 2150000, 4250000, 550000, 2400, "111317", true, presentationText(column.Heading, 48))
			addText(fmt.Sprintf("Column body %d", i+1), x+350000, 2850000, 4250000, 650000, 1700, "555B65", false, presentationText(column.Body, 80))
			add(pptTextBox(nextID, fmt.Sprintf("Column bullets %d", i+1), x+350000, 3650000, 4250000, 1450000, pptBullets(column.Bullets, 1600, "30343A", 4), "", "t"))
			nextID++
		}
		addFooter("8A8F98")
	case "timeline", "process":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "FFFFFF", ""))
		addText("Title", 750000, 650000, 10300000, 800000, 3500, "111317", true, title)
		steps := slide.Bullets
		if len(steps) > 4 {
			steps = steps[:4]
		}
		add(pptRect(nextID, "Timeline", 1050000, 3200000, 9900000, 50000, "C8CCD2", ""))
		for i, step := range steps {
			x := 900000 + i*2750000
			add(pptRect(nextID, fmt.Sprintf("Step marker %d", i+1), x, 2980000, 480000, 480000, accent, ""))
			addText(fmt.Sprintf("Step number %d", i+1), x+120000, 3050000, 240000, 210000, 1200, "FFFFFF", true, fmt.Sprintf("%d", i+1))
			addText(fmt.Sprintf("Step %d", i+1), x, 3650000, 2350000, 1250000, 1600, "30343A", true, presentationText(step, 100))
		}
		addText("Takeaway", 750000, 5350000, 10200000, 500000, 1700, "555B65", false, takeaway)
		addFooter("8A8F98")
	case "closing":
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "101114", ""))
		addText("Kicker", 850000, 850000, 3000000, 300000, 1200, accent, true, nonEmptyText(kicker, "NEXT STEP"))
		addText("Title", 850000, 1550000, 9100000, 1600000, 4300, "FFFFFF", true, title)
		addText("Takeaway", 870000, 3400000, 8500000, 1000000, 2200, "D3D6DB", false, takeaway)
		add(pptTextBox(nextID, "Actions", 870000, 4650000, 7700000, 950000, pptBullets(slide.Bullets, 1700, "FFFFFF", 3), "", "t"))
		nextID++
		add(pptRect(nextID, "Closing accent", 10050000, 1050000, 1050000, 4400000, accent, ""))
		addFooter("6F7580")
	default: // content / image / visual
		add(pptRect(nextID, "Background", 0, 0, pptSlideWidth, pptSlideHeight, "FFFFFF", ""))
		addText("Kicker", 750000, 420000, 2600000, 260000, 1100, accent, true, kicker)
		addText("Title", 750000, 780000, 10300000, 850000, 3500, "111317", true, title)
		textWidth := 10100000
		if hasImage {
			textWidth = 5150000
			add(pptPicture(nextID, "Reference image", 6900000, 1650000, 4550000, 4250000, "rId2", imageWidth, imageHeight))
		}
		if takeaway != "" {
			addText("Takeaway", 750000, 1780000, textWidth, 650000, 2100, "30343A", true, takeaway)
		}
		add(pptTextBox(nextID, "Content", 750000, 2650000, textWidth, 3000000, pptBullets(slide.Bullets, 1800, "30343A", 5), "", "t"))
		nextID++
		addFooter("8A8F98")
	}

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` + strings.Join(shapes, "") + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

func presentationText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if maxRunes > 0 && len(runes) > maxRunes {
		return string(runes[:maxRunes-1]) + "…"
	}
	return value
}

func nonEmptyText(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func pptParagraph(text string, size int, color string, bold, bullet bool, align string) string {
	properties := `<a:pPr algn="` + align + `"`
	if bullet {
		properties += ` marL="300000" indent="-220000"><a:buChar char="•"/></a:pPr>`
	} else {
		properties += `><a:buNone/></a:pPr>`
	}
	boldValue := "0"
	if bold {
		boldValue = "1"
	}
	return `<a:p>` + properties + `<a:r><a:rPr lang="zh-CN" sz="` + strconv.Itoa(size) + `" b="` + boldValue + `"><a:solidFill><a:srgbClr val="` + cleanPPTColor(color, "111317") + `"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:rPr><a:t>` + xmlText(text) + `</a:t></a:r><a:endParaRPr lang="zh-CN" sz="` + strconv.Itoa(size) + `"/></a:p>`
}

func pptBullets(values []string, size int, color string, limit int) string {
	var out strings.Builder
	count := 0
	for _, value := range values {
		value = presentationText(value, 60)
		if value == "" {
			continue
		}
		out.WriteString(pptParagraph(value, size, color, false, true, "l"))
		count++
		if limit > 0 && count >= limit {
			break
		}
	}
	if out.Len() == 0 {
		out.WriteString(pptParagraph("", size, color, false, false, "l"))
	}
	return out.String()
}

func pptTextBox(id int, name string, x, y, cx, cy int, paragraphs, fill, anchor string) string {
	fillXML := `<a:noFill/>`
	if fill != "" {
		fillXML = `<a:solidFill><a:srgbClr val="` + cleanPPTColor(fill, "FFFFFF") + `"/></a:solidFill>`
	}
	return fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>%s<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="%s" lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/>%s</p:txBody></p:sp>`, id, xmlText(name), x, y, cx, cy, fillXML, anchor, paragraphs)
}

func pptRect(id int, name string, x, y, cx, cy int, fill, line string) string {
	lineXML := `<a:ln><a:noFill/></a:ln>`
	if line != "" {
		lineXML = `<a:ln w="12700"><a:solidFill><a:srgbClr val="` + cleanPPTColor(line, "B8BCC4") + `"/></a:solidFill></a:ln>`
	}
	return fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="%s"/></a:solidFill>%s</p:spPr></p:sp>`, id, xmlText(name), x, y, cx, cy, cleanPPTColor(fill, "FFFFFF"), lineXML)
}

func pptPicture(id int, name string, x, y, cx, cy int, relID string, sourceWidth, sourceHeight int) string {
	srcRect := ""
	if sourceWidth > 0 && sourceHeight > 0 && cx > 0 && cy > 0 {
		sourceAspect := float64(sourceWidth) / float64(sourceHeight)
		targetAspect := float64(cx) / float64(cy)
		if sourceAspect > targetAspect {
			crop := int((1-targetAspect/sourceAspect)*50000 + 0.5)
			srcRect = fmt.Sprintf(`<a:srcRect l="%d" r="%d"/>`, crop, crop)
		} else if sourceAspect < targetAspect {
			crop := int((1-sourceAspect/targetAspect)*50000 + 0.5)
			srcRect = fmt.Sprintf(`<a:srcRect t="%d" b="%d"/>`, crop, crop)
		}
	}
	return fmt.Sprintf(`<p:pic><p:nvPicPr><p:cNvPr id="%d" name="%s"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="%s"/>%s<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`, id, xmlText(name), relID, srcRect, x, y, cx, cy)
}

const themeXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FlowingLight"><a:themeElements><a:clrScheme name="FlowingLight"><a:dk1><a:srgbClr val="171717"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="262626"/></a:dk2><a:lt2><a:srgbClr val="F5F5F5"/></a:lt2><a:accent1><a:srgbClr val="4F46E5"/></a:accent1><a:accent2><a:srgbClr val="0F766E"/></a:accent2><a:accent3><a:srgbClr val="B45309"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4><a:accent5><a:srgbClr val="0369A1"/></a:accent5><a:accent6><a:srgbClr val="BE123C"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="FlowingLight"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="FlowingLight"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
