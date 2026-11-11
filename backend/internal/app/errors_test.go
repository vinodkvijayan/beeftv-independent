package app

import (
	"errors"
	"testing"
)

func TestAppErrorPreservesSafeProjectionAndCause(t *testing.T) {
	cause := errors.New("database password=secret")
	err := WrapAppError(503, "Service is temporarily unavailable", cause)
	err.Code = 10001
	err.Retryable = true

	if err.Error() != "Service is temporarily unavailable" {
		t.Fatalf("AppError.Error() = %q", err.Error())
	}
	if err.Status != 503 || err.Code != 10001 || !err.Retryable {
		t.Fatalf("AppError fields = %#v", err)
	}
	if !errors.Is(err, cause) {
		t.Fatal("AppError should unwrap its internal cause")
	}
}

func TestAuthErrorAliasRemainsCompatible(t *testing.T) {
	var err *AuthError = BadAuthRequest("Request parameter error")
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 400 || appErr.Code != 400 || appErr.Reason != ReasonInvalidArgument || appErr.Message != "Request parameter error" {
		t.Fatalf("AuthError compatibility = %#v", err)
	}
}

func TestQuotaExceededUsesStableCodeAndReason(t *testing.T) {
	err := QuotaExceeded("The number of account materials has reached the upper limit of 1")
	if err.Status != 403 || err.Code != CodeQuotaExceeded || err.Reason != ReasonQuotaExceeded {
		t.Fatalf("QuotaExceeded = %#v", err)
	}
}
