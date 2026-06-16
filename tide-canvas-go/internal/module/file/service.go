package file

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
)

const (
	// presignExpireSeconds 直传预签名 URL 有效期（秒）：约束 PUT 发起时刻，足够覆盖 presign 到上传开始的间隔。
	presignExpireSeconds = int64(3600)
	// presignTicketPrefix 直传票据前缀：记录某 key 由哪个用户申请、其内容类型与大类，登记时闭环校验。
	presignTicketPrefix = "presign:"
	// ticketExtraTTLSeconds 票据有效期相对预签名的额外冗余（秒），对齐旧版 +600。
	ticketExtraTTLSeconds = 600
	// defaultContentType 缺省内容类型。
	defaultContentType = "application/octet-stream"
)

// Config 文件模块配置（对齐 StorageProperties，由 router 从 viper 读取后注入）。
type Config struct {
	// MaxSize 单文件大小上限（字节）。<=0 时按旧默认 52428800（50MB）。
	MaxSize int64
	// AllowedTypes 允许的 MIME 类型；为空则不限制（对齐 allowedTypes==null）。
	AllowedTypes []string
}

// Service 文件业务逻辑（对齐 FileServiceImpl）。
type Service struct {
	repo    *Repository
	store   Storage
	users   UserFinder
	teams   TeamProvider
	opLog   OperationLogger
	tickets TicketStore
	cfg     Config
}

// NewService 构造文件服务。
func NewService(repo *Repository, store Storage, users UserFinder, teams TeamProvider, opLog OperationLogger, tickets TicketStore, cfg Config) *Service {
	if cfg.MaxSize <= 0 {
		cfg.MaxSize = 52428800
	}
	return &Service{repo: repo, store: store, users: users, teams: teams, opLog: opLog, tickets: tickets, cfg: cfg}
}

// Upload 单文件上传（对齐 upload）：校验 → 存储 → 计算哈希 → 落库 → 操作日志。
// 失败也落一条操作日志便于后台排查，随后原样返回错误由 handler 收口。
func (s *Service) Upload(userID int64, data []byte, originalName, mimeType string) (*FileVO, error) {
	vo, err := s.doUpload(userID, data, originalName, mimeType)
	if err != nil {
		s.opLog.RecordOperation("file_upload", userID, nil, originalName, false, "", err.Error())
		return nil, err
	}
	s.opLog.RecordOperation("file_upload", userID, nil, originalName, true, vo.FileURL, "")
	return vo, nil
}

func (s *Service) doUpload(userID int64, data []byte, originalName, mimeType string) (*FileVO, error) {
	if err := s.validateFile(data, mimeType); err != nil {
		return nil, err
	}
	size := int64(len(data))
	// 存储额度校验：已占用 + 本次 不得超过用户额度（超限返回 StorageInsufficient）。
	if err := s.assertQuota(userID, size); err != nil {
		return nil, err
	}

	fileType := fileTypeFromMime(mimeType)
	directory := fileType + "/" + time.Now().Format("2006/01/02")
	filePath, err := s.store.Upload(data, originalName, mimeType, directory)
	if err != nil {
		return nil, ecode.ServerError.WithMessage("文件上传失败")
	}
	fileURL := s.store.PublicURL(filePath)

	f := &model.SysFile{
		UserID:       userID,
		OriginalName: originalName,
		StoredName:   storedNameOf(filePath),
		FilePath:     filePath,
		FileURL:      fileURL,
		FileSize:     size,
		FileType:     fileType,
		MimeType:     mimeType,
		Hash:         computeHash(data),
		StorageType:  s.store.Type(),
	}
	if err := s.repo.Create(f); err != nil {
		return nil, err
	}
	return s.toFileVOSingle(f), nil
}

// UploadBatch 批量上传（对齐 uploadBatch）：逐个调用 Upload，任一失败即中断返回。
func (s *Service) UploadBatch(userID int64, files []UploadItem) ([]*FileVO, error) {
	result := make([]*FileVO, 0, len(files))
	for _, it := range files {
		vo, err := s.Upload(userID, it.Data, it.OriginalName, it.MimeType)
		if err != nil {
			return nil, err
		}
		result = append(result, vo)
	}
	return result, nil
}

// UploadItem 批量上传单项（handler 读取 multipart 后传入）。
type UploadItem struct {
	Data         []byte
	OriginalName string
	MimeType     string
}

// SaveFromURL 将已存在的公网 URL 记录为当前用户素材（对齐 saveFromUrl）；同用户同 URL 已存在则直接返回。
func (s *Service) SaveFromURL(userID int64, url, fileType, originalName string) (*FileVO, error) {
	if strings.TrimSpace(url) == "" {
		return nil, ecode.BadRequest.WithMessage("素材地址不能为空")
	}
	exist, err := s.repo.FindByUserAndURL(userID, url)
	if err != nil {
		return nil, err
	}
	if exist != nil {
		return s.toFileVOSingle(exist), nil
	}
	typ := fileType
	if strings.TrimSpace(typ) == "" {
		typ = guessTypeFromURL(url)
	}
	name := originalName
	if strings.TrimSpace(name) == "" {
		name = extractNameFromURL(url)
	}
	mime := "image/png"
	if typ == "video" {
		mime = "video/mp4"
	}
	storageType := "local"
	if strings.HasPrefix(url, "http") {
		storageType = "oss"
	}
	f := &model.SysFile{
		UserID:       userID,
		OriginalName: name,
		StoredName:   name,
		FilePath:     url,
		FileURL:      url,
		FileSize:     0,
		FileType:     typ,
		MimeType:     mime,
		Hash:         "",
		StorageType:  storageType,
	}
	if err := s.repo.Create(f); err != nil {
		return nil, err
	}
	s.opLog.RecordOperation("asset_save", userID, nil, name, true, url, "")
	return s.toFileVOSingle(f), nil
}

// Presign 申请前端直传凭据（对齐 presignDirectUpload）。
// 本地存储不支持直传 → 返回 Direct=false，前端回退中转上传。
func (s *Service) Presign(userID int64, req *PresignReq) (*PresignVO, error) {
	if !s.store.SupportsDirectUpload() {
		return &PresignVO{Direct: false}, nil
	}
	contentType := req.ContentType
	if strings.TrimSpace(contentType) == "" {
		contentType = defaultContentType
	}
	// 类型白名单：不允许的类型直接拒签（与中转上传 validateFile 一致）。
	if err := s.assertTypeAllowed(contentType); err != nil {
		return nil, err
	}
	fileType := req.FileType
	if strings.TrimSpace(fileType) == "" {
		fileType = fileTypeFromMime(contentType)
	}
	directory := fileType + "/" + time.Now().Format("2006/01/02")
	name := req.Filename
	if strings.TrimSpace(name) == "" {
		name = "file"
	}
	ticket, err := s.store.Presign(name, contentType, directory, presignExpireSeconds)
	if err != nil {
		return nil, ecode.ServerError.WithMessage("生成直传凭据失败")
	}
	// 存票据（key → 申请用户 | 内容类型 | 文件大类），供 register 闭环校验；有效期略大于预签名。
	ttl := time.Duration(presignExpireSeconds+ticketExtraTTLSeconds) * time.Second
	s.tickets.Set(presignTicketPrefix+ticket.Key, fmt.Sprintf("%d|%s|%s", userID, contentType, fileType), ttl)

	return &PresignVO{
		Direct:      true,
		UploadURL:   ticket.UploadURL,
		Key:         ticket.Key,
		FileURL:     ticket.FileURL,
		ContentType: contentType,
	}, nil
}

// Register 前端直传完成后登记文件（对齐 registerDirectUpload）。
func (s *Service) Register(userID int64, req *RegisterReq) (*FileVO, error) {
	key := req.Key
	// 闭环校验①：该 key 必须由本用户申请过预签名（防伪造/冒用他人 key）。
	raw, ok := s.tickets.Get(presignTicketPrefix + key)
	if !ok {
		return nil, ecode.BadRequest.WithMessage("上传凭据无效或已过期")
	}
	parts := strings.SplitN(raw, "|", 3)
	if len(parts) < 3 || parts[0] != fmt.Sprintf("%d", userID) {
		return nil, ecode.Forbidden.WithMessage("无权登记该文件")
	}
	// 类型以票据为准（不信任 register 传入的 contentType/fileType，防绕过白名单）。
	contentType := parts[1]
	fileType := parts[2]
	originalName := req.OriginalName
	if strings.TrimSpace(originalName) == "" {
		originalName = keyFileName(key)
	}

	// 校验对象确已上传、取真实大小、设公网可读。
	size, err := s.store.FinalizeDirectUpload(key, contentType)
	if err != nil {
		s.opLog.RecordOperation("file_upload", userID, nil, originalName, false, "", "直传对象校验失败:"+err.Error())
		return nil, ecode.BadRequest.WithMessage("文件未完成上传或不存在")
	}
	// 闭环校验②：用 OSS 上报的真实大小卡上限；超限则删对象 + 作废票据。
	if size > s.cfg.MaxSize {
		s.store.Delete(key)
		s.tickets.Delete(presignTicketPrefix + key)
		s.opLog.RecordOperation("file_upload", userID, nil, originalName, false, "", "文件超出大小限制")
		return nil, ecode.FileSizeExceeded
	}
	// 闭环校验③：类型白名单兜底。
	if err := s.assertTypeAllowed(contentType); err != nil {
		return nil, err
	}
	// 存储额度校验（直传同样受额度约束）：超限则删对象 + 作废票据。
	if err := s.assertQuota(userID, size); err != nil {
		s.store.Delete(key)
		s.tickets.Delete(presignTicketPrefix + key)
		s.opLog.RecordOperation("file_upload", userID, nil, originalName, false, "", "存储空间不足")
		return nil, err
	}

	fileURL := s.store.PublicURL(key)
	f := &model.SysFile{
		UserID:       userID,
		OriginalName: originalName,
		StoredName:   keyFileName(key),
		FilePath:     key,
		FileURL:      fileURL,
		FileSize:     size,
		FileType:     fileType,
		MimeType:     contentType,
		Hash:         "",
		StorageType:  s.store.Type(),
	}
	if err := s.repo.Create(f); err != nil {
		return nil, err
	}
	// 一次性票据：登记后作废，防重复登记。
	s.tickets.Delete(presignTicketPrefix + key)
	s.opLog.RecordOperation("file_upload", userID, nil, originalName, true, fileURL, "")
	return s.toFileVOSingle(f), nil
}

// ListFiles 文件列表（对齐 listFiles）：团队共享素材库分页。
func (s *Service) ListFiles(userID int64, q *ListQuery) ([]*FileVO, int64, error) {
	q.normalize()
	ownerIDs, err := s.teams.GetTeamMemberIDs(userID)
	if err != nil {
		return nil, 0, err
	}
	records, total, err := s.repo.Page(ownerIDs, q.FileType, q.Keyword, q.PageNum, q.PageSize)
	if err != nil {
		return nil, 0, err
	}
	ownerMap, err := s.ownerPublicIDs(records)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]*FileVO, 0, len(records))
	for i := range records {
		vos = append(vos, s.toFileVO(&records[i], ownerMap))
	}
	return vos, total, nil
}

// ownerPublicIDs 批量解析记录归属用户的 public_id（去重后一次查询）。
func (s *Service) ownerPublicIDs(records []model.SysFile) (map[int64]string, error) {
	if len(records) == 0 {
		return map[int64]string{}, nil
	}
	idSet := make(map[int64]struct{}, len(records))
	ids := make([]int64, 0, len(records))
	for i := range records {
		uid := records[i].UserID
		if _, ok := idSet[uid]; !ok {
			idSet[uid] = struct{}{}
			ids = append(ids, uid)
		}
	}
	return s.users.PublicIDsByIDs(ids)
}

// GetFile 文件详情（对齐 getFile）：本人或同团队成员可访问。
func (s *Service) GetFile(userID int64, publicID string) (*FileVO, error) {
	f, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, ecode.NotFound.WithMessage("文件不存在")
	}
	memberIDs, err := s.teams.GetTeamMemberIDs(userID)
	if err != nil {
		return nil, err
	}
	if f.UserID == 0 || !contains(memberIDs, f.UserID) {
		return nil, ecode.Forbidden.WithMessage("无权访问该文件")
	}
	return s.toFileVOSingle(f), nil
}

// DeleteFile 删除文件（对齐 deleteFile）：仅所有者或团队管理员可删；成员只能用/看队友素材。
func (s *Service) DeleteFile(userID int64, publicID string) error {
	f, err := s.repo.FindByPublicID(publicID)
	if err != nil {
		return err
	}
	if f == nil {
		return ecode.NotFound.WithMessage("文件不存在")
	}
	if f.UserID != userID {
		isAdmin, err := s.teams.IsTeamAdminOf(userID, f.UserID)
		if err != nil {
			return err
		}
		if !isAdmin {
			return ecode.Forbidden.WithMessage("无权删除该文件")
		}
	}
	s.store.Delete(f.FilePath)
	if err := s.repo.DeleteByID(f.ID); err != nil {
		return err
	}
	s.opLog.RecordOperation("file_delete", userID, nil, f.OriginalName, true, f.FileURL, "")
	return nil
}

// ---- 内部校验/装配 ----

// validateFile 中转上传校验（对齐 validateFile）：非空 + 大小上限 + 类型白名单。
func (s *Service) validateFile(data []byte, contentType string) error {
	if len(data) == 0 {
		return ecode.BadRequest.WithMessage("文件不能为空")
	}
	if int64(len(data)) > s.cfg.MaxSize {
		return ecode.FileSizeExceeded
	}
	return s.assertTypeAllowed(contentType)
}

// assertTypeAllowed 内容类型白名单校验（AllowedTypes 未配置则不限制，对齐 allowedTypes==null）。
func (s *Service) assertTypeAllowed(contentType string) error {
	if len(s.cfg.AllowedTypes) == 0 {
		return nil
	}
	for _, t := range s.cfg.AllowedTypes {
		if t == contentType {
			return nil
		}
	}
	return ecode.FileTypeNotAllowed
}

// assertQuota 存储额度校验：用户已占用 + 本次新增 不得超过 storage_quota（额度<=0 或用户缺失视为不限制）。
//
// 注：旧 FileServiceImpl 仅做单文件 max-size 校验、未做累计额度校验；此处按本次迁移要求新增配额闭环
// （sys_user.storage_quota），超限返回 ecode.StorageInsufficient。
func (s *Service) assertQuota(userID, addSize int64) error {
	quota, ok, err := s.users.StorageQuotaOf(userID)
	if err != nil {
		return err
	}
	if !ok || quota <= 0 {
		return nil
	}
	used, err := s.repo.SumSizeByUserIDs([]int64{userID})
	if err != nil {
		return err
	}
	if used+addSize > quota {
		return ecode.StorageInsufficient
	}
	return nil
}

// toFileVOSingle 单条 实体 → 视图：单独解析归属用户 public_id（upload/register/get 等单记录路径用）。
func (s *Service) toFileVOSingle(f *model.SysFile) *FileVO {
	ownerMap, _ := s.users.PublicIDsByIDs([]int64{f.UserID})
	return s.toFileVO(f, ownerMap)
}

// toFileVO 实体 → 视图。ownerId 解析为归属用户的 public_id（对外不暴露雪花ID）；映射缺失则留空。
func (s *Service) toFileVO(f *model.SysFile, ownerMap map[int64]string) *FileVO {
	return &FileVO{
		ID:           f.PublicID,
		OwnerID:      ownerMap[f.UserID],
		OriginalName: f.OriginalName,
		FileURL:      f.FileURL,
		FileSize:     f.FileSize,
		FileType:     f.FileType,
		MimeType:     f.MimeType,
		StorageType:  f.StorageType,
		CreateTime:   f.CreateTime,
	}
}

// ---- 无副作用辅助 ----

// fileTypeFromMime 由 MIME 推断文件大类（对齐 FileTypeEnum.fromMimeType）。
func fileTypeFromMime(mime string) string {
	if mime == "" {
		return "other"
	}
	if strings.HasPrefix(mime, "image/") {
		return "image"
	}
	if strings.HasPrefix(mime, "video/") {
		return "video"
	}
	return "other"
}

// guessTypeFromURL 由 URL 后缀粗判 image / video（对齐 guessTypeFromUrl）。
func guessTypeFromURL(url string) string {
	low := strings.ToLower(url)
	if strings.HasSuffix(low, ".mp4") || strings.HasSuffix(low, ".webm") || strings.HasSuffix(low, ".mov") {
		return "video"
	}
	return "image"
}

// extractNameFromURL 取 URL 路径末段为素材名（对齐 extractNameFromUrl）。
func extractNameFromURL(url string) string {
	path := strings.SplitN(url, "?", 2)[0]
	slash := strings.LastIndex(path, "/")
	name := path
	if slash >= 0 {
		name = path[slash+1:]
	}
	if strings.TrimSpace(name) == "" {
		return "素材"
	}
	return name
}

// keyFileName 从对象键取末段作为存储文件名（对齐 keyFileName）。
func keyFileName(key string) string {
	if key == "" {
		return "file"
	}
	if slash := strings.LastIndex(key, "/"); slash >= 0 {
		return key[slash+1:]
	}
	return key
}

// storedNameOf 由存储相对路径取末段为存储文件名。
func storedNameOf(filePath string) string { return keyFileName(filePath) }

// computeHash 取内容 SHA-256 前 16 位十六进制（对齐 DigestUtil.sha256Hex(...).substring(0,16)）。
func computeHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:16]
}

// contains 切片包含判断。
func contains(ids []int64, target int64) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}
