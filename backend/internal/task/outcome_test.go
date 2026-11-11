package task

import (
	"reflect"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestComputeOutcome(t *testing.T) {
	noResult, unrecoverable := RecoveryNoResult, RecoveryUnrecoverable
	failed := model.Task{Type: "canvas_image", Status: model.TaskStatusFailed}
	with := func(change func(*model.Task)) model.Task { copy := failed; change(&copy); return copy }
	want := func(phase, regenerate, reason string) Outcome {
		return Outcome{Phase: phase, Regenerate: regenerate, Reason: reason}
	}
	cases := []struct {
		name  string
		task  model.Task
		state string
		facts OutcomeFacts
		want  Outcome
	}{
		{"queue", with(func(t *model.Task) { t.Status = model.TaskStatusQueued }), "", OutcomeFacts{}, want("running", "blocked", "task_running")},
		{"Expired lease still running after reboot", with(func(t *model.Task) {
			t.Status = model.TaskStatusRunning
			past := time.Now().Add(-time.Hour)
			t.LeaseExpiresAt = &past
		}), "", OutcomeFacts{}, want("running", "blocked", "task_running")},
		{"All outputs are stored in the database", with(func(t *model.Task) { t.Status = model.TaskStatusSucceeded }), ResultStateReady, OutcomeFacts{}, want("ready", "allowed", "result_ready")},
		{"Part of the output is not stored in the database", with(func(t *model.Task) { t.Status = model.TaskStatusSucceeded }), ResultStatePendingMaterialization, OutcomeFacts{}, want("fetching", "blocked", "result_fetching")},
		{"Download temporarily failed", with(func(t *model.Task) { t.Status = model.TaskStatusSucceeded }), ResultStateFailedRetryable, OutcomeFacts{}, want("retrievable", "blocked", "delivery_pending")},
		{"Storage confirmation failed", with(func(t *model.Task) { t.Status = model.TaskStatusSucceeded }), ResultStateFailedPermanent, OutcomeFacts{}, want("failed", "confirm", "result_unrecoverable")},
		{"Not yet distributed", failed, "", OutcomeFacts{DispatchState: "not_sent"}, want("failed", "allowed", "task_failed")},
		{"Local preparation failed", failed, "", OutcomeFacts{RequestNotSent: true}, want("failed", "allowed", "task_failed")},
		{"Stage text does not participate in judgment", with(func(t *model.Task) { t.Stage = "The request has not been submitted yet" }), "", OutcomeFacts{}, want("failed", "confirm", "task_failed")},
		{"Not issued but there is a task number in the upstream", with(func(t *model.Task) { t.ProviderRequestID = "upstream" }), "", OutcomeFacts{RequestNotSent: true}, want("retrievable", "blocked", "provider_result_pending")},
		{"The unissued stage was overturned by the accepted evidence.", failed, "", OutcomeFacts{RequestNotSent: true, DispatchState: "accepted"}, want("retrievable", "blocked", "image_recovery_pending")},
		{"It is clear that no task has been created", with(func(t *model.Task) { t.RecoveryOutcome = &noResult }), "", OutcomeFacts{DispatchState: "rejected_no_job"}, want("failed", "allowed", "no_result")},
		{"Explicitly reject uncreated tasks but already have POST call logs", failed, "", OutcomeFacts{HasImageReceipt: true, DispatchState: "rejected_no_job"}, want("failed", "allowed", "task_failed")},
		{"Make it clear that failure does not mean a refund", with(func(t *model.Task) { t.RecoveryOutcome = &noResult }), "", OutcomeFacts{DispatchState: "accepted"}, want("failed", "confirm", "no_result")},
		{"Old receipts are not routed", failed, "", OutcomeFacts{HasImageReceipt: true}, want("retrievable", "blocked", "image_recovery_pending")},
		{"Accepted", failed, "", OutcomeFacts{DispatchState: "accepted"}, want("retrievable", "blocked", "image_recovery_pending")},
		{"Same key to be resent", failed, "", OutcomeFacts{DispatchState: "submission_unknown", SafeImageReplay: true}, want("retrievable", "blocked", "image_recovery_pending")},
		{"Old commits are unconfirmed and waiting to be scanned", with(func(t *model.Task) { t.Stage = "submission_unknown" }), "", OutcomeFacts{}, want("retrievable", "blocked", "image_recovery_pending")},
		{"Confirm that it cannot be retrieved", with(func(t *model.Task) { t.RecoveryOutcome = &unrecoverable }), "", OutcomeFacts{HasImageReceipt: true}, want("failed", "confirm", "result_unrecoverable")},
		{"Failure to read evidence does not mean there is no result", failed, "", OutcomeFacts{Unreadable: true}, want("retrievable", "blocked", "evidence_unavailable")},
		{"Audit failure can be regenerated after confirmation", with(func(t *model.Task) {
			t.FailureDiagnostics = &model.TaskFailureDiagnostics{ProviderCode: "SAFETY.INPUT.TEXT"}
		}), "", OutcomeFacts{}, want("failed", "confirm", "input_rejected")},
		{"Content review failure shall not be deemed as no deduction of money", with(func(t *model.Task) {
			t.FailureDiagnostics = &model.TaskFailureDiagnostics{ProviderCode: "content_policy_violation"}
		}), "", OutcomeFacts{DispatchState: "not_sent"}, want("failed", "confirm", "input_rejected")},
		{"Deep local is free of charge", with(func(t *model.Task) { t.Type = model.TaskTypeDepthCapture }), "", OutcomeFacts{}, want("failed", "allowed", "task_failed")},
		{"Unknown billing", failed, "", OutcomeFacts{}, want("failed", "confirm", "task_failed")},
		{"Accept evidence to overwrite old unissued stage", with(func(t *model.Task) { t.Stage = "request_not_sent"; t.RecoveryOutcome = &noResult }), "", OutcomeFacts{DispatchState: "accepted", ImageResponseAccepted: true}, want("failed", "confirm", "no_result")},
		{"The video follows the original task query", with(func(t *model.Task) { t.Type = "canvas_video"; t.ProviderRequestID = "original" }), "", OutcomeFacts{}, want("retrievable", "blocked", "provider_result_pending")},
		{"Video confirmation upstream failed", with(func(t *model.Task) {
			t.Type = "canvas_video"
			t.ProviderRequestID = "original"
			t.RecoveryOutcome = &noResult
		}), "", OutcomeFacts{}, want("failed", "confirm", "no_result")},
		{"The video is out of warranty or cannot be retrieved", with(func(t *model.Task) {
			t.Type = "canvas_video"
			t.ProviderRequestID = "original"
			t.RecoveryOutcome = &unrecoverable
		}), "", OutcomeFacts{}, want("failed", "confirm", "result_unrecoverable")},
		{"Image super score follows the upstream query", with(func(t *model.Task) {
			t.Type = "canvas_image"
			t.Model = "topaz-standard-v2"
			t.ProviderRequestID = "upscale-req-1"
		}), "", OutcomeFacts{}, want("retrievable", "blocked", "provider_result_pending")},
		{"Picture super score confirmation no result", with(func(t *model.Task) {
			t.Type = "canvas_image"
			t.Model = "topaz-standard-v2"
			t.ProviderRequestID = "upscale-req-1"
			t.RecoveryOutcome = &noResult
		}), "", OutcomeFacts{}, want("failed", "confirm", "no_result")},
		{"The picture is confirmed to be over-scored and cannot be retrieved.", with(func(t *model.Task) {
			t.Type = "canvas_image"
			t.Model = "topaz-standard-v2"
			t.ProviderRequestID = "upscale-req-1"
			t.RecoveryOutcome = &unrecoverable
		}), "", OutcomeFacts{}, want("failed", "confirm", "result_unrecoverable")},
		{"BeefTV video has failed to settle and is allowed to be regenerated directly", with(func(t *model.Task) {
			u := "failed"
			t.Type = "canvas_video"
			t.ProviderRequestID = "vid-failed"
			t.RecoveryOutcome = &noResult
			t.BeefUsageState = &u
		}), "", OutcomeFacts{}, want("failed", "allowed", "no_result")},
		{"BeefTV video pending settlement blocking regeneration and transparent transmission deadline", with(func(t *model.Task) {
			u := "pending"
			dl := "2026-04-20T12:00:00Z"
			t.Type = "canvas_video"
			t.ProviderRequestID = "vid-pending"
			t.RecoveryOutcome = &noResult
			t.BeefUsageState = &u
			t.BeefReconcileDeadline = &dl
		}), "", OutcomeFacts{}, Outcome{Phase: "failed", Regenerate: "blocked", Reason: "settlement_pending", ReconcileDeadline: "2026-04-20T12:00:00Z"}},
		{"BeefTV video has been deducted and can be retrieved during blocking and regeneration", with(func(t *model.Task) {
			u := "completed"
			t.Type = "canvas_video"
			t.ProviderRequestID = "vid-completed"
			t.BeefUsageState = &u
		}), "", OutcomeFacts{}, want("retrievable", "blocked", "provider_result_pending")},
		{"BeefTV video has been deducted but the result cannot be retrieved and needs to be confirmed to be regenerated.", with(func(t *model.Task) {
			u := "completed"
			t.Type = "canvas_video"
			t.ProviderRequestID = "vid-completed"
			t.RecoveryOutcome = &unrecoverable
			t.BeefUsageState = &u
		}), "", OutcomeFacts{}, want("failed", "confirm", "charged_result_unrecoverable")},
		{"BeefTV pictures have been refunded and allowed to be regenerated directly", with(func(t *model.Task) {
			b := "refunded"
			t.ImageJobID = "img-job-1"
			t.RecoveryOutcome = &noResult
			t.BeefBillingState = &b
		}), "", OutcomeFacts{DispatchState: "accepted"}, want("failed", "allowed", "no_result")},
		{"BeefTV pictures have been deducted and can be retrieved during blocking and regeneration.", with(func(t *model.Task) {
			b := "settled"
			t.ImageJobID = "img-job-2"
			t.BeefBillingState = &b
		}), "", OutcomeFacts{DispatchState: "accepted"}, want("retrievable", "blocked", "image_recovery_pending")},
		{"BeefTV pictures have been deducted but the results cannot be retrieved and need to be confirmed to be regenerated.", with(func(t *model.Task) {
			b := "settled"
			t.ImageJobID = "img-job-2"
			t.RecoveryOutcome = &noResult
			t.BeefBillingState = &b
		}), "", OutcomeFacts{DispatchState: "accepted"}, want("failed", "confirm", "charged_result_unrecoverable")},
		{"BeefTV picture pending settlement empty string blocking regeneration and transparent transmission deadline", with(func(t *model.Task) {
			b := ""
			dl := "2026-04-20T12:30:00Z"
			t.ImageJobID = "img-job-3"
			t.RecoveryOutcome = &noResult
			t.BeefBillingState = &b
			t.BeefReconcileDeadline = &dl
		}), "", OutcomeFacts{DispatchState: "accepted"}, Outcome{Phase: "failed", Regenerate: "blocked", Reason: "settlement_pending", ReconcileDeadline: "2026-04-20T12:30:00Z"}},
		{"BeefTV picture is missing the billing_state key. Press the third party to confirm.", with(func(t *model.Task) {
			t.ImageJobID = "img-job-no-billing-key"
			t.RecoveryOutcome = &unrecoverable
			t.BeefBillingState = nil
		}), "", OutcomeFacts{DispatchState: "accepted"}, want("failed", "confirm", "result_unrecoverable")},
		{"BeefTV pictures have no job_id and are not issued. Regeneration is allowed according to the third party's cover.", with(func(t *model.Task) {
			t.BeefBillingState = nil
		}), "", OutcomeFacts{DispatchState: "not_sent"}, want("failed", "allowed", "task_failed")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := tc.task
			if got := ComputeOutcome(tc.task, tc.state, tc.facts); got != tc.want {
				t.Fatalf("got=%+v want=%+v", got, tc.want)
			}
			if !reflect.DeepEqual(before, tc.task) {
				t.Fatal("Read-only projection modified the task")
			}
			tc.task.Error = "content policy violated: context deadline exceeded Refunded"
			if got := ComputeOutcome(tc.task, tc.state, tc.facts); got != tc.want {
				t.Fatalf("The projection parsed the wrong copy: %+v", got)
			}
		})
	}
}
