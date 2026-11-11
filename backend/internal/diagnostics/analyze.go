package diagnostics

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"time"
)

// AnalyzeBundle reads only exported evidence. It needs no application process,
// database, model access or network, and does not trust precomputed findings.
func AnalyzeBundle(data []byte) ([]Finding, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	c := &collection{}
	var manifest manifest
	seen := map[string]bool{}
	var total uint64
	for _, file := range archive.File {
		if seen[file.Name] {
			return nil, errors.New("duplicate diagnostic file")
		}
		seen[file.Name] = true
		if file.UncompressedSize64 > (32<<20)-total {
			return nil, errors.New("diagnostic input exceeds read limit")
		}
		total += file.UncompressedSize64
		var target any
		switch file.Name {
		case "manifest.json":
			target = &manifest
		case "backend/tasks.jsonl":
			target = &c.Tasks
		case "backend/canvas-bindings.jsonl":
			target = &c.CanvasBindings
		case "client/events.jsonl":
			target = &c.ClientEvents
		case "backend/events.jsonl":
			target = &c.BackendEvents
		case "backend/assistant-turns.jsonl":
			target = &c.AssistantTurns
		case "backend/assistant-runtime.jsonl":
			target = &c.AssistantEvidence
		case "backend/resources.jsonl":
			target = &c.Resources
		default:
			continue
		}
		reader, err := file.Open()
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(reader, 32<<20+1))
		reader.Close()
		if err != nil {
			return nil, err
		}
		if file.Name == "manifest.json" {
			err = json.Unmarshal(body, target)
		} else {
			err = decodeJSONL(body, target)
		}
		if err != nil {
			return nil, fmt.Errorf("invalid diagnostic file %s: %w", file.Name, err)
		}
	}
	if manifest.SchemaVersion != SchemaVersion || manifest.Collectors == nil {
		return nil, errors.New("schema 3 manifest required")
	}
	c.Collectors = manifest.Collectors
	// A removed file cannot silently masquerade as an empty successful source.
	for name, path := range map[string]string{"tasks": "backend/tasks.jsonl", "canvasBindings": "backend/canvas-bindings.jsonl", "clientEvents": "client/events.jsonl", "backendEvents": "backend/events.jsonl", "assistantTurns": "backend/assistant-turns.jsonl", "assistantRuntime": "backend/assistant-runtime.jsonl", "resources": "backend/resources.jsonl"} {
		if !seen[path] {
			c.Collectors[name] = CollectorCoverage{Status: "failed", Scope: "bundle", Reason: "evidence_file_missing"}
		}
	}
	return analyze(c), nil
}

func decodeJSONL(body []byte, target any) error {
	var rows []json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(body))
	for {
		var row json.RawMessage
		err := decoder.Decode(&row)
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		rows = append(rows, row)
	}
	encoded, err := json.Marshal(rows)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

func analyze(c *collection) []Finding {
	findings := []Finding{}
	add := func(status, stage, reason, explanation string, refs, missing []string) {
		findings = append(findings, Finding{ID: fmt.Sprintf("finding-%03d", len(findings)+1), Status: status, Stage: stage, Reason: reason, Explanation: explanation, EvidenceRefs: refs, MissingEvidence: missing})
	}
	for _, task := range c.Tasks {
		ref := recordRef("backend/tasks.jsonl", task.ID)
		if task.Status != "failed" {
			continue
		}
		diagnostic := task.FailureDiagnostics
		switch {
		case diagnostic != nil && diagnostic.Source == "local_network":
			stage := "local_network"
			if diagnostic.TransportPhase != "" && diagnostic.TransportPhase != "unknown" {
				stage += "/" + diagnostic.TransportPhase
			}
			add("confirmed", stage, "local_network_failed", "The record confirms that a network failure occurred when the machine accessed external services; if there is an upstream task, the original task should continue to be queried, and the model generation failure cannot be determined based on this.", []string{ref}, nil)
		case diagnostic != nil && diagnostic.Source == "upstream_response" && diagnostic.HTTPStatus < 400:
			add("confirmed", diagnostic.Stage, "upstream_business_failed", "The upstream has returned a business failure; HTTP success does not mean successful generation, and failure to read material does not mean failure to download to the user's computer.", []string{ref}, nil)
		case diagnostic != nil && diagnostic.Source == "reference_upload":
			stage := "reference_upload"
			if diagnostic.FailedOperation != "" && diagnostic.FailedOperation != "unknown" {
				stage = diagnostic.FailedOperation
			}
			if diagnostic.TransportPhase != "" && diagnostic.TransportPhase != "unknown" {
				stage += "/" + diagnostic.TransportPhase
			} else if diagnostic.FailedOperation != "" {
				for i := len(diagnostic.Requests) - 1; i >= 0; i-- {
					request := diagnostic.Requests[i]
					if request.Operation == diagnostic.FailedOperation {
						if request.TransportPhase != "" && request.TransportPhase != "unknown" {
							stage += "/" + request.TransportPhase
						}
						break
					}
				}
			}
			add("confirmed", stage, "reference_preparation_failed", "The record confirms that the reference material preparation failed and has not yet entered subsequent generation and submission; the connection stage indicates the location of the failure, and this alone cannot be used to determine which party's network failure is the cause.", []string{ref}, nil)
		case diagnostic != nil && diagnostic.Source == "local_result" && diagnostic.ExecutionResult == "completed":
			add("confirmed", "result_delivery", "local_result_failed", "The model has been completed, and the task record confirms that local result processing failed; the original task should continue to be retrieved to avoid repeated generation.", []string{ref}, nil)
		case diagnostic != nil && diagnostic.HTTPStatus >= 400 && (diagnostic.Source == "upstream_http" || diagnostic.Source == "upstream_response"):
			add("confirmed", "upstream", "upstream_request_failed", "The task record confirms that the upstream request failed; whether to deduct fees still requires corresponding billing evidence.", []string{ref}, nil)
		default:
			add("inconclusive", "generation", "failed_task_cause_unknown", "The mission has failed, but current evidence cannot determine the cause.", []string{ref}, []string{"structured_failure_reason"})
		}
	}
	for _, event := range c.ClientEvents {
		if event.Code == "turn_interrupted" && event.AssistantTurnID != "" {
			add("confirmed", "assistant", "assistant_interrupted", "The client record confirms that the assistant's round has been interrupted; it still needs to be restored later to determine whether it can be restored.", []string{recordRef("client/events.jsonl", event.ID)}, nil)
		}
		if event.Code == "generation_bind_refused" && event.Reason != "" {
			confirmed := false
			for _, later := range c.ClientEvents {
				if later.Code == "generation_bind_confirmed" && sameBinding(event, later) && eventAfter(later.Timestamp, event.Timestamp) {
					confirmed = true
					break
				}
			}
			if !confirmed {
				add("confirmed", "canvas_binding", event.Reason, "As a result, the binding was rejected, and the subsequent successful binding of the same node was not recorded in the package; this record can only confirm the problem during the binding phase.", []string{recordRef("client/events.jsonl", event.ID)}, []string{"subsequent_binding_receipt"})
			}
		}
		if event.Media != nil && event.Media.ErrorCode != nil && *event.Media.ErrorCode > 0 {
			add("confirmed", "playback", "media_element_error", "The player logged a media error; this cannot be used to conclude that the upstream build failed.", []string{recordRef("client/events.jsonl", event.ID)}, nil)
		}
	}
	for _, event := range c.BackendEvents {
		if event.Phase == "start" && event.SpanID != "" {
			ended := false
			for _, end := range c.BackendEvents {
				if end.Phase == "end" && end.TraceID == event.TraceID && end.SpanID == event.SpanID {
					ended = true
					break
				}
			}
			if !ended {
				add("inconclusive", event.Name, "operation_end_not_recorded", "The start of the step has been recorded, but the end has not been recorded; it may still be running, the process exits, or the end record is missing, and the fault cannot be confirmed based on this alone.", []string{recordRef("backend/events.jsonl", event.ID)}, []string{"operation_end_or_recovery_event"})
			}
		}
		if event.Phase != "end" || event.Status != "error" || event.Reason == "" {
			continue
		}
		if event.Name == "generation.download" && event.Reason == "download_not_started" {
			add("inconclusive", "result_download", "download_not_started", "This retrieval was stopped before it started. This cannot be used to determine that the download failed, nor can the previous failure be marked as recovered.", []string{recordRef("backend/events.jsonl", event.ID)}, nil)
			continue
		}
		stage := ""
		switch event.Name {
		case "generation.download":
			stage = "result_download"
		case "generation.persist":
			stage = "result_persistence"
		case "canvas.bind":
			stage = "canvas_binding"
		default:
			continue
		}
		recovered := false
		for _, later := range c.BackendEvents {
			if later.Name == event.Name && later.Phase == "end" && later.Status == "ok" && later.TaskID == event.TaskID && later.NodeID == event.NodeID && later.OperationID == event.OperationID && later.Timestamp.After(event.Timestamp) {
				recovered = true
				break
			}
		}
		if !recovered {
			add("confirmed", stage, event.Reason, "Persistent logging confirms that the step failed and that subsequent successes of the same operation are not documented in the package; subsequent undocumented behavior cannot be inferred from this.", []string{recordRef("backend/events.jsonl", event.ID)}, nil)
		}
	}
	for _, resource := range c.Resources {
		if resource.Storage == "local" && resource.Status == "ready" && (resource.FileStatus == "missing" || (resource.FileSize != nil && *resource.FileSize == 0)) {
			add("confirmed", "local_resource", "ready_resource_file_missing", "The resource is marked as available, but the local file does not exist or is empty when exported.", []string{recordRef("backend/resources.jsonl", resource.ID)}, nil)
		}
	}
	ownedSessions := map[string]bool{}
	for _, turn := range c.AssistantTurns {
		if turn.SessionID != "" && turn.CanvasID != "" {
			ownedSessions[turn.SessionID+"|"+turn.CanvasID] = true
		}
	}
	for _, evidence := range c.AssistantEvidence {
		if ownedSessions[evidence.SessionID+"|"+evidence.CanvasID] {
			stage, reason, explanation, missingReason := "", "", "", ""
			switch {
			case evidence.Kind == "tool" && evidence.Status == "failed":
				stage, reason, missingReason = "assistant_tool", "assistant_tool_failed", "tool_failure_reason"
				explanation = "The tool log of the associated assistant session confirms that this operation failed; subsequent successes of other operations cannot be considered as recovery of this operation, nor can the complete cause of the failure be determined based on this."
			case evidence.Kind == "model_call" && evidence.Name == "model.response" && evidence.Status == "error":
				stage, reason, missingReason = "assistant_model", "model_attempt_failed", "model_failure_reason"
				explanation = "The model response record of the associated assistant session confirms that the attempt failed; this does not prove that the process crashed or became inoperable after being restarted."
			}
			if stage != "" {
				missing := []string{}
				if evidence.TurnID == "" {
					missing = append(missing, "assistant_turn_link")
					explanation += "History lacks exact turn correlation."
				}
				if code := sanitizeAssistantFailureReason(evidence.FailureReason); code != "" {
					reason = code
				} else {
					missing = append(missing, missingReason)
				}
				add("confirmed", stage, reason, explanation, []string{recordRef("backend/assistant-runtime.jsonl", evidence.ID)}, missing)
			}
		}
		if ownedSessions[evidence.SessionID+"|"+evidence.CanvasID] && evidence.Kind == "model_call" && evidence.Name == "model.response" && (evidence.Status == "aborted" || evidence.Status == "interrupted") {
			add("confirmed", "assistant_model", "model_attempt_interrupted", "The model response record of the associated assistant session confirms that the model attempt was interrupted; this cannot be used to determine process crashes, unassociated business rounds, or the operational status after restarting.", []string{recordRef("backend/assistant-runtime.jsonl", evidence.ID)}, nil)
		}
		if evidence.TurnID != "" && evidence.Kind == "recovery" && (evidence.Status == "interrupted" || evidence.Status == "aborted" || evidence.Reason == "process_interrupted") {
			add("confirmed", "assistant", "assistant_interrupted", "The assistant record confirms that the execution was interrupted; this does not prove that the operation cannot be performed after restarting, nor does it mean that the tool operation has been rolled back.", []string{recordRef("backend/assistant-runtime.jsonl", evidence.ID)}, nil)
		}
	}
	for _, turn := range c.AssistantTurns {
		if turn.State == "open" {
			add("inconclusive", "assistant", "assistant_turn_unsettled", "The assistant round has not yet settled; it cannot be determined whether it is running, exiting, or crashing without evidence of interruption or recovery.", []string{recordRef("backend/assistant-turns.jsonl", turn.ID)}, []string{"assistant_execution_or_recovery_event"})
		}
	}
	missing := []string{}
	for name, coverage := range c.Collectors {
		if coverage.Status != "complete" {
			missing = append(missing, name+":"+coverage.Status)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		add("inconclusive", "collection", "evidence_incomplete", "Some records have not been collected, have expired, or have been truncated; the absence of records does not mean that it did not occur.", []string{"manifest.json#/collectors"}, missing)
	}
	if len(findings) == 0 {
		add("inconclusive", "unknown", "no_confirmed_failure", "There are no records in the package that are sufficient to confirm the cause of the failure; evidence of execution and display of the failure is required.", []string{"manifest.json"}, []string{"failure_time_evidence"})
	}
	return findings
}

func recordRef(path, id string) string {
	if id == "" {
		return path
	}
	return path + "#" + id
}

func sameBinding(a, b clientEventRecord) bool {
	if a.TaskID == "" || a.TaskID != b.TaskID {
		return false
	}
	if a.CanvasBinding == nil || b.CanvasBinding == nil || a.CanvasBinding.NodeID == "" {
		return false
	}
	return a.CanvasBinding.NodeID == b.CanvasBinding.NodeID && a.CanvasBinding.ClientOperationID == b.CanvasBinding.ClientOperationID
}

func eventAfter(after, before string) bool {
	a, e1 := time.Parse(time.RFC3339Nano, after)
	b, e2 := time.Parse(time.RFC3339Nano, before)
	return e1 == nil && e2 == nil && !a.Before(b)
}
