package modelcatalog

import "infinite-canvas/backend/internal/kernel"

// ModelErrorCode 是模型选择/路由/供应商失败的稳定机器可读码。
type ModelErrorCode string

const (
	ErrCodeModelCapabilityNotSupported ModelErrorCode = "model_capability_not_supported"
	ErrCodeModelRouteUnavailable       ModelErrorCode = "model_route_unavailable"
	ErrCodeProviderRequestFailed       ModelErrorCode = "provider_request_failed"
	ErrCodeModelCatalogMismatch        ModelErrorCode = "model_catalog_mismatch"
	ErrCodeInvalidModelSelection       ModelErrorCode = "invalid_model_selection"
)

// ModelError 嵌入 AppError，HTTP 投影通过 errors.As 读取 status/reason/文案。
type ModelError struct {
	*kernel.AppError
	ErrorCode ModelErrorCode
	Details   map[string]any
}

func (e *ModelError) Error() string {
	if e == nil {
		return ""
	}
	if e.AppError != nil {
		return e.AppError.Error()
	}
	return string(e.ErrorCode)
}

func NewModelError(code ModelErrorCode, message string) *ModelError {
	err := kernel.NewAppError(400, message)
	err.Reason = kernel.ErrorReason(code)
	return &ModelError{AppError: err, ErrorCode: code, Details: map[string]any{}}
}

func (e *ModelError) WithDetails(details map[string]any) *ModelError {
	if e == nil {
		return e
	}
	e.Details = details
	return e
}

func ModelCapabilityNotSupported(message string) error {
	if message == "" {
		message = "The current model does not support this capability"
	}
	return NewModelError(ErrCodeModelCapabilityNotSupported, message)
}

func ModelRouteUnavailable(message string) error {
	if message == "" {
		message = "No supply lines available"
	}
	return NewModelError(ErrCodeModelRouteUnavailable, message)
}

func ProviderRequestFailed(message string) error {
	if message == "" {
		message = "The model service failed to return, please check the request content or channel configuration."
	}
	return NewModelError(ErrCodeProviderRequestFailed, message)
}

func ModelCatalogMismatch(message string) error {
	if message == "" {
		message = "The model catalog has been updated, please select again"
	}
	return NewModelError(ErrCodeModelCatalogMismatch, message)
}

func InvalidModelSelection(message string) error {
	if message == "" {
		message = "Invalid model selection"
	}
	return NewModelError(ErrCodeInvalidModelSelection, message)
}

func IsModelError(err error) bool {
	_, ok := err.(*ModelError)
	return ok
}

func GetModelErrorCode(err error) ModelErrorCode {
	if modelErr, ok := err.(*ModelError); ok {
		return modelErr.ErrorCode
	}
	return ""
}

func FormatModelError(err error) string {
	if modelErr, ok := err.(*ModelError); ok {
		if modelErr.AppError == nil {
			return string(modelErr.ErrorCode)
		}
		if len(modelErr.Details) > 0 {
			return kernel.StringValue(modelErr.Message) + " (Error code:" + string(modelErr.ErrorCode) + ")"
		}
		return modelErr.Message
	}
	if err == nil {
		return ""
	}
	return err.Error()
}
