package capability

import "sync"

const (
	maxAgentNodeTitleRunes   = 240
	maxAgentNodeContentRunes = 16000
)

var (
	sharedRegistryOnce sync.Once
	sharedRegistry     *Registry
)

func BuiltinRegistry() *Registry {
	sharedRegistryOnce.Do(func() {
		sharedRegistry = newBuiltinRegistry()
	})
	return sharedRegistry
}

func SharedRegistry() *Registry {
	return BuiltinRegistry()
}

func newBuiltinRegistry() *Registry {
	registry, err := NewRegistry([]Descriptor{
		{
			Type: "text", Version: "1", Label: "text", DefaultWidth: 340, DefaultHeight: 240,
			Purpose:     "Contains general instructions, creative drafts, and single paragraph prompts.",
			GoodFor:     []string{"single idea", "one-time prompt word", "Temporary remarks", "quick test"},
			NotIdealFor: []string{"multi-camera script", "Content that needs to be modified shot by shot", "Content that requires shot-level asset relationships"},
			Tradeoffs:   []string{"Create and edit the most lightweight", "No shot-level fields and shot-by-shot maintenance capabilities"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Text", "Node text"),
			CreateMetadata: func(content string) map[string]any {
				return map[string]any{"content": content, "status": "idle", "fontSize": float64(14)}
			},
		},
		{
			Type: "markdown", Version: "1", Label: "Markdown", DefaultWidth: 420, DefaultHeight: 320,
			Purpose:     "Hosts human-readable plans, script drafts, and formatted documents.",
			GoodFor:     []string{"Creative solutions", "draft script", "Delivery documents", "Long text that needs formatting"},
			NotIdealFor: []string{"Multi-camera content that requires shot-by-shot generation or review", "Requires a structured process for binding media assets"},
			Tradeoffs:   []string{"Good for reading and exporting", "Low level of structure and cannot replace maintainable storyboards"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Markdown text", "Markdown text"),
		},
		generatedMediaDescriptor("image", "3", "pictures", 720, 405, "image", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "upscale-result"},
		}),
		generatedMediaDescriptor("video", "3", "video", 720, 405, "video", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "video", "audio", "upscale-result"},
		}),
		{
			Type: "upscale", Version: "1", Label: "AI super score", DefaultWidth: 420, DefaultHeight: 240,
			Purpose:   "Batch processes images and videos on the left, and delivers results via independent media nodes on the right.",
			InputKind: "upscale-result", Connection: ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image", "video"}},
			CanUpdate: true, SummaryFields: []string{"upscale", "upscaleBatch"}, DetailFields: []string{"upscale", "upscaleBatch"},
			PatchFields:    map[string]PatchField{"title": {Path: "title", Kind: patchKindString, Label: "Node name", Order: 10, Description: "Super-resolution processing node name", MaxRunes: maxAgentNodeTitleRunes}},
			CreateMetadata: func(string) map[string]any { return map[string]any{"status": "idle"} },
		},
		generatedMediaDescriptor("audio", "3", "Audio", 340, 120, "audio", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, MaxInputCount: 1, AcceptedInputKinds: []string{"text"},
		}),
		{
			Type: "frame", Version: "1", Label: "backplane", DefaultWidth: 760, DefaultHeight: 520,
			Purpose:       "A canvas area that organizes a group of related nodes.",
			GoodFor:       []string{"Organize nodes by scene", "Divide work areas"},
			NotIdealFor:   []string{"Carrying structured lens data", "Replace specific business nodes"},
			Tradeoffs:     []string{"Improves spatial organization without adding content structure or generative capabilities"},
			SummaryFields: []string{"label"}, DetailFields: []string{"label"},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
			},
		},
		{
			Type: "batch-table", Version: "1", Label: "Batch creation table", DefaultWidth: 1280, DefaultHeight: 560,
			Purpose:     "A structured task sheet for e-commerce batch dressing and creative image production; each row is bound to up to six groups of canvas images, and independent prompt words can be written using references such as @Reference Picture 1. Global prompt words can also be set to cover each row and the generated results can be tracked.",
			GoodFor:     []string{"Product and model batch change", "Multiple scene creative pictures of the same product", "Combination generation of multiple sets of reference images", "Batch result tracking and failure retry"},
			NotIdealFor: []string{"General database or inventory management", "Quick test on a single image", "Multi-camera narrative continuity"},
			Tradeoffs:   []string{"The reference image must first be entered into the canvas as an image node.", "Batch submission will generate multiple generation tasks, and the model, quantity and cost must be confirmed before execution."},
			Actions:     []string{"read_rows", "append_row", "update_row", "remove_row", "set_operation", "set_concurrency", "add_reference_column", "remove_reference_column", "set_global_prompt", "preview_batch_generation"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image"}},
			CanUpdate:   true, SummaryFields: []string{"batchTable"}, DetailFields: []string{"batchTable"}, ProjectionKind: "batch_table", ProjectionField: "batchTable",
			PatchFields: map[string]PatchField{
				"title": {Path: "title", Kind: patchKindString, Label: "Node name", Order: 10, Description: "Create table titles in batches", MaxRunes: maxAgentNodeTitleRunes},
			},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{
					"status": "idle",
					"batchTable": map[string]any{
						"operation": "try_on", "concurrency": float64(10),
						"referenceColumns": []any{
							map[string]any{"id": "reference-1", "label": "Reference Figure 1"},
							map[string]any{"id": "reference-2", "label": "Reference Figure 2"},
							map[string]any{"id": "reference-3", "label": "Reference Figure 3"},
						},
						"rows": []any{},
					},
				}
			},
		},
		{
			Type: "script", Version: "1", Label: "Storyboard", DefaultWidth: 920, DefaultHeight: 360,
			Purpose:       "Maintain structured multi-shot scripts that support shot-level review, modification and media correlation.",
			GoodFor:       []string{"Multi-lens planning", "shot continuity", "Shot-by-shot review and fine-tuning", "Generate pictures or videos shot by shot", "Content that needs to be taken over and maintained by others"},
			NotIdealFor:   []string{"Quick test with only one screen", "One-time temporary prompt word", "Only need to read the typesetting of ordinary documents"},
			Tradeoffs:     []string{"The initial entry cost is higher than that of text nodes", "But it can retain the lens-level structure, asset relationships and subsequent maintenance capabilities."},
			Actions:       []string{"read_rows", "append_row", "update_row", "remove_row", "generate_storyboard"},
			SummaryFields: []string{"storyboard"}, DetailFields: []string{"storyboard"}, ProjectionKind: "storyboard", ProjectionField: "storyboard",
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": []any{}, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{}}}
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return registry
}

func generatedMediaDescriptor(nodeType, version, label string, width, height float64, generationMode string, connection ConnectionPolicy) Descriptor {
	semantics := generatedMediaSemantics(nodeType)
	return Descriptor{
		Type: nodeType, Version: version, Label: label, DefaultWidth: width, DefaultHeight: height,
		Purpose: semantics.Purpose, GoodFor: semantics.GoodFor, NotIdealFor: semantics.NotIdealFor,
		Tradeoffs: semantics.Tradeoffs, Actions: semantics.Actions,
		InputKind: nodeType, GenerationMode: generationMode, Connection: connection, CanUpdate: true,
		SummaryFields:  []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
		DetailFields:   []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
		PatchFields:    generatedDraftFields(nodeType),
		CreateMetadata: generatedMetadata,
	}
}

func generatedDraftFields(kind string) map[string]PatchField {
	fields := editableNodeFields("metadata.composerContent", "Prompt word for next edition", "Next time, a draft of the prompt word will be generated and the existing finished product will not be overwritten.")
	fields["prompt"] = PatchField{
		Path: "metadata.composerContent", Kind: patchKindString, Label: "Generate prompt word draft", Order: 25,
		Description: "Next time, a draft of the prompt word will be generated and the existing finished product will not be overwritten.", MaxRunes: maxAgentNodeContentRunes,
	}
	names := []string{"model"}
	switch kind {
	case "image":
		names = append(names, "size", "quality", "transparentBackground")
		fields["count"] = PatchField{Path: "metadata.count", Kind: patchKindNumber, Label: "Generate quantity", Order: 30}
	case "video":
		names = append(names, "size", "seconds", "vquality", "generateAudio", "watermark", "videoEditOperation")
	case "audio":
		names = append(names, "audioVoice", "audioFormat", "audioSpeed", "audioPitch", "audioVolume", "audioInstructions")
	}
	for index, name := range names {
		max := 256
		if name == "audioInstructions" {
			max = 4096
		}
		fields[name] = PatchField{Path: "metadata." + name, Kind: patchKindString, Label: name, Order: 40 + index,
			Description: "Draft parameters", MaxRunes: max}
	}
	return fields
}

type generatedMediaCapabilitySemantics struct {
	Purpose     string
	GoodFor     []string
	NotIdealFor []string
	Tradeoffs   []string
	Actions     []string
}

func generatedMediaSemantics(nodeType string) generatedMediaCapabilitySemantics {
	switch nodeType {
	case "image":
		return generatedMediaCapabilitySemantics{
			Purpose:     "Generate or host a still picture and serve as real reference material for subsequent picture or video generation.",
			GoodFor:     []string{"Single picture generation", "Picture generation with reference pictures", "Storyboard first frame and key frame", "Visual materials that need to be reused"},
			NotIdealFor: []string{"Hosting multi-shot script structures", "Express camera movement or time changes", "Maintain shot continuity instead of storyboard"},
			Tradeoffs:   []string{"A node corresponds to a static media target", "The number of reference images and the generation method must be matched by the model catalog capabilities."},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "video":
		return generatedMediaCapabilitySemantics{
			Purpose:     "Generate or carry a continuous video clip; can perform Vincent Video, Graphic Video or Multi-Graphic Video based on actual reference material.",
			GoodFor:     []string{"Single shot Vincent video", "Single Tusheng Video", "Multi-picture reference video", "Video generation with existing video or audio participation"},
			NotIdealFor: []string{"Hosts entire multi-camera script", "Replace shot-by-shot review and maintenance with one node", "Model capabilities are not queried and assumed to support any number of references"},
			Tradeoffs:   []string{"A node usually corresponds to a video clip that can be independently generated and reviewed", "Reference type, quantity, duration, frame, audio and price are subject to current model catalog"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "audio":
		return generatedMediaCapabilitySemantics{
			Purpose:     "Generate or host an audio material for use as voiceover, music, sound effects or video reference input.",
			GoodFor:     []string{"text to speech", "Dubbing", "Music or sound effects material", "Provide audio reference for video"},
			NotIdealFor: []string{"Bearing storyboard structure", "express picture composition or camera movement", "instead of video node"},
			Tradeoffs:   []string{"One node corresponds to one audio target and can receive at most one text input.", "Audio type, duration and price are still subject to model catalog and task access"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	default:
		return generatedMediaCapabilitySemantics{}
	}
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	return map[string]PatchField{
		"title": {
			Path: "title", Kind: patchKindString, Label: "Node name", Order: 10, Description: "Node title", MaxRunes: maxAgentNodeTitleRunes,
		},
		"content": {
			Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes,
		},
	}
}

func generatedMetadata(prompt string) map[string]any {
	return map[string]any{"content": "", "prompt": prompt, "composerContent": prompt, "status": "idle"}
}
