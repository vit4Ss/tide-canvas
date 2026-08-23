package toolartifact

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

type spreadsheetCell struct {
	Formula string
	Value   any
	Format  string
}

func RenderXLSX(book Workbook) ([]byte, error) {
	if strings.TrimSpace(book.Title) == "" {
		book.Title = "工作簿"
	}
	if len(book.Sheets) == 0 {
		book.Sheets = []Sheet{{Name: "Sheet1", Purpose: "暂无数据", Columns: []SheetColumn{{Header: "说明", Type: "text"}}}}
	}
	accent := cleanPPTColor(book.Accent, "245B82")
	files := map[string]string{}
	var sheetsXML, relsXML, overrides strings.Builder
	usedSheetNames := map[string]bool{}
	for index, source := range book.Sheets {
		name := uniqueSheetName(cleanSheetName(source.Name, index+1), usedSheetNames)
		id := index + 1
		sheetsXML.WriteString(fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlText(name), id, id))
		relsXML.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, id, id))
		overrides.WriteString(fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, id))
		files[fmt.Sprintf("xl/worksheets/sheet%d.xml", id)] = commercialWorksheetXML(book.Title, source, index == 0, accent)
	}
	styleRelID := len(book.Sheets) + 1
	themeRelID := styleRelID + 1
	relsXML.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, styleRelID))
	relsXML.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`, themeRelID))
	files["[Content_Types].xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` + overrides.String() + `</Types>`
	files["_rels/.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`
	files["xl/workbook.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><bookViews><workbookView activeTab="0"/></bookViews><sheets>` + sheetsXML.String() + `</sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`
	files["xl/_rels/workbook.xml.rels"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + relsXML.String() + `</Relationships>`
	files["xl/styles.xml"] = spreadsheetStylesXML(accent)
	files["xl/theme/theme1.xml"] = spreadsheetThemeXML(accent)
	files["docProps/core.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>` + xmlText(book.Title) + `</dc:title><dc:creator>FlowingLight</dc:creator></cp:coreProperties>`
	files["docProps/app.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FlowingLight</Application><AppVersion>2.0</AppVersion></Properties>`
	return zipFiles(files)
}

func commercialWorksheetXML(bookTitle string, sheet Sheet, selected bool, accent string) string {
	columns, dataRows := normalizeSheetData(sheet)
	columnCount := len(columns)
	if columnCount == 0 {
		columnCount = 1
		columns = []SheetColumn{{Header: "说明", Type: "text"}}
	}
	lastColumn := columnName(columnCount)
	rowCursor := 1
	rows := strings.Builder{}
	title := strings.TrimSpace(sheet.Name)
	if title == "" {
		title = bookTitle
	}
	rows.WriteString(spreadsheetRow(rowCursor, 30, []string{spreadsheetInlineCell("A1", title, 1)}))
	titleRow := rowCursor
	rowCursor++
	purposeRow := rowCursor
	purpose := strings.TrimSpace(sheet.Purpose)
	rows.WriteString(spreadsheetRow(rowCursor, 24, []string{spreadsheetInlineCell("A"+strconv.Itoa(rowCursor), purpose, 2)}))
	rowCursor++
	rowCursor++
	headerRow := rowCursor
	headerCells := make([]string, 0, columnCount)
	for index, column := range columns {
		ref := columnName(index+1) + strconv.Itoa(headerRow)
		headerCells = append(headerCells, spreadsheetInlineCell(ref, nonEmptyText(strings.TrimSpace(column.Header), "字段"+strconv.Itoa(index+1)), 3))
	}
	rows.WriteString(spreadsheetRow(headerRow, 24, headerCells))
	rowCursor++
	dataStart := rowCursor
	for _, row := range dataRows {
		cells := make([]string, 0, columnCount)
		for columnIndex := 0; columnIndex < columnCount; columnIndex++ {
			value := any(nil)
			if columnIndex < len(row) {
				value = row[columnIndex]
			}
			ref := columnName(columnIndex+1) + strconv.Itoa(rowCursor)
			cells = append(cells, spreadsheetValueCell(ref, value, columns[columnIndex]))
		}
		rows.WriteString(spreadsheetRow(rowCursor, 21, cells))
		rowCursor++
	}
	lastDataRow := maxInt(headerRow, rowCursor-1)
	freezeRows := sheet.FreezeRows
	if freezeRows <= 0 {
		freezeRows = headerRow
	}
	if freezeRows < headerRow {
		freezeRows = headerRow
	}
	selectedXML := ""
	if selected {
		selectedXML = ` tabSelected="1"`
	}
	view := `<sheetViews><sheetView showGridLines="0" workbookViewId="0"` + selectedXML + `><pane ySplit="` + strconv.Itoa(freezeRows) + `" topLeftCell="A` + strconv.Itoa(freezeRows+1) + `" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A` + strconv.Itoa(dataStart) + `" sqref="A` + strconv.Itoa(dataStart) + `"/></sheetView></sheetViews>`
	cols := strings.Builder{}
	for index, column := range columns {
		width := column.Width
		if width <= 0 {
			width = inferredColumnWidth(column, dataRows, index)
		}
		width = math.Max(9, math.Min(42, width))
		cols.WriteString(fmt.Sprintf(`<col min="%d" max="%d" width="%.2f" customWidth="1"/>`, index+1, index+1, width))
	}
	merges := []string{}
	if columnCount > 1 {
		merges = append(merges, `<mergeCell ref="A`+strconv.Itoa(titleRow)+`:`+lastColumn+strconv.Itoa(titleRow)+`"/>`)
	}
	if purpose != "" && columnCount > 1 {
		merges = append(merges, `<mergeCell ref="A`+strconv.Itoa(purposeRow)+`:`+lastColumn+strconv.Itoa(purposeRow)+`"/>`)
	}
	autoFilter := true
	if sheet.AutoFilter != nil {
		autoFilter = *sheet.AutoFilter
	}
	filterXML := ""
	if autoFilter && lastDataRow > headerRow {
		filterXML = `<autoFilter ref="A` + strconv.Itoa(headerRow) + `:` + lastColumn + strconv.Itoa(lastDataRow) + `"/>`
	}
	dimension := `A1:` + lastColumn + strconv.Itoa(maxInt(titleRow, lastDataRow))
	mergeXML := ""
	if len(merges) > 0 {
		mergeXML = `<mergeCells count="` + strconv.Itoa(len(merges)) + `">` + strings.Join(merges, "") + `</mergeCells>`
	}
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="` + dimension + `"/>` + view + `<sheetFormatPr defaultRowHeight="18"/><cols>` + cols.String() + `</cols><sheetData>` + rows.String() + `</sheetData>` + filterXML + mergeXML + `<printOptions horizontalCentered="1"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`
}

func normalizeSheetData(sheet Sheet) ([]SheetColumn, [][]any) {
	columns := append([]SheetColumn(nil), sheet.Columns...)
	rows := append([][]any(nil), sheet.Rows...)
	if len(columns) == 0 && len(rows) > 0 {
		for _, value := range rows[0] {
			columns = append(columns, SheetColumn{Header: strings.TrimSpace(fmt.Sprint(value)), Type: inferSheetColumnType(rows[1:], len(columns))})
		}
		rows = rows[1:]
	} else if len(columns) > 0 && len(rows) > 0 && spreadsheetRowMatchesHeaders(rows[0], columns) {
		rows = rows[1:]
	}
	maxColumns := len(columns)
	for _, row := range rows {
		if len(row) > maxColumns {
			maxColumns = len(row)
		}
	}
	for len(columns) < maxColumns {
		index := len(columns)
		columns = append(columns, SheetColumn{Header: "字段" + strconv.Itoa(index+1), Type: inferSheetColumnType(rows, index)})
	}
	for index := range columns {
		columns[index].Type = normalizeSheetColumnType(columns[index].Type)
		if strings.TrimSpace(columns[index].Format) == "" {
			columns[index].Format = defaultSheetFormat(columns[index].Type)
		}
	}
	return columns, rows
}

func spreadsheetRowMatchesHeaders(row []any, columns []SheetColumn) bool {
	if len(row) < len(columns) {
		return false
	}
	for index, column := range columns {
		if !strings.EqualFold(strings.TrimSpace(fmt.Sprint(row[index])), strings.TrimSpace(column.Header)) {
			return false
		}
	}
	return true
}

func inferSheetColumnType(rows [][]any, index int) string {
	for _, row := range rows {
		if index >= len(row) || row[index] == nil {
			continue
		}
		switch row[index].(type) {
		case float64, float32, int, int64, json.Number:
			return "number"
		case bool:
			return "boolean"
		default:
			return "text"
		}
	}
	return "text"
}

func normalizeSheetColumnType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "integer", "int", "count":
		return "integer"
	case "number", "decimal", "float":
		return "number"
	case "percent", "percentage", "rate":
		return "percent"
	case "currency", "money", "amount":
		return "currency"
	case "date", "datetime":
		return "date"
	case "boolean", "bool":
		return "boolean"
	}
	return "text"
}

func defaultSheetFormat(columnType string) string {
	switch columnType {
	case "integer":
		return "#,##0"
	case "number":
		return "#,##0.00"
	case "percent":
		return "0.0%"
	case "currency":
		return `¥#,##0.00`
	case "date":
		return "yyyy-mm-dd"
	}
	return ""
}

func inferredColumnWidth(column SheetColumn, rows [][]any, index int) float64 {
	longest := displayWidth(column.Header)
	limit := minInt(len(rows), 200)
	for rowIndex := 0; rowIndex < limit; rowIndex++ {
		if index >= len(rows[rowIndex]) {
			continue
		}
		value := rows[rowIndex][index]
		if object, ok := value.(map[string]any); ok {
			if nested, exists := object["value"]; exists {
				value = nested
			} else if formula, exists := object["formula"]; exists {
				value = formula
			}
		}
		longest = maxInt(longest, displayWidth(fmt.Sprint(value)))
	}
	return float64(minInt(40, maxInt(9, longest+2)))
}

func displayWidth(value string) int {
	width := 0
	for _, r := range value {
		if r > 0xFF {
			width += 2
		} else {
			width++
		}
	}
	return width
}

func spreadsheetRow(index int, height float64, cells []string) string {
	return fmt.Sprintf(`<row r="%d" ht="%.1f" customHeight="1">%s</row>`, index, height, strings.Join(cells, ""))
}

func spreadsheetInlineCell(ref, value string, style int) string {
	return `<c r="` + ref + `" s="` + strconv.Itoa(style) + `" t="inlineStr"><is><t xml:space="preserve">` + xmlText(value) + `</t></is></c>`
}

func spreadsheetValueCell(ref string, raw any, column SheetColumn) string {
	cell := spreadsheetCell{Value: raw, Format: column.Format}
	if object, ok := raw.(map[string]any); ok {
		if formula, exists := object["formula"].(string); exists {
			cell.Formula = strings.TrimSpace(formula)
		}
		if value, exists := object["value"]; exists {
			cell.Value = value
		} else if cell.Formula != "" {
			cell.Value = nil
		}
		if format, exists := object["format"].(string); exists && strings.TrimSpace(format) != "" {
			cell.Format = strings.TrimSpace(format)
		}
	}
	style := spreadsheetStyleIndex(column.Type, cell.Format)
	if cell.Formula != "" {
		formula, ok := safeSpreadsheetFormula(cell.Formula)
		if ok {
			cached := spreadsheetCachedValue(cell.Value)
			return `<c r="` + ref + `" s="` + strconv.Itoa(style) + `"><f>` + xmlText(formula) + `</f>` + cached + `</c>`
		}
		cell.Value = "'" + cell.Formula
	}
	if cell.Value == nil {
		return `<c r="` + ref + `" s="` + strconv.Itoa(style) + `"/>`
	}
	if column.Type == "date" {
		if serial, ok := spreadsheetDateSerial(cell.Value); ok {
			return `<c r="` + ref + `" s="8"><v>` + strconv.FormatFloat(serial, 'f', -1, 64) + `</v></c>`
		}
	}
	switch value := cell.Value.(type) {
	case float64:
		return spreadsheetNumberCell(ref, value, style)
	case float32:
		return spreadsheetNumberCell(ref, float64(value), style)
	case int:
		return spreadsheetNumberCell(ref, float64(value), style)
	case int64:
		return spreadsheetNumberCell(ref, float64(value), style)
	case json.Number:
		if number, err := value.Float64(); err == nil {
			return spreadsheetNumberCell(ref, number, style)
		}
	case bool:
		if value {
			return `<c r="` + ref + `" s="` + strconv.Itoa(style) + `" t="b"><v>1</v></c>`
		}
		return `<c r="` + ref + `" s="` + strconv.Itoa(style) + `" t="b"><v>0</v></c>`
	}
	return spreadsheetInlineCell(ref, presentationText(fmt.Sprint(cell.Value), 32767), style)
}

func spreadsheetNumberCell(ref string, value float64, style int) string {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return spreadsheetInlineCell(ref, "", style)
	}
	return `<c r="` + ref + `" s="` + strconv.Itoa(style) + `"><v>` + strconv.FormatFloat(value, 'f', -1, 64) + `</v></c>`
}

func spreadsheetCachedValue(value any) string {
	switch item := value.(type) {
	case float64:
		return `<v>` + strconv.FormatFloat(item, 'f', -1, 64) + `</v>`
	case float32:
		return `<v>` + strconv.FormatFloat(float64(item), 'f', -1, 64) + `</v>`
	case int:
		return `<v>` + strconv.Itoa(item) + `</v>`
	case int64:
		return `<v>` + strconv.FormatInt(item, 10) + `</v>`
	case json.Number:
		return `<v>` + xmlText(item.String()) + `</v>`
	}
	return ""
}

func spreadsheetDateSerial(value any) (float64, bool) {
	text := strings.TrimSpace(fmt.Sprint(value))
	for _, layout := range []string{"2006-01-02", time.RFC3339, "2006/01/02"} {
		if parsed, err := time.Parse(layout, text); err == nil {
			base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
			return parsed.UTC().Sub(base).Hours() / 24, true
		}
	}
	return 0, false
}

func safeSpreadsheetFormula(raw string) (string, bool) {
	formula := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "="))
	upper := strings.ToUpper(formula)
	if formula == "" || len(formula) > 512 || strings.ContainsAny(formula, "[]\x00\r\n") {
		return "", false
	}
	for _, forbidden := range []string{"WEBSERVICE(", "HYPERLINK(", "RTD(", "DDE(", "CALL(", "EXEC(", "FILTERXML("} {
		if strings.Contains(upper, forbidden) {
			return "", false
		}
	}
	return formula, true
}

func spreadsheetStyleIndex(columnType, format string) int {
	format = strings.ToLower(strings.TrimSpace(format))
	if strings.Contains(format, "%") || columnType == "percent" {
		return 6
	}
	if strings.ContainsAny(format, "¥$€£") || columnType == "currency" {
		return 7
	}
	if strings.Contains(format, "yy") || columnType == "date" {
		return 8
	}
	if columnType == "integer" || format == "#,##0" {
		return 4
	}
	if columnType == "number" {
		return 5
	}
	return 0
}

func spreadsheetStylesXML(accent string) string {
	light := mixPPTColor(accent, "FFFFFF", 0.88)
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="¥#,##0.00"/><numFmt numFmtId="167" formatCode="yyyy-mm-dd"/></numFmts><fonts count="4"><font><sz val="10.5"/><color rgb="FF27313C"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font><font><b/><sz val="10.5"/><color rgb="FFFFFFFF"/><name val="Aptos"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF66717E"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF` + accent + `"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF` + light + `"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD8DEE5"/></bottom><diagonal/></border><border><left style="thin"><color rgb="FFE1E6EB"/></left><right style="thin"><color rgb="FFE1E6EB"/></right><top style="thin"><color rgb="FFE1E6EB"/></top><bottom style="thin"><color rgb="FFE1E6EB"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="2" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`
}

func spreadsheetThemeXML(accent string) string {
	value := strings.Replace(themeXML, `name="FlowingLight"`, `name="FlowingLight Spreadsheet"`, 1)
	return strings.Replace(value, "4F46E5", cleanPPTColor(accent, "245B82"), 1)
}
