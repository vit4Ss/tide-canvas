package skillformat

import (
	"context"

	"gorm.io/gorm"
	"tidecanvas/internal/model"
)

// ValidateVersion reuses import validation for saved versions. Polling only
// loads reference paths and the primary document, not every private reference.
func ValidateVersion(ctx context.Context, db *gorm.DB, version *model.SkillVersion) (*Metadata, error) {
	if version == nil || version.ID == 0 {
		return nil, Invalid("技能没有可校验的版本")
	}
	var files []File
	if err := db.WithContext(ctx).Model(&model.SkillFile{}).
		Select("path, CASE WHEN path = ? THEN content ELSE '' END AS content", version.PrimaryFilePath).
		Where("skill_version_id = ?", version.ID).Limit(129).Find(&files).Error; err != nil {
		return nil, err
	}
	if len(files) > 128 {
		return nil, Invalid("Skill 文件数量超过本站 128 个文件上限")
	}
	return ValidateFiles(files, version.PrimaryFilePath, "")
}
