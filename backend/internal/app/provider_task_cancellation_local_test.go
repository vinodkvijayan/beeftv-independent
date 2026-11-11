package app

import "testing"

func TestProviderCancellationUncertainMessageIsLocal(t *testing.T) {
	if got := providerCancellationUncertainMessage("Cancel request result is unclear"); got != "The result of the cancellation request is unclear and the cancellation status needs to be confirmed." {
		t.Fatalf("local cancellation message = %q", got)
	}
}
