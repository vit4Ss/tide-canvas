package community

import (
	"encoding/json"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for the community domain. JSON shapes mirror
// the frontend (tide-canvas-web inspire/community feed). Every id field is an
// idgen.ID (serialized as a string).
//
// The CommunityPost model only persists Title/Content/CoverURL/Tags + counters,
// so the richer feed/detail fields the frontend wants (type, cat, model, and the
// generation params: prompt/negPrompt/steps/sampler/cfgScale/size/seed) are
// carried inside the Content column as a small JSON metadata blob and decoded
// here. This keeps the model untouched while round-tripping the full VO shape.

// postMeta is the JSON blob stored in CommunityPost.Content. All fields are
// optional; a post whose Content is not valid JSON degrades gracefully (empty
// meta, type defaults to "image", description falls back to raw Content).
type postMeta struct {
	Type      string  `json:"type"`      // image|video
	Cat       string  `json:"cat"`       // category label
	Model     string  `json:"model"`     // generation model label
	Desc      string  `json:"desc"`      // human-readable description / body
	Prompt    string  `json:"prompt"`    // detail-only
	NegPrompt string  `json:"negPrompt"` // detail-only
	Steps     int     `json:"steps"`     // detail-only
	Sampler   string  `json:"sampler"`   // detail-only
	CfgScale  float64 `json:"cfgScale"`  // detail-only
	Size      string  `json:"size"`      // detail-only, e.g. "1024x1024"
	Seed      int64   `json:"seed"`      // detail-only
}

// AuthorVO is the compact author block embedded in a PostVO.
type AuthorVO struct {
	ID     idgen.ID `json:"id"`
	Name   string   `json:"name"`
	Avatar string   `json:"avatar"`
}

// PostVO is the feed-card view of a community post.
//
//	{id,type,cover,thumbnail,title,cat,model,author{id,name,avatar},likes,liked,createTime}
type PostVO struct {
	ID         idgen.ID `json:"id"`
	Type       string   `json:"type"`
	Cover      string   `json:"cover"`
	Thumbnail  string   `json:"thumbnail"`
	Title      string   `json:"title"`
	Cat        string   `json:"cat"`
	Model      string   `json:"model"`
	Author     AuthorVO `json:"author"`
	Likes      int      `json:"likes"`
	Liked      bool     `json:"liked"`
	CreateTime string   `json:"createTime"`
}

// PostDetailVO is the full post view, adding the generation parameters and the
// comment count on top of the feed card.
type PostDetailVO struct {
	PostVO
	Prompt    string  `json:"prompt"`
	NegPrompt string  `json:"negPrompt"`
	Steps     int     `json:"steps"`
	Sampler   string  `json:"sampler"`
	CfgScale  float64 `json:"cfgScale"`
	Size      string  `json:"size"`
	Seed      int64   `json:"seed"`
	Comments  int     `json:"comments"`
}

// CommentVO is one comment in a post's comment list.
type CommentVO struct {
	ID         idgen.ID  `json:"id"`
	PostID     idgen.ID  `json:"postId"`
	ParentID   *idgen.ID `json:"parentId"`
	Content    string    `json:"content"`
	Author     AuthorVO  `json:"author"`
	CreateTime string    `json:"createTime"`
}

// UserSimpleVO is the compact user view for follower / following lists.
type UserSimpleVO struct {
	ID       idgen.ID `json:"id"`
	Username string   `json:"username"`
	Nickname string   `json:"nickname"`
	Avatar   string   `json:"avatar"`
}

// LikeVO is the toggle-like response.
type LikeVO struct {
	Liked     bool `json:"liked"`
	LikeCount int  `json:"likeCount"`
}

// parseMeta decodes the metadata blob from a post's Content column. It never
// errors: invalid JSON yields a zero meta value.
func parseMeta(content string) postMeta {
	var m postMeta
	s := strings.TrimSpace(content)
	if s == "" || s[0] != '{' {
		return m
	}
	_ = json.Unmarshal([]byte(s), &m)
	return m
}

// authorName prefers the nickname, then username, then a generic label so the
// feed never renders an empty author.
func authorName(u *model.User) string {
	if u == nil {
		return "用户"
	}
	if n := strings.TrimSpace(u.Nickname); n != "" {
		return n
	}
	if n := strings.TrimSpace(u.Username); n != "" {
		return n
	}
	return "用户"
}

// toAuthorVO builds the compact author block (nil-safe).
func toAuthorVO(u *model.User) AuthorVO {
	if u == nil {
		return AuthorVO{Name: "用户"}
	}
	return AuthorVO{ID: u.ID, Name: authorName(u), Avatar: u.Avatar}
}

// postType normalizes the stored type to image|video, defaulting to image.
func postType(m postMeta) string {
	if strings.EqualFold(m.Type, "video") {
		return "video"
	}
	return "image"
}

// toPostVO maps a post + its author + the caller's liked flag to the feed VO.
func toPostVO(p *model.CommunityPost, author *model.User, liked bool) PostVO {
	m := parseMeta(p.Content)
	return PostVO{
		ID:         p.ID,
		Type:       postType(m),
		Cover:      p.CoverURL,
		Thumbnail:  p.CoverURL,
		Title:      p.Title,
		Cat:        m.Cat,
		Model:      m.Model,
		Author:     toAuthorVO(author),
		Likes:      p.LikeCount,
		Liked:      liked,
		CreateTime: formatTime(p.CreateTime),
	}
}

// toPostDetailVO maps a post to the full detail VO (generation params + comment
// count). commentCount is passed in so the handler can use the live count.
func toPostDetailVO(p *model.CommunityPost, author *model.User, liked bool, commentCount int) PostDetailVO {
	m := parseMeta(p.Content)
	return PostDetailVO{
		PostVO:    toPostVO(p, author, liked),
		Prompt:    m.Prompt,
		NegPrompt: m.NegPrompt,
		Steps:     m.Steps,
		Sampler:   m.Sampler,
		CfgScale:  m.CfgScale,
		Size:      m.Size,
		Seed:      m.Seed,
		Comments:  commentCount,
	}
}

// toCommentVO maps a persisted comment + its author to the comment VO.
func toCommentVO(cm *model.PostComment, author *model.User) CommentVO {
	return CommentVO{
		ID:         cm.ID,
		PostID:     cm.PostID,
		ParentID:   cm.ParentID,
		Content:    cm.Content,
		Author:     toAuthorVO(author),
		CreateTime: formatTime(cm.CreateTime),
	}
}

// toUserSimpleVO maps a user to the compact follower/following VO.
func toUserSimpleVO(u *model.User) UserSimpleVO {
	if u == nil {
		return UserSimpleVO{}
	}
	return UserSimpleVO{
		ID:       u.ID,
		Username: u.Username,
		Nickname: u.Nickname,
		Avatar:   u.Avatar,
	}
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
