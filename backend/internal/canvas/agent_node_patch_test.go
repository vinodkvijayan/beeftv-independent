package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/kernel"
)

// 画布编辑器的提示词输入框读的是 metadata.composerContent（见
// canvas-node-prompt-panel.tsx：composerContent ?? prompt）。因此外部写入必须落到
// 描述符声明的同一路径，否则「外部改提示词」在界面上看不到，还会把生成节点的
// 媒体结果槽位 metadata.content 覆盖掉。
func TestUpdateUserCanvasNodeFieldsFollowsDescriptorPaths(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	actor := "owner"
	canvasID := "canvas-patch-paths"
	created, err := svc.UpsertUserCanvasProject(actor, json.RawMessage(`{
		"id":"canvas-patch-paths","revision":0,"title":"补丁路径",
		"nodes":[
			{"id":"img","type":"image","title":"镜头","metadata":{"content":"","prompt":"已提交提示词","composerContent":"原始草稿","promptTemplateOperation":"storyboard-image","promptTemplateVariables":{"shot":"1"},"status":"idle"}},
			{"id":"txt","type":"text","title":"文本","metadata":{"content":"正文","status":"idle"}}
		],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.UpdateUserCanvasNodeFields(actor, canvasID, "img", map[string]any{"content": "Night scene: Confrontation at the alley on a rainy night"}, created.Revision); err != nil {
		t.Fatal(err)
	}
	raw, err := svc.UserCanvasProject(actor, canvasID)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			ID       string         `json:"id"`
			Metadata map[string]any `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	image := doc.Nodes[0]
	if image.Metadata["composerContent"] != "Night scene: Confrontation at the alley on a rainy night" {
		t.Fatalf("Generate node content patch should fall to composerContent, actual %#v", image.Metadata)
	}
	if image.Metadata["promptTemplateOperation"] != nil || image.Metadata["promptTemplateVariables"] != nil {
		t.Fatalf("When modifying the draft prompt word, the old template variables should be cleared, actual %#v", image.Metadata)
	}
	if image.Metadata["prompt"] != "Prompt word submitted" {
		t.Fatalf("The content patch must not rewrite the submitted prompt word, actual %#v", image.Metadata["prompt"])
	}
	if image.Metadata["content"] != "" {
		t.Fatalf("The content patch must not cover the media result slot, actual %#v", image.Metadata["content"])
	}

	if _, err := svc.UpdateUserCanvasNodeFields(actor, canvasID, "txt", map[string]any{"content": "new text"}, created.Revision+1); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateUserCanvasNodeFields(actor, canvasID, "img", map[string]any{"prompt": "Draft prompt for next edition"}, created.Revision+2); err != nil {
		t.Fatal(err)
	}
	raw, err = svc.UserCanvasProject(actor, canvasID)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Nodes[1].Metadata["content"] != "new text" {
		t.Fatalf("Text node content patch should fall to content, actual %#v", doc.Nodes[1].Metadata)
	}
	if doc.Nodes[0].Metadata["composerContent"] != "Draft prompt for next edition" {
		t.Fatalf("prompt patch should be written to metadata.composerContent, actual %#v", doc.Nodes[0].Metadata["composerContent"])
	}
	if doc.Nodes[0].Metadata["prompt"] != "Prompt word submitted" {
		t.Fatalf("The prompt patch must not cover the historical submitted prompt words. The actual prompt is %#v.", doc.Nodes[0].Metadata["prompt"])
	}
	if _, err := svc.UpdateUserCanvasNodeFields(actor, canvasID, "img", map[string]any{"prompt": "Draft A", "content": "Draft B"}, created.Revision+3); err == nil {
		t.Fatal("Simultaneous submission of prompt and content with different content should be rejected")
	}
}

// script/frame 这类结构节点没有 PatchFields，但「名称可编辑」是既有体验：
// title 必须走通用节点字段写入，不能出现「返回成功但没改」。
func TestUpdateUserCanvasNodeFieldsKeepsTitleEditableForStructureNodes(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas-structure","revision":0,"title":"structure node",
		"nodes":[
			{"id":"scr","type":"script","title":"Old script name","metadata":{"storyboard":{"rows":[]}}},
			{"id":"frm","type":"frame","title":"Old backplane name","metadata":{"frame":{"collapsed":false}}}
		],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	for index, nodeID := range []string{"scr", "frm"} {
		if _, err := svc.UpdateUserCanvasNodeFields("owner", "canvas-structure", nodeID, map[string]any{"title": "new name"}, created.Revision+int64(index)); err != nil {
			t.Fatalf("%s rename should be successful, but actually %v", nodeID, err)
		}
	}
	raw, _ := svc.UserCanvasProject("owner", "canvas-structure")
	var doc struct {
		Nodes []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Nodes[0].Title != "new name" || doc.Nodes[1].Title != "new name" {
		t.Fatalf("The rename of the structure node does not take effect: %#v", doc.Nodes)
	}
}

// 描述符没有声明的字段必须明确拒绝，且整批不写：revision 不推进、不产生幂等记录。
func TestUpdateUserCanvasNodeFieldsRejectsUnsupportedFieldWithoutWriting(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas-unsupported","revision":0,"title":"Unsupported field",
		"nodes":[{"id":"scr","type":"script","title":"script","metadata":{"storyboard":{"rows":[]}}}],
		"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.UpdateUserCanvasNodeFields("owner", "canvas-unsupported", "scr", map[string]any{"content": "should not write"}, created.Revision)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusBadRequest {
		t.Fatalf("content of script should be explicitly rejected, actually %v", err)
	}
	if appError.Reason != kernel.ReasonUnsupportedField {
		t.Fatalf("reason should be unsupported_field, actual %q", appError.Reason)
	}

	// 混入合法 title 也必须整批不写：不能出现「一半生效」。
	if _, err = svc.UpdateUserCanvasNodeFields("owner", "canvas-unsupported", "scr", map[string]any{"title": "new name", "content": "should not write"}, created.Revision); err == nil {
		t.Fatal("Entire batch of updates with unsupported fields should be rejected")
	}
	after, err := svc.UserCanvasProject("owner", "canvas-unsupported")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Revision int64 `json:"revision"`
		Nodes    []struct {
			Title    string         `json:"title"`
			Metadata map[string]any `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(after, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Revision != created.Revision {
		t.Fatalf("Rejected updates should not be pushed forward revision: %d -> %d", created.Revision, doc.Revision)
	}
	if doc.Nodes[0].Title != "script" {
		t.Fatalf("Rejected updates should not write title, actual %q", doc.Nodes[0].Title)
	}
}

// 历史节点可能没有 metadata：ApplyPatch 的落点必须先绑定到节点上，不能被空 map 覆盖。
func TestUpdateUserCanvasNodeFieldsPreservesPatchOnNodeWithoutMetadata(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas-no-metadata","revision":0,"title":"无 metadata",
		"nodes":[{"id":"txt","type":"text","title":"旧文本"}],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateUserCanvasNodeFields("owner", "canvas-no-metadata", "txt", map[string]any{"content": "first write"}, created.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateUserCanvasNodeFields("owner", "canvas-no-metadata", "txt", map[string]any{"content": "second write"}, created.Revision+1); err != nil {
		t.Fatal(err)
	}
	raw, err := svc.UserCanvasProject("owner", "canvas-no-metadata")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			Metadata map[string]any `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Nodes[0].Metadata["content"] != "second write" {
		t.Fatalf("Content updates for nodes without metadata are discarded: %#v", doc.Nodes[0].Metadata)
	}
}
