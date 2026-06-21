package file

// presignDTO is the body of POST /api/files/presign.
//
// Matches the frontend fileApi.presign payload:
//
//	{ filename: string; contentType: string; fileType?: string }
type presignDTO struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	FileType    string `json:"fileType"`
}

// registerDTO is the body of POST /api/files/register (post direct-upload).
//
//	{ key: string; originalName: string; contentType: string; fileType?: string }
type registerDTO struct {
	Key          string `json:"key"`
	OriginalName string `json:"originalName"`
	ContentType  string `json:"contentType"`
	FileType     string `json:"fileType"`
}

// saveFromURLDTO is the body of POST /api/files/save-from-url.
//
//	{ url: string; fileType?: string; originalName?: string }
type saveFromURLDTO struct {
	URL          string `json:"url"`
	FileType     string `json:"fileType"`
	OriginalName string `json:"originalName"`
}

// fileQuery is the query string of GET /api/files (FileQuery).
type fileQuery struct {
	PageNum        int    `form:"pageNum"`
	PageSize       int    `form:"pageSize"`
	OrderBy        string `form:"orderBy"`
	OrderDirection string `form:"orderDirection"`
	FileType       string `form:"fileType"`
	Keyword        string `form:"keyword"`
}
