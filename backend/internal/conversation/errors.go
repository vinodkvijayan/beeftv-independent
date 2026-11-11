package conversation

import (
	"net/http"
	"strings"
)

const (
	ReasonNotFound            = "not_found"
	ReasonConflict            = "conflict"
	ReasonStaleRevision       = "stale_revision"
	ReasonDeleted             = "conversation_deleted"
	ReasonMessageTaskMismatch = "message_task_mismatch"
	ReasonInvalid             = "invalid_argument"
	ReasonUnavailable         = "unavailable"
)

// Error is the domain HTTP projection. Handlers map Status/Reason; this
// package does not import app.
type Error struct {
	Status  int
	Reason  string
	Message string
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if strings.TrimSpace(e.Message) != "" {
		return e.Message
	}
	return e.Reason
}

func errNotFound() *Error {
	return &Error{Status: http.StatusNotFound, Reason: ReasonNotFound, Message: "Creation dialogue does not exist"}
}

func errConflict() *Error {
	return &Error{Status: http.StatusConflict, Reason: ReasonConflict, Message: "Conversation updated, current draft does not overwrite saved content"}
}

func errDeleted() *Error {
	return &Error{Status: http.StatusConflict, Reason: ReasonDeleted, Message: "The conversation has been deleted and can no longer be written to"}
}

func errMessageTaskMismatch() *Error {
	return &Error{Status: http.StatusConflict, Reason: ReasonMessageTaskMismatch, Message: "This message has changed tasks and the results cannot be written again."}
}

func errInvalid(message string) *Error {
	if strings.TrimSpace(message) == "" {
		message = "Invalid authoring conversation content"
	}
	return &Error{Status: http.StatusBadRequest, Reason: ReasonInvalid, Message: message}
}

func errIdentity() *Error {
	return &Error{Status: http.StatusBadRequest, Reason: ReasonInvalid, Message: "Missing workspace identity"}
}

func errUnavailable() *Error {
	return &Error{Status: http.StatusServiceUnavailable, Reason: ReasonUnavailable, Message: "Authoring session storage is unavailable"}
}

func ErrUnavailable() *Error {
	return errUnavailable()
}
