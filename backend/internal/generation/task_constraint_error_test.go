package generation

import "testing"

func TestFirstFrameChannelErrorsSurvivePersistence(t *testing.T) {
	for _, code := range []string{"video_first_frame_ratio_unreadable", "video_first_frame_ratio_unsupported", "video_first_frame_ratio_mismatch", "Video frame only supports: [1:1], currently passed in adaptive"} {
		f := ClassifyText(code)
		if f.Category != CategoryInvalidParams || f.Reason == "Model does not accept current parameters" {
			t.Fatalf("unspecific error: %#v", f)
		}
		persisted := ClassifyText(f.UserMessage())
		if persisted.Reason != f.Reason || persisted.Action != f.Action {
			t.Fatalf("persistence lost copy: %#v", persisted)
		}
	}
}

func TestNestedTaskTypeConstraint(t *testing.T) {
	raw := `{"error":{"code":"upstream_error","message":"{\"code\":\"fail_to_fetch_task\",\"message\":\"InvalidParameter.TaskTypeConstraint: The parameter ratio specified in the request is not valid. For first-frame or first-last-frame generation, the output ratio follows the first-frame image\"}"}}`
	got := ClassifyText(raw)
	got.RequestID = "req_task_constraint_123"
	if got.Category != CategoryInvalidParams || got.Reason != "The screen ratio of the first and last frame modes must follow the first frame" {
		t.Fatalf("unexpected classification: %#v", got)
	}
	readback := ClassifyText(got.UserMessage())
	if readback.Category != got.Category || readback.Reason != got.Reason || readback.RequestID != got.RequestID {
		t.Fatalf("persisted copy lost: %#v", readback)
	}
}
