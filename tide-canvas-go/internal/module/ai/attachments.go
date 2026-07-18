package ai

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

const (
	maxChatAttachmentBytes = int64(20 << 20)
	documentChunkRunes     = 1400
	documentChunkOverlap   = 180
	defaultRAGCharacters   = 28000
)

type extractedSection struct {
	Text    string
	Locator map[string]any
}

func (s *Service) prepareChatAttachments(userID int64, logicalModel *model.AiModel, input map[string]interface{}, ctx logCtx) error {
	if s.attachments == nil {
		return nil
	}
	items, ok := input["attachments"].([]interface{})
	if !ok || len(items) == 0 {
		return nil
	}
	capabilities := decodeCapabilities(logicalModel)
	multimodal := boolCapability(capabilities, "multimodal")
	nativeFiles := boolCapability(capabilities, "nativeFiles")
	budget := defaultRAGCharacters
	if context := intCapability(capabilities, "contextWindow"); context > 0 {
		// Roughly reserve half of the context for history, answer, and system instructions.
		budget = minInt(defaultRAGCharacters, maxInt(4000, context*2))
	}
	prompt := strOf(input["prompt"])

	for _, raw := range items {
		attachment, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		fileURL := strings.TrimSpace(strOf(attachment["url"]))
		if fileURL == "" {
			continue
		}
		mimeHint := strings.ToLower(strOf(attachment["mimeType"]))
		if !(multimodal && strings.HasPrefix(mimeHint, "image/")) {
			cachedName, cachedChunks, found, cacheErr := s.loadPersistedDocument(userID, fileURL)
			if cacheErr != nil {
				return cacheErr
			}
			if found {
				applyRetrievedChunks(attachment, cachedName, cachedChunks, prompt, budget)
				continue
			}
		}
		data, originalName, mimeType, publicID, err := s.attachments.ReadOwnedFileByURL(userID, fileURL, maxChatAttachmentBytes)
		if err != nil {
			return fmt.Errorf("读取附件失败: %w", err)
		}
		if strings.TrimSpace(strOf(attachment["name"])) == "" {
			attachment["name"] = originalName
		}
		if strings.TrimSpace(strOf(attachment["mimeType"])) == "" {
			attachment["mimeType"] = mimeType
		}

		if strings.HasPrefix(strings.ToLower(mimeType), "image/") {
			dataURL := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
			if multimodal {
				attachment["directMultimodal"] = true
				attachment["dataURL"] = dataURL
				continue
			}
			text, ocrErr := s.ocrImageWithConfiguredModel(dataURL, originalName, ctx)
			if ocrErr != nil {
				return ocrErr
			}
			chunks := chunkSections([]extractedSection{{Text: text, Locator: map[string]any{"section": "OCR"}}})
			if err := s.persistDocument(userID, publicID, chunks); err != nil {
				return err
			}
			applyRetrievedChunks(attachment, originalName, chunks, prompt, budget)
			continue
		}

		sections, extractErr := extractDocument(data, originalName, mimeType)
		chunks := chunkSections(sections)
		if extractErr != nil || len(chunks) == 0 {
			dataURL := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
			if nativeFiles {
				attachment["directNativeFile"] = true
				attachment["dataURL"] = dataURL
				continue
			}
			text, modelErr := s.extractFileWithConfiguredModel(dataURL, originalName, mimeType, ctx)
			if modelErr != nil {
				if extractErr != nil {
					return fmt.Errorf("解析附件 %s 失败: %w", originalName, extractErr)
				}
				return fmt.Errorf("附件 %s 未提取到可读文本: %w", originalName, modelErr)
			}
			chunks = chunkSections([]extractedSection{{Text: text, Locator: map[string]any{"section": "AI 文档识别"}}})
		}
		if err := s.persistDocument(userID, publicID, chunks); err != nil {
			return err
		}
		applyRetrievedChunks(attachment, originalName, chunks, prompt, budget)
	}
	return nil
}

func applyRetrievedChunks(attachment map[string]interface{}, originalName string, chunks []documentChunk, prompt string, budget int) {
	selected := selectRelevantChunks(chunks, prompt, budget)
	var text strings.Builder
	for _, chunk := range selected {
		citation := citationLabel(originalName, chunk.Locator, chunk.Index)
		text.WriteString(citation)
		text.WriteByte('\n')
		text.WriteString(chunk.Text)
		text.WriteString("\n\n")
	}
	attachment["extractedText"] = strings.TrimSpace(text.String())
	attachment["citations"] = "回答涉及附件事实时，请保留对应的 [来源：…] 标记。"
}

func decodeCapabilities(item *model.AiModel) map[string]interface{} {
	if item == nil {
		return map[string]interface{}{}
	}
	out := map[string]interface{}{}
	_ = json.Unmarshal(item.Capabilities, &out)
	if item.Type == "text" {
		if _, ok := out["streaming"]; !ok {
			out["streaming"] = true
		}
		if _, ok := out["maxInputFiles"]; !ok {
			out["maxInputFiles"] = 10
		}
		if _, ok := out["maxFileSizeMB"]; !ok {
			out["maxFileSizeMB"] = 20
		}
		if _, ok := out["contextWindow"]; !ok {
			out["contextWindow"] = 128000
		}
		if _, ok := out["multimodal"]; !ok {
			identifier := strings.ToLower(item.ModelID + " " + item.Name)
			for _, marker := range []string{"gpt-4o", "gpt-5", "gemini", "claude-3", "claude-4", "qwen-vl", "vision"} {
				if strings.Contains(identifier, marker) {
					out["multimodal"] = true
					if strings.Contains(identifier, "gpt-") || strings.Contains(identifier, "gemini") || strings.Contains(identifier, "claude") {
						if _, configured := out["nativeFiles"]; !configured {
							out["nativeFiles"] = true
						}
					}
					break
				}
			}
		}
	}
	if item.Type == "image" {
		if _, ok := out["maxReferenceImages"]; !ok {
			out["maxReferenceImages"] = 4
		}
	}
	if item.Type == "video" {
		if _, ok := out["maxReferenceFiles"]; !ok {
			out["maxReferenceFiles"] = 12
		}
		if _, ok := out["maxReferenceVideos"]; !ok {
			out["maxReferenceVideos"] = 2
		}
	}
	return out
}

func boolCapability(values map[string]interface{}, key string) bool {
	value, ok := values[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(typed)
		return parsed
	default:
		return false
	}
}

func intCapability(values map[string]interface{}, key string) int {
	value, ok := values[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		parsed, _ := strconv.Atoi(typed)
		return parsed
	default:
		return 0
	}
}

func (s *Service) ocrImageWithConfiguredModel(dataURL, originalName string, ctx logCtx) (string, error) {
	models, err := s.repo.ListEnabledModels()
	if err != nil {
		return "", err
	}
	for i := range models {
		candidate := &models[i]
		if candidate.Type != "text" || !boolCapability(decodeCapabilities(candidate), "multimodal") {
			continue
		}
		exec := s.resolveExecutionModel(candidate, "assistant_chat", map[string]interface{}{}, nil)
		provider, resolveErr := s.gateway.resolveProvider(exec)
		if resolveErr != nil || !s.gateway.isUsable(provider) {
			continue
		}
		answer, chatErr := s.gateway.chat(provider, exec.ModelID, map[string]interface{}{
			"systemPrompt": "你是文档 OCR 助手。请完整识别图片中的文字、表格结构和关键视觉信息，只输出识别结果，不要解释。",
			"prompt":       "识别附件 " + originalName + " 的全部可读内容。",
			"attachments": []interface{}{map[string]interface{}{
				"name": originalName, "mimeType": "image/*", "dataURL": dataURL, "directMultimodal": true,
			}},
		}, ctx)
		if chatErr == nil && strings.TrimSpace(answer) != "" {
			return answer, nil
		}
	}
	return "", fmt.Errorf("当前文本模型不支持图片读取，且后台未配置可用的多模态文本模型用于 OCR")
}

func (s *Service) extractFileWithConfiguredModel(dataURL, originalName, mimeType string, ctx logCtx) (string, error) {
	models, err := s.repo.ListEnabledModels()
	if err != nil {
		return "", err
	}
	for i := range models {
		candidate := &models[i]
		capabilities := decodeCapabilities(candidate)
		if candidate.Type != "text" || !boolCapability(capabilities, "nativeFiles") {
			continue
		}
		exec := s.resolveExecutionModel(candidate, "assistant_chat", map[string]interface{}{}, nil)
		provider, resolveErr := s.gateway.resolveProvider(exec)
		if resolveErr != nil || !s.gateway.isUsable(provider) {
			continue
		}
		answer, chatErr := s.gateway.chat(provider, exec.ModelID, map[string]interface{}{
			"systemPrompt": "你是文档解析助手。请完整提取文件中的文字、表格结构、页码或工作表信息，只输出忠实的结构化文本，不要解释。",
			"prompt":       "读取附件 " + originalName + " 的全部可读内容。",
			"attachments": []interface{}{map[string]interface{}{
				"name": originalName, "mimeType": mimeType, "dataURL": dataURL, "directNativeFile": true,
			}},
		}, ctx)
		if chatErr == nil && strings.TrimSpace(answer) != "" {
			return answer, nil
		}
	}
	return "", fmt.Errorf("后台未配置支持原生文件读取的文本模型")
}

type documentChunk struct {
	Index   int
	Text    string
	Locator map[string]any
}

func chunkSections(sections []extractedSection) []documentChunk {
	var chunks []documentChunk
	for _, section := range sections {
		text := strings.TrimSpace(section.Text)
		if text == "" {
			continue
		}
		runes := []rune(text)
		for start := 0; start < len(runes); {
			end := minInt(len(runes), start+documentChunkRunes)
			if end < len(runes) {
				for cursor := end; cursor > start+documentChunkRunes/2; cursor-- {
					if unicode.IsSpace(runes[cursor-1]) || strings.ContainsRune("。！？；\n", runes[cursor-1]) {
						end = cursor
						break
					}
				}
			}
			part := strings.TrimSpace(string(runes[start:end]))
			if part != "" {
				locator := make(map[string]any, len(section.Locator)+1)
				for key, value := range section.Locator {
					locator[key] = value
				}
				locator["range"] = fmt.Sprintf("%d-%d", start+1, end)
				chunks = append(chunks, documentChunk{Index: len(chunks), Text: part, Locator: locator})
			}
			if end >= len(runes) {
				break
			}
			start = maxInt(start+1, end-documentChunkOverlap)
		}
	}
	return chunks
}

func (s *Service) persistDocument(userID int64, filePublicID string, chunks []documentChunk) error {
	if filePublicID == "" {
		return nil
	}
	var file model.SysFile
	if err := s.db.Where("user_id = ? AND public_id = ?", userID, filePublicID).First(&file).Error; err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var document model.AiDocument
		err := tx.Where("file_id = ?", file.ID).First(&document).Error
		if err == gorm.ErrRecordNotFound {
			document = model.AiDocument{UserID: userID, FileID: file.ID, Status: "processing"}
			if createErr := tx.Create(&document).Error; createErr != nil {
				return createErr
			}
		} else if err != nil {
			return err
		}
		if err := tx.Where("document_id = ?", document.ID).Delete(&model.AiDocumentChunk{}).Error; err != nil {
			return err
		}
		var characterCount int64
		for _, chunk := range chunks {
			locator, _ := json.Marshal(chunk.Locator)
			characterCount += int64(utf8.RuneCountInString(chunk.Text))
			if err := tx.Create(&model.AiDocumentChunk{
				DocumentID: document.ID,
				ChunkIndex: chunk.Index,
				Content:    chunk.Text,
				Locator:    datatypes.JSON(locator),
				TokenCount: maxInt(1, utf8.RuneCountInString(chunk.Text)/2),
			}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&document).Updates(map[string]interface{}{
			"status": "ready", "character_count": characterCount, "error_message": "",
		}).Error
	})
}

func (s *Service) loadPersistedDocument(userID int64, fileURL string) (string, []documentChunk, bool, error) {
	var file model.SysFile
	if err := s.db.Where("user_id = ? AND file_url = ?", userID, fileURL).First(&file).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil, false, nil
		}
		return "", nil, false, err
	}
	var document model.AiDocument
	if err := s.db.Where("file_id = ? AND status = ?", file.ID, "ready").First(&document).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil, false, nil
		}
		return "", nil, false, err
	}
	var rows []model.AiDocumentChunk
	if err := s.db.Where("document_id = ?", document.ID).Order("chunk_index ASC").Find(&rows).Error; err != nil {
		return "", nil, false, err
	}
	chunks := make([]documentChunk, 0, len(rows))
	for _, row := range rows {
		var locator map[string]any
		_ = json.Unmarshal(row.Locator, &locator)
		chunks = append(chunks, documentChunk{Index: row.ChunkIndex, Text: row.Content, Locator: locator})
	}
	return file.OriginalName, chunks, len(chunks) > 0, nil
}

func selectRelevantChunks(chunks []documentChunk, query string, budget int) []documentChunk {
	if len(chunks) == 0 {
		return nil
	}
	tokens := queryTokens(query)
	type scored struct {
		chunk documentChunk
		score int
	}
	values := make([]scored, 0, len(chunks))
	for _, chunk := range chunks {
		lower := strings.ToLower(chunk.Text)
		score := 0
		for _, token := range tokens {
			score += strings.Count(lower, token) * maxInt(1, utf8.RuneCountInString(token))
		}
		values = append(values, scored{chunk: chunk, score: score})
	}
	sort.SliceStable(values, func(i, j int) bool {
		if values[i].score == values[j].score {
			return values[i].chunk.Index < values[j].chunk.Index
		}
		return values[i].score > values[j].score
	})
	selected := make([]documentChunk, 0, minInt(12, len(values)))
	used := 0
	for _, value := range values {
		length := utf8.RuneCountInString(value.chunk.Text)
		if len(selected) > 0 && used+length > budget {
			continue
		}
		selected = append(selected, value.chunk)
		used += length
		if used >= budget || len(selected) >= 12 {
			break
		}
	}
	sort.Slice(selected, func(i, j int) bool { return selected[i].Index < selected[j].Index })
	return selected
}

func queryTokens(value string) []string {
	value = strings.ToLower(strings.TrimSpace(value))
	seen := map[string]struct{}{}
	var out []string
	for _, field := range strings.FieldsFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsPunct(r) }) {
		if utf8.RuneCountInString(field) >= 2 {
			seen[field] = struct{}{}
		}
	}
	runes := []rune(value)
	for i := 0; i+1 < len(runes); i++ {
		if unicode.Is(unicode.Han, runes[i]) && unicode.Is(unicode.Han, runes[i+1]) {
			seen[string(runes[i:i+2])] = struct{}{}
		}
	}
	for token := range seen {
		out = append(out, token)
	}
	return out
}

func citationLabel(name string, locator map[string]any, index int) string {
	parts := []string{name}
	for _, key := range []string{"page", "sheet", "slide", "section"} {
		if value, ok := locator[key]; ok {
			labels := map[string]string{"page": "第 %v 页", "sheet": "工作表 %v", "slide": "第 %v 页幻灯片", "section": "%v"}
			parts = append(parts, fmt.Sprintf(labels[key], value))
		}
	}
	parts = append(parts, fmt.Sprintf("片段 %d", index+1))
	return "[来源：" + strings.Join(parts, "，") + "]"
}

func extractDocument(data []byte, name, mimeType string) ([]extractedSection, error) {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".txt", ".md", ".markdown", ".csv", ".json", ".xml", ".html", ".htm":
		return []extractedSection{{Text: normalizePlainText(data), Locator: map[string]any{"section": "全文"}}}, nil
	case ".docx":
		return extractOfficeXML(data, "word/", "document", "section"), nil
	case ".pptx":
		return extractOfficeXML(data, "ppt/slides/", "slide", "slide"), nil
	case ".xlsx":
		return extractXLSX(data), nil
	case ".pdf":
		return extractPDF(data), nil
	case ".doc", ".xls", ".ppt":
		return []extractedSection{{Text: extractLegacyOfficeText(data), Locator: map[string]any{"section": "全文"}}}, nil
	}
	if strings.HasPrefix(strings.ToLower(mimeType), "text/") {
		return []extractedSection{{Text: normalizePlainText(data), Locator: map[string]any{"section": "全文"}}}, nil
	}
	return nil, fmt.Errorf("暂不支持的文档格式 %s", ext)
}

type richTextXML struct {
	Text string `xml:"t"`
	Runs []struct {
		Text string `xml:"t"`
	} `xml:"r"`
}

func (r richTextXML) String() string {
	var builder strings.Builder
	builder.WriteString(r.Text)
	for _, run := range r.Runs {
		builder.WriteString(run.Text)
	}
	return builder.String()
}

func extractXLSX(data []byte) []extractedSection {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil
	}
	var shared []string
	var sheets []*zip.File
	for _, file := range archive.File {
		name := strings.ToLower(file.Name)
		if name == "xl/sharedstrings.xml" {
			stream, openErr := file.Open()
			if openErr != nil {
				continue
			}
			var table struct {
				Items []richTextXML `xml:"si"`
			}
			_ = xml.NewDecoder(stream).Decode(&table)
			_ = stream.Close()
			for _, item := range table.Items {
				shared = append(shared, item.String())
			}
		}
		if strings.HasPrefix(name, "xl/worksheets/") && strings.HasSuffix(name, ".xml") {
			sheets = append(sheets, file)
		}
	}
	sort.Slice(sheets, func(i, j int) bool { return naturalLess(sheets[i].Name, sheets[j].Name) })
	sections := make([]extractedSection, 0, len(sheets))
	for sheetIndex, file := range sheets {
		stream, openErr := file.Open()
		if openErr != nil {
			continue
		}
		var worksheet struct {
			Rows []struct {
				Number int `xml:"r,attr"`
				Cells  []struct {
					Ref    string      `xml:"r,attr"`
					Type   string      `xml:"t,attr"`
					Value  string      `xml:"v"`
					Inline richTextXML `xml:"is"`
				} `xml:"c"`
			} `xml:"sheetData>row"`
		}
		decodeErr := xml.NewDecoder(stream).Decode(&worksheet)
		_ = stream.Close()
		if decodeErr != nil {
			continue
		}
		var builder strings.Builder
		for _, row := range worksheet.Rows {
			values := make([]string, 0, len(row.Cells))
			for _, cell := range row.Cells {
				value := cell.Value
				switch cell.Type {
				case "s":
					if index, parseErr := strconv.Atoi(cell.Value); parseErr == nil && index >= 0 && index < len(shared) {
						value = shared[index]
					}
				case "inlineStr":
					value = cell.Inline.String()
				case "b":
					if value == "1" {
						value = "TRUE"
					} else {
						value = "FALSE"
					}
				}
				if cell.Ref != "" {
					values = append(values, cell.Ref+"="+value)
				} else {
					values = append(values, value)
				}
			}
			if len(values) > 0 {
				builder.WriteString(strings.Join(values, "\t"))
				builder.WriteByte('\n')
			}
		}
		if strings.TrimSpace(builder.String()) != "" {
			sections = append(sections, extractedSection{Text: builder.String(), Locator: map[string]any{"sheet": sheetIndex + 1}})
		}
	}
	return sections
}

func normalizePlainText(data []byte) string {
	if utf8.Valid(data) {
		return strings.TrimSpace(string(data))
	}
	return strings.TrimSpace(extractLegacyOfficeText(data))
}

func extractOfficeXML(data []byte, prefix, contains, locatorKey string) []extractedSection {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil
	}
	files := make([]*zip.File, 0)
	for _, file := range reader.File {
		name := strings.ToLower(file.Name)
		if strings.HasPrefix(name, prefix) && strings.Contains(name, contains) && strings.HasSuffix(name, ".xml") {
			files = append(files, file)
		}
	}
	sort.Slice(files, func(i, j int) bool { return naturalLess(files[i].Name, files[j].Name) })
	sections := make([]extractedSection, 0, len(files))
	for index, file := range files {
		stream, err := file.Open()
		if err != nil {
			continue
		}
		text, _ := extractXMLText(stream)
		_ = stream.Close()
		if strings.TrimSpace(text) == "" {
			continue
		}
		sections = append(sections, extractedSection{Text: text, Locator: map[string]any{locatorKey: index + 1}})
	}
	return sections
}

func extractXMLText(reader io.Reader) (string, error) {
	decoder := xml.NewDecoder(reader)
	var builder strings.Builder
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return builder.String(), err
		}
		switch typed := token.(type) {
		case xml.CharData:
			value := strings.TrimSpace(string(typed))
			if value != "" {
				if builder.Len() > 0 {
					builder.WriteByte(' ')
				}
				builder.WriteString(value)
			}
		case xml.EndElement:
			if typed.Name.Local == "p" || typed.Name.Local == "row" || typed.Name.Local == "tr" {
				builder.WriteByte('\n')
			}
		}
	}
	return strings.TrimSpace(builder.String()), nil
}

var pdfLiteral = regexp.MustCompile(`\((?:\\.|[^\\)])*\)\s*(?:Tj|['"])`)

func extractPDF(data []byte) []extractedSection {
	streams := [][]byte{data}
	for cursor := 0; cursor < len(data); {
		streamAt := bytes.Index(data[cursor:], []byte("stream"))
		if streamAt < 0 {
			break
		}
		start := cursor + streamAt + len("stream")
		if start < len(data) && data[start] == '\r' {
			start++
		}
		if start < len(data) && data[start] == '\n' {
			start++
		}
		endRelative := bytes.Index(data[start:], []byte("endstream"))
		if endRelative < 0 {
			break
		}
		end := start + endRelative
		raw := bytes.TrimSpace(data[start:end])
		headerStart := maxInt(0, cursor+streamAt-300)
		header := data[headerStart : cursor+streamAt]
		if bytes.Contains(header, []byte("FlateDecode")) {
			if reader, err := zlib.NewReader(bytes.NewReader(raw)); err == nil {
				if inflated, readErr := io.ReadAll(reader); readErr == nil {
					streams = append(streams, inflated)
				}
				_ = reader.Close()
			}
		} else {
			streams = append(streams, raw)
		}
		cursor = end + len("endstream")
	}
	sections := make([]extractedSection, 0, len(streams))
	for index, stream := range streams {
		matches := pdfLiteral.FindAll(stream, -1)
		var builder strings.Builder
		for _, match := range matches {
			end := bytes.LastIndexByte(match, ')')
			if end <= 0 {
				continue
			}
			value := decodePDFLiteral(match[1:end])
			if strings.TrimSpace(value) != "" {
				builder.WriteString(value)
				builder.WriteByte(' ')
			}
		}
		if strings.TrimSpace(builder.String()) != "" {
			sections = append(sections, extractedSection{Text: builder.String(), Locator: map[string]any{"page": index + 1}})
		}
	}
	return sections
}

func decodePDFLiteral(value []byte) string {
	value = bytes.ReplaceAll(value, []byte(`\n`), []byte("\n"))
	value = bytes.ReplaceAll(value, []byte(`\r`), []byte("\n"))
	value = bytes.ReplaceAll(value, []byte(`\t`), []byte("\t"))
	value = bytes.ReplaceAll(value, []byte(`\(`), []byte("("))
	value = bytes.ReplaceAll(value, []byte(`\)`), []byte(")"))
	value = bytes.ReplaceAll(value, []byte(`\\`), []byte(`\`))
	return normalizePlainText(value)
}

func extractLegacyOfficeText(data []byte) string {
	var parts []string
	var ascii []byte
	flushASCII := func() {
		if len(ascii) >= 4 {
			parts = append(parts, string(ascii))
		}
		ascii = ascii[:0]
	}
	for _, value := range data {
		if value == '\n' || value == '\r' || value == '\t' || (value >= 32 && value < 127) {
			ascii = append(ascii, value)
		} else {
			flushASCII()
		}
	}
	flushASCII()
	var utf16Runes []rune
	for i := 0; i+1 < len(data); i += 2 {
		code := rune(data[i]) | rune(data[i+1])<<8
		if code == '\n' || (code >= 32 && !unicode.IsControl(code)) {
			utf16Runes = append(utf16Runes, code)
		} else {
			if len(utf16Runes) >= 4 {
				parts = append(parts, string(utf16Runes))
			}
			utf16Runes = utf16Runes[:0]
		}
	}
	if len(utf16Runes) >= 4 {
		parts = append(parts, string(utf16Runes))
	}
	return strings.Join(parts, "\n")
}

func naturalLess(a, b string) bool {
	number := regexp.MustCompile(`\d+`)
	ai, _ := strconv.Atoi(number.FindString(a))
	bi, _ := strconv.Atoi(number.FindString(b))
	if ai == bi {
		return a < b
	}
	return ai < bi
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
