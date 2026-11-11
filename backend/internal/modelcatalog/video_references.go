package modelcatalog

import (
	"fmt"
	"infinite-canvas/backend/internal/kernel"
)

func videoTaskOperation(profile *VideoCapabilityConfig, input TaskInput) string {
	if metadataString(input.Metadata, "videoDraftTaskId") != "" {
		return "draft_to_final"
	}
	if operation := metadataString(input.Metadata, "videoEditOperation"); operation != "" {
		return operation
	}
	if len(input.ReferenceImages) > 0 {
		return "image_to_video"
	}
	return profile.DefaultOperation
}

func videoReferencesForOperation(profile *VideoCapabilityConfig, operation string) VideoReferenceConfig {
	refs := profile.References
	limits := profile.OperationReferences[operation]
	if limits.MinImages != nil {
		refs.MinImages = *limits.MinImages
	}
	if limits.MaxImages != nil {
		refs.MaxImages = *limits.MaxImages
	}
	if limits.MaxVideos != nil {
		refs.MaxVideos = *limits.MaxVideos
	}
	if limits.MaxAudios != nil {
		refs.MaxAudios = *limits.MaxAudios
	}
	return refs
}

func validateVideoReferenceCounts(refs VideoReferenceConfig, input TaskInput) error {
	if len(input.ReferenceImages) > refs.MaxImages {
		return kernel.BadAuthRequest(fmt.Sprintf("The current generation mode supports up to %d reference images.", refs.MaxImages))
	}
	if len(input.ReferenceVideos) > refs.MaxVideos {
		return kernel.BadAuthRequest(fmt.Sprintf("The current generation mode supports up to %d reference videos", refs.MaxVideos))
	}
	if len(input.ReferenceAudios) > refs.MaxAudios {
		return kernel.BadAuthRequest(fmt.Sprintf("The current generation mode supports at most %d segments of reference audio.", refs.MaxAudios))
	}
	if len(input.ReferenceImages) < refs.MinImages {
		return kernel.BadAuthRequest(fmt.Sprintf("The current generation mode requires at least %d reference images", refs.MinImages))
	}
	return nil
}
