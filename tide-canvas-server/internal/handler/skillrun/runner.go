package skillrun

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"time"

	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/handler/ai"
	filehandler "tidecanvas/internal/handler/file"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/boundedtext"
	"tidecanvas/internal/pkg/chatattach"
	"tidecanvas/internal/pkg/chatcontext"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/storage"
)

var errRunPaused = errors.New("skill run paused")
var errRunSuperseded = errors.New("skill run revision superseded")

type runUserError struct{ message string }

func (e runUserError) Error() string { return e.message }

type agentManifest struct {
	PreferredNodeType string      `json:"preferredNodeType"`
	Steps             []agentStep `json:"steps"`
}

type agentStep struct {
	Key               string          `json:"key"`
	Title             string          `json:"title"`
	Type              string          `json:"type"`
	Handler           string          `json:"handler"`
	ModelID           string          `json:"modelId"`
	Prompt            string          `json:"prompt"`
	SystemPrompt      string          `json:"systemPrompt"`
	OutputType        string          `json:"outputType"`
	OutputRole        string          `json:"outputRole"`
	RegisterWork      *bool           `json:"registerWork"`
	StrictJSON        bool            `json:"strictJson"`
	PreferredNodeType string          `json:"preferredNodeType"`
	Message           string          `json:"message"`
	Schema            json.RawMessage `json:"schema"`
	PromotePrevious   bool            `json:"promotePrevious"`
}

type stepResult struct {
	Step      *model.SkillRunStep
	Artifacts []model.SkillRunArtifact
	Text      string
}

func agentManifestHasSteps(raw string) bool {
	var manifest agentManifest
	return json.Unmarshal([]byte(raw), &manifest) == nil && len(manifest.Steps) > 0
}

func (s *service) enqueue(runID idgen.ID) {
	if _, loaded := s.running.LoadOrStore(runID, struct{}{}); loaded {
		return
	}
	go func() {
		for {
			s.execute(runID)
			s.running.Delete(runID)
			var run model.SkillRun
			if s.db.Select("status").First(&run, "id = ?", runID).Error != nil || run.Status != model.SkillRunQueued {
				return
			}
			if _, loaded := s.running.LoadOrStore(runID, struct{}{}); loaded {
				return
			}
		}
	}()
}

func (s *service) recoveryLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	lastAssetSweep := time.Time{}
	for now := range ticker.C {
		if s.deps != nil && (lastAssetSweep.IsZero() || now.Sub(lastAssetSweep) >= time.Minute) {
			var pendingAssets []model.SkillRun
			if s.db.Select("id").Where("status = ? AND entry_point = ? AND EXISTS (SELECT 1 FROM skill_run_artifact a WHERE a.run_id = skill_run.id AND a.deleted IS NULL AND a.is_final = ? AND a.file_id = 0 AND (a.url <> '' OR (a.type = 'file' AND a.text_content <> '')))",
				model.SkillRunSucceeded, "asset", true).Limit(100).Find(&pendingAssets).Error == nil {
				for i := range pendingAssets {
					if err := s.materializeFinalArtifacts(pendingAssets[i].ID); err != nil {
						logger.L().Warn("skill run artifact recovery failed", zap.String("runId", pendingAssets[i].ID.String()), zap.Error(err))
					}
				}
			}
			lastAssetSweep = now
		}
		var rows []model.SkillRun
		if err := s.db.Select("id").Where("status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?))",
			model.SkillRunQueued, model.SkillRunRunning, now).Limit(200).Find(&rows).Error; err != nil {
			continue
		}
		for i := range rows {
			s.enqueue(rows[i].ID)
		}
	}
}

func (s *service) execute(runID idgen.ID) {
	ctx := context.Background()
	now := time.Now()
	lease := now.Add(45 * time.Second)
	claim := s.db.Model(&model.SkillRun{}).
		Where("id = ? AND (status = ? OR (status = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)))", runID, model.SkillRunQueued, model.SkillRunRunning, now).
		Updates(map[string]any{"status": model.SkillRunRunning, "pending_action": "", "worker_id": s.workerID, "lease_expires_at": lease,
			"started_at": gorm.Expr("COALESCE(started_at, ?)", now), "revision": gorm.Expr("revision + 1"),
			"state_revision": gorm.Expr("state_revision + 1")})
	if claim.Error != nil || claim.RowsAffected != 1 {
		return
	}
	var run model.SkillRun
	if err := s.db.First(&run, "id = ?", runID).Error; err != nil {
		return
	}
	var version model.SkillVersion
	if err := s.db.Where("id = ? AND skill_id = ?", run.SkillVersionID, run.SkillID).First(&version).Error; err != nil {
		s.failRun(run.ID, run.Revision, "skill version is unavailable")
		return
	}
	var input RunInput
	if json.Unmarshal([]byte(run.Input), &input) != nil {
		s.failRun(run.ID, run.Revision, "invalid run input")
		return
	}
	var err error
	switch version.Kind {
	case model.SkillKindPreset:
		err = s.runPreset(ctx, &run, &version, input)
	case model.SkillKindAgent:
		if agentManifestHasSteps(version.ManifestJSON) {
			err = s.runAgentSteps(ctx, &run, &version, input)
		} else {
			err = s.runAgent(ctx, &run, &version, input)
		}
	case model.SkillKindTool:
		if !agentManifestHasSteps(version.ManifestJSON) {
			err = errors.New("tool manifest has no executable steps")
		} else {
			err = s.runAgentSteps(ctx, &run, &version, input)
		}
	default:
		err = errors.New("unsupported skill kind")
	}
	if errors.Is(err, errRunPaused) || errors.Is(err, errRunSuperseded) {
		return
	}
	if err != nil {
		var current model.SkillRun
		if s.db.Select("status").First(&current, "id = ?", run.ID).Error == nil && current.Status == model.SkillRunCancelled {
			return
		}
		logger.L().Error("skill run execution failed", zap.String("runId", run.ID.String()), zap.Error(err))
		s.failRun(run.ID, run.Revision, publicRunError(err))
		return
	}
	s.finishRun(run.ID, run.Revision)
}

func (s *service) runPreset(ctx context.Context, run *model.SkillRun, version *model.SkillVersion, input RunInput) error {
	outputType := normalizedOutput(version.PrimaryOutputType)
	preferred := manifestPreferredNode(version.ManifestJSON)
	handler := handlerFor(outputType, input.Assets)
	modelID, err := s.resolveModel(version.ModelID, requestedModel(input.Parameters), outputType)
	if err != nil {
		return err
	}
	commandInput := buildGenerationInput(version.DefaultParams, input, input.Prompt)
	pinnedPrompt, err := s.expandSkillTemplate(version, version.PromptTemplate)
	if err != nil {
		return err
	}
	_, err = s.executeGenerationStep(ctx, run, version, agentStep{
		Key: "generate", Title: "Generate", Type: "generate", Handler: handler,
		ModelID: modelID, OutputType: outputType, OutputRole: "final", PreferredNodeType: preferred,
	}, 0, 1, commandInput, pinnedPrompt, true)
	return err
}

func (s *service) runAgent(ctx context.Context, run *model.SkillRun, version *model.SkillVersion, input RunInput) error {
	input = withAgentConversationContext(input)
	outputType := normalizedOutput(version.PrimaryOutputType)
	systemPrompt, err := s.expandSkillTemplate(version, s.primarySkillText(version))
	if err != nil {
		return err
	}
	if outputType == "text" || outputType == "file" {
		modelID, err := s.resolveTextModelForAssets(version.ModelID, requestedModel(input.Parameters), input.Assets)
		if err != nil {
			return err
		}
		commandInput := buildGenerationInput(version.DefaultParams, input, input.Prompt)
		commandInput["systemPrompt"] = systemPrompt
		_, err = s.executeGenerationStep(ctx, run, version, agentStep{
			Key: "respond", Title: "Respond", Type: "text", Handler: "skill_text_completion",
			ModelID: modelID, OutputType: outputType, OutputRole: "final",
		}, 0, 1, commandInput, "", true)
		return err
	}

	textModel, err := s.resolveTextModelForAssets("", requestedTextModel(input.Parameters), input.Assets)
	if err != nil {
		return err
	}
	planPrompt := "Turn the following user request into a concise generation prompt. Return JSON only: {\"prompt\":\"...\"}.\n\n<user_request>\n" + strings.TrimSpace(input.Prompt) + "\n</user_request>"
	planInput := buildGenerationInput("{}", input, planPrompt)
	planInput["systemPrompt"] = systemPrompt
	planInput["strictJson"] = true
	plan, err := s.executeGenerationStep(ctx, run, version, agentStep{
		Key: "plan", Title: "Plan", Type: "text", Handler: "skill_text_completion", ModelID: textModel,
		OutputType: "text", OutputRole: "intermediate", StrictJSON: true,
	}, 0, 2, planInput, "", false)
	if err != nil {
		return err
	}
	prompt := promptFromJSON(plan.Text)
	if prompt == "" {
		prompt = input.Prompt
	}
	mediaModel, err := s.resolveModel(version.ModelID, requestedModel(input.Parameters), outputType)
	if err != nil {
		return err
	}
	commandInput := buildGenerationInput(version.DefaultParams, input, prompt)
	_, err = s.executeGenerationStep(ctx, run, version, agentStep{
		Key: "generate", Title: "Generate", Type: "generate", Handler: handlerFor(outputType, input.Assets),
		ModelID: mediaModel, OutputType: outputType, OutputRole: "final",
		PreferredNodeType: manifestPreferredNode(version.ManifestJSON),
	}, 1, 2, commandInput, "", true)
	return err
}

func (s *service) runAgentSteps(ctx context.Context, run *model.SkillRun, version *model.SkillVersion, input RunInput) error {
	input = withAgentConversationContext(input)
	var manifest agentManifest
	if err := json.Unmarshal([]byte(version.ManifestJSON), &manifest); err != nil || len(manifest.Steps) == 0 {
		return errors.New("agent manifest has no executable steps")
	}
	previous := ""
	for index := range manifest.Steps {
		step := manifest.Steps[index]
		if strings.TrimSpace(step.Key) == "" {
			step.Key = fmt.Sprintf("step_%d", index+1)
		}
		if strings.TrimSpace(step.Title) == "" {
			step.Title = step.Key
		}
		if step.PreferredNodeType == "" {
			step.PreferredNodeType = manifest.PreferredNodeType
		}
		if step.Type == "approval" {
			paused, err := s.waitForApproval(run, step, index, len(manifest.Steps))
			if err != nil {
				return err
			}
			if paused {
				return errRunPaused
			}
			if step.PromotePrevious {
				if err := s.promoteApprovedStep(ctx, run, index); err != nil {
					return err
				}
			}
			continue
		}
		if step.Type == "input" {
			paused, err := s.waitForInput(run, step, index, len(manifest.Steps))
			if err != nil {
				return err
			}
			if paused {
				return errRunPaused
			}
			continue
		}
		outputType := normalizedOutput(step.OutputType)
		if step.Type == "text" && strings.TrimSpace(step.OutputType) == "" {
			outputType = "text"
		}
		expandedPrompt, err := s.expandSkillTemplate(version, step.Prompt)
		if err != nil {
			return err
		}
		prompt, err := renderStepPrompt(expandedPrompt, input, previous, run.Context)
		if err != nil {
			return err
		}
		if strings.TrimSpace(prompt) == "" {
			prompt = input.Prompt
		}
		if step.Type == "tool" {
			step.Handler = strings.TrimSpace(step.Handler)
			if step.OutputRole == "" {
				if index == len(manifest.Steps)-1 {
					step.OutputRole = "final"
				} else {
					step.OutputRole = "intermediate"
				}
			}
			registerWork := step.OutputRole == "final"
			if step.RegisterWork != nil {
				registerWork = *step.RegisterWork
			}
			result, err := s.executeToolStep(ctx, run, version, step, index, len(manifest.Steps), input, prompt, previous, registerWork)
			if err != nil {
				return err
			}
			if result.Text != "" {
				previous = result.Text
			} else if len(result.Artifacts) > 0 {
				previous = result.Artifacts[len(result.Artifacts)-1].URL
			}
			continue
		}
		expectedModelType := outputType
		if step.Type == "text" {
			expectedModelType = "text"
		}
		configuredModel := strings.TrimSpace(step.ModelID)
		versionModelType := normalizedOutput(version.PrimaryOutputType)
		if versionModelType == "file" {
			versionModelType = "text"
		}
		// A step-level model is the most specific setting. The version-level
		// model is the default only for steps of the primary output modality, so
		// an image model is never accidentally applied to a text planning step.
		if configuredModel == "" && expectedModelType == versionModelType {
			configuredModel = version.ModelID
		}
		requested := requestedAgentStepModel(input.Parameters, step.Type, versionModelType)
		var modelID string
		if step.Type == "text" {
			modelID, err = s.resolveTextModelForAssets(configuredModel, requested, input.Assets)
		} else {
			modelID, err = s.resolveModel(configuredModel, requested, expectedModelType)
		}
		if err != nil {
			return err
		}
		handler := strings.TrimSpace(step.Handler)
		if handler == "" {
			if step.Type == "text" {
				handler = "skill_text_completion"
			} else {
				handler = handlerFor(outputType, input.Assets)
			}
		}
		step.Handler = handler
		step.ModelID = modelID
		if step.OutputRole == "" {
			if index == len(manifest.Steps)-1 {
				step.OutputRole = "final"
			} else {
				step.OutputRole = "intermediate"
			}
		}
		willPromote := index+1 < len(manifest.Steps) && manifest.Steps[index+1].Type == "approval" && manifest.Steps[index+1].PromotePrevious
		registerWork := step.OutputRole == "final" || willPromote
		if step.RegisterWork != nil {
			registerWork = *step.RegisterWork
		}
		// A result awaiting an immediately following approval is always a draft.
		// The confirmation resume path promotes both its artifact and work record.
		if willPromote {
			step.OutputRole = "intermediate"
		}
		commandInput := buildGenerationInput(version.DefaultParams, input, prompt)
		if step.Type == "text" {
			s.addSkillTextAttachments(ctx, commandInput, input.Assets)
			systemPrompt, err := s.expandSkillTemplate(version, agentStepSystemPrompt(step.SystemPrompt, s.primarySkillText(version)))
			if err != nil {
				return err
			}
			renderedSystemPrompt, err := renderStepPrompt(systemPrompt, input, previous, run.Context)
			if err != nil {
				return err
			}
			commandInput["systemPrompt"] = renderedSystemPrompt
			commandInput["strictJson"] = step.StrictJSON
		}
		result, err := s.executeGenerationStep(ctx, run, version, step, index, len(manifest.Steps), commandInput, "", registerWork)
		if err != nil {
			return err
		}
		if result.Text != "" {
			previous = result.Text
		} else if len(result.Artifacts) > 0 {
			previous = result.Artifacts[len(result.Artifacts)-1].URL
		}
	}
	return nil
}

func (s *service) executeGenerationStep(ctx context.Context, run *model.SkillRun, version *model.SkillVersion, spec agentStep, sequence, total int, input map[string]any, pinnedPrompt string, registerWork bool) (*stepResult, error) {
	step, alreadyDone, err := s.ensureStep(run, spec.Key, sequence, spec.Type, input, registerWork)
	if err != nil {
		return nil, err
	}
	if alreadyDone {
		return s.completedStepResult(step)
	}
	if step.AiTaskID == 0 {
		taskID, err := s.ai.Submit(ctx, run.UserID, ai.GenerationCommand{
			ProjectID: run.ProjectID, Handler: spec.Handler, ModelID: spec.ModelID, Input: input,
			Origin: "skill_run", SkillRunID: run.ID, SkillRunStepID: step.ID,
			SkillRunRevision: run.Revision, SkillRunWorkerID: s.workerID,
			OutputRole: spec.OutputRole, RegisterWork: false, PinnedSkillPrompt: pinnedPrompt,
		})
		if err != nil {
			s.failStep(run, step.ID, err.Error())
			return nil, err
		}
		var claimed model.SkillRun
		if err := s.db.Select("status", "revision", "worker_id").First(&claimed, "id = ?", run.ID).Error; err != nil ||
			claimed.Status != model.SkillRunRunning || claimed.Revision != run.Revision || claimed.WorkerID != s.workerID {
			// The task is attached to the durable step, not to this process. A new
			// lease owner may already be polling/reusing it, so a superseded worker
			// must leave both task and step untouched.
			return nil, errRunSuperseded
		}
		step.AiTaskID = taskID
	}
	progressUpdate := s.db.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", run.ID, run.Revision, s.workerID, model.SkillRunRunning).Updates(map[string]any{
		"current_step": spec.Key, "progress": stepBaseProgress(sequence, total), "state_revision": gorm.Expr("state_revision + 1"),
	})
	if progressUpdate.Error != nil {
		return nil, progressUpdate.Error
	}
	if progressUpdate.RowsAffected != 1 {
		return nil, errRunSuperseded
	}

	ticker := time.NewTicker(650 * time.Millisecond)
	defer ticker.Stop()
	for {
		var current model.SkillRun
		if err := s.db.Select("status", "revision", "worker_id").First(&current, "id = ?", run.ID).Error; err != nil {
			return nil, err
		}
		if current.Revision != run.Revision || current.WorkerID != s.workerID || current.Status != model.SkillRunRunning {
			return nil, errRunSuperseded
		}
		_ = s.db.Model(&model.SkillRun{}).Where("id = ? AND worker_id = ?", run.ID, s.workerID).
			Updates(map[string]any{"lease_expires_at": time.Now().Add(45 * time.Second)}).Error
		snapshot, err := s.ai.Get(ctx, run.UserID, step.AiTaskID)
		if err != nil {
			s.failStep(run, step.ID, "generation task is unavailable")
			return nil, errors.New("generation task is unavailable")
		}
		switch snapshot.Status {
		case ai.TaskSuccess:
			artifacts, text, err := s.persistArtifacts(run, step, snapshot, spec, version, sequence, total)
			if err != nil {
				s.failStep(run, step.ID, err.Error())
				return nil, err
			}
			output, _ := json.Marshal(map[string]any{"text": text, "artifactCount": len(artifacts)})
			step.Status = model.SkillStepSucceeded
			step.Output = string(output)
			return &stepResult{Step: step, Artifacts: artifacts, Text: text}, nil
		case ai.TaskFailed:
			s.failStep(run, step.ID, snapshot.ErrorMessage)
			return nil, runUserError{message: nonEmpty(snapshot.ErrorMessage, "generation failed")}
		case ai.TaskCancelled:
			s.failStep(run, step.ID, "generation cancelled")
			return nil, errors.New("generation cancelled")
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *service) ensureStep(run *model.SkillRun, key string, sequence int, stepType string, input map[string]any, registerWork bool) (*model.SkillRunStep, bool, error) {
	var result model.SkillRunStep
	done := false
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var claimed model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "status", "revision", "worker_id").First(&claimed, "id = ?", run.ID).Error; err != nil {
			return err
		}
		if claimed.Status != model.SkillRunRunning || claimed.Revision != run.Revision || claimed.WorkerID != s.workerID {
			return errRunSuperseded
		}
		var latest model.SkillRunStep
		lookupErr := tx.Where("run_id = ? AND step_key = ?", run.ID, key).Order("attempt DESC").First(&latest).Error
		if lookupErr == nil {
			if latest.RegisterWork != registerWork && latest.Status != model.SkillStepSucceeded {
				if err := tx.Model(&model.SkillRunStep{}).Where("id = ?", latest.ID).Update("register_work", registerWork).Error; err != nil {
					return err
				}
				latest.RegisterWork = registerWork
			}
			switch latest.Status {
			case model.SkillStepSucceeded:
				result, done = latest, true
				return nil
			case model.SkillStepRunning, model.SkillStepWaiting:
				result = latest
				return nil
			}
		} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return lookupErr
		}
		attempt := 1
		if lookupErr == nil {
			attempt = latest.Attempt + 1
		}
		raw, _ := json.Marshal(input)
		now := time.Now()
		step := model.SkillRunStep{RunID: run.ID, StepKey: key, Sequence: sequence, Attempt: attempt,
			Type: nonEmpty(stepType, "generate"), Status: model.SkillStepRunning, RegisterWork: registerWork, Input: string(raw), StartedAt: &now}
		if err := tx.Create(&step).Error; err != nil {
			// Some engines ignore row locking. Treat a unique-race winner as the
			// authoritative attempt instead of failing the active run.
			if reloadErr := tx.Where("run_id = ? AND step_key = ?", run.ID, key).Order("attempt DESC").First(&result).Error; reloadErr == nil {
				done = result.Status == model.SkillStepSucceeded
				return nil
			}
			return err
		}
		// A newly visible step is part of the run snapshot returned to clients.
		// Bump the public state revision in the same transaction so action callers
		// cannot act on a response that did not include this step yet.
		stateUpdate := tx.Model(&model.SkillRun{}).
			Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", run.ID, run.Revision, s.workerID, model.SkillRunRunning).
			Update("state_revision", gorm.Expr("state_revision + 1"))
		if stateUpdate.Error != nil {
			return stateUpdate.Error
		}
		if stateUpdate.RowsAffected != 1 {
			return errRunSuperseded
		}
		result = step
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &result, done, nil
}

func (s *service) completedStepResult(step *model.SkillRunStep) (*stepResult, error) {
	var artifacts []model.SkillRunArtifact
	if err := s.db.Where("step_id = ?", step.ID).Order("sort_order ASC").Find(&artifacts).Error; err != nil {
		return nil, err
	}
	text := ""
	for i := range artifacts {
		if strings.TrimSpace(artifacts[i].Text) != "" {
			text = artifacts[i].Text
		}
	}
	return &stepResult{Step: step, Artifacts: artifacts, Text: text}, nil
}

func (s *service) waitForApproval(run *model.SkillRun, spec agentStep, sequence, total int) (bool, error) {
	step, done, err := s.ensureStep(run, spec.Key, sequence, "approval", map[string]any{}, false)
	if err != nil || done {
		return false, err
	}
	pending := map[string]any{"type": "confirmation", "title": spec.Title, "message": spec.Message}
	if len(spec.Schema) > 0 && json.Valid(spec.Schema) {
		pending["schema"] = json.RawMessage(spec.Schema)
	}
	raw, _ := json.Marshal(pending)
	if err := s.transitionToWaiting(run, step, model.SkillRunWaitingConfirmation, spec.Key, stepBaseProgress(sequence, total), string(raw)); err != nil {
		return false, err
	}
	return true, nil
}

func (s *service) promoteApprovedStep(_ context.Context, run *model.SkillRun, approvalSequence int) error {
	var previous model.SkillRunStep
	if err := s.db.Where("run_id = ? AND sequence_no < ? AND type IN ? AND status = ?", run.ID, approvalSequence,
		[]string{"text", "generate"}, model.SkillStepSucceeded).
		Order("sequence_no DESC, attempt DESC").First(&previous).Error; err != nil {
		return errors.New("approval has no completed draft to promote")
	}
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		var current model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "status", "revision", "worker_id").First(&current, "id = ?", run.ID).Error; err != nil {
			return err
		}
		if current.Status != model.SkillRunRunning || current.Revision != run.Revision || current.WorkerID != s.workerID {
			return errRunSuperseded
		}
		if err := tx.Model(&model.SkillRunArtifact{}).Where("step_id = ?", previous.ID).
			Updates(map[string]any{"role": "final", "is_final": true}).Error; err != nil {
			return err
		}
		update := tx.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", run.ID, run.Revision, s.workerID, model.SkillRunRunning).
			Update("state_revision", gorm.Expr("state_revision + 1"))
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errRunSuperseded
		}
		return nil
	}); err != nil {
		return err
	}
	return nil
}

func (s *service) waitForInput(run *model.SkillRun, spec agentStep, sequence, total int) (bool, error) {
	step, done, err := s.ensureStep(run, spec.Key, sequence, "input", map[string]any{}, false)
	if err != nil || done {
		return false, err
	}
	pending := map[string]any{"type": "input", "title": spec.Title, "message": spec.Message}
	if len(spec.Schema) > 0 && json.Valid(spec.Schema) {
		pending["schema"] = json.RawMessage(spec.Schema)
	}
	raw, _ := json.Marshal(pending)
	if err := s.transitionToWaiting(run, step, model.SkillRunWaitingInput, spec.Key, stepBaseProgress(sequence, total), string(raw)); err != nil {
		return false, err
	}
	return true, nil
}

// transitionToWaiting publishes the step and run waiting state atomically. A
// client can therefore never observe a waiting step without the matching
// pending action (or the inverse), and stateRevision fences all actions against
// exactly that snapshot.
func (s *service) transitionToWaiting(run *model.SkillRun, step *model.SkillRunStep, status, key string, progress int, pending string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var claimed model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "status", "revision", "worker_id").First(&claimed, "id = ?", run.ID).Error; err != nil {
			return err
		}
		if claimed.Status != model.SkillRunRunning || claimed.Revision != run.Revision || claimed.WorkerID != s.workerID {
			return errRunSuperseded
		}
		var currentStep model.SkillRunStep
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "run_id", "status").First(&currentStep, "id = ? AND run_id = ?", step.ID, run.ID).Error; err != nil {
			return err
		}
		if currentStep.Status != model.SkillStepRunning && currentStep.Status != model.SkillStepWaiting {
			return errRunSuperseded
		}
		if currentStep.Status != model.SkillStepWaiting {
			stepUpdate := tx.Model(&model.SkillRunStep{}).
				Where("id = ? AND run_id = ? AND status = ?", step.ID, run.ID, model.SkillStepRunning).
				Update("status", model.SkillStepWaiting)
			if stepUpdate.Error != nil {
				return stepUpdate.Error
			}
			if stepUpdate.RowsAffected != 1 {
				return errRunSuperseded
			}
		}
		update := tx.Model(&model.SkillRun{}).
			Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", run.ID, run.Revision, s.workerID, model.SkillRunRunning).
			Updates(map[string]any{
				"status": status, "current_step": key, "progress": progress, "pending_action": pending,
				"worker_id": "", "lease_expires_at": nil, "state_revision": gorm.Expr("state_revision + 1"),
			})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errRunSuperseded
		}
		return nil
	})
}

func (s *service) persistArtifacts(run *model.SkillRun, step *model.SkillRunStep, snapshot *ai.TaskSnapshot, spec agentStep, version *model.SkillVersion, sequence, total int) ([]model.SkillRunArtifact, string, error) {
	meta := map[string]any{}
	if strings.TrimSpace(snapshot.ResultMeta) != "" {
		_ = json.Unmarshal([]byte(snapshot.ResultMeta), &meta)
	}
	preferred := strings.TrimSpace(spec.PreferredNodeType)
	if preferred == "" {
		preferred = manifestPreferredNode(version.ManifestJSON)
	}
	if preferred == "character" || preferred == "scene" {
		meta["preferredNodeType"] = preferred
	}
	metadata, _ := json.Marshal(meta)
	role := strings.TrimSpace(spec.OutputRole)
	if role == "" {
		role = "final"
	}
	final := role == "final"
	outputType := normalizedOutput(spec.OutputType)
	text, _ := meta["text"].(string)
	urls := []string{}
	if values, ok := meta["urls"].([]any); ok {
		for _, value := range values {
			if url, ok := value.(string); ok && strings.TrimSpace(url) != "" {
				urls = append(urls, strings.TrimSpace(url))
			}
		}
	}
	if strings.TrimSpace(snapshot.ResultURL) != "" {
		urls = append(urls, strings.TrimSpace(snapshot.ResultURL))
	}
	urls = uniqueStrings(urls)
	rows := []model.SkillRunArtifact{}
	if strings.TrimSpace(text) != "" {
		typeName := outputType
		if typeName != "file" {
			typeName = "text"
		}
		rows = append(rows, model.SkillRunArtifact{RunID: run.ID, StepID: step.ID, TaskID: snapshot.ID,
			Type: typeName, Role: role, Text: text, Metadata: string(metadata), SortOrder: len(rows), IsFinal: final})
	}
	for _, url := range urls {
		rows = append(rows, model.SkillRunArtifact{RunID: run.ID, StepID: step.ID, TaskID: snapshot.ID,
			Type: outputType, Role: role, URL: url, Metadata: string(metadata), SortOrder: len(rows), IsFinal: final})
	}
	if len(rows) == 0 {
		return nil, "", errors.New("generation produced no artifact")
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var claimed model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "status", "revision", "worker_id").First(&claimed, "id = ?", run.ID).Error; err != nil {
			return err
		}
		if claimed.Status != model.SkillRunRunning || claimed.Revision != run.Revision || claimed.WorkerID != s.workerID {
			return errRunSuperseded
		}
		var count int64
		if err := tx.Model(&model.SkillRunArtifact{}).Where("step_id = ?", step.ID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			for i := range rows {
				if err := tx.Create(&rows[i]).Error; err != nil {
					return err
				}
			}
		} else if err := tx.Where("step_id = ?", step.ID).Order("sort_order ASC").Find(&rows).Error; err != nil {
			return err
		}
		output, _ := json.Marshal(map[string]any{"text": text, "artifactCount": len(rows)})
		now := time.Now()
		stepUpdate := tx.Model(&model.SkillRunStep{}).Where("id = ? AND status = ?", step.ID, model.SkillStepRunning).Updates(map[string]any{
			"status": model.SkillStepSucceeded, "output_json": string(output), "completed_at": now,
		})
		if stepUpdate.Error != nil {
			return stepUpdate.Error
		}
		if stepUpdate.RowsAffected != 1 {
			return errRunSuperseded
		}
		update := tx.Model(&model.SkillRun{}).
			Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", run.ID, run.Revision, s.workerID, model.SkillRunRunning).
			Updates(map[string]any{"point_cost": gorm.Expr("point_cost + ?", snapshot.PointCost), "progress": stepEndProgress(sequence, total),
				"state_revision": gorm.Expr("state_revision + 1")})
		if update.Error != nil {
			return update.Error
		}
		if update.RowsAffected != 1 {
			return errRunSuperseded
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	return rows, text, nil
}

func (s *service) resolveModel(configured, requested, outputType string) (string, error) {
	typeName := outputType
	if typeName == "file" {
		typeName = "text"
	}
	configured = strings.TrimSpace(configured)
	requested = strings.TrimSpace(requested)
	candidates := []string{}
	if configured != "" {
		candidates = append(candidates, configured)
	} else if requested != "" {
		candidates = append(candidates, requested)
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		var count int64
		query := s.db.Model(&model.MarketModel{}).Where("status = 1 AND type = ?", typeName)
		if id, err := idgen.Parse(candidate); err == nil {
			query = query.Where("model_key = ? OR id = ?", candidate, id)
		} else {
			query = query.Where("model_key = ?", candidate)
		}
		if query.Count(&count).Error == nil && count > 0 {
			return candidate, nil
		}
	}
	if configured != "" {
		return "", fmt.Errorf("configured %s model is unavailable", typeName)
	}
	var row model.MarketModel
	if err := s.db.Where("status = 1 AND type = ? AND model_key <> ''", typeName).
		Order("sort_order ASC, id ASC").First(&row).Error; err != nil {
		return "", fmt.Errorf("no available %s model", typeName)
	}
	return row.ModelKey, nil
}

func (s *service) resolveTextModelForAssets(configured, requested string, assets []AssetInput) (string, error) {
	resolved, err := s.resolveModel(configured, requested, "text")
	if err != nil || len(assets) == 0 {
		return resolved, err
	}
	var row model.MarketModel
	query := s.db.Where("status = 1 AND type = ? AND model_key <> ''", "text")
	if id, parseErr := idgen.Parse(resolved); parseErr == nil {
		query = query.Where("model_key = ? OR id = ?", resolved, id)
	} else {
		query = query.Where("model_key = ?", resolved)
	}
	if err := query.First(&row).Error; err != nil {
		return "", errors.New("selected text model is unavailable")
	}
	if !textModelSupportsAssets(row, assets) {
		return "", runUserError{message: "当前文本模型不支持此技能使用的附件，请移除附件或切换支持文件上传的模型"}
	}
	return row.ModelKey, nil
}

func (s *service) primarySkillText(version *model.SkillVersion) string {
	var file model.SkillFile
	if version.PrimaryFilePath != "" && s.db.Where("skill_version_id = ? AND path = ?", version.ID, version.PrimaryFilePath).First(&file).Error == nil {
		return file.Content
	}
	return version.PromptTemplate
}

var runtimeSkillFileReferencePattern = regexp.MustCompile(`\{\{skill\.file:([^{}]+)\}\}`)

// expandSkillTemplate resolves only explicitly referenced files from the pinned
// SkillVersion. It never concatenates the whole package, keeping prompt size and
// context cost controlled. Imports validate references; runtime still defends
// against old/broken snapshots and reference cycles.
func (s *service) expandSkillTemplate(version *model.SkillVersion, value string) (string, error) {
	if len(value) > 1<<20 {
		return "", errors.New("expanded skill prompt exceeds size limit")
	}
	if !strings.Contains(value, "{{skill.") {
		return value, nil
	}
	var files []model.SkillFile
	if err := s.db.Where("skill_version_id = ?", version.ID).Find(&files).Error; err != nil {
		return "", err
	}
	byPath := make(map[string]string, len(files))
	for i := range files {
		byPath[files[i].Path] = files[i].Content
	}
	return expandSkillTemplateFiles(version.PrimaryFilePath, value, byPath)
}

func expandSkillTemplateFiles(primaryPath, value string, byPath map[string]string) (string, error) {
	primary, ok := byPath[primaryPath]
	if !ok {
		return "", errors.New("primary skill file is unavailable")
	}
	result := value
	for depth := 0; depth < 8 && strings.Contains(result, "{{skill."); depth++ {
		changed := false
		if strings.Contains(result, "{{skill.primary}}") {
			result = strings.ReplaceAll(result, "{{skill.primary}}", primary)
			changed = true
		}
		var replaceErr error
		result = runtimeSkillFileReferencePattern.ReplaceAllStringFunc(result, func(token string) string {
			if replaceErr != nil {
				return token
			}
			match := runtimeSkillFileReferencePattern.FindStringSubmatch(token)
			ref := strings.TrimSpace(strings.ReplaceAll(match[1], "\\", "/"))
			clean := path.Clean(ref)
			if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || strings.Contains(clean, ":") {
				replaceErr = errors.New("skill file reference is invalid")
				return token
			}
			content, exists := byPath[clean]
			if !exists {
				base := path.Dir(primaryPath)
				if base != "." {
					relative := path.Clean(path.Join(base, clean))
					if relative != ".." && !strings.HasPrefix(relative, "../") {
						content, exists = byPath[relative]
					}
				}
			}
			if !exists {
				replaceErr = fmt.Errorf("skill file %q is unavailable", clean)
				return token
			}
			changed = true
			return content
		})
		if replaceErr != nil {
			return "", replaceErr
		}
		if len(result) > 1<<20 {
			return "", errors.New("expanded skill prompt exceeds size limit")
		}
		if !changed {
			break
		}
	}
	if strings.Contains(result, "{{skill.primary}}") || runtimeSkillFileReferencePattern.MatchString(result) {
		return "", errors.New("skill file references contain a cycle")
	}
	return result, nil
}

func (s *service) failStep(run *model.SkillRun, stepID idgen.ID, message string) {
	now := time.Now()
	_ = s.db.Transaction(func(tx *gorm.DB) error {
		var claimed model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "status", "revision", "worker_id").First(&claimed, "id = ?", run.ID).Error; err != nil {
			return err
		}
		if claimed.Status != model.SkillRunRunning || claimed.Revision != run.Revision || claimed.WorkerID != s.workerID {
			return errRunSuperseded
		}
		stepUpdate := tx.Model(&model.SkillRunStep{}).Where("id = ? AND run_id = ? AND status = ?", stepID, run.ID, model.SkillStepRunning).Updates(map[string]any{
			"status": model.SkillStepFailed, "error_message": nonEmpty(message, "step failed"), "completed_at": now,
		})
		if stepUpdate.Error != nil {
			return stepUpdate.Error
		}
		if stepUpdate.RowsAffected == 0 {
			return nil
		}
		return tx.Model(&model.SkillRun{}).
			Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", run.ID, run.Revision, s.workerID, model.SkillRunRunning).
			Update("state_revision", gorm.Expr("state_revision + 1")).Error
	})
}

func (s *service) failRun(runID idgen.ID, revision int64, message string) {
	defer func() {
		if err := points.RefundFailedSocialRun(s.db, runID); err != nil {
			logger.L().Error("social report refund failed", zap.Error(err))
		}
	}()
	now := time.Now()
	_ = s.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", runID, revision, s.workerID, model.SkillRunRunning).Updates(map[string]any{
			"status": model.SkillRunFailed, "progress": 100, "error_message": nonEmpty(message, "skill run failed"),
			"pending_action": "", "completed_at": now, "worker_id": "", "lease_expires_at": nil, "state_revision": gorm.Expr("state_revision + 1"),
		})
		if result.Error != nil || result.RowsAffected != 1 {
			return result.Error
		}
		if err := tx.Model(&model.SkillRunArtifact{}).Where("run_id = ?", runID).Update("is_final", false).Error; err != nil {
			return err
		}
		return demoteRunChildTasksTx(tx, runID)
	})
}

func (s *service) finishRun(runID idgen.ID, revision int64) {
	prepared, err := s.prepareAssetArchives(runID, revision)
	if err != nil {
		s.cleanupPreparedArchives(prepared)
		if !errors.Is(err, errRunSuperseded) {
			logger.L().Warn("skill run asset archive preparation failed", zap.String("runId", runID.String()), zap.Error(err))
			var current model.SkillRun
			_ = s.db.Select("finalize_attempts").First(&current, "id = ?", runID).Error
			if filehandler.IsPermanentArchiveError(err) || current.FinalizeAttempts >= 3 {
				s.failRun(runID, revision, "asset archive failed")
			} else {
				_ = s.db.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", runID, revision, s.workerID, model.SkillRunRunning).
					Update("lease_expires_at", time.Now().Add(15*time.Second)).Error
			}
		}
		return
	}
	// Safe on both success and failure: cleanup keeps the storage key referenced
	// by the winning File row and removes only this worker's unreferenced key.
	defer s.cleanupPreparedArchives(prepared)
	now := time.Now()
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var run model.SkillRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&run, "id = ?", runID).Error; err != nil {
			return err
		}
		if run.Revision != revision || run.WorkerID != s.workerID || run.Status != model.SkillRunRunning {
			return errRunSuperseded
		}
		// Asset runs are materialized before success becomes visible. Polling
		// clients therefore never race on a final artifact with fileId=0.
		if run.EntryPoint == "asset" {
			if err := s.bindPreparedArchivesTx(tx, &run, prepared); err != nil {
				return err
			}
		}
		if err := s.promoteFinalTasksTx(tx, &run); err != nil {
			return err
		}
		result := tx.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", runID, revision, s.workerID, model.SkillRunRunning).Updates(map[string]any{
			"status": model.SkillRunSucceeded, "progress": 100, "pending_action": "", "completed_at": now,
			"worker_id": "", "lease_expires_at": nil, "state_revision": gorm.Expr("state_revision + 1"),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errRunSuperseded
		}
		return nil
	})
	if err != nil {
		if !errors.Is(err, errRunSuperseded) {
			logger.L().Warn("skill run finish transaction failed", zap.String("runId", runID.String()), zap.Error(err))
			var current model.SkillRun
			_ = s.db.Select("finalize_attempts").First(&current, "id = ?", runID).Error
			if current.FinalizeAttempts >= 3 {
				s.failRun(runID, revision, "skill run finalization failed")
			} else {
				_ = s.db.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", runID, revision, s.workerID, model.SkillRunRunning).
					Update("lease_expires_at", time.Now().Add(15*time.Second)).Error
			}
		}
		return
	}
	var artifact model.SkillRunArtifact
	if s.db.Where("run_id = ? AND is_final = ? AND text_content <> ''", runID, true).
		Order("sort_order DESC, create_time DESC").First(&artifact).Error == nil {
		_ = s.db.Model(&model.IMMessage{}).Where("skill_run_id = ?", runID).Update("content", artifact.Text).Error
	}
}

func (s *service) promoteFinalTasksTx(tx *gorm.DB, run *model.SkillRun) error {
	var taskIDs []idgen.ID
	if err := tx.Model(&model.SkillRunArtifact{}).
		Joins("JOIN skill_run_step ON skill_run_step.id = skill_run_artifact.step_id AND skill_run_step.deleted IS NULL").
		Where("skill_run_artifact.run_id = ? AND skill_run_artifact.is_final = ? AND skill_run_artifact.task_id <> 0 AND skill_run_step.register_work = ?", run.ID, true, true).
		Distinct("task_id").Pluck("task_id", &taskIDs).Error; err != nil {
		return err
	}
	for _, taskID := range taskIDs {
		if err := s.ai.PromoteTaskTx(context.Background(), tx, run.UserID, taskID); err != nil {
			return err
		}
	}
	return nil
}

type preparedAssetArchives map[idgen.ID]*filehandler.PreparedRemoteArchive

func (s *service) prepareAssetArchives(runID idgen.ID, revision int64) (preparedAssetArchives, error) {
	prepared := preparedAssetArchives{}
	lease := time.Now().Add(90 * time.Second)
	claim := s.db.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", runID, revision, s.workerID, model.SkillRunRunning).
		Updates(map[string]any{"lease_expires_at": lease, "finalize_attempts": gorm.Expr("finalize_attempts + 1")})
	if claim.Error != nil {
		return prepared, claim.Error
	}
	if claim.RowsAffected != 1 {
		return prepared, errRunSuperseded
	}
	var run model.SkillRun
	if err := s.db.Select("id", "user_id", "target_type", "entry_point", "status", "revision", "worker_id", "finalize_attempts").First(&run, "id = ?", runID).Error; err != nil {
		return prepared, err
	}
	if run.EntryPoint != "asset" {
		return prepared, nil
	}
	if s.deps == nil || s.deps.Storage == nil {
		return prepared, filehandler.PermanentArchiveError(errors.New("asset storage is unavailable"))
	}
	var artifacts []model.SkillRunArtifact
	if err := s.db.Where("run_id = ? AND is_final = ? AND file_id = 0 AND (url <> '' OR (type = ? AND text_content <> ''))", run.ID, true, "file").Order("id ASC").Find(&artifacts).Error; err != nil {
		return prepared, err
	}
	category := strings.ToLower(strings.TrimSpace(run.TargetType))
	if category != "character" && category != "scene" {
		category = "general"
	}
	for i := range artifacts {
		fileType := strings.ToLower(strings.TrimSpace(artifacts[i].Type))
		if fileType != "image" && fileType != "video" && fileType != "audio" {
			fileType = "other"
		}
		archiveCtx, cancelArchive := context.WithTimeout(context.Background(), 65*time.Second)
		var archive *filehandler.PreparedRemoteArchive
		var err error
		if fileType == "other" && artifacts[i].Type == "file" && strings.TrimSpace(artifacts[i].URL) == "" {
			archive, err = filehandler.PrepareTextArchive(archiveCtx, s.deps, run.UserID, artifacts[i].ID,
				artifacts[i].Text, category, fmt.Sprintf("skill-%s-%s.md", run.ID.String(), artifacts[i].ID.String()))
		} else {
			archive, err = filehandler.PrepareRemoteArchive(archiveCtx, s.deps, run.UserID, artifacts[i].ID,
				artifacts[i].URL, fileType, category, fmt.Sprintf("skill-%s-%s", run.ID.String(), artifacts[i].ID.String()))
		}
		cancelArchive()
		if err != nil {
			return prepared, err
		}
		prepared[artifacts[i].ID] = archive
		// Each download is bounded to 60 seconds. Renew between batch items so a
		// second server cannot reclaim the run while archival is active.
		heartbeat := s.db.Model(&model.SkillRun{}).Where("id = ? AND revision = ? AND worker_id = ? AND status = ?", runID, revision, s.workerID, model.SkillRunRunning).
			Update("lease_expires_at", time.Now().Add(90*time.Second))
		if heartbeat.Error != nil {
			return prepared, heartbeat.Error
		}
		if heartbeat.RowsAffected != 1 {
			return prepared, errRunSuperseded
		}
	}
	return prepared, nil
}

func (s *service) bindPreparedArchivesTx(tx *gorm.DB, run *model.SkillRun, prepared preparedAssetArchives) error {
	if run == nil || run.EntryPoint != "asset" {
		return nil
	}
	var artifacts []model.SkillRunArtifact
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("run_id = ? AND is_final = ? AND (url <> '' OR (type = ? AND text_content <> ''))", run.ID, true, "file").Order("id ASC").Find(&artifacts).Error; err != nil {
		return err
	}
	// Serialize quota accounting with ordinary uploads. Holding this lock until
	// File creation and storage_used update commit prevents concurrent archive
	// runs from each observing the same remaining quota.
	var user model.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "storage_quota", "storage_used").First(&user, "id = ?", run.UserID).Error; err != nil {
		return err
	}
	var remainingBytes int64
	quotaUnavailable := false
	if user.StorageQuota > 0 {
		storageScope := ""
		if s.deps != nil && s.deps.Cfg != nil {
			storageScope = storage.ScopeID(s.deps.Cfg.Storage)
		}
		reservedBytes, err := filehandler.ReservedUploadBytes(tx, run.UserID, storageScope, 0)
		if err != nil {
			return err
		}
		if user.StorageUsed > user.StorageQuota || reservedBytes > user.StorageQuota-user.StorageUsed {
			quotaUnavailable = true
		} else {
			remainingBytes = user.StorageQuota - user.StorageUsed - reservedBytes
		}
	}
	var addedBytes int64
	for i := range artifacts {
		if artifacts[i].FileID != 0 {
			continue
		}
		archive := prepared[artifacts[i].ID]
		if archive == nil {
			return errors.New("final asset archive is incomplete")
		}
		var file model.File
		err := tx.Where("source_artifact_id = ? AND owner_id = ?", artifacts[i].ID, run.UserID).First(&file).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			file = archive.File
			insufficientQuota := user.StorageQuota > 0 &&
				(quotaUnavailable || addedBytes > remainingBytes || file.FileSize > remainingBytes-addedBytes)
			if file.FileSize < 0 || insufficientQuota {
				return filehandler.PermanentArchiveError(errors.New("storage quota is insufficient"))
			}
			if err := tx.Create(&file).Error; err != nil {
				return err
			}
			addedBytes += file.FileSize
		} else if err != nil {
			return err
		}
		updates := map[string]any{"file_id": file.ID}
		if strings.TrimSpace(artifacts[i].URL) == "" {
			updates["url"] = file.FileUrl
		}
		result := tx.Model(&model.SkillRunArtifact{}).Where("id = ? AND file_id = 0", artifacts[i].ID).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errRunSuperseded
		}
	}
	if addedBytes > 0 {
		if err := tx.Model(&model.User{}).Where("id = ?", run.UserID).
			UpdateColumn("storage_used", gorm.Expr("GREATEST(storage_used + ?, 0)", addedBytes)).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *service) cleanupPreparedArchives(prepared preparedAssetArchives) {
	if s.deps == nil || s.deps.Storage == nil {
		return
	}
	for artifactID, archive := range prepared {
		if archive == nil || !archive.Prepared || strings.TrimSpace(archive.File.StorageKey) == "" {
			continue
		}
		var winner model.File
		err := s.db.Select("storage_key").Where("source_artifact_id = ?", artifactID).First(&winner).Error
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && winner.StorageKey != archive.File.StorageKey) {
			_ = s.deps.Storage.Delete(context.Background(), archive.File.StorageKey)
		}
	}
}

// materializeFinalArtifacts upgrades succeeded asset runs created by an older
// process version. New runs archive before exposing succeeded and never enter
// this recovery path.
func (s *service) materializeFinalArtifacts(runID idgen.ID) error {
	var run model.SkillRun
	if err := s.db.First(&run, "id = ?", runID).Error; err != nil {
		return err
	}
	if run.Status != model.SkillRunSucceeded || run.EntryPoint != "asset" {
		return nil
	}
	var artifacts []model.SkillRunArtifact
	if err := s.db.Where("run_id = ? AND is_final = ? AND file_id = 0 AND (url <> '' OR (type = ? AND text_content <> ''))", run.ID, true, "file").Find(&artifacts).Error; err != nil {
		return err
	}
	prepared := preparedAssetArchives{}
	defer s.cleanupPreparedArchives(prepared)
	for i := range artifacts {
		archiveCtx, cancelArchive := context.WithTimeout(context.Background(), 65*time.Second)
		var archive *filehandler.PreparedRemoteArchive
		var err error
		if artifacts[i].Type == "file" && strings.TrimSpace(artifacts[i].URL) == "" {
			archive, err = filehandler.PrepareTextArchive(archiveCtx, s.deps, run.UserID, artifacts[i].ID,
				artifacts[i].Text, run.TargetType, fmt.Sprintf("skill-%s-%s.md", run.ID.String(), artifacts[i].ID.String()))
		} else {
			archive, err = filehandler.PrepareRemoteArchive(archiveCtx, s.deps, run.UserID, artifacts[i].ID,
				artifacts[i].URL, artifacts[i].Type, run.TargetType, fmt.Sprintf("skill-%s-%s", run.ID.String(), artifacts[i].ID.String()))
		}
		cancelArchive()
		if err != nil {
			return err
		}
		prepared[artifacts[i].ID] = archive
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.bindPreparedArchivesTx(tx, &run, prepared); err != nil {
			return err
		}
		return tx.Model(&model.SkillRun{}).Where("id = ? AND status = ?", run.ID, model.SkillRunSucceeded).
			Update("state_revision", gorm.Expr("state_revision + 1")).Error
	})
	return err
}

func buildGenerationInput(defaultsJSON string, input RunInput, prompt string) map[string]any {
	result := map[string]any{}
	_ = json.Unmarshal([]byte(defaultsJSON), &result)
	for key, value := range input.Parameters {
		if key != "modelId" && key != "textModelId" {
			result[key] = value
		}
	}
	// Conversation context comes only from RunInput.Messages via the bounded
	// Agent prompt. Defaults/parameters must not add a second history array.
	delete(result, "messages")
	result["prompt"] = strings.TrimSpace(prompt)
	imageURLs := []string{}
	for _, asset := range input.Assets {
		if asset.Type == "image" && strings.TrimSpace(asset.URL) != "" {
			imageURLs = append(imageURLs, strings.TrimSpace(asset.URL))
		}
	}
	if len(imageURLs) > 0 {
		result["imageUrls"] = imageURLs
		result["imageList"] = imageURLs
		result["imageUrl"] = imageURLs[0]
		result["sourceImage"] = imageURLs[0]
	}
	return result
}

// addSkillTextAttachments reuses the hardened chat attachment extractor so
// office tools can consume the same uploaded images and documents as normal
// text chat. Only URLs owned by configured storage are fetched; unsupported,
// oversized or untrusted files become an explicit note instead of disappearing.
func (s *service) addSkillTextAttachments(ctx context.Context, command map[string]any, assets []AssetInput) {
	if len(assets) == 0 {
		return
	}
	attachments := make([]chatattach.Attach, 0, len(assets))
	imageNames := make([]string, 0, len(assets))
	for _, asset := range assets {
		attachments = append(attachments, chatattach.Attach{
			URL: strings.TrimSpace(asset.URL), Kind: strings.TrimSpace(asset.Type), Name: strings.TrimSpace(asset.Name),
		})
		if strings.EqualFold(strings.TrimSpace(asset.Type), "image") && strings.TrimSpace(asset.URL) != "" {
			name := strings.TrimSpace(asset.Name)
			if name == "" {
				name = fmt.Sprintf("参考图%d", len(imageNames)+1)
			}
			imageNames = append(imageNames, name)
		}
	}
	files, note := (chatattach.Extractor{Store: s.deps.Storage}).FileParts(ctx, attachments)
	if len(files) > 0 {
		encoded := make([]map[string]string, 0, len(files))
		for _, file := range files {
			encoded = append(encoded, map[string]string{"filename": file.Filename, "dataUri": file.DataURI})
		}
		command["files"] = encoded
	}
	imageNote := ""
	if len(imageNames) > 0 {
		imageNote = fmt.Sprintf("本条任务附带 %d 张参考图，按上传顺序编号为参考图1至参考图%d（%s）。请逐张读取，只陈述画面中可见的信息，并让图片影响内容判断与视觉建议；若当前输出协议包含 imageIndex 或 imageIndexes，可按编号安排图片，否则仅把它们作为内容与风格依据。", len(imageNames), len(imageNames), strings.Join(imageNames, "、"))
	}
	if note != "" || imageNote != "" {
		prompt, _ := command["prompt"].(string)
		command["prompt"] = strings.TrimSpace(prompt + "\n\n" + strings.TrimSpace(imageNote+"\n"+note))
	}
}

// withAgentConversationContext turns recent assistant history into one explicit
// execution prompt. Only Agent runners call this helper: Preset keeps its
// single-turn contract and sees input.Prompt unchanged. The original user
// message also remains unchanged in storage because RunInput is copied by value.
func withAgentConversationContext(input RunInput) RunInput {
	if len(input.Messages) == 0 {
		return input
	}

	var context strings.Builder
	context.WriteString("以下是最近对话上下文，仅用于理解指代、延续创作意图和保持一致性；当前请求是本轮需要执行的任务。\n\n<recent_conversation>\n")
	for _, message := range chatcontext.Latest(input.Messages) {
		role := "用户"
		if message.Role == "assistant" {
			role = "助手"
		}
		context.WriteString(role)
		context.WriteString("：")
		context.WriteString(strings.TrimSpace(message.Content))
		context.WriteByte('\n')
	}
	context.WriteString("</recent_conversation>\n\n<current_request>\n")
	context.WriteString(strings.TrimSpace(input.Prompt))
	context.WriteString("\n</current_request>")

	input.Prompt = context.String()
	return input
}

func requestedModel(parameters map[string]any) string {
	value, _ := parameters["modelId"].(string)
	return value
}

func requestedTextModel(parameters map[string]any) string {
	value, _ := parameters["textModelId"].(string)
	return value
}

func requestedAgentStepModel(parameters map[string]any, stepType, versionModelType string) string {
	if stepType != "text" {
		return requestedModel(parameters)
	}
	if textModel := requestedTextModel(parameters); textModel != "" {
		return textModel
	}
	// A text/file-primary agent historically exposed modelId as its only
	// model override. Keep that compatible while ensuring a media modelId is
	// never applied to a text planning step.
	if versionModelType == "text" {
		return requestedModel(parameters)
	}
	return ""
}

func handlerFor(outputType string, assets []AssetInput) string {
	hasImage := false
	for _, asset := range assets {
		if asset.Type == "image" && strings.TrimSpace(asset.URL) != "" {
			hasImage = true
			break
		}
	}
	switch outputType {
	case "image":
		if hasImage {
			return "image_to_image"
		}
		return "text_to_image"
	case "video":
		if hasImage {
			return "image_to_video"
		}
		return "text_to_video"
	case "audio":
		return "text_to_audio"
	default:
		return "skill_text_completion"
	}
}

func normalizedOutput(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image", "video", "audio", "text", "file":
		return strings.ToLower(strings.TrimSpace(value))
	}
	return "text"
}

func renderStepPrompt(template string, input RunInput, previous, contextJSON string) (string, error) {
	if strings.TrimSpace(template) == "" {
		return input.Prompt, nil
	}
	feedback := ""
	var contextMap map[string]any
	if json.Unmarshal([]byte(contextJSON), &contextMap) == nil {
		feedback, _ = contextMap["feedback"].(string)
	}
	replacements := []string{
		"{{prompt}}", input.Prompt, "{{input.prompt}}", input.Prompt,
		"{{previous}}", previous, "{{feedback}}", feedback, "{{context.feedback}}", feedback,
	}
	for key, value := range input.Parameters {
		if scalar, ok := templateScalar(value); ok {
			replacements = append(replacements, "{{input."+key+"}}", scalar, "{{input.parameters."+key+"}}", scalar)
		}
	}
	if userInput, ok := contextMap["userInput"].(map[string]any); ok {
		for key, value := range userInput {
			if scalar, ok := templateScalar(value); ok {
				replacements = append(replacements, "{{context.userInput."+key+"}}", scalar)
			}
		}
	}
	rendered, err := boundedtext.Replace(template, 1<<20, replacements...)
	if errors.Is(err, boundedtext.ErrLimitExceeded) {
		return "", runUserError{message: "rendered skill prompt exceeds 1 MiB"}
	}
	return rendered, err
}

func templateScalar(value any) (string, bool) {
	switch value := value.(type) {
	case string:
		return value, true
	case float64, float32, int, int64, bool, json.Number:
		return fmt.Sprint(value), true
	}
	return "", false
}

func agentStepSystemPrompt(explicit, primarySkillText string) string {
	if strings.TrimSpace(explicit) != "" {
		return explicit
	}
	return primarySkillText
}

func promptFromJSON(value string) string {
	var object map[string]any
	if json.Unmarshal([]byte(value), &object) != nil {
		return ""
	}
	prompt, _ := object["prompt"].(string)
	return strings.TrimSpace(prompt)
}

func manifestPreferredNode(raw string) string {
	var manifest agentManifest
	if json.Unmarshal([]byte(raw), &manifest) != nil {
		return ""
	}
	if manifest.PreferredNodeType == "character" || manifest.PreferredNodeType == "scene" {
		return manifest.PreferredNodeType
	}
	return ""
}

func stepBaseProgress(sequence, total int) int {
	if total <= 0 {
		return 5
	}
	return 5 + sequence*90/total
}

func stepEndProgress(sequence, total int) int {
	if total <= 0 {
		return 95
	}
	return 5 + (sequence+1)*90/total
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func nonEmpty(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func publicRunError(err error) string {
	var userError runUserError
	if errors.As(err, &userError) && strings.TrimSpace(userError.message) != "" {
		return userError.message
	}
	return "\u6280\u80fd\u6267\u884c\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5"
}
