package market

import (
	"strings"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for market endpoints. Every id field is an
// idgen.ID (string JSON) and all JSON keys are camelCase.
//
// The MarketModel entity stores only a flat set of columns (name, tags,
// cover_url, use_count, like_count, ...). Several presentation fields the
// frontend wants — nameCn/nameEn, base, type, ver, badge — are not discrete
// columns, so they are DERIVED here without editing the model:
//
//   - name      "中文名|EnglishName" splits into nameCn / nameEn (both fall back
//     to the whole name when no pipe is present).
//   - tags      comma-separated. Pseudo-tags of the form "key:value" (keys
//     base / type / ver / badge) are lifted into the matching VO field; the
//     remaining plain tags become the tags[] list.
//   - base      falls back to the linked category name when no "base:" pseudo-tag.

// ModelCategoryVO is one entry of GET /api/market/categories.
type ModelCategoryVO struct {
	ID        idgen.ID `json:"id"`
	Name      string   `json:"name"`
	Slug      string   `json:"slug"`
	Icon      string   `json:"icon"`
	SortOrder int      `json:"sortOrder"`
}

// AuthorVO is the embedded author view inside MarketModelVO.
type AuthorVO struct {
	ID   idgen.ID `json:"id"`
	Name string   `json:"name"`
}

// MarketModelVO is the list/detail view of a marketplace model.
type MarketModelVO struct {
	ID     idgen.ID `json:"id"`
	Type   string   `json:"type"`
	NameCn string   `json:"nameCn"`
	NameEn string   `json:"nameEn"`
	Base   string   `json:"base"`
	Author AuthorVO `json:"author"`
	Runs   int      `json:"runs"`
	Likes  int      `json:"likes"`
	Ver    string   `json:"ver"`
	Tags   []string `json:"tags"`
	Badge  string   `json:"badge"`
	Cover  string   `json:"cover"`
}

// toCategoryVO maps a persisted category to its VO.
func toCategoryVO(c *model.ModelCategory) ModelCategoryVO {
	return ModelCategoryVO{
		ID:        c.ID,
		Name:      c.Name,
		Slug:      c.Slug,
		Icon:      c.Icon,
		SortOrder: c.SortOrder,
	}
}

// toMarketModelVO maps a persisted market model (plus its resolved author name
// and category name) to the presentation VO, deriving the split-name, base,
// type, ver and badge fields from the stored columns.
func toMarketModelVO(m *model.MarketModel, authorName, categoryName string) MarketModelVO {
	cn, en := splitName(m.Name)
	tags, meta := parseTags(m.Tags)

	base := meta["base"]
	if base == "" {
		base = categoryName
	}

	return MarketModelVO{
		ID:     m.ID,
		Type:   meta["type"],
		NameCn: cn,
		NameEn: en,
		Base:   base,
		Author: AuthorVO{ID: m.AuthorID, Name: authorName},
		Runs:   m.UseCount,
		Likes:  m.LikeCount,
		Ver:    meta["ver"],
		Tags:   tags,
		Badge:  meta["badge"],
		Cover:  m.CoverURL,
	}
}

// splitName splits a "中文名|EnglishName" stored name into its two parts. When no
// pipe is present both parts fall back to the trimmed whole name.
func splitName(name string) (cn, en string) {
	name = strings.TrimSpace(name)
	if i := strings.Index(name, "|"); i >= 0 {
		cn = strings.TrimSpace(name[:i])
		en = strings.TrimSpace(name[i+1:])
		if cn == "" {
			cn = en
		}
		if en == "" {
			en = cn
		}
		return cn, en
	}
	return name, name
}

// parseTags splits the comma-separated tags string into plain display tags and a
// map of lifted pseudo-tags (base/type/ver/badge). A pseudo-tag has the form
// "key:value"; only the recognized keys are lifted, everything else stays a plain
// tag. The returned tags slice is always non-nil (empty when there are none) so
// it serializes as [] rather than null.
func parseTags(raw string) (tags []string, meta map[string]string) {
	tags = []string{}
	meta = map[string]string{}
	for _, part := range strings.Split(raw, ",") {
		t := strings.TrimSpace(part)
		if t == "" {
			continue
		}
		if k, v, ok := splitMeta(t); ok {
			meta[k] = v
			continue
		}
		tags = append(tags, t)
	}
	return tags, meta
}

// splitMeta recognizes a "key:value" pseudo-tag for the lifted keys.
func splitMeta(t string) (key, val string, ok bool) {
	i := strings.Index(t, ":")
	if i <= 0 {
		return "", "", false
	}
	k := strings.ToLower(strings.TrimSpace(t[:i]))
	v := strings.TrimSpace(t[i+1:])
	switch k {
	case "base", "type", "ver", "badge":
		return k, v, true
	default:
		return "", "", false
	}
}
