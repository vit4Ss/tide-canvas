package file

// presignDTO is the body of POST /api/files/presign.
//
// Matches the frontend fileApi.presign payload:
//
//	{ filename: string; contentType: string; size: number; fileType?: string }
type presignDTO struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	FileType    string `json:"fileType"`
	Category    string `json:"category"`
}

// registerDTO is the body of POST /api/files/register (post direct-upload).
//
//	{ key: string; originalName: string; contentType: string; fileType?: string }
type registerDTO struct {
	Key          string `json:"key"`
	OriginalName string `json:"originalName"`
	ContentType  string `json:"contentType"`
	FileType     string `json:"fileType"`
	Category     string `json:"category"`
}

// saveFromURLDTO is the body of POST /api/files/save-from-url.
//
//	{ url: string; fileType?: string; originalName?: string }
type saveFromURLDTO struct {
	URL          string `json:"url"`
	FileType     string `json:"fileType"`
	Category     string `json:"category"`
	OriginalName string `json:"originalName"`
}

// fileQuery is the query string of GET /api/files (FileQuery).
type fileQuery struct {
	PageNum        int    `form:"pageNum"`
	PageSize       int    `form:"pageSize"`
	OrderBy        string `form:"orderBy"`
	OrderDirection string `form:"orderDirection"`
	FileType       string `form:"fileType"`
	// MediaKind splits the physical "other" bucket into audio/doc before
	// pagination. image/video map to their physical file_type values.
	MediaKind string `form:"mediaKind"`
	Category  string `form:"category"`
	Keyword   string `form:"keyword"`
	// 时间筛选(资产库「时间筛选」):按 create_time 过滤,口径同 ai 任务列表。
	StartDate string `form:"startDate"`
	EndDate   string `form:"endDate"`
}
