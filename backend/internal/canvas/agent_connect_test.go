package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/kernel"
)

func connectFixture(t *testing.T) (*Service, string, int64) {
	t.Helper()
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas-connect","revision":0,"title":"连线方向",
		"nodes":[
			{"id":"txt","type":"text","title":"文本","metadata":{"content":"正文"}},
			{"id":"img","type":"image","title":"图片","metadata":{"prompt":"p","composerContent":"p"}},
			{"id":"aud","type":"audio","title":"音频","metadata":{"prompt":"p","composerContent":"p"}}
		],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	return svc, "canvas-connect", created.Revision
}

// 参考连线方向必须按「来源可作输入、目标可接收、类型被目标放行」判定。
// 旧实现拿来源描述符去校验目标类型，方向正好相反。
func TestConnectUserCanvasNodesEnforcesReferenceDirection(t *testing.T) {
	svc, canvasID, revision := connectFixture(t)

	// text -> image 合法：图片接受文本输入。
	summary, err := svc.ConnectUserCanvasNodesAtRevision("owner", canvasID, "txt", "img", revision)
	if err != nil {
		t.Fatalf("text -> image should be accepted, actual %v", err)
	}
	if summary.Revision != revision+1 {
		t.Fatalf("After connection revision = %d", summary.Revision)
	}

	// image -> text 非法：文本节点不接收参考输入。
	_, err = svc.ConnectUserCanvasNodesAtRevision("owner", canvasID, "img", "txt", summary.Revision)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusBadRequest {
		t.Fatalf("image -> text should be rejected, actual %v", err)
	}

	// image -> audio 非法：音频只接受文本输入。
	if _, err = svc.ConnectUserCanvasNodesAtRevision("owner", canvasID, "img", "aud", summary.Revision); err == nil {
		t.Fatal("image -> audio should be rejected")
	}
}

// 目标类型声明的输入上限必须生效（音频只允许一个输入）。
func TestConnectUserCanvasNodesEnforcesInputCapacity(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas-capacity","revision":0,"title":"Input upper limit",
		"nodes":[
			{"id":"t1","type":"text","title":"text1","metadata":{"content":"a"}},
			{"id":"t2","type":"text","title":"text2","metadata":{"content":"b"}},
			{"id":"aud","type":"audio","title":"audio","metadata":{"prompt":"p","composerContent":"p"}}
		],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	first, err := svc.ConnectUserCanvasNodesAtRevision("owner", "canvas-capacity", "t1", "aud", created.Revision)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.ConnectUserCanvasNodesAtRevision("owner", "canvas-capacity", "t2", "aud", first.Revision)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusBadRequest {
		t.Fatalf("The second input should be rejected by the input cap, actual %v", err)
	}
}

// 一次批量创建里混排不同类型时必须按累计宽度排布，不能按「序号 × 自身宽度」，
// 否则窄节点后面的宽节点会压在前一个节点上。
func TestCreateUserCanvasNodesLayoutDoesNotOverlap(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{"id":"canvas-layout","revision":0,"title":"排布","nodes":[],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.CreateUserCanvasNodes("owner", "canvas-layout", []NodeDraft{
		{Title: "text", Type: "text"},
		{Title: "pictures", Type: "image"},
		{Title: "Audio", Type: "audio"},
	}, created.Revision); err != nil {
		t.Fatal(err)
	}
	raw, err := svc.UserCanvasProject("owner", "canvas-layout")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Nodes []struct {
			Title    string  `json:"title"`
			Width    float64 `json:"width"`
			Position struct {
				X float64 `json:"x"`
			} `json:"position"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Nodes) != 3 {
		t.Fatalf("Number of nodes = %d", len(doc.Nodes))
	}
	for index := 1; index < len(doc.Nodes); index += 1 {
		previous := doc.Nodes[index-1]
		current := doc.Nodes[index]
		if current.Position.X < previous.Position.X+previous.Width {
			t.Fatalf("%s(x=%.0f,w=%.0f) overlaps %s(x=%.0f)",
				previous.Title, previous.Position.X, previous.Width, current.Title, current.Position.X)
		}
	}
}

func TestCreateUserCanvasNodesStartsAfterExistingRightEdge(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{"id":"canvas-existing-layout","revision":0,"title":"Existing canvas","nodes":[
		{"id":"wide","type":"image","title":"wide node","position":{"x":600,"y":160},"width":900,"height":220},
		{"id":"left","type":"text","title":"Left node","position":{"x":10,"y":160},"width":320,"height":220}
	],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	first, _, err := svc.CreateUserCanvasNodes("owner", created.ID, []NodeDraft{{Title: "new pictures", Type: "image"}, {Title: "new text", Type: "text"}}, created.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.CreateUserCanvasNodes("owner", created.ID, []NodeDraft{{Title: "next batch", Type: "text"}}, first.Revision); err != nil {
		t.Fatal(err)
	}
	doc, err := svc.loadCanvasDoc("owner", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	nodes := canvasDocNodes(doc)
	if len(nodes) != 5 {
		t.Fatalf("node count = %d", len(nodes))
	}
	right := 1500.0
	for _, raw := range nodes[2:] {
		node := raw.(map[string]any)
		x := node["position"].(map[string]any)["x"].(float64)
		if x < right+nodePlacementGap {
			t.Fatalf("node %s at %v overlaps existing edge %v", node["title"], x, right)
		}
		right = x + node["width"].(float64)
	}
}
