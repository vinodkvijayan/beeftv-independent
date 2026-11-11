package app

import "testing"

func TestTaskCancellationPendingRetryMessageIsLocal(t *testing.T) {
	if got := taskCancellationPendingRetryMessage(); got != "The last cancellation request is still being confirmed, please try again later" {
		t.Fatalf("local retry message = %q", got)
	}
}
