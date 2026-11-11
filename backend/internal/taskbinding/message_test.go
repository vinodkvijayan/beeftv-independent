package taskbinding

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

type fakeMessagePorts struct {
	fakePorts
	attach      func(MessageAttachInput) (ConversationView, error)
	attachCalls int
}

func (f *fakeMessagePorts) Conversation(string, string) (ConversationView, error) {
	return ConversationView{ID: "conv-1", Revision: 3}, nil
}

func (f *fakeMessagePorts) AttachMessageResult(_ string, input MessageAttachInput) (ConversationView, error) {
	f.attachCalls++
	if f.attach != nil {
		return f.attach(input)
	}
	return ConversationView{ID: input.ConversationID, Revision: 4, Document: []byte(`{"id":"conv-1","messages":[]}`)}, nil
}

func testTextMessageTask() *model.Task {
	return &model.Task{
		ID: "task-1", UserID: "user-1", Type: "text",
		Status:     model.TaskStatusSucceeded,
		InputJSON:  `{"metadata":{"conversationId":"conv-1","messageId":"msg-1"}}`,
		ResultJSON: `{"text":"成片旁白"}`,
	}
}

func TestIsMessageRevisionConflictUsesTypedReasonOnly(t *testing.T) {
	if isMessageRevisionConflict(errors.New("Conversation updated, current draft does not overwrite saved content")) {
		t.Fatal("must not parse Chinese text as a revision conflict")
	}
	if isMessageRevisionConflict(errors.New("revision conflict stale")) {
		t.Fatal("must not parse error strings as a revision conflict")
	}
	if isMessageRevisionConflict(conflict("conversation_deleted", "The conversation has been deleted and can no longer be written to")) {
		t.Fatal("deleted must not retry as a revision conflict")
	}
	if isMessageRevisionConflict(conflict("message_task_mismatch", "The message is not associated with the task")) {
		t.Fatal("task mismatch must not retry as a revision conflict")
	}
	if isMessageRevisionConflict(conflict("conflict", "Conversation updated, current draft does not overwrite saved content")) {
		t.Fatal("generic conflict must not retry after typed mapping")
	}
	if !isMessageRevisionConflict(conflict("stale_revision", "Conversation updated, current draft does not overwrite saved content")) {
		t.Fatal("typed stale_revision must retry")
	}
}

func TestAttachMessageRetriesOnlyStaleRevision(t *testing.T) {
	stale := &fakeMessagePorts{fakePorts: fakePorts{task: testTextMessageTask()}}
	stale.attach = func(MessageAttachInput) (ConversationView, error) {
		return ConversationView{}, conflict("stale_revision", "Conversation updated, current draft does not overwrite saved content")
	}
	if _, err := AttachMessage(stale, "user-1", MessageRequest{ConversationID: "conv-1", MessageID: "msg-1", TaskID: "task-1"}); !isBindReason(err, "stale_revision") {
		t.Fatalf("stale = %v", err)
	}
	if stale.attachCalls != maxBindRevisionAttempts {
		t.Fatalf("stale retries = %d", stale.attachCalls)
	}

	deleted := &fakeMessagePorts{fakePorts: fakePorts{task: testTextMessageTask()}}
	deleted.attach = func(MessageAttachInput) (ConversationView, error) {
		return ConversationView{}, conflict("conversation_deleted", "The conversation has been deleted and can no longer be written to")
	}
	if _, err := AttachMessage(deleted, "user-1", MessageRequest{ConversationID: "conv-1", MessageID: "msg-1", TaskID: "task-1"}); !isBindReason(err, "conversation_deleted") {
		t.Fatalf("deleted = %v", err)
	}
	if deleted.attachCalls != 1 {
		t.Fatalf("deleted retries = %d", deleted.attachCalls)
	}

	mismatch := &fakeMessagePorts{fakePorts: fakePorts{task: testTextMessageTask()}}
	mismatch.attach = func(MessageAttachInput) (ConversationView, error) {
		return ConversationView{}, conflict("message_task_mismatch", "The message is not associated with the task")
	}
	if _, err := AttachMessage(mismatch, "user-1", MessageRequest{ConversationID: "conv-1", MessageID: "msg-1", TaskID: "task-1"}); !isBindReason(err, "message_task_mismatch") {
		t.Fatalf("mismatch = %v", err)
	}
	if mismatch.attachCalls != 1 {
		t.Fatalf("mismatch retries = %d", mismatch.attachCalls)
	}
}

func TestAttachMessageUsesDurableTextNotClientURL(t *testing.T) {
	ports := &fakeMessagePorts{fakePorts: fakePorts{task: testTextMessageTask()}}
	receipt, err := AttachMessage(ports, "user-1", MessageRequest{ConversationID: "conv-1", MessageID: "msg-1", TaskID: "task-1"})
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Content != "Narration of the finished film" || receipt.MediaType != "text" || receipt.Revision != 4 {
		t.Fatalf("receipt = %#v", receipt)
	}
	if receipt.EffectKey != localtask.AttachMessageEffectKey("task-1", "msg-1", 0) {
		t.Fatalf("effect = %q", receipt.EffectKey)
	}
}
