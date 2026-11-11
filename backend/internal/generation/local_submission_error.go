package generation

type ImageRecoveryError struct{ Cause error }

// This wrapper is only used before the first transport call; it cannot imply
// that a supplier accepted the request or started a paid generation.
type ImagePreparationError struct{ Cause error }

func (e ImagePreparationError) Error() string {
	return "The image request failed while preparing locally and has not yet been submitted to the model service"
}
func (e ImagePreparationError) Unwrap() error { return e.Cause }

func (e ImageRecoveryError) Error() string {
	return "The image result has not been confirmed and automatic resending has been stopped; please keep the task record and contact support to query the result."
}
func (e ImageRecoveryError) Unwrap() error { return e.Cause }
