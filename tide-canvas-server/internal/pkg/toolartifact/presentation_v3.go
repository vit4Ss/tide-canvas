package toolartifact

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"sort"
	"strconv"
	"strings"
)

// presentation_v3 is deliberately content-first: reference images drive the
// palette and composition, while the renderer chooses a layout that can safely
// contain the supplied copy. The previous renderer is retained in office.go for
// package compatibility, but all public PPTX generation routes through this one.

type commercialTheme struct {
	Name       string
	Accent     string
	Accent2    string
	Dark       string
	DarkRaised string
	Light      string
	LightWarm  string
	TextDark   string
	TextLight  string
	MutedDark  string
	MutedLight string
}

type commercialSlideImage struct {
	Index int
	RelID string
	Image *PresentationImage
}

func RenderPPTX(deck Presentation) ([]byte, error) {
	return renderCommercialPPTX(deck)
}

func renderCommercialPPTX(deck Presentation) ([]byte, error) {
	deck = normalizeCommercialDeck(deck)
	theme := resolveCommercialTheme(deck)
	imagePlan := commercialImagePlan(deck.Slides, len(deck.Images))

	files := map[string]string{}
	var overrides, slideIDs, presentationRels, imageTypes strings.Builder
	seenImageTypes := map[string]bool{}
	for index, source := range deck.Images {
		extension, contentType := presentationImageType(source)
		if len(source.Data) == 0 || extension == "" {
			continue
		}
		files[fmt.Sprintf("ppt/media/image%d.%s", index+1, extension)] = string(source.Data)
		if !seenImageTypes[extension] {
			seenImageTypes[extension] = true
			imageTypes.WriteString(fmt.Sprintf(`<Default Extension="%s" ContentType="%s"/>`, extension, contentType))
		}
	}

	for index, slide := range deck.Slides {
		id := index + 1
		overrides.WriteString(fmt.Sprintf(`<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, id))
		slideIDs.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="rId%d"/>`, 255+id, id))
		presentationRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`, id, id))

		rels := strings.Builder{}
		rels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
		refs := make([]commercialSlideImage, 0, len(imagePlan[index]))
		for _, imageIndex := range imagePlan[index] {
			if imageIndex <= 0 || imageIndex > len(deck.Images) {
				continue
			}
			source := &deck.Images[imageIndex-1]
			extension, _ := presentationImageType(*source)
			if len(source.Data) == 0 || extension == "" {
				continue
			}
			relID := fmt.Sprintf("rId%d", len(refs)+2)
			refs = append(refs, commercialSlideImage{Index: imageIndex, RelID: relID, Image: source})
			rels.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image%d.%s"/>`, relID, imageIndex, extension))
		}
		rels.WriteString(`</Relationships>`)
		files[fmt.Sprintf("ppt/slides/slide%d.xml", id)] = commercialSlideXML(deck, slide, index, theme, refs)
		files[fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", id)] = rels.String()
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
	files["ppt/theme/theme1.xml"] = commercialThemeXML(theme)
	files["ppt/presProps.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`
	files["ppt/viewProps.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr/><p:slideViewPr/><p:notesTextViewPr/><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`
	files["ppt/tableStyles.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`
	return zipFiles(files)
}

func normalizeCommercialDeck(deck Presentation) Presentation {
	if strings.TrimSpace(deck.Title) == "" {
		deck.Title = "演示文稿"
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
	deck.Slides[0].Kind = "cover"
	last := len(deck.Slides) - 1
	if last > 0 && strings.TrimSpace(deck.Slides[last].Kind) == "" {
		deck.Slides[last].Kind = "closing"
	}
	for index := range deck.Slides {
		deck.Slides[index].Title = presentationText(deck.Slides[index].Title, 54)
		deck.Slides[index].Subtitle = presentationText(deck.Slides[index].Subtitle, 110)
		deck.Slides[index].Takeaway = presentationText(deck.Slides[index].Takeaway, 110)
		deck.Slides[index].Caption = presentationText(deck.Slides[index].Caption, 90)
		deck.Slides[index].Kicker = presentationText(deck.Slides[index].Kicker, 36)
	}
	return deck
}

func resolveCommercialTheme(deck Presentation) commercialTheme {
	name := strings.ToLower(strings.TrimSpace(deck.Theme))
	switch name {
	case "cinematic", "科技深色", "电影感", "bold":
		name = "cinematic"
	case "editorial", "编辑风", "人文叙事":
		name = "editorial"
	case "consulting", "咨询报告", "商务极简":
		name = "consulting"
	case "launch", "品牌发布", "发布会":
		name = "launch"
	default:
		if len(deck.Images) > 0 {
			name = "launch"
		} else {
			name = "consulting"
		}
	}
	accent := strings.TrimPrefix(strings.ToUpper(strings.TrimSpace(deck.Accent)), "#")
	if accent == "" || accent == "AUTO" {
		accent = derivePresentationAccent(deck.Images)
	}
	accent = cleanPPTColor(accent, "FF4D3D")
	accent2 := cleanPPTColor(deck.Accent2, mixPPTColor(accent, "FFFFFF", 0.32))
	return commercialTheme{
		Name: name, Accent: accent, Accent2: accent2,
		Dark: "0B0D10", DarkRaised: "171B21", Light: "F7F8FA", LightWarm: "F2EFE8",
		TextDark: "121417", TextLight: "F7F8FA", MutedDark: "626A76", MutedLight: "ADB5C0",
	}
}

func commercialImagePlan(slides []Slide, imageCount int) [][]int {
	plan := make([][]int, len(slides))
	if imageCount <= 0 || len(slides) == 0 {
		return plan
	}
	used := map[int]bool{}
	for index, slide := range slides {
		values := append([]int(nil), slide.ImageIndexes...)
		if slide.ImageIndex > 0 {
			values = append([]int{slide.ImageIndex}, values...)
		}
		seen := map[int]bool{}
		for _, value := range values {
			if value <= 0 || value > imageCount || seen[value] || len(plan[index]) >= 4 {
				continue
			}
			seen[value] = true
			used[value] = true
			plan[index] = append(plan[index], value)
		}
	}
	if len(plan[0]) == 0 {
		plan[0] = []int{1}
		used[1] = true
	}
	preferred := make([]int, 0, len(slides))
	fallback := make([]int, 0, len(slides))
	for index, slide := range slides {
		if index == 0 || index == len(slides)-1 {
			continue
		}
		kind := strings.ToLower(strings.TrimSpace(slide.Kind))
		switch kind {
		case "image", "gallery", "visual", "content", "statement", "quote":
			preferred = append(preferred, index)
		case "section", "metrics", "timeline", "process":
		default:
			fallback = append(fallback, index)
		}
	}
	targets := append(preferred, fallback...)
	for imageIndex := 1; imageIndex <= imageCount; imageIndex++ {
		if used[imageIndex] {
			continue
		}
		placed := false
		for _, slideIndex := range targets {
			limit := 1
			kind := strings.ToLower(strings.TrimSpace(slides[slideIndex].Kind))
			if kind == "image" || kind == "gallery" || kind == "visual" {
				limit = 2
			}
			if len(plan[slideIndex]) < limit {
				plan[slideIndex] = append(plan[slideIndex], imageIndex)
				placed = true
				break
			}
		}
		if !placed && len(plan[0]) < 2 {
			plan[0] = append(plan[0], imageIndex)
		}
	}
	return plan
}

func commercialSlideXML(deck Presentation, slide Slide, index int, theme commercialTheme, images []commercialSlideImage) string {
	kind := strings.ToLower(strings.TrimSpace(slide.Kind))
	if index == 0 {
		kind = "cover"
	} else if index == len(deck.Slides)-1 && (kind == "" || kind == "content") {
		kind = "closing"
	}
	if kind == "" {
		kind = "content"
	}
	background, textColor, mutedColor := commercialSlideColors(theme, slide.Tone, kind, index)
	title := presentationText(slide.Title, 54)
	if title == "" {
		title = "核心观点"
	}
	takeaway := presentationText(slide.Takeaway, 105)
	subtitle := presentationText(slide.Subtitle, 105)
	kicker := presentationText(slide.Kicker, 36)

	shapes := make([]string, 0, 24)
	nextID := 2
	add := func(shape string) {
		shapes = append(shapes, shape)
		nextID++
	}
	addRect := func(name string, x, y, cx, cy int, fill string, alpha int) {
		add(commercialRect(nextID, name, x, y, cx, cy, fill, alpha))
	}
	addText := func(name string, x, y, cx, cy, size int, color string, bold bool, align, text string) {
		if strings.TrimSpace(text) == "" {
			return
		}
		add(pptTextBox(nextID, name, x, y, cx, cy, commercialParagraph(text, size, color, bold, false, align), "", "t"))
	}
	addBullets := func(name string, x, y, cx, cy, size int, color string, values []string, limit int) {
		add(pptTextBox(nextID, name, x, y, cx, cy, commercialBullets(values, size, color, limit), "", "t"))
	}
	addPicture := func(name string, ref commercialSlideImage, x, y, cx, cy int) {
		add(pptPicture(nextID, name, x, y, cx, cy, ref.RelID, ref.Image.Width, ref.Image.Height))
	}
	addPageMark := func() {
		if index == 0 {
			return
		}
		addText("Deck label", emu(0.72), emu(7.12), emu(5.4), emu(0.18), 900, mutedColor, false, "l", presentationText(deck.Title, 28))
		addText("Page", emu(12.05), emu(7.08), emu(0.55), emu(0.22), 950, mutedColor, false, "r", fmt.Sprintf("%02d", index+1))
	}

	addRect("Background", 0, 0, pptSlideWidth, pptSlideHeight, background, 100000)

	switch kind {
	case "cover":
		coverBackground := theme.Dark
		addRect("Cover background", 0, 0, pptSlideWidth, pptSlideHeight, coverBackground, 100000)
		textWidth := emu(10.7)
		subtitleWidth := textWidth
		if len(images) > 0 {
			addPicture("Hero reference", images[0], emu(7.15), 0, emu(6.18), pptSlideHeight)
			addRect("Image divider", emu(7.1), 0, emu(0.05), pptSlideHeight, theme.Accent, 100000)
			textWidth = emu(6.15)
			subtitleWidth = emu(5.05)
		}
		addRect("Cover rule", emu(0.72), emu(0.72), emu(0.11), emu(5.92), theme.Accent, 100000)
		addText("Kicker", emu(1.08), emu(0.82), textWidth, emu(0.32), 1200, theme.Accent, true, "l", nonEmptyText(kicker, "PRESENTATION"))
		coverTitle := presentationText(title, 34)
		addText("Title", emu(1.08), emu(1.42), textWidth, emu(3.35), commercialCoverTitleSize(coverTitle), theme.TextLight, true, "l", coverTitle)
		addText("Subtitle", emu(1.1), emu(5.2), subtitleWidth, emu(0.9), 1900, theme.MutedLight, false, "l", presentationText(subtitle, 74))
		if len(images) > 0 {
			addText("Image caption", emu(8.0), emu(6.82), emu(4.55), emu(0.22), 900, "D5DAE1", false, "r", presentationText(nonEmptyText(slide.Caption, images[0].Image.Name), 54))
		}
	case "section":
		sectionText := commercialContrast(theme.Accent)
		addRect("Section background", 0, 0, pptSlideWidth, pptSlideHeight, theme.Accent, 100000)
		addText("Section index", emu(0.68), emu(0.45), emu(3.2), emu(1.65), 9800, mixPPTColor(theme.Accent, sectionText, 0.2), true, "l", fmt.Sprintf("%02d", index))
		addText("Kicker", emu(3.1), emu(1.18), emu(8.7), emu(0.32), 1300, sectionText, true, "l", kicker)
		addText("Title", emu(3.1), emu(1.9), emu(8.75), emu(2.1), commercialSlideTitleSize(title), sectionText, true, "l", title)
		addText("Subtitle", emu(3.12), emu(4.45), emu(7.8), emu(0.85), 2100, mixPPTColor(theme.Accent, sectionText, 0.76), false, "l", subtitle)
	case "statement", "quote":
		contentWidth := emu(10.9)
		if len(images) > 0 {
			addPicture("Statement reference", images[0], emu(8.85), 0, emu(4.48), pptSlideHeight)
			addRect("Statement image veil", emu(8.15), 0, emu(1.25), pptSlideHeight, background, 75000)
			contentWidth = emu(7.2)
		}
		addText("Kicker", emu(0.82), emu(0.72), contentWidth, emu(0.3), 1200, theme.Accent, true, "l", kicker)
		addText("Statement", emu(0.82), emu(1.55), contentWidth, emu(2.65), commercialStatementSize(title), textColor, true, "l", presentationText(title, 48))
		addRect("Statement rule", emu(0.82), emu(4.55), emu(2.05), emu(0.07), theme.Accent, 100000)
		addText("Support", emu(0.82), emu(4.9), contentWidth, emu(0.95), 2100, mutedColor, false, "l", nonEmptyText(takeaway, subtitle))
		addPageMark()
	case "metrics":
		addText("Kicker", emu(0.72), emu(0.42), emu(3.2), emu(0.25), 1100, theme.Accent, true, "l", kicker)
		addText("Title", emu(0.72), emu(0.82), emu(11.9), emu(0.92), commercialSlideTitleSize(title), textColor, true, "l", title)
		metrics := slide.Metrics
		if len(metrics) > 3 {
			metrics = metrics[:3]
		}
		if len(metrics) == 0 {
			addText("Takeaway", emu(0.75), emu(2.2), emu(10.9), emu(1.6), 3000, textColor, true, "l", nonEmptyText(takeaway, subtitle))
		}
		width := 11.9 / math.Max(1, float64(len(metrics)))
		for metricIndex, metric := range metrics {
			x := 0.72 + float64(metricIndex)*width
			if metricIndex > 0 {
				addRect(fmt.Sprintf("Metric divider %d", metricIndex), emu(x-0.22), emu(2.15), emu(0.018), emu(2.75), mutedColor, 36000)
			}
			addText(fmt.Sprintf("Metric value %d", metricIndex+1), emu(x), emu(2.05), emu(width-0.45), emu(1.12), commercialMetricSize(metric.Value), theme.Accent, true, "l", presentationText(metric.Value, 22))
			addText(fmt.Sprintf("Metric label %d", metricIndex+1), emu(x), emu(3.45), emu(width-0.5), emu(1.1), 1800, textColor, true, "l", presentationText(metric.Label, 65))
		}
		addText("Takeaway", emu(0.74), emu(5.35), emu(11.55), emu(0.65), 2000, mutedColor, false, "l", takeaway)
		addPageMark()
	case "comparison":
		addText("Kicker", emu(0.72), emu(0.42), emu(3.2), emu(0.25), 1100, theme.Accent, true, "l", kicker)
		addText("Title", emu(0.72), emu(0.82), emu(11.9), emu(0.92), commercialSlideTitleSize(title), textColor, true, "l", title)
		columns := slide.Columns
		if len(columns) > 2 {
			columns = columns[:2]
		}
		addRect("Comparison divider", emu(6.65), emu(2.0), emu(0.025), emu(3.9), mutedColor, 42000)
		for columnIndex, column := range columns {
			x := 0.82 + float64(columnIndex)*6.02
			labelColor := theme.Accent
			if columnIndex == 1 {
				labelColor = theme.Accent2
			}
			addRect(fmt.Sprintf("Column rule %d", columnIndex+1), emu(x), emu(2.05), emu(0.72), emu(0.08), labelColor, 100000)
			addText(fmt.Sprintf("Column title %d", columnIndex+1), emu(x), emu(2.38), emu(5.25), emu(0.52), 2500, textColor, true, "l", presentationText(column.Heading, 38))
			addText(fmt.Sprintf("Column body %d", columnIndex+1), emu(x), emu(3.05), emu(5.05), emu(0.72), 1800, mutedColor, false, "l", presentationText(column.Body, 72))
			addBullets(fmt.Sprintf("Column bullets %d", columnIndex+1), emu(x), emu(4.0), emu(5.05), emu(1.55), 1650, textColor, column.Bullets, 4)
		}
		addPageMark()
	case "timeline", "process":
		addText("Kicker", emu(0.72), emu(0.42), emu(3.2), emu(0.25), 1100, theme.Accent, true, "l", kicker)
		addText("Title", emu(0.72), emu(0.82), emu(11.9), emu(0.92), commercialSlideTitleSize(title), textColor, true, "l", title)
		steps := slide.Bullets
		if len(steps) > 4 {
			steps = steps[:4]
		}
		for stepIndex, step := range steps {
			column := stepIndex % 2
			row := stepIndex / 2
			x := 0.82 + float64(column)*6.05
			y := 2.05 + float64(row)*1.72
			addText(fmt.Sprintf("Step number %d", stepIndex+1), emu(x), emu(y), emu(0.65), emu(0.65), 2600, theme.Accent, true, "l", fmt.Sprintf("%02d", stepIndex+1))
			addRect(fmt.Sprintf("Step rule %d", stepIndex+1), emu(x+0.82), emu(y+0.18), emu(0.6), emu(0.06), theme.Accent, 100000)
			addText(fmt.Sprintf("Step %d", stepIndex+1), emu(x+1.55), emu(y-0.02), emu(4.15), emu(1.02), 1800, textColor, true, "l", presentationText(step, 66))
		}
		addText("Takeaway", emu(0.82), emu(5.62), emu(11.2), emu(0.48), 1850, mutedColor, false, "l", takeaway)
		addPageMark()
	case "image", "gallery", "visual":
		if len(images) == 0 {
			commercialContentSlide(addRect, addText, addBullets, addPicture, addPageMark, slide, index, theme, background, textColor, mutedColor, nil)
			break
		}
		addRect("Visual background", 0, 0, pptSlideWidth, pptSlideHeight, theme.Dark, 100000)
		if len(images) == 1 {
			addPicture("Full bleed reference", images[0], 0, 0, pptSlideWidth, pptSlideHeight)
		} else {
			addPicture("Reference A", images[0], 0, 0, emu(6.64), pptSlideHeight)
			addPicture("Reference B", images[1], emu(6.69), 0, emu(6.64), pptSlideHeight)
		}
		addRect("Visual title veil", emu(0.55), emu(0.55), emu(6.5), emu(2.35), theme.Dark, 82000)
		addText("Kicker", emu(0.82), emu(0.82), emu(5.8), emu(0.25), 1100, theme.Accent, true, "l", kicker)
		addText("Title", emu(0.82), emu(1.24), emu(5.85), emu(1.35), 3500, theme.TextLight, true, "l", presentationText(title, 32))
		caption := nonEmptyText(slide.Caption, takeaway)
		if caption != "" {
			addRect("Caption veil", emu(7.55), emu(6.2), emu(5.1), emu(0.76), theme.Dark, 76000)
			addText("Caption", emu(7.82), emu(6.32), emu(4.55), emu(0.48), 1200, theme.TextLight, false, "r", presentationText(caption, 72))
		}
	case "closing":
		addRect("Closing background", 0, 0, pptSlideWidth, pptSlideHeight, theme.Dark, 100000)
		addRect("Closing accent", emu(0.72), emu(0.78), emu(0.12), emu(5.85), theme.Accent, 100000)
		addText("Kicker", emu(1.08), emu(0.82), emu(4.2), emu(0.3), 1200, theme.Accent, true, "l", nonEmptyText(kicker, "CONCLUSION"))
		addText("Title", emu(1.08), emu(1.55), emu(10.9), emu(1.65), commercialClosingTitleSize(title), theme.TextLight, true, "l", presentationText(title, 44))
		addText("Takeaway", emu(1.1), emu(3.55), emu(9.9), emu(0.9), 2300, theme.MutedLight, false, "l", takeaway)
		for actionIndex, action := range compactStrings(slide.Bullets, 3, 46) {
			x := 1.1 + float64(actionIndex)*3.75
			addText(fmt.Sprintf("Action number %d", actionIndex+1), emu(x), emu(5.15), emu(0.45), emu(0.35), 1400, theme.Accent, true, "l", fmt.Sprintf("0%d", actionIndex+1))
			addText(fmt.Sprintf("Action %d", actionIndex+1), emu(x+0.55), emu(5.12), emu(2.9), emu(0.75), 1650, theme.TextLight, true, "l", action)
		}
	default:
		commercialContentSlide(addRect, addText, addBullets, addPicture, addPageMark, slide, index, theme, background, textColor, mutedColor, images)
	}

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` + strings.Join(shapes, "") + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

func commercialContentSlide(
	addRect func(string, int, int, int, int, string, int),
	addText func(string, int, int, int, int, int, string, bool, string, string),
	addBullets func(string, int, int, int, int, int, string, []string, int),
	addPicture func(string, commercialSlideImage, int, int, int, int),
	addPageMark func(),
	slide Slide,
	index int,
	theme commercialTheme,
	background, textColor, mutedColor string,
	images []commercialSlideImage,
) {
	title := presentationText(slide.Title, 54)
	takeaway := presentationText(slide.Takeaway, 105)
	kicker := presentationText(slide.Kicker, 36)
	textX, textWidth := 0.72, 11.85
	imageLeft := index%2 == 0
	if len(images) > 0 {
		if imageLeft {
			textX, textWidth = 7.05, 5.55
			if len(images) == 1 {
				addPicture("Reference image", images[0], emu(0.0), emu(0.0), emu(6.45), pptSlideHeight)
			} else {
				addPicture("Reference image A", images[0], emu(0.0), emu(0.0), emu(6.45), emu(3.72))
				addPicture("Reference image B", images[1], emu(0.0), emu(3.78), emu(6.45), emu(3.72))
			}
			addRect("Image edge", emu(6.42), 0, emu(0.09), pptSlideHeight, theme.Accent, 100000)
		} else {
			textWidth = 5.55
			if len(images) == 1 {
				addPicture("Reference image", images[0], emu(6.88), emu(0.0), emu(6.45), pptSlideHeight)
			} else {
				addPicture("Reference image A", images[0], emu(6.88), emu(0.0), emu(6.45), emu(3.72))
				addPicture("Reference image B", images[1], emu(6.88), emu(3.78), emu(6.45), emu(3.72))
			}
			addRect("Image edge", emu(6.82), 0, emu(0.09), pptSlideHeight, theme.Accent, 100000)
		}
	}
	addText("Kicker", emu(textX), emu(0.52), emu(textWidth), emu(0.25), 1100, theme.Accent, true, "l", kicker)
	addText("Title", emu(textX), emu(0.92), emu(textWidth), emu(1.32), commercialSlideTitleSizeForWidth(title, textWidth), textColor, true, "l", title)
	if takeaway != "" {
		addText("Takeaway", emu(textX), emu(2.48), emu(textWidth), emu(0.95), 2200, textColor, true, "l", takeaway)
	}
	bodyY := 3.72
	if takeaway == "" {
		bodyY = 2.72
	}
	addBullets("Content", emu(textX), emu(bodyY), emu(textWidth), emu(2.25), 1750, mutedColor, slide.Bullets, 5)
	addPageMark()
}

func commercialSlideColors(theme commercialTheme, tone, kind string, index int) (background, text, muted string) {
	tone = strings.ToLower(strings.TrimSpace(tone))
	dark := tone == "dark"
	if tone == "light" {
		dark = false
	} else if tone == "" {
		switch theme.Name {
		case "cinematic":
			dark = true
		case "launch":
			dark = index%3 == 0 || kind == "statement"
		case "editorial":
			dark = kind == "statement" && index%2 == 1
		}
	}
	if dark {
		return theme.Dark, theme.TextLight, theme.MutedLight
	}
	if theme.Name == "editorial" {
		return theme.LightWarm, theme.TextDark, theme.MutedDark
	}
	return theme.Light, theme.TextDark, theme.MutedDark
}

func commercialRect(id int, name string, x, y, cx, cy int, fill string, alpha int) string {
	fill = cleanPPTColor(fill, "FFFFFF")
	if alpha <= 0 || alpha > 100000 {
		alpha = 100000
	}
	alphaXML := ""
	if alpha < 100000 {
		alphaXML = `<a:alpha val="` + strconv.Itoa(alpha) + `"/>`
	}
	return fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="%s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="%s">%s</a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`, id, xmlText(name), x, y, cx, cy, fill, alphaXML)
}

func commercialParagraph(text string, size int, color string, bold, bullet bool, align string) string {
	properties := `<a:pPr algn="` + align + `"`
	if bullet {
		properties += ` marL="300000" indent="-220000"><a:lnSpc><a:spcPct val="112000"/></a:lnSpc><a:spcAft><a:spcPts val="900"/></a:spcAft><a:buChar char="•"/></a:pPr>`
	} else {
		properties += `><a:lnSpc><a:spcPct val="104000"/></a:lnSpc><a:buNone/></a:pPr>`
	}
	boldValue := "0"
	if bold {
		boldValue = "1"
	}
	return `<a:p>` + properties + `<a:r><a:rPr lang="zh-CN" sz="` + strconv.Itoa(size) + `" b="` + boldValue + `" kern="1200"><a:solidFill><a:srgbClr val="` + cleanPPTColor(color, "121417") + `"/></a:solidFill><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft YaHei UI"/></a:rPr><a:t>` + xmlText(text) + `</a:t></a:r><a:endParaRPr lang="zh-CN" sz="` + strconv.Itoa(size) + `"/></a:p>`
}

func commercialBullets(values []string, size int, color string, limit int) string {
	var out strings.Builder
	for _, value := range compactStrings(values, limit, 58) {
		out.WriteString(commercialParagraph(value, size, color, false, true, "l"))
	}
	if out.Len() == 0 {
		out.WriteString(commercialParagraph("", size, color, false, false, "l"))
	}
	return out.String()
}

func compactStrings(values []string, limit, maxRunes int) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = presentationText(value, maxRunes)
		if value == "" {
			continue
		}
		out = append(out, value)
		if limit > 0 && len(out) >= limit {
			break
		}
	}
	return out
}

func commercialCoverTitleSize(text string) int {
	length := len([]rune(text))
	if length > 28 {
		return 5000
	}
	if length > 20 {
		return 5400
	}
	return 6200
}

func commercialSlideTitleSize(text string) int {
	return commercialSlideTitleSizeForWidth(text, 11.9)
}

func commercialSlideTitleSizeForWidth(text string, widthInches float64) int {
	length := float64(len([]rune(text)))
	capacity := widthInches * 2.15
	if length > capacity*1.45 {
		return 3500
	}
	if length > capacity {
		return 3800
	}
	return 4200
}

func commercialStatementSize(text string) int {
	if len([]rune(text)) > 34 {
		return 3800
	}
	return 4600
}

func commercialClosingTitleSize(text string) int {
	if len([]rune(text)) > 34 {
		return 3800
	}
	return 4600
}

func commercialMetricSize(value string) int {
	if len([]rune(value)) > 12 {
		return 3500
	}
	if len([]rune(value)) > 7 {
		return 4200
	}
	return 5200
}

func emu(inches float64) int {
	return int(math.Round(inches * 914400))
}

func derivePresentationAccent(images []PresentationImage) string {
	type bucket struct {
		count   int
		r, g, b int
	}
	buckets := map[int]*bucket{}
	for _, source := range images {
		decoded, _, err := image.Decode(bytes.NewReader(source.Data))
		if err != nil {
			continue
		}
		bounds := decoded.Bounds()
		stepX := int(math.Max(1, float64(bounds.Dx())/72))
		stepY := int(math.Max(1, float64(bounds.Dy())/72))
		for y := bounds.Min.Y; y < bounds.Max.Y; y += stepY {
			for x := bounds.Min.X; x < bounds.Max.X; x += stepX {
				r16, g16, b16, a16 := decoded.At(x, y).RGBA()
				if a16 < 0x8000 {
					continue
				}
				r, g, b := int(r16>>8), int(g16>>8), int(b16>>8)
				maxValue := maxInt(r, maxInt(g, b))
				minValue := minInt(r, minInt(g, b))
				if maxValue < 48 || minValue > 232 || maxValue-minValue < 34 {
					continue
				}
				key := (r/32)<<6 | (g/32)<<3 | b/32
				entry := buckets[key]
				if entry == nil {
					entry = &bucket{}
					buckets[key] = entry
				}
				weight := 1 + (maxValue-minValue)/48
				entry.count += weight
				entry.r += r * weight
				entry.g += g * weight
				entry.b += b * weight
			}
		}
	}
	if len(buckets) == 0 {
		return "FF4D3D"
	}
	keys := make([]int, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return buckets[keys[i]].count > buckets[keys[j]].count })
	best := buckets[keys[0]]
	r, g, b := best.r/best.count, best.g/best.count, best.b/best.count
	luminance := (299*r + 587*g + 114*b) / 1000
	if luminance < 92 {
		r = (r*3 + 255) / 4
		g = (g*3 + 255) / 4
		b = (b*3 + 255) / 4
	}
	return fmt.Sprintf("%02X%02X%02X", r, g, b)
}

func mixPPTColor(first, second string, ratio float64) string {
	first = cleanPPTColor(first, "000000")
	second = cleanPPTColor(second, "FFFFFF")
	if ratio < 0 {
		ratio = 0
	}
	if ratio > 1 {
		ratio = 1
	}
	parse := func(value string, offset int) int {
		parsed, _ := strconv.ParseInt(value[offset:offset+2], 16, 32)
		return int(parsed)
	}
	r := int(math.Round(float64(parse(first, 0))*(1-ratio) + float64(parse(second, 0))*ratio))
	g := int(math.Round(float64(parse(first, 2))*(1-ratio) + float64(parse(second, 2))*ratio))
	b := int(math.Round(float64(parse(first, 4))*(1-ratio) + float64(parse(second, 4))*ratio))
	return fmt.Sprintf("%02X%02X%02X", r, g, b)
}

func commercialContrast(color string) string {
	color = cleanPPTColor(color, "000000")
	parse := func(offset int) int {
		value, _ := strconv.ParseInt(color[offset:offset+2], 16, 32)
		return int(value)
	}
	if (299*parse(0)+587*parse(2)+114*parse(4))/1000 > 148 {
		return "101215"
	}
	return "FFFFFF"
}

func commercialThemeXML(theme commercialTheme) string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="FlowingLight Commercial"><a:themeElements><a:clrScheme name="FlowingLight Commercial"><a:dk1><a:srgbClr val="` + theme.TextDark + `"/></a:dk1><a:lt1><a:srgbClr val="` + theme.TextLight + `"/></a:lt1><a:dk2><a:srgbClr val="` + theme.DarkRaised + `"/></a:dk2><a:lt2><a:srgbClr val="` + theme.Light + `"/></a:lt2><a:accent1><a:srgbClr val="` + theme.Accent + `"/></a:accent1><a:accent2><a:srgbClr val="` + theme.Accent2 + `"/></a:accent2><a:accent3><a:srgbClr val="5B677A"/></a:accent3><a:accent4><a:srgbClr val="8B5CF6"/></a:accent4><a:accent5><a:srgbClr val="0EA5A8"/></a:accent5><a:accent6><a:srgbClr val="D97706"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="FlowingLight Commercial"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface="Microsoft YaHei UI"/><a:cs typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface="Microsoft YaHei UI"/><a:cs typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="FlowingLight Commercial"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
