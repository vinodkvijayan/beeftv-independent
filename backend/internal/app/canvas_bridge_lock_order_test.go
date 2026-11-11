package app

import (
	"context"
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/conversation"
	"infinite-canvas/backend/internal/taskbinding"
	"net/http"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/operations"
	"infinite-canvas/backend/internal/repository"
)

type lockOrderFixture struct {
	t        *testing.T
	service  *Service
	registry *operations.Registry
	userID   string
	canvasID string
}

func newLockOrderFixture(t *testing.T) *lockOrderFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	dsn := filepath.Join(t.TempDir(), "lock-order.db") + "?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	pool.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	db = db.WithContext(ctx)
	if err := database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Workspace{ID: "local", Name: "local workspace"}).Error; err != nil {
		t.Fatal(err)
	}
	service := NewLocal(repository.New(db), t.TempDir())
	encoded, err := json.Marshal(map[string]any{
		"id": "lock-canvas", "title": "Lock order", "revision": 0,
		"nodes": []any{
			map[string]any{"id": "n1", "type": "text", "title": "node", "position": map[string]any{"x": 1, "y": 1},
				"width": 320, "height": 220, "metadata": map[string]any{"content": "original"}},
		},
		"connections": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpsertUserCanvasProject("local", encoded); err != nil {
		t.Fatal(err)
	}
	return &lockOrderFixture{t: t, service: service, registry: service.workspaceOperations(), userID: "local", canvasID: "lock-canvas"}
}

func (fx *lockOrderFixture) revision() int64 {
	fx.t.Helper()
	raw, err := fx.service.UserCanvasProject(fx.userID, fx.canvasID)
	if err != nil {
		fx.t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		fx.t.Fatal(err)
	}
	switch v := doc["revision"].(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	default:
		fx.t.Fatalf("Canvas revision type exception: %T", doc["revision"])
	}
	return 0
}

func (fx *lockOrderFixture) executeNodeUpdate() error {
	raw, err := json.Marshal(map[string]any{
		"canvasId": fx.canvasID, "nodeId": "n1", "expectedRevision": fx.revision(),
		"patch": map[string]any{"title": "write within transaction"}, "operationId": "lock-order-node-update",
	})
	if err != nil {
		return err
	}
	_, err = fx.registry.Execute(operations.Request{
		Op: "canvas.node.update", OpID: "lock-order-node-update",
		UserID: fx.userID, Caller: operations.ManualCaller(false), Params: raw,
	})
	return err
}

func (fx *lockOrderFixture) prepareUndo() {
	fx.t.Helper()
	if _, err := fx.service.BeginAssistantTurn(fx.userID, fx.canvasID, "aabbccddeeff0011", AssistantTurnInput{}); err != nil {
		fx.t.Fatal(err)
	}
	raw, err := json.Marshal(map[string]any{
		"canvasId": fx.canvasID, "expectedRevision": fx.revision(),
		"nodes":       []any{map[string]any{"title": "round node", "type": "text"}},
		"operationId": "lock-order-turn-create",
	})
	if err != nil {
		fx.t.Fatal(err)
	}
	if _, err := fx.registry.Execute(operations.Request{
		Op: "canvas.nodes.create", OpID: "lock-order-turn-create", TurnID: "aabbccddeeff0011",
		UserID: fx.userID, Caller: operations.ManualCaller(false), Params: raw,
	}); err != nil {
		fx.t.Fatal(err)
	}
	if err := fx.service.FinalizeAssistantTurn("aabbccddeeff0011"); err != nil {
		fx.t.Fatal(err)
	}
}

func (fx *lockOrderFixture) undo() error {
	_, err := fx.service.AssistantTurns().Undo(fx.userID, fx.canvasID, "aabbccddeeff0011")
	return err
}

func (fx *lockOrderFixture) createTaskHoldingMutex(held chan struct{}) error {
	policy, err := fx.service.RuntimePolicy()
	if err != nil {
		return err
	}
	task := &model.Task{
		ID: "lock-create-1", UserID: fx.userID, Type: "canvas_text",
		Status: model.TaskStatusQueued, Prompt: "Lock order creation", InputJSON: "{}",
	}
	fx.service.storageMu.Lock()
	defer fx.service.storageMu.Unlock()
	close(held)
	return createTaskWithStorageQuotaRepository(fx.service.repo, task, policy)
}

func (fx *lockOrderFixture) seedRunningTask() model.Task {
	fx.t.Helper()
	task := model.Task{
		ID: "lock-save-1", UserID: fx.userID, Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`,
	}
	if err := fx.service.repo.Create(&task); err != nil {
		fx.t.Fatal(err)
	}
	return task
}

func (fx *lockOrderFixture) saveTaskHoldingMutex(task model.Task, held chan struct{}) error {
	fx.service.storageMu.Lock()
	defer fx.service.storageMu.Unlock()
	close(held)
	if _, err := fx.service.repo.UserStorageUsage(task.UserID); err != nil {
		return err
	}
	completed := task
	completed.Status = model.TaskStatusSucceeded
	completed.Stage = "Mission accomplished"
	completed.Progress = 100
	completed.ResultJSON = `{"ok":true}`
	now := time.Now()
	completed.CompletedAt = &now
	return fx.service.repo.SaveTaskCompletion(&completed, model.TaskStatusRunning, nil)
}

func TestSingleConnectionOpsWriteAndAssistantUndoDoNotDeadlockAgainstTaskWrites(t *testing.T) {
	cases := []struct {
		name   string
		txPath string
		task   string
	}{
		{name: "ops node.update vs task create", txPath: "ops", task: "create"},
		{name: "ops node.update vs task save", txPath: "ops", task: "save"},
		{name: "assistant undo vs task create", txPath: "undo", task: "create"},
		{name: "assistant undo vs task save", txPath: "undo", task: "save"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fx := newLockOrderFixture(t)
			if tc.txPath == "undo" {
				fx.prepareUndo()
			}
			var running model.Task
			if tc.task == "save" {
				running = fx.seedRunningTask()
			}
			runLockOrderAgainstTask(t, fx, tc.txPath, tc.task, running)
		})
	}
}

func runLockOrderAgainstTask(t *testing.T, fx *lockOrderFixture, txPath, taskPath string, running model.Task) {
	t.Helper()
	txReady := make(chan struct{})
	proceed := make(chan struct{})
	held := make(chan struct{})
	var txOnce sync.Once
	var proceedOnce sync.Once
	t.Cleanup(func() {
		proceedOnce.Do(func() { close(proceed) })
	})
	// Pause only this fixture's database after acquiring its transaction's
	// connection. No process-global hook is installed in production code.
	err := fx.service.repo.DB().Callback().Query().After("gorm:query").Register("test:lock-order", func(tx *gorm.DB) {
		if !repoHoldsTransaction(repository.New(tx)) {
			return
		}
		txOnce.Do(func() {
			close(txReady)
			select {
			case <-proceed:
			case <-time.After(4 * time.Second):
			}
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	txErr := make(chan error, 1)
	go func() {
		if txPath == "undo" {
			txErr <- fx.undo()
			return
		}
		txErr <- fx.executeNodeUpdate()
	}()

	select {
	case <-txReady:
	case err := <-txErr:
		t.Fatalf("Transaction path returned before WithStorageLock: %v", err)
	case <-time.After(4 * time.Second):
		t.Fatal("Transaction path does not enter WithStorageLock")
	}

	taskErr := make(chan error, 1)
	go func() {
		if taskPath == "save" {
			taskErr <- fx.saveTaskHoldingMutex(running, held)
			return
		}
		taskErr <- fx.createTaskHoldingMutex(held)
	}()

	select {
	case <-held:
	case err := <-taskErr:
		t.Fatalf("The task path returns before getting storageMu: %v", err)
	case <-time.After(4 * time.Second):
		t.Fatal("The task path did not get storageMu")
	}
	proceedOnce.Do(func() { close(proceed) })

	deadline := time.After(4 * time.Second)
	var gotTx, gotTask error
	gotTx, gotTask = errPending, errPending
	for gotTx == errPending || gotTask == errPending {
		select {
		case err := <-txErr:
			gotTx = err
		case err := <-taskErr:
			gotTask = err
		case <-deadline:
			t.Fatalf("The single connection lock sequence did not end within the time limit tx=%v task=%v", pendingText(gotTx), pendingText(gotTask))
		}
	}
	if gotTx != nil {
		t.Fatalf("Transaction path failed: %v", gotTx)
	}
	if gotTask != nil {
		t.Fatalf("Task path failed: %v", gotTask)
	}
}

var errPending = errors.New("pending")

func pendingText(err error) string {
	if err == errPending {
		return "Not returned"
	}
	if err == nil {
		return "ok"
	}
	return err.Error()
}

func TestMapConversationAttachErrorUsesTypedReasons(t *testing.T) {
	t.Helper()
	deleted := mapConversationAttachError(&conversation.Error{
		Status: http.StatusConflict, Reason: conversation.ReasonDeleted, Message: "The conversation has been deleted and can no longer be written to",
	})
	var bindErr *taskbinding.Error
	if !errors.As(deleted, &bindErr) || bindErr.Reason != "conversation_deleted" || bindErr.Status != 409 {
		t.Fatalf("deleted = %#v", deleted)
	}
	mismatch := mapConversationAttachError(&conversation.Error{
		Status: http.StatusConflict, Reason: conversation.ReasonMessageTaskMismatch, Message: "This message has changed tasks and the results cannot be written again.",
	})
	if !errors.As(mismatch, &bindErr) || bindErr.Reason != "message_task_mismatch" {
		t.Fatalf("mismatch = %#v", mismatch)
	}
	stale := mapConversationAttachError(&conversation.Error{
		Status: http.StatusConflict, Reason: conversation.ReasonConflict, Message: "Conversation updated, current draft does not overwrite saved content",
	})
	if !errors.As(stale, &bindErr) || bindErr.Reason != "stale_revision" {
		t.Fatalf("stale = %#v", stale)
	}
	if mapped := mapConversationAttachError(errors.New("Conversation updated, current draft does not overwrite saved content")); mapped.Error() != "Conversation updated, current draft does not overwrite saved content" {
		t.Fatalf("untyped text must pass through: %v", mapped)
	}
}

func TestSingleConnectionDocumentCommitDoesNotDeadlockAgainstDocumentLimitReads(t *testing.T) {
	fx := newLockOrderFixture(t)
	if _, err := fx.service.CanvasService().UpdateCanvasDocumentLimitMB(128); err != nil {
		t.Fatal(err)
	}
	canvasSvc := fx.service.CanvasService()
	limitArmed := make(chan struct{})
	limitAtQuery := make(chan struct{})
	txHoldingConn := make(chan struct{})
	var limitOnce sync.Once
	var txOnce sync.Once
	t.Cleanup(func() {
		txOnce.Do(func() { close(txHoldingConn) })
	})
	err := fx.service.repo.DB().Callback().Query().Before("gorm:query").Register("test:commit-limit-before-query", func(tx *gorm.DB) {
		if repoHoldsTransaction(repository.New(tx)) {
			return
		}
		select {
		case <-limitArmed:
			limitOnce.Do(func() {
				close(limitAtQuery)
				select {
				case <-txHoldingConn:
				case <-time.After(4 * time.Second):
				}
			})
		default:
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	err = fx.service.repo.DB().Callback().Query().After("gorm:query").Register("test:commit-limit-after-tx-query", func(tx *gorm.DB) {
		if !repoHoldsTransaction(repository.New(tx)) {
			return
		}
		txOnce.Do(func() {
			close(txHoldingConn)
			time.Sleep(20 * time.Millisecond)
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	expectedRev := fx.revision()
	close(limitArmed)
	limitErr := make(chan error, 1)
	go func() {
		if got := canvasSvc.CanvasDocumentLimitMB(); got != 128 {
			limitErr <- errors.New("unexpected canvas document limit")
			return
		}
		if got := canvasSvc.RequestMaxBodyBytes(); got <= 0 {
			limitErr <- errors.New("unexpected request max body bytes")
			return
		}
		limitErr <- nil
	}()

	select {
	case <-limitAtQuery:
	case err := <-limitErr:
		t.Fatalf("The capacity limit read returns: %v before entering the query callback.", err)
	case <-time.After(4 * time.Second):
		t.Fatal("Capacity upper limit reading does not enter the query callback")
	}

	commitErr := make(chan error, 1)
	go func() {
		params, marshalErr := json.Marshal(map[string]any{
			"canvasId":         fx.canvasID,
			"expectedRevision": expectedRev,
			"operationId":      "lock-order-document-commit",
			"document": map[string]any{
				"title": "Submit the entire document",
				"nodes": []any{
					map[string]any{
						"id":       "n1",
						"type":     "text",
						"title":    "Post-commit node",
						"position": map[string]any{"x": 10, "y": 20},
						"width":    320,
						"height":   220,
						"metadata": map[string]any{"content": "Update content"},
					},
				},
				"connections": []any{},
			},
		})
		if marshalErr != nil {
			commitErr <- marshalErr
			return
		}
		_, execErr := fx.registry.Execute(operations.Request{
			Op:     "canvas.document.commit",
			OpID:   "lock-order-document-commit",
			UserID: fx.userID,
			Caller: operations.ManualCaller(false),
			Params: params,
		})
		commitErr <- execErr
	}()

	deadline := time.After(4 * time.Second)
	gotCommit, gotLimit := errPending, errPending
	for gotCommit == errPending || gotLimit == errPending {
		select {
		case err := <-commitErr:
			gotCommit = err
		case err := <-limitErr:
			gotLimit = err
		case <-deadline:
			t.Fatalf("document.commit and capacity limit reading deadlock occurs under single connection commit=%v limit=%v", pendingText(gotCommit), pendingText(gotLimit))
		}
	}
	if gotCommit != nil {
		t.Fatalf("document.commit failed: %v", gotCommit)
	}
	if gotLimit != nil {
		t.Fatalf("Failed to read capacity limit: %v", gotLimit)
	}
}
