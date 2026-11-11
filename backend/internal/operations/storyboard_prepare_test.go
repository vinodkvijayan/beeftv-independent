package operations

import (
	"encoding/json"
	"strings"
	"testing"
)

// 草稿标题由调用方传入模板，{n} 在领域层替换为镜号；模板不能混进生成参数。
func TestOpStoryboardPrepareForwardsTitleTemplates(t *testing.T) {
	probe := &prepareProbe{configureProbe: configureFixture(t, "image")}
	_, err := opStoryboardPrepare(&Context{UserID: "owner", Domain: probe},
		json.RawMessage(`{"canvasId":"c1","nodeId":"n","expectedRevision":4,"rowIds":["shot-1"],
			"image":{"model":"chosen","title":"Mirror {n} first frame"},
			"video":{"model":"chosen","generateAudio":"true","title":"Mirror {n} Video"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if !probe.prepared || probe.input.ImageTitle != "Mirror {n} first frame" || probe.input.VideoTitle != "Mirror {n} Video" {
		t.Fatalf("title templates = %#v", probe.input)
	}
	for kind, patch := range map[string]map[string]any{"image": probe.input.Image, "video": probe.input.Video} {
		if _, exists := patch["title"]; exists {
			t.Fatalf("%s generation parameters should not be retained title: %#v", kind, patch)
		}
	}
}

// 不含 {n}、null、超过 40 字的模板都在入口拒绝，与 schema 一致。
func TestOpStoryboardPrepareRejectsInvalidTitleTemplates(t *testing.T) {
	for _, title := range []string{`"Mirror First Frame"`, `"Lens {N} first frame"`, `null`, `"` + strings.Repeat("mirror", 38) + `{n}"`} {
		probe := &prepareProbe{configureProbe: configureFixture(t, "image")}
		_, err := opStoryboardPrepare(&Context{UserID: "owner", Domain: probe},
			json.RawMessage(`{"canvasId":"c1","nodeId":"n","expectedRevision":4,"rowIds":["shot-1"],
				"image":{"model":"chosen","title":`+title+`}}`))
		if err == nil || AsError(err).Reason != "invalid_parameter" {
			t.Fatalf("Invalid templates should be rejected: %s -> %v", title, err)
		}
		if probe.prepared {
			t.Fatalf("Drafts should not be created after rejection: %q", title)
		}
	}
}

func TestOpStoryboardPrepareTreatsBlankTitleAsOmitted(t *testing.T) {
	probe := &prepareProbe{configureProbe: configureFixture(t, "image")}
	_, err := opStoryboardPrepare(&Context{UserID: "owner", Domain: probe},
		json.RawMessage(`{"canvasId":"c1","nodeId":"n","expectedRevision":4,"rowIds":["shot-1"],
			"image":{"model":"chosen","title":"   "}}`))
	if err != nil {
		t.Fatal(err)
	}
	if probe.input.ImageTitle != "" {
		t.Fatalf("Blank templates should be omitted equivalently: %#v", probe.input)
	}
}
