package file

import (
	"errors"
	"mime/multipart"
	"net/http"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

const (
	maxMultipartOverhead = 1 << 20
	maxBatchFiles        = 20
	maxBatchTotalSize    = maxFileSize
)

// handler is the file domain's HTTP layer.
type handler struct {
	svc *service
}

func newHandler(d *app.Deps) *handler {
	return &handler{svc: newService(d)}
}

// upload POST /api/files/upload (multipart "file") -> FileVO
func (h *handler) upload(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFileSize+maxMultipartOverhead)
	defer removeMultipartTempFiles(c)
	fh, err := c.FormFile("file")
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeUploadErr(c, errFileTooLarge)
			return
		}
		response.Fail(c, response.CodeBadRequest, "missing file field")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.saveHeader(c, uid, fh)
	if err != nil {
		writeUploadErr(c, err)
		return
	}
	response.OK(c, vo)
}

// uploadBatch POST /api/files/upload/batch (multipart, multiple "file") -> FileVO[]
func (h *handler) uploadBatch(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBatchTotalSize+maxMultipartOverhead)
	form, err := c.MultipartForm()
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeUploadErr(c, errFileTooLarge)
			return
		}
		response.Fail(c, response.CodeBadRequest, "invalid multipart form")
		return
	}
	defer form.RemoveAll()
	files := form.File["file"]
	if len(files) == 0 {
		files = form.File["files"] // tolerate either field name
	}
	if len(files) == 0 {
		response.Fail(c, response.CodeBadRequest, "no files uploaded")
		return
	}
	if len(files) > maxBatchFiles {
		response.Fail(c, response.CodeBadRequest, "too many files")
		return
	}
	var totalSize int64
	for _, fh := range files {
		if fh.Size <= 0 {
			writeUploadErr(c, errEmptyFile)
			return
		}
		if fh.Size > maxFileSize || totalSize > maxBatchTotalSize-fh.Size {
			writeUploadErr(c, errFileTooLarge)
			return
		}
		totalSize += fh.Size
	}
	uid := middleware.CurrentUserID(c)
	out := make([]FileVO, 0, len(files))
	for _, fh := range files {
		vo, err := h.saveHeader(c, uid, fh)
		if err != nil {
			// Batch is all-or-nothing from the caller's perspective. Remove any
			// assets already persisted before the first failure.
			for _, saved := range out {
				_ = h.svc.delete(c.Request.Context(), uid, saved.ID)
			}
			writeUploadErr(c, err)
			return
		}
		out = append(out, *vo)
	}
	response.OK(c, out)
}

func removeMultipartTempFiles(c *gin.Context) {
	if c.Request.MultipartForm != nil {
		_ = c.Request.MultipartForm.RemoveAll()
	}
}

// saveHeader opens a multipart file header and persists it.
func (h *handler) saveHeader(c *gin.Context, uid idgen.ID, fh *multipart.FileHeader) (*FileVO, error) {
	src, err := fh.Open()
	if err != nil {
		return nil, errEmptyFile
	}
	defer src.Close()
	ct := ""
	if fh.Header != nil {
		ct = fh.Header.Get("Content-Type")
	}
	return h.svc.upload(c.Request.Context(), uid, uploadInput{
		OriginalName: fh.Filename,
		ContentType:  ct,
		FileTypeHint: c.PostForm("fileType"),
		CategoryHint: c.PostForm("category"),
		Size:         fh.Size,
		Reader:       src,
	})
}

// presign POST /api/files/presign -> FilePresignVO
func (h *handler) presign(c *gin.Context) {
	var dto presignDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request body")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.presign(c.Request.Context(), uid, dto)
	if err != nil {
		writeUploadErr(c, err)
		return
	}
	response.OK(c, vo)
}

// register POST /api/files/register -> FileVO
func (h *handler) register(c *gin.Context) {
	var dto registerDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request body")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.register(c.Request.Context(), uid, dto)
	if err != nil {
		writeUploadErr(c, err)
		return
	}
	response.OK(c, vo)
}

// saveFromURL POST /api/files/save-from-url -> FileVO
func (h *handler) saveFromURL(c *gin.Context) {
	var dto saveFromURLDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request body")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.saveFromURL(c.Request.Context(), uid, dto)
	if err != nil {
		switch {
		case errors.Is(err, errBadURL):
			response.Fail(c, response.CodeBadRequest, "invalid url")
		case errors.Is(err, errFetchFailed):
			response.Fail(c, response.CodeBadRequest, "failed to fetch remote file")
		default:
			writeUploadErr(c, err)
		}
		return
	}
	response.OK(c, vo)
}

// list GET /api/files -> PageData<FileVO>
func (h *handler) list(c *gin.Context) {
	var q fileQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query")
		return
	}
	uid := middleware.CurrentUserID(c)
	offset, limit := pagination(q.PageNum, q.PageSize)
	rows, total, err := h.svc.list(c.Request.Context(), uid, q, offset, limit)
	if err != nil {
		if errors.Is(err, errInvalidCategory) {
			response.Fail(c, response.CodeBadRequest, "invalid asset category")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to list files")
		return
	}
	response.Page(c, rows, total, normPage(q.PageNum), limit)
}

// get GET /api/files/:id -> FileVO
func (h *handler) get(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid file id")
		return
	}
	uid := middleware.CurrentUserID(c)
	vo, err := h.svc.get(c.Request.Context(), uid, id)
	if err != nil {
		writeAccessErr(c, err)
		return
	}
	response.OK(c, vo)
}

// remove DELETE /api/files/:id -> void
func (h *handler) remove(c *gin.Context) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid file id")
		return
	}
	uid := middleware.CurrentUserID(c)
	if err := h.svc.delete(c.Request.Context(), uid, id); err != nil {
		writeAccessErr(c, err)
		return
	}
	response.OK[any](c, nil)
}

// writeUploadErr maps upload/storage errors to business codes.
func writeUploadErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errFileTooLarge):
		response.Fail(c, response.CodeFileSizeExceeded, "file size exceeds the limit")
	case errors.Is(err, errFileTypeRejected):
		response.Fail(c, response.CodeFileTypeNotAllowed, "file type is not allowed")
	case errors.Is(err, errInvalidCategory):
		response.Fail(c, response.CodeBadRequest, "invalid asset category")
	case errors.Is(err, errEmptyFile):
		response.Fail(c, response.CodeBadRequest, "empty file")
	case errors.Is(err, errStorageInsufficient):
		response.Fail(c, response.CodeStorageInsufficient, "storage quota is insufficient")
	case errors.Is(err, errUploadGrantInvalid):
		response.Fail(c, response.CodeBadRequest, "direct upload expired or is invalid")
	case errors.Is(err, errUploadMismatch):
		response.Fail(c, response.CodeBadRequest, "uploaded file does not match the upload grant")
	case errors.Is(err, errBadURL):
		response.Fail(c, response.CodeBadRequest, "invalid request")
	default:
		response.Fail(c, response.CodeServerError, "upload failed")
	}
}

// writeAccessErr maps not-found/forbidden lookups to business codes.
func writeAccessErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errFileNotFound):
		response.Fail(c, response.CodeNotFound, "file not found")
	case errors.Is(err, errFileForbidden):
		response.Fail(c, response.CodeForbidden, "not allowed")
	default:
		response.Fail(c, response.CodeServerError, "operation failed")
	}
}

// normPage normalizes a page number for the response echo.
func normPage(pageNum int) int {
	if pageNum <= 0 {
		return 1
	}
	return pageNum
}
