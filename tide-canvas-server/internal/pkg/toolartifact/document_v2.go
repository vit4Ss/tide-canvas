package toolartifact

import (
	"fmt"
	"strconv"
	"strings"
)

const documentContentWidthDXA = 9360

func RenderDOCX(doc Document) ([]byte, error) {
	doc = normalizeCommercialDocument(doc)
	accent := cleanPPTColor(doc.Accent, "2E5B88")
	body := strings.Builder{}
	body.WriteString(documentParagraph(doc.Title, "Title", 0))
	if doc.Subtitle != "" {
		body.WriteString(documentParagraph(doc.Subtitle, "Subtitle", 0))
	}
	if doc.Author != "" || doc.Date != "" {
		body.WriteString(documentMetadataParagraph(doc.Author, doc.Date))
	}
	if doc.Summary != "" {
		body.WriteString(documentParagraph(doc.Summary, "Lead", 0))
	}
	for _, section := range doc.Sections {
		if section.Heading != "" {
			level := section.Level
			if level < 1 || level > 3 {
				level = 1
			}
			body.WriteString(documentParagraph(section.Heading, "Heading"+strconv.Itoa(level), 0))
		}
		if section.Lead != "" {
			body.WriteString(documentParagraph(section.Lead, "SectionLead", 0))
		}
		for paragraphIndex, value := range section.Paragraphs {
			if value = strings.TrimSpace(value); value != "" {
				keepNext := section.Table != nil && paragraphIndex == len(section.Paragraphs)-1 && len(section.Bullets) == 0 && len(section.Numbered) == 0 && section.Callout == ""
				body.WriteString(documentParagraphWithKeep(value, "Normal", 0, keepNext))
			}
		}
		for _, value := range section.Bullets {
			if value = strings.TrimSpace(value); value != "" {
				body.WriteString(documentParagraph(value, "Normal", 1))
			}
		}
		for _, value := range section.Numbered {
			if value = strings.TrimSpace(value); value != "" {
				body.WriteString(documentParagraph(value, "Normal", 2))
			}
		}
		if section.Callout != "" {
			body.WriteString(documentParagraph(section.Callout, "Callout", 0))
		}
		if section.Table != nil && (len(section.Table.Headers) > 0 || len(section.Table.Rows) > 0) {
			body.WriteString(documentTableXML(*section.Table, accent))
		}
	}

	creator := nonEmptyText(doc.Author, "FlowingLight")
	files := map[string]string{
		"[Content_Types].xml":          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
		"_rels/.rels":                  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
		"word/document.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` + body.String() + `<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
		"word/styles.xml":              documentStylesXML(accent),
		"word/numbering.xml":           documentNumberingXML(),
		"word/settings.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
		"word/header1.xml":             `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>` + xmlText(presentationText(doc.Title, 72)) + `</w:t></w:r></w:p></w:hdr>`,
		"word/footer1.xml":             `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>FLOWINGLIGHT  ·  </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`,
		"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
		"docProps/core.xml":            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>` + xmlText(doc.Title) + `</dc:title><dc:creator>` + xmlText(creator) + `</dc:creator><dc:subject>` + xmlText(doc.Subtitle) + `</dc:subject></cp:coreProperties>`,
		"docProps/app.xml":             `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FlowingLight</Application><AppVersion>2.0</AppVersion></Properties>`,
	}
	return zipFiles(files)
}

func normalizeCommercialDocument(doc Document) Document {
	doc.Title = strings.TrimSpace(doc.Title)
	if doc.Title == "" {
		doc.Title = "生成文档"
	}
	doc.Subtitle = strings.TrimSpace(doc.Subtitle)
	doc.Author = strings.TrimSpace(doc.Author)
	doc.Date = strings.TrimSpace(doc.Date)
	doc.Summary = presentationText(doc.Summary, 480)
	for index := range doc.Sections {
		doc.Sections[index].Heading = presentationText(doc.Sections[index].Heading, 120)
		doc.Sections[index].Lead = presentationText(doc.Sections[index].Lead, 360)
		doc.Sections[index].Callout = presentationText(doc.Sections[index].Callout, 420)
	}
	return doc
}

func documentParagraph(value, style string, numID int) string {
	return documentParagraphWithKeep(value, style, numID, false)
}

func documentParagraphWithKeep(value, style string, numID int, keepNext bool) string {
	properties := strings.Builder{}
	properties.WriteString(`<w:pPr>`)
	if style != "" {
		properties.WriteString(`<w:pStyle w:val="` + xmlText(style) + `"/>`)
	}
	if keepNext {
		properties.WriteString(`<w:keepNext/>`)
	}
	properties.WriteString(`<w:widowControl/>`)
	if numID > 0 {
		properties.WriteString(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="` + strconv.Itoa(numID) + `"/></w:numPr>`)
	}
	properties.WriteString(`</w:pPr>`)
	return `<w:p>` + properties.String() + `<w:r><w:t xml:space="preserve">` + xmlText(strings.TrimSpace(value)) + `</w:t></w:r></w:p>`
}

func documentMetadataParagraph(author, date string) string {
	parts := make([]string, 0, 2)
	if author != "" {
		parts = append(parts, "作者："+author)
	}
	if date != "" {
		parts = append(parts, "日期："+date)
	}
	return documentParagraph(strings.Join(parts, "    "), "Metadata", 0)
}

func documentTableXML(table DocumentTable, accent string) string {
	columns := len(table.Headers)
	for _, row := range table.Rows {
		if len(row) > columns {
			columns = len(row)
		}
	}
	if columns == 0 {
		return ""
	}
	widths := documentColumnWidths(table, columns)
	out := strings.Builder{}
	if strings.TrimSpace(table.Caption) != "" {
		out.WriteString(documentParagraph(table.Caption, "Caption", 0))
	}
	out.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="D9DEE5"/><w:left w:val="single" w:sz="6" w:color="D9DEE5"/><w:bottom w:val="single" w:sz="6" w:color="D9DEE5"/><w:right w:val="single" w:sz="6" w:color="D9DEE5"/><w:insideH w:val="single" w:sz="4" w:color="E6E9ED"/><w:insideV w:val="single" w:sz="4" w:color="E6E9ED"/></w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>`)
	for _, width := range widths {
		out.WriteString(`<w:gridCol w:w="` + strconv.Itoa(width) + `"/>`)
	}
	out.WriteString(`</w:tblGrid>`)
	if len(table.Headers) > 0 {
		out.WriteString(`<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>`)
		for index := 0; index < columns; index++ {
			value := ""
			if index < len(table.Headers) {
				value = table.Headers[index]
			}
			out.WriteString(documentTableCell(value, widths[index], true, len(table.Rows) <= 8, accent))
		}
		out.WriteString(`</w:tr>`)
	}
	for rowIndex, row := range table.Rows {
		out.WriteString(`<w:tr><w:trPr><w:cantSplit/></w:trPr>`)
		for index := 0; index < columns; index++ {
			value := ""
			if index < len(row) {
				value = row[index]
			}
			keepNext := len(table.Rows) <= 8 && rowIndex < len(table.Rows)-1
			out.WriteString(documentTableCell(value, widths[index], false, keepNext, accent))
		}
		out.WriteString(`</w:tr>`)
	}
	out.WriteString(`</w:tbl>`)
	return out.String()
}

func documentTableCell(value string, width int, header, keepNext bool, accent string) string {
	shading := ""
	style := "TableText"
	if header {
		shading = `<w:shd w:val="clear" w:color="auto" w:fill="` + mixPPTColor(accent, "FFFFFF", 0.86) + `"/>`
		style = "TableHeader"
	}
	align := "left"
	if !header && looksLikeCompactValue(value) {
		align = "center"
	}
	keepXML := ""
	if keepNext {
		keepXML = `<w:keepNext/>`
	}
	return `<w:tc><w:tcPr><w:tcW w:w="` + strconv.Itoa(width) + `" w:type="dxa"/><w:vAlign w:val="center"/>` + shading + `</w:tcPr><w:p><w:pPr><w:pStyle w:val="` + style + `"/>` + keepXML + `<w:jc w:val="` + align + `"/></w:pPr><w:r><w:t xml:space="preserve">` + xmlText(strings.TrimSpace(value)) + `</w:t></w:r></w:p></w:tc>`
}

func documentColumnWidths(table DocumentTable, columns int) []int {
	weights := make([]int, columns)
	for index := range weights {
		weights[index] = 6
	}
	for index, value := range table.Headers {
		if index < columns {
			weights[index] = maxInt(weights[index], len([]rune(value)))
		}
	}
	for _, row := range table.Rows {
		for index, value := range row {
			if index < columns {
				weights[index] = maxInt(weights[index], minInt(32, len([]rune(value))))
			}
		}
	}
	totalWeight := 0
	for _, weight := range weights {
		totalWeight += weight
	}
	widths := make([]int, columns)
	remaining := documentContentWidthDXA
	for index, weight := range weights {
		if index == columns-1 {
			widths[index] = remaining
			break
		}
		width := remaining * weight / totalWeight
		minimum := 1080
		if width < minimum {
			width = minimum
		}
		widths[index] = width
		remaining -= width
		totalWeight -= weight
	}
	return widths
}

func looksLikeCompactValue(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > 14 {
		return false
	}
	for _, r := range value {
		if (r >= '0' && r <= '9') || strings.ContainsRune("%¥$€£年月日.-/:+", r) {
			continue
		}
		return false
	}
	return true
}

func documentStylesXML(accent string) string {
	darkAccent := mixPPTColor(accent, "000000", 0.25)
	lightAccent := mixPPTColor(accent, "FFFFFF", 0.92)
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei UI"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="20242A"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:next w:val="Subtitle"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="100"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display" w:eastAsia="Microsoft YaHei UI"/><w:b/><w:color w:val="18202A"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:after="160"/></w:pPr><w:rPr><w:color w:val="5E6875"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:pPr><w:spacing w:after="220"/></w:pPr><w:rPr><w:color w:val="707A86"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Lead"><w:name w:val="Lead"/><w:pPr><w:spacing w:before="40" w:after="260" w:line="300" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="%s"/><w:ind w:left="240" w:right="240"/><w:pBdr><w:left w:val="single" w:sz="20" w:space="10" w:color="%s"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="24303C"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="SectionLead"><w:name w:val="Section Lead"/><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="364453"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos Display" w:hAnsi="Aptos Display" w:eastAsia="Microsoft YaHei UI"/><w:b/><w:color w:val="%s"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="%s"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="%s"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:pPr><w:spacing w:before="100" w:after="180" w:line="288" w:lineRule="auto"/><w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/><w:ind w:left="260" w:right="260"/><w:pBdr><w:top w:val="single" w:sz="4" w:color="D7DCE3"/><w:bottom w:val="single" w:sz="4" w:color="D7DCE3"/></w:pBdr></w:pPr><w:rPr><w:color w:val="2D3742"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="%s"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:color w:val="%s"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:color w:val="303944"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Header"><w:name w:val="Header"/><w:pPr><w:spacing w:after="0"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="8" w:color="D8DDE4"/></w:pBdr></w:pPr><w:rPr><w:color w:val="7A8490"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="Footer"/><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:color w:val="8A939D"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style></w:styles>`, lightAccent, accent, darkAccent, accent, darkAccent, darkAccent, commercialContrast(mixPPTColor(accent, "FFFFFF", 0.86)))
}

func documentNumberingXML() string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="100" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei UI"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="100" w:line="280" w:lineRule="auto"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
}
