package project

import (
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/operations"
	"infinite-canvas/backend/internal/repository"
)

const (
	chapterApplyOpIDPrefix        = "chapter-apply:"
	ChapterApplyOpStoryboard      = "project.chapter.storyboard.apply"
	ChapterApplyOpCharacters      = "project.chapter.characters.apply"
	chapterApplyKindStoryboard    = "storyboard"
	chapterApplyKindCharacters    = "characters"
	chapterStoryboardTaskSource   = "short-drama-chapter-storyboard"
	chapterCharacterTaskOperation = "chapter_character_breakdown"
	maxChapterApplyReceiptQuery   = 100
)

type chapterApplyKind string

const (
	chapterApplyStoryboard chapterApplyKind = chapterApplyKindStoryboard
	chapterApplyCharacters chapterApplyKind = chapterApplyKindCharacters
)

type chapterApplySource struct {
	TaskID      string
	UnitID      string
	OpID        string
	Op          string
	PayloadHash string
}

type chapterApplyReceipt struct {
	TaskID     string                        `json:"taskId"`
	ProjectID  string                        `json:"projectId"`
	UnitID     string                        `json:"unitId"`
	Kind       string                        `json:"kind"`
	Shots      []model.Shot                  `json:"shots,omitempty"`
	Candidates []model.ProjectAssetCandidate `json:"candidates,omitempty"`
}

type storyboardApplyPayload struct {
	UnitID string                `json:"unitId"`
	Shots  []storyboardApplyShot `json:"shots"`
}

type storyboardApplyShot struct {
	Title           string            `json:"title"`
	Description     string            `json:"description"`
	DurationMs      int64             `json:"durationMs"`
	Revision        ShotRevisionInput `json:"revision"`
	AssetVersionIDs []string          `json:"assetVersionIds"`
}

type characterApplyPayload struct {
	Source     string                    `json:"source"`
	Candidates []characterApplyCandidate `json:"candidates"`
}

type characterApplyCandidate struct {
	UnitID   string         `json:"unitId"`
	ShotID   string         `json:"shotId"`
	Name     string         `json:"name"`
	Category string         `json:"category"`
	Details  map[string]any `json:"details"`
}

func chapterApplyOpID(taskID string) string {
	return chapterApplyOpIDPrefix + strings.TrimSpace(taskID)
}

func chapterApplyOp(kind chapterApplyKind) string {
	if kind == chapterApplyCharacters {
		return ChapterApplyOpCharacters
	}
	return ChapterApplyOpStoryboard
}

func (s *Service) resolveChapterApplySource(userID, projectID, unitID, sourceTaskID string, kind chapterApplyKind, payload any) (chapterApplySource, error) {
	taskID := strings.TrimSpace(sourceTaskID)
	if taskID == "" {
		return chapterApplySource{}, nil
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		if IsNotFound(err) {
			return chapterApplySource{}, kernel.NotFound("The corresponding build task cannot be found")
		}
		return chapterApplySource{}, err
	}
	if task.Status != model.TaskStatusSucceeded {
		return chapterApplySource{}, kernel.BadAuthRequest("The generation is not yet complete and the results cannot be written")
	}
	metadata := generationTaskMetadata(task.InputJSON)
	taskProjectID := strings.TrimSpace(task.ProjectID)
	if taskProjectID == "" {
		taskProjectID = metadataString(metadata, "domainProjectId")
	}
	if taskProjectID != projectID {
		return chapterApplySource{}, kernel.Forbidden("The generated results of other projects cannot be written into this chapter.")
	}
	taskChapterID := metadataString(metadata, "chapterId")
	if taskChapterID == "" {
		return chapterApplySource{}, kernel.Forbidden("Cannot write generated results that lack a chapter identity to this chapter")
	}
	if unitID != "" && taskChapterID != unitID {
		return chapterApplySource{}, kernel.Forbidden("The generated results of other chapters cannot be written into this chapter.")
	}
	if kind == chapterApplyStoryboard {
		if metadataString(metadata, "source") != chapterStoryboardTaskSource && strings.TrimSpace(task.Operation) != "storyboard" {
			return chapterApplySource{}, kernel.Forbidden("Other types of generated results cannot be written into the storyboard of this chapter.")
		}
	} else if metadataString(metadata, "operation") != chapterCharacterTaskOperation {
		return chapterApplySource{}, kernel.Forbidden("Other types of generation results cannot be written to the assets of this chapter.")
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return chapterApplySource{}, kernel.BadAuthRequest("The written content cannot be verified")
	}
	op := chapterApplyOp(kind)
	return chapterApplySource{
		TaskID:      task.ID,
		UnitID:      taskChapterID,
		OpID:        chapterApplyOpID(task.ID),
		Op:          op,
		PayloadHash: operations.PayloadHash(op, encoded),
	}, nil
}

func (s *Service) ChapterApplyReceipts(userID, projectID string, taskIDs []string) ([]ChapterApplyReceiptView, error) {
	if _, err := s.Owned(userID, projectID); err != nil {
		return nil, err
	}
	opIDs := make([]string, 0, len(taskIDs))
	seen := make(map[string]struct{}, len(taskIDs))
	for _, raw := range taskIDs {
		taskID := strings.TrimSpace(raw)
		if taskID == "" {
			continue
		}
		if _, exists := seen[taskID]; exists {
			continue
		}
		seen[taskID] = struct{}{}
		opIDs = append(opIDs, chapterApplyOpID(taskID))
		if len(opIDs) >= maxChapterApplyReceiptQuery {
			break
		}
	}
	records, err := s.repo.AgentOpRecordsForUser(userID, opIDs)
	if err != nil {
		return nil, err
	}
	receipts := make([]ChapterApplyReceiptView, 0, len(records))
	for _, record := range records {
		if record.Status != "succeeded" {
			continue
		}
		kind := ""
		switch record.Op {
		case ChapterApplyOpStoryboard:
			kind = chapterApplyKindStoryboard
		case ChapterApplyOpCharacters:
			kind = chapterApplyKindCharacters
		default:
			continue
		}
		taskID := strings.TrimPrefix(record.OpID, chapterApplyOpIDPrefix)
		if taskID == "" || taskID == record.OpID {
			continue
		}
		var stored chapterApplyReceipt
		if json.Unmarshal([]byte(record.ResultJSON), &stored) != nil || stored.TaskID != taskID || stored.UnitID == "" || stored.Kind != kind || stored.ProjectID == "" {
			return nil, kernel.NewAppError(kernel.CodeInternal, "The saved write record cannot be read, please try again later.")
		}
		if stored.ProjectID != projectID {
			continue
		}
		receipts = append(receipts, ChapterApplyReceiptView{TaskID: taskID, Op: record.Op, Kind: kind, Applied: true})
	}
	return receipts, nil
}

func (source chapterApplySource) runRequest(userID string) operations.RunRequest {
	return operations.RunRequest{UserID: userID, OpID: source.OpID, Op: source.Op, PayloadHash: source.PayloadHash}
}

func storyboardApplyPayloadFromRequest(unitID string, shots []ReplaceProjectUnitShotInput) storyboardApplyPayload {
	payload := storyboardApplyPayload{UnitID: unitID, Shots: make([]storyboardApplyShot, 0, len(shots))}
	for _, shot := range shots {
		payload.Shots = append(payload.Shots, storyboardApplyShot{
			Title:           strings.TrimSpace(shot.Title),
			Description:     strings.TrimSpace(shot.Description),
			DurationMs:      shot.DurationMs,
			Revision:        shot.Revision,
			AssetVersionIDs: append([]string(nil), shot.AssetVersionIDs...),
		})
	}
	return payload
}

func characterApplyPayloadFromRequest(req CreateAssetCandidatesRequest) characterApplyPayload {
	payload := characterApplyPayload{Source: strings.TrimSpace(req.Source), Candidates: make([]characterApplyCandidate, 0, len(req.Candidates))}
	for _, candidate := range req.Candidates {
		payload.Candidates = append(payload.Candidates, characterApplyCandidate{
			UnitID:   strings.TrimSpace(candidate.UnitID),
			ShotID:   strings.TrimSpace(candidate.ShotID),
			Name:     strings.TrimSpace(candidate.Name),
			Category: strings.TrimSpace(candidate.Category),
			Details:  candidate.Details,
		})
	}
	return payload
}

func unmarshalChapterApplyReceipt(raw []byte) (chapterApplyReceipt, error) {
	var stored chapterApplyReceipt
	if err := json.Unmarshal(raw, &stored); err != nil {
		return chapterApplyReceipt{}, kernel.NewAppError(kernel.CodeInternal, "Written receipt cannot be read")
	}
	return stored, nil
}

func marshalChapterApplyReceipt(receipt chapterApplyReceipt) ([]byte, error) {
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return nil, kernel.BadAuthRequest("Write receipt cannot be saved")
	}
	return encoded, nil
}

func mapChapterApplyWriteError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, repository.ErrProjectUnitShotsChanged) {
		return &kernel.AppError{
			Status:  kernel.CodeConflict,
			Code:    kernel.CodeConflict,
			Reason:  kernel.ReasonProjectUnitShotsChanged,
			Message: "The storyboard of this chapter has changed, please refresh and confirm again.",
			Cause:   err,
		}
	}
	if errors.Is(err, repository.ErrProjectRevisionConflict) {
		return &kernel.AppError{
			Status:  kernel.CodeConflict,
			Code:    kernel.CodeConflict,
			Reason:  kernel.ReasonProjectRevisionConflict,
			Message: "The project has been updated by other operations, please reload before saving.",
			Cause:   err,
		}
	}
	var opErr *operations.Error
	if errors.As(err, &opErr) {
		return mapChapterApplyOperationsError(opErr)
	}
	return mapProjectWriteError(err)
}

func mapChapterApplyOperationsError(err *operations.Error) error {
	message := err.Message
	code := operations.HTTPStatus(err.Code)
	appCode := code
	switch err.Reason {
	case "operation_id_reused_with_different_payload":
		message = "This result has been written according to the content of another copy and cannot be overwritten."
		appCode = kernel.CodeIdempotencyConflict
	case "operation_in_progress":
		message = "The same write is in progress, please try again later"
	}
	return &kernel.AppError{
		Status:  code,
		Code:    appCode,
		Reason:  kernel.ErrorReason(err.Reason),
		Message: message,
		Cause:   err,
	}
}

func generationTaskMetadata(inputJSON string) map[string]any {
	if strings.TrimSpace(inputJSON) == "" {
		return map[string]any{}
	}
	var input struct {
		Metadata map[string]any `json:"metadata"`
	}
	if json.Unmarshal([]byte(inputJSON), &input) != nil || input.Metadata == nil {
		return map[string]any{}
	}
	return input.Metadata
}

func metadataString(metadata map[string]any, key string) string {
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}
