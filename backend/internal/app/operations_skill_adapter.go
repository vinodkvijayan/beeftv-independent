package app

import (
	"context"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/operations"
	"infinite-canvas/backend/internal/skills"
)

func (s *Service) ValidateAgentSkills(userID string, pins []skills.Pin) ([]skills.Pin, error) {
	domain := s.skillDomain()
	validated, err := domain.ValidateAgentSkills(userID, pins)
	if err != nil {
		return nil, err
	}
	for _, pin := range validated {
		if err := s.checkAgentSkillRequirements(domain, userID, pin); err != nil {
			return nil, err
		}
	}
	return validated, nil
}
func (s *operationSession) AgentSkillVersion(userID string, pin skills.Pin) (*skills.AgentResource, error) {
	if err := s.service.checkAgentSkillRequirements(s.service.skillDomain(), userID, pin); err != nil { return nil, err }
	return s.service.skillDomain().AgentVersion(userID, pin)
}
func (s *operationSession) AgentSkillFile(userID string, pin skills.Pin, path string) (*skills.AgentFile, error) {
	if err := s.service.checkAgentSkillRequirements(s.service.skillDomain(), userID, pin); err != nil { return nil, err }
	return s.service.skillDomain().AgentFile(userID, pin, path)
}
func (s *operationSession) AgentSkillCatalog(userID string) ([]skills.AgentCatalogItem, error) { return s.service.skillDomain().AgentCatalog(userID) }
func (s *operationSession) ProposeOrRunSkillScript(ctx context.Context, userID, turnID string, req skills.ScriptRunRequest) (any, error) {
	if err := s.service.checkAgentSkillRequirements(s.service.skillDomain(), userID, req.Pin); err != nil { return nil, err }
	return operations.ProposeOrRunSkillScript(ctx, s.repo.DB(), s.service.skillDomain().WithRepo(s.repo), userID, turnID, req)
}
func (s *Service) checkAgentSkillRequirements(domain *skills.Service, userID string, pin skills.Pin) error {
	required, err := domain.AgentRequirements(userID, pin)
	if err != nil {
		return err
	}
	for _, capability := range required {
		var message string
		switch capability {
		case "beeftv.canvas":
			continue
		case "model.audio", "model.video":
			if snapshot, err := s.assistantConfig(); err == nil {
				if _, reason := modelcatalog.ResolveMediaReviewProvider(snapshot, s.assistantManagedCredentialLookup()); reason == "" {
					continue
				}
			}
			message = "This skill requires audio and video understanding skills. Please select an available default multimodal model in the model configuration before using this skill."
		case "model.image":
			message = "Unable to confirm image input support for the current model. Please choose skills that do not require picture understanding for now."
		default:
			message = "This skill requires yet-to-be-confirmed abilities:" + capability
		}
		return &kernel.AppError{Status: 409, Code: 409, Reason: "skill_capability_unavailable", Message: message}
	}
	return nil
}
