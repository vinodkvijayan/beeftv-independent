package canvas

import (
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

// StoryboardPreparation creates the production drafts for existing, authored
// rows. It does not submit generation or replace any existing output.
type StoryboardPreparation struct {
	Script           *StoryboardDraft
	RowIDs           []string
	Image, Video     map[string]any
	ImageTitle       string
	VideoTitle       string
	ReferenceNodeIDs []string
}

type StoryboardDraft struct {
	Title string               `json:"title"`
	Rows  []StoryboardRowDraft `json:"rows"`
}

type PreparedStoryboardShot struct {
	RowID       string `json:"rowId"`
	ImageNodeID string `json:"imageNodeId,omitempty"`
	VideoNodeID string `json:"videoNodeId,omitempty"`
}

type StoryboardPreparationResult struct {
	ScriptNodeID   string                   `json:"scriptNodeId,omitempty"`
	Created        []CreatedNode            `json:"created"`
	CreatedEdgeIDs []string                 `json:"createdEdgeIds"`
	Shots          []PreparedStoryboardShot `json:"shots"`
}

// PrepareUserCanvasStoryboard creates, configures, lays out and binds one batch
// in a single canvas revision. A failed row cannot leave half a production graph.
func (s *Service) PrepareUserCanvasStoryboard(userID, canvasID, nodeID string, input StoryboardPreparation, expectedRevision int64) (UserDataSummary, StoryboardPreparationResult, error) {
	result := StoryboardPreparationResult{Created: []CreatedNode{}, CreatedEdgeIDs: []string{}, Shots: []PreparedStoryboardShot{}}
	fail := func(message string) (UserDataSummary, StoryboardPreparationResult, error) {
		return UserDataSummary{}, StoryboardPreparationResult{}, kernel.NewAppError(http.StatusBadRequest, message)
	}
	if err := requireExpectedRevision(expectedRevision); err != nil {
		return UserDataSummary{}, result, err
	}
	if (input.Script == nil && len(input.RowIDs) < 1) || len(input.RowIDs) > 8 || len(input.ReferenceNodeIDs) > 4 || (input.Script == nil && len(input.Image) == 0 && len(input.Video) == 0) {
		return fail("Please select 1..8 storyboards and picture or video parameters, with a maximum of 4 reference pictures.")
	}
	if len(input.Image) == 0 && len(input.ReferenceNodeIDs) > 0 {
		return fail("Character or style reference is used for the first frame of the image; the video uses its own first frame for each storyboard")
	}
	var doc, storyboard map[string]any
	var rows []any
	var err error
	if input.Script == nil {
		doc, storyboard, rows, err = s.loadStoryboardRows(userID, canvasID, nodeID)
	} else {
		if nodeID != "" || len(input.RowIDs) > 0 || len(input.Script.Rows) > 8 {
			return fail("Please choose one between new storyboard and existing storyboard.")
		}
		if err := requireStoryboardRows(input.Script.Rows); err != nil {
			return UserDataSummary{}, result, err
		}
		doc, err = s.loadCanvasDoc(userID, canvasID)
		if err == nil {
			result.Created, err = createCanvasNodes(doc, []NodeDraft{{Title: input.Script.Title, Type: storyboardNodeType}})
		}
		if err == nil {
			nodeID = result.Created[0].ID
			result.ScriptNodeID = nodeID
			metadata := findCanvasNode(doc, nodeID)["metadata"].(map[string]any)
			storyboard = metadata["storyboard"].(map[string]any)
			for i, draft := range input.Script.Rows {
				row := buildStoryboardRow(i+1, draft)
				if plot, _ := row["plotDescription"].(string); strings.TrimSpace(plot) == "" {
					if imgPrompt, _ := row["imageGenerationPrompt"].(string); strings.TrimSpace(imgPrompt) != "" {
						row["plotDescription"] = strings.TrimSpace(imgPrompt)
					}
				}
				rows = append(rows, row)
				input.RowIDs = append(input.RowIDs, rowIDOf(row))
			}
		}
	}
	if err != nil {
		return UserDataSummary{}, result, err
	}
	seenReferences := map[string]bool{}
	for _, id := range input.ReferenceNodeIDs {
		if seenReferences[id] {
			return fail("Reference image duplication:" + id)
		}
		seenReferences[id] = true
		if node := findCanvasNode(doc, id); node == nil || canvasNodeType(node) != "image" {
			return fail("The reference picture is not in the current canvas:" + id)
		}
	}
	seen := map[string]bool{}
	rowReferences := map[string][]string{}
	for _, id := range input.RowIDs {
		row := findStoryboardRow(rows, id)
		if row == nil || seen[id] {
			return fail("The storyboard does not exist or is duplicated:" + id)
		}
		seen[id] = true
		refs, refErr := storyboardPreparationReferences(doc, storyboard, row, nodeID, input.ReferenceNodeIDs)
		if refErr != nil {
			return fail(refErr.Error())
		}
		rowReferences[id] = refs
		if len(input.Video) > 0 {
			seconds, ok := row["durationSeconds"].(float64)
			if !ok || math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < StoryboardMinShotSeconds || seconds > StoryboardMaxShotSeconds {
				return fail("Please fill in the valid storyboard duration first")
			}
		}
		for _, kind := range []string{"image", "video"} {
			patch := input.Image
			promptField := "imageGenerationPrompt"
			if kind == "video" {
				patch = input.Video
				promptField = "videoMotionPrompt"
			}
			if len(patch) == 0 {
				continue
			}
			if bound, _ := row[kind+"NodeId"].(string); bound != "" {
				return fail("Storyboard already available" + kind + "Node, please modify the original node instead of re-creating it")
			}
			if kind == "image" {
				if prompt, _ := row[promptField].(string); strings.TrimSpace(prompt) == "" {
					if plot, _ := row["plotDescription"].(string); strings.TrimSpace(plot) != "" {
						row[promptField] = strings.TrimSpace(plot)
					}
				}
			}
			if prompt, _ := row[promptField].(string); strings.TrimSpace(prompt) == "" {
				return fail("Storyboard missing" + promptField)
			}
		}
		if len(input.Video) > 0 && len(input.Image) == 0 {
			if id, _ := row["imageNodeId"].(string); id != "" {
				if node := findCanvasNode(doc, id); node == nil || canvasNodeType(node) != "image" {
					return fail("The first frame node of the storyboard no longer exists. Please correct the binding first.")
				}
			} else if len(refs) > 0 {
				return fail("This storyboard already has character or material references. Please prepare the first frame before making the video.")
			}
		}
	}
	// Two columns, one row per shot. Start to the right of all existing nodes;
	// the canvas remains legible instead of growing one long horizontal strip.
	x := 120.0
	for _, raw := range canvasDocNodes(doc) {
		if node, ok := raw.(map[string]any); ok {
			position, _ := node["position"].(map[string]any)
			left, _ := position["x"].(float64)
			width, _ := node["width"].(float64)
			if width <= 0 {
				if d, ok := canvasCapabilityRegistry.Resolve(canvasNodeType(node)); ok {
					width = d.DefaultWidth
				}
			}
			if right := left + width + nodePlacementGap; right > x {
				x = right
			}
		}
	}
	connect := func(from, to, rowID string) {
		id := newStoryboardEdgeID()
		edges, _ := doc["connections"].([]any)
		doc["connections"] = append(edges, map[string]any{"id": id, "fromNodeId": from, "toNodeId": to, "relation": "storyboard-asset-reference", "storyboardRowId": rowID})
		result.CreatedEdgeIDs = append(result.CreatedEdgeIDs, id)
	}
	if err := checkStoryboardTemplateTitles(doc, rows, input); err != nil {
		return UserDataSummary{}, result, err
	}
	imageWidth, imageHeight := storyboardDraftSize(input.Image)
	videoWidth, videoHeight := storyboardDraftSize(input.Video)
	rowStride := math.Max(imageHeight, videoHeight) + 80
	videoSizes := map[string][2]float64{}
	for _, id := range input.RowIDs {
		width, height := videoWidth, videoHeight
		if size, _ := input.Video["size"].(string); size == "" || size == "auto" {
			if len(input.Image) > 0 {
				width, height = imageWidth, imageHeight
			} else if row := findStoryboardRow(rows, id); row != nil {
				frameID, _ := row["imageNodeId"].(string)
				if frame := findCanvasNode(doc, frameID); frame != nil {
					w, _ := frame["width"].(float64)
					h, _ := frame["height"].(float64)
					if w > 0 && h > 0 {
						width, height = storyboardDraftSize(map[string]any{"size": fmt.Sprintf("%g:%g", w, h)})
					}
				}
			}
		}
		videoSizes[id] = [2]float64{width, height}
		rowStride = math.Max(rowStride, height+80)
	}
	for index, id := range input.RowIDs {
		row := findStoryboardRow(rows, id)
		shot := PreparedStoryboardShot{RowID: id}
		shot.ImageNodeID, _ = row["imageNodeId"].(string)
		for _, kind := range []string{"image", "video"} {
			patch := input.Image
			promptField, label := "imageGenerationPrompt", "first frame"
			if kind == "video" {
				patch = input.Video
				promptField, label = "videoMotionPrompt", "video"
			}
			if len(patch) == 0 {
				continue
			}
			descriptor, _ := canvasCapabilityRegistry.Resolve(kind)
			prompt, _ := row[promptField].(string)
			metadata := descriptor.Metadata(prompt)
			metadata["prompt"] = prompt
			metadata["workflowKind"] = "shot"
			metadata["shotIndex"] = row["shotNumber"]
			createdID := newCanvasNodeID()
			titleTemplate := input.ImageTitle
			if kind == "video" {
				titleTemplate = input.VideoTitle
			}
			title := storyboardDraftTitle(titleTemplate, row, label)
			left, width, height := x, imageWidth, imageHeight
			if kind == "video" {
				left, width, height = x+imageWidth+80, videoSizes[id][0], videoSizes[id][1]
			}
			node := map[string]any{"id": createdID, "type": kind, "title": title, "metadata": metadata,
				"position": map[string]any{"x": left, "y": 160 + float64(index)*rowStride}, "width": width, "height": height}
			for name, value := range patch {
				if name == "title" || name == "content" || name == "prompt" {
					return fail("Generation parameters cannot override storyboard prompt words or names")
				}
				if _, exists := descriptor.PatchFields[name]; !exists {
					return fail("Unsupported build parameters:" + name)
				}
				if err := descriptor.ApplyPatch(node, map[string]any{name: value}); err != nil {
					return fail(err.Error())
				}
			}
			if kind == "video" {
				seconds, _ := row["durationSeconds"].(float64)
				metadata["seconds"] = strconv.FormatFloat(seconds, 'f', -1, 64)
				metadata["videoEditOperation"] = "text_to_video"
				if shot.ImageNodeID != "" {
					metadata["videoEditOperation"] = "image_to_video"
					metadata["videoStartFrameNodeId"] = shot.ImageNodeID
				}
			} else {
				// Each row owns one first frame, even when the global count is higher.
				metadata["count"] = float64(1)
			}
			doc["nodes"] = append(canvasDocNodes(doc), node)
			result.Created = append(result.Created, CreatedNode{ID: createdID, Title: title, Type: kind})
			edges, _, bindErr := bindStoryboardRowOutput(doc, nodeID, row, kind+"NodeId", kind, createdID)
			if bindErr != nil {
				return UserDataSummary{}, result, bindErr
			}
			result.CreatedEdgeIDs = append(result.CreatedEdgeIDs, edges...)
			if kind == "image" {
				shot.ImageNodeID = createdID
				for _, ref := range rowReferences[id] {
					connect(ref, createdID, id)
				}
			} else {
				shot.VideoNodeID = createdID
				if shot.ImageNodeID != "" {
					connect(shot.ImageNodeID, createdID, id)
				}
			}
		}
		result.Shots = append(result.Shots, shot)
	}
	summary, err := s.saveStoryboardRows(userID, canvasID, doc, storyboard, rows, expectedRevision)
	if err != nil {
		return UserDataSummary{}, StoryboardPreparationResult{}, err
	}
	return summary, result, nil
}

// These are the existing storyboard reference sources also used by the UI
// materializer. Preparation supports image references; unsupported media must
// be reported before saving rather than silently disappearing from the shot.
func storyboardPreparationReferences(doc, storyboard, row map[string]any, scriptID string, explicit []string) ([]string, error) {
	refs := []string{}
	seen := map[string]bool{}
	add := func(value any) {
		if id, ok := value.(string); ok && id != "" && id != scriptID && !seen[id] {
			seen[id] = true
			refs = append(refs, id)
		}
	}
	for _, id := range explicit {
		add(id)
	}
	if items, ok := storyboard["referenceNodeIds"].([]any); ok {
		for _, id := range items {
			add(id)
		}
	}
	if items, ok := row["assetBindings"].([]any); ok {
		for _, raw := range items {
			if binding, ok := raw.(map[string]any); ok {
				add(binding["nodeId"])
			}
		}
	}
	characters := map[string]bool{}
	if items, ok := row["characters"].([]any); ok {
		for _, raw := range items {
			if character, ok := raw.(map[string]any); ok {
				if id, ok := character["characterAssetId"].(string); ok {
					characters[id] = true
				}
			}
		}
	}
	for _, raw := range canvasDocNodes(doc) {
		if node, ok := raw.(map[string]any); ok {
			metadata, _ := node["metadata"].(map[string]any)
			assetID, _ := metadata["characterAssetId"].(string)
			if metadata["workflowKind"] == "character" && assetID != "" && characters[assetID] {
				add(node["id"])
			}
		}
	}
	if edges, ok := doc["connections"].([]any); ok {
		for _, raw := range edges {
			if edge, ok := raw.(map[string]any); ok && edge["toNodeId"] == scriptID && edge["toHandleId"] == "row:"+rowIDOf(row) {
				add(edge["fromNodeId"])
			}
		}
	}
	for _, id := range refs {
		if node := findCanvasNode(doc, id); node == nil || canvasNodeType(node) != "image" {
			return nil, fmt.Errorf("Storyboard reference %s is not available; batch preparation only supports picture reference of the current canvas", id)
		}
	}
	return refs, nil
}

var storyboardSizePattern = regexp.MustCompile(`(?i)^([0-9]+(?:\.[0-9]+)?)[x:]([0-9]+(?:\.[0-9]+)?)`)

func storyboardDraftSize(patch map[string]any) (float64, float64) {
	ratio := 16.0 / 9
	if size, ok := patch["size"].(string); ok {
		parts := storyboardSizePattern.FindStringSubmatch(strings.TrimSpace(size))
		if len(parts) == 3 {
			w, e1 := strconv.ParseFloat(parts[1], 64)
			h, e2 := strconv.ParseFloat(parts[2], 64)
			if e1 == nil && e2 == nil && w > 0 && h > 0 && w/h >= 0.25 && w/h <= 4 {
				ratio = w / h
			}
		} else if strings.Contains(size, "竖") || strings.Contains(size, "portrait") || strings.Contains(size, "9:16") {
			ratio = 9.0 / 16
		} else if strings.Contains(size, "square") || strings.Contains(size, "1:1") {
			ratio = 1
		}
	}
	// Match the actual empty-media sizing contract (720x405 base, 420x236
	// readable minimum). Smaller draft boxes are expanded on UI load and would
	// overlap their neighbours despite looking non-overlapping in the Go graph.
	width, height := 720.0, 720.0/ratio
	if ratio < 720.0/405 {
		width, height = 405*ratio, 405
	}
	scale := math.Max(1, math.Max(420/width, 236/height))
	return width * scale, height * scale
}

// storyboardDraftTitle 是分镜草稿标题的唯一出口：有模板按镜号替换 {n}，否则用默认标题。
func storyboardDraftTitle(template string, row map[string]any, label string) string {
	if template == "" {
		return fmt.Sprintf("Lens %d · %s", rowShotNumber(row), label)
	}
	return strings.ReplaceAll(template, "{n}", strconv.Itoa(rowShotNumber(row)))
}

// checkStoryboardTemplateTitles 让调用方给的标题模板遵守普通建节点的重名规则：
// 模板标题不与本批任何最终标题（含默认标题）重复，也不与画布已有标题相同。
// 不带模板的批次保持原行为。
func checkStoryboardTemplateTitles(doc map[string]any, rows []any, input StoryboardPreparation) error {
	if input.ImageTitle == "" && input.VideoTitle == "" {
		return nil
	}
	type batchTitle struct {
		title     string
		templated bool
	}
	var batch []batchTitle
	counts := map[string]int{}
	for _, id := range input.RowIDs {
		row := findStoryboardRow(rows, id)
		for _, draft := range []struct {
			template, label string
			patch           map[string]any
		}{{input.ImageTitle, "first frame", input.Image}, {input.VideoTitle, "video", input.Video}} {
			if len(draft.patch) == 0 {
				continue
			}
			title := normalizeNodeTitle(storyboardDraftTitle(draft.template, row, draft.label))
			batch = append(batch, batchTitle{title, draft.template != ""})
			counts[title]++
		}
	}
	existing := map[string]bool{}
	for _, raw := range canvasDocNodes(doc) {
		if node, ok := raw.(map[string]any); ok {
			if title, _ := node["title"].(string); title != "" {
				existing[normalizeNodeTitle(title)] = true
			}
		}
	}
	for _, item := range batch {
		if !item.templated {
			continue
		}
		if counts[item.title] > 1 {
			return kernel.NewAppError(http.StatusBadRequest, "Duplicate titles within the same batch:"+item.title)
		}
		if existing[item.title] {
			return kernel.NewAppError(http.StatusConflict, "Title already exists:"+item.title)
		}
	}
	return nil
}
