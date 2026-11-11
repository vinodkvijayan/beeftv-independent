package generation

import "testing"

func TestReferenceTransportErrorsRemainActionable(t *testing.T) {
	for _, raw := range []string{
		"The current model protocol requires public network material addresses. Please use a model that supports embedded materials in the local workspace instead.",
		"The reference material of the current JSON video protocol cannot use embedded data. Please upload it to the local resource directory first.",
		"The current model does not support reference videos. Please remove this material or select a model that supports this material.",
		"The current model supports up to 1 reference image. Please remove redundant materials and regenerate.",
	} {
		got := ClassifyText(raw)
		if got.Category != CategoryInvalidParams || got.Action == "" {
			t.Fatalf("unclassified error: %#v", got)
		}
		readback := ClassifyText(got.UserMessage())
		if readback.Category != got.Category || readback.Reason != got.Reason {
			t.Fatalf("lost on persistence: %#v", readback)
		}
	}
}
