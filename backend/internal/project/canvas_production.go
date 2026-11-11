package project

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"
)

type CanvasProductionContext struct {
	ProjectID         string `json:"projectId"`
	CanvasID          string `json:"canvasId"`
	UnitID            string `json:"unitId"`
	ShotID            string `json:"shotId"`
	ShotRevisionID    string `json:"shotRevisionId"`
	StepKey           string `json:"stepKey"`
	WorkflowStepID    string `json:"workflowStepId"`
	ArtifactType      string `json:"artifactType"`
	Linked            bool   `json:"linked"`
	WorkflowAvailable bool   `json:"workflowAvailable"`
}

type CanvasProductionTaskRequest struct {
	UnitID         string `json:"unitId"`
	ShotID         string `json:"shotId"`
	ShotRevisionID string `json:"shotRevisionId"`
	StepKey        string `json:"stepKey"`
	TaskID         string `json:"taskId"`
	ResourceID     string `json:"resourceId,omitempty"`
}

type CanvasProductionTaskResult struct {
	Context    CanvasProductionContext    `json:"context"`
	Step       model.WorkflowStepInstance `json:"step"`
	TaskID     string                     `json:"taskId"`
	ResourceID string                     `json:"resourceId"`
}

func productionError(reason, message string) error {
	return &kernel.AppError{Status: 409, Code: 409, Reason: kernel.ErrorReason(reason), Message: message}
}

// Reading a proposed association never creates workflow rows or moves a canvas.
func (s *Service) CanvasProductionContext(userID, projectID, canvasID, unitID, shotID, stepKey string) (CanvasProductionContext, error) {
	if strings.TrimSpace(unitID) == "" {
		return CanvasProductionContext{}, kernel.BadAuthRequest("Please select a chapter to create")
	}
	if _, err := s.Active(userID, projectID); err != nil {
		return CanvasProductionContext{}, err
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, strings.TrimSpace(canvasID))
	if err != nil {
		return CanvasProductionContext{}, err
	}
	if canvas.ProjectID != "" && canvas.ProjectID != projectID {
		return CanvasProductionContext{}, productionError("production_canvas_project_conflict", "The canvas already belongs to other projects, please clearly adjust the ownership first.")
	}
	shot, err := s.repo.ShotForProject(projectID, strings.TrimSpace(shotID))
	if err != nil {
		return CanvasProductionContext{}, err
	}
	if shot.UnitID != strings.TrimSpace(unitID) || shot.CurrentRevisionID == "" {
		return CanvasProductionContext{}, kernel.BadAuthRequest("Shot does not belong to selected chapter or no version is available")
	}
	artifact := workflowArtifactType(stepKey)
	if artifact == "" {
		return CanvasProductionContext{}, kernel.BadAuthRequest("Please select storyboard, pre-show, video or delivery stage")
	}
	result := CanvasProductionContext{ProjectID: projectID, CanvasID: canvas.ID, UnitID: shot.UnitID, ShotID: shot.ID, ShotRevisionID: shot.CurrentRevisionID, StepKey: strings.TrimSpace(stepKey), ArtifactType: artifact}
	if _, err := s.repo.CanvasUnitLink(projectID, canvas.ID, shot.UnitID); err == nil {
		result.Linked = true
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasProductionContext{}, err
	}
	workflows, err := s.workflowDetails(projectID)
	if err != nil {
		return CanvasProductionContext{}, err
	}
	for _, workflow := range workflows {
		if workflow.Instance.UnitID == shot.UnitID && workflow.Instance.Scope == "unit" {
			for _, step := range workflow.Steps {
				if step.StepKey == result.StepKey {
					result.WorkflowAvailable = true
					result.WorkflowStepID = step.ID
					return result, nil
				}
			}
		}
	}
	return result, nil
}

// Attach an already generated, local-ready canvas output to existing production
// records. This operation never creates, retries, downloads or dispatches a task.
func (s *Service) RegisterCanvasProductionTask(userID, projectID, canvasID string, req CanvasProductionTaskRequest) (CanvasProductionTaskResult, error) {
	var result CanvasProductionTaskResult
	err := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		bound := New(repository.New(tx), Dependencies{})
		current, err := bound.CanvasProductionContext(userID, projectID, canvasID, req.UnitID, req.ShotID, req.StepKey)
		if err != nil {
			return err
		}
		if strings.TrimSpace(req.ShotRevisionID) == "" || req.ShotRevisionID != current.ShotRevisionID {
			return productionError("production_revision_conflict", "The lens has changed, please check the current version and reconfirm the association.")
		}
		task, err := bound.repo.TaskForUser(userID, strings.TrimSpace(req.TaskID))
		if err != nil {
			return err
		}
		if task.ProjectID != canvasID {
			return productionError("production_task_canvas_mismatch", "Can only be associated with the generation task of the current canvas")
		}
		if task.Status != model.TaskStatusSucceeded {
			return productionError("production_output_not_ready", "The original task has not been completed, please wait for the result of the original task")
		}
		outputs := localtask.CanonicalOutputs(task.ResultJSON, task.Type)
		resourceID, mediaType := "", ""
		for _, output := range outputs {
			if req.ResourceID != "" && output.ResourceID != req.ResourceID {
				continue
			}
			if req.ResourceID == "" && len(outputs) > 1 {
				return productionError("production_output_selection_required", "This task has multiple products, please clearly select the material to be associated")
			}
			resourceID = output.ResourceID
			mediaType = output.MediaType
			break
		}
		if resourceID == "" {
			return productionError("production_output_not_ready", "The original task has no locally available materials. Please restore the original task results and then connect again.")
		}
		resource, err := bound.repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return err
		}
		if resource.Status != model.ResourceStatusReady {
			return productionError("production_output_not_ready", "The material is still being downloaded or saved, please wait for the original material to be restored.")
		}
		if resource.Kind != mediaType {
			return productionError("production_output_type_mismatch", "The type verification of the original task material failed.")
		}
		if ((current.StepKey == "storyboard" || current.StepKey == "previz") && mediaType != "image") || ((current.StepKey == "video" || current.StepKey == "delivery") && mediaType != "video") {
			return productionError("production_output_type_mismatch", "The selected material type is inconsistent with the production stage")
		}
		links, err := bound.repo.ProductionLinksForTask(task.ID)
		if err != nil {
			return err
		}
		for _, link := range links {
			if link.ProjectID != projectID || link.ShotID != current.ShotID || link.ArtifactType != current.ArtifactType {
				return productionError("production_task_already_linked", "This task already has other production records, please use the materials in that record")
			}
		}
		artifacts, err := bound.repo.ShotArtifactsForTask(task.ID)
		if err != nil {
			return err
		}
		for _, artifact := range artifacts {
			if artifact.ResourceID != resourceID {
				return productionError("production_task_already_linked", "This task is associated with other products, please use existing production records")
			}
			if artifact.RevisionID != current.ShotRevisionID {
				return productionError("production_output_revision_mismatch", "This task has been registered in the old lens version, and the original footage is still retained. Please check the existing production records.")
			}
		}
		if !current.Linked {
			if _, err = bound.LinkCanvasUnit(userID, projectID, LinkCanvasUnitRequest{CanvasID: canvasID, UnitID: current.UnitID, Role: "storyboard"}); err != nil {
				return err
			}
		}
		if !current.WorkflowAvailable {
			if _, err = bound.CreateUnitWorkflow(userID, projectID, current.UnitID); err != nil {
				return err
			}
		}
		current, err = bound.CanvasProductionContext(userID, projectID, canvasID, current.UnitID, current.ShotID, current.StepKey)
		if err != nil {
			return err
		}
		versionID, err := bound.EnsureGeneratedProjectAsset(userID, projectID, task.ID, current.ShotID, resourceID, mediaType, task.Prompt)
		if err != nil {
			return err
		}
		step, err := bound.RegisterTaskOutput(userID, projectID, current.WorkflowStepID, RegisterTaskOutputRequest{TaskID: task.ID, CanvasID: canvasID, UnitID: current.UnitID, ShotID: current.ShotID, ShotRevisionID: current.ShotRevisionID, ArtifactType: current.ArtifactType, ResourceID: resourceID, MediaType: mediaType, AssetVersionID: versionID, Role: "output", MetadataJSON: `{"source":"canvas_explicit_assignment"}`})
		if err != nil {
			return err
		}
		result = CanvasProductionTaskResult{Context: current, Step: step, TaskID: task.ID, ResourceID: resourceID}
		return nil
	})
	return result, err
}
