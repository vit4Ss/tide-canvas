package ai

import (
	"context"
	"encoding/json"
	"strings"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// This is an output-only snapshot, never the provider response or a workflow
// manifest. It also preserves text/multiple media when a task is removed.
type historyResultSnapshot struct {
	Assets []UserHistoryAssetVO `json:"assets"`
	Text   string               `json:"text"`
}

func publicGenerationSnapshot(task *model.AiTask, result GenerateResult, handler, operation string) string {
	copy := *task
	copy.ResultUrl, copy.ResultMeta = result.ResultURL, buildResultMeta(result)
	assets, text := publicTaskResults(&copy, userHistoryMediaType(handler, operation))
	raw, _ := json.Marshal(historyResultSnapshot{Assets: assets, Text: text})
	return string(raw)
}

func historyStage(origin, role string) string {
	if origin != "skill_run" {
		return ""
	}
	if role == "final" {
		return "final"
	}
	return "intermediate"
}

// Both the result list and details use this same account-scoped enrichment.
// Soft-deleted tasks still back immutable billing/history; private execution
// prompts in old tasks are replaced with the owner's original Skill input.
func (s *service) historyContext(ctx context.Context, uid idgen.ID, logs []model.AiGenerationLog, details bool) (map[idgen.ID]model.AiTask, map[idgen.ID]int64, error) {
	tasks := map[idgen.ID]model.AiTask{}
	refunds := map[idgen.ID]int64{}
	ids := make([]idgen.ID, 0, len(logs))
	safeInputs := map[idgen.ID]string{}
	for _, log := range logs {
		if log.InputSanitized {
			safeInputs[log.TaskID] = log.InputParams
		}
		if log.TaskID != 0 {
			ids = append(ids, log.TaskID)
		}
	}
	if len(ids) == 0 {
		for i := range logs {
			if logs[i].Origin == "skill_run" && !logs[i].InputSanitized {
				logs[i].InputParams = `{}`
			}
		}
		return tasks, refunds, nil
	}
	var rows []model.AiTask
	query := s.repo.db.WithContext(ctx).Unscoped().Where("user_id = ? AND id IN ?", uid, ids)
	if !details {
		query = query.Select("id", "user_id", "origin", "skill_run_id", "output_role", "status", "point_cost", "is_api_call")
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	runIDs := []idgen.ID{}
	for _, task := range rows {
		if _, safe := safeInputs[task.ID]; task.SkillRunID != 0 && !safe {
			runIDs = append(runIDs, task.SkillRunID)
		}
	}
	inputs := map[idgen.ID]string{}
	if len(runIDs) > 0 {
		var runs []model.SkillRun
		if err := s.repo.db.WithContext(ctx).Unscoped().Select("id", "input_json").Where("user_id = ? AND id IN ?", uid, runIDs).Find(&runs).Error; err != nil {
			return nil, nil, err
		}
		for _, run := range runs {
			inputs[run.ID] = publicSkillHistoryInput(run.Input)
		}
	}
	for _, task := range rows {
		if input, ok := safeInputs[task.ID]; ok {
			task.Input = input
		} else if task.Origin == "skill_run" || task.SkillRunID != 0 {
			task.Input = inputs[task.SkillRunID]
			if task.Input == "" {
				task.Input = `{}`
			}
		}
		tasks[task.ID] = task
	}
	for i := range logs {
		if task, ok := tasks[logs[i].TaskID]; ok {
			logs[i].Origin, logs[i].OutputRole = task.Origin, task.OutputRole
			if details || task.Origin == "skill_run" || task.SkillRunID != 0 || logs[i].InputSanitized {
				logs[i].InputParams = task.Input
			}
		} else if logs[i].Origin == "skill_run" && !logs[i].InputSanitized {
			logs[i].InputParams = `{}`
		}
	}
	// A task's refunded boolean historically also meant "settled". Only a
	// positive refund ledger entry proves money was actually returned.
	var returned []struct {
		RefID  idgen.ID
		Amount int64
	}
	if err := s.repo.db.WithContext(ctx).Unscoped().Model(&model.PointRecord{}).
		Select("ref_id, SUM(amount) AS amount").Where("user_id = ? AND ref_id IN ? AND change_type = ? AND amount > 0", uid, ids, "refund").Group("ref_id").Scan(&returned).Error; err != nil {
		return nil, nil, err
	}
	for _, row := range returned {
		refunds[row.RefID] = row.Amount
	}
	return tasks, refunds, nil
}

// RunInput has a deliberately public prompt and assets; parameters may include
// private execution controls, so forward only known product options.
func publicSkillHistoryInput(raw string) string {
	var in struct {
		Prompt string `json:"prompt"`
		Assets []struct {
			Type string `json:"type"`
			URL  string `json:"url"`
			Name string `json:"name"`
		} `json:"assets"`
		Parameters map[string]any `json:"parameters"`
	}
	if json.Unmarshal([]byte(raw), &in) != nil {
		return `{}`
	}
	out := map[string]any{"prompt": in.Prompt}
	for _, key := range []string{"ratio", "resolution", "quality", "duration", "size", "batchCount", "count"} {
		if value, ok := in.Parameters[key]; ok {
			out[key] = value
		}
	}
	for _, asset := range in.Assets {
		key := map[string]string{"image": "imageUrls", "video": "videoUrls", "audio": "audioUrls", "file": "files"}[asset.Type]
		if key == "" || !isPublicHistoryURL(strings.TrimSpace(asset.URL)) {
			continue
		}
		values, _ := out[key].([]string)
		out[key] = append(values, asset.URL)
	}
	b, _ := json.Marshal(out)
	return string(b)
}
