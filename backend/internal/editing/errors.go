package editing

import "errors"

var (
	ErrNoMedia              = errors.New("The timeline has no renderable media clips")
	ErrOverlap              = errors.New("Server-side rendering does not currently support overlapping video or image fragments")
	ErrNegativeTime         = errors.New("Fragment time cannot be negative")
	ErrMissingSource        = errors.New("Material not found")
	ErrMissingMediaRef      = errors.New("Fragment missing valid media reference")
	ErrInsufficientDuration = errors.New("The length of the material is insufficient, please adjust the cropping range")
	ErrMissingAudioTrack    = errors.New("Standalone audio material has no available audio track")
	ErrMissingVideoTrack    = errors.New("The material is missing the required audio and video tracks")
	ErrInvalidClip          = errors.New("Invalid segment time")
	ErrInvalidVolume        = errors.New("Clip crop or volume is invalid")
	ErrUnreadableSource     = errors.New("Unable to parse material")
	ErrUnsupportedVersion   = errors.New("Unsupported timeline version")
	ErrDuplicateID          = errors.New("There are duplicate tracks or clips in the timeline")
	ErrInvalidID            = errors.New("Track or region is missing a valid number")
	ErrUnknownTrack         = errors.New("Region references a track that does not exist")
	ErrUnsupportedKind      = errors.New("Unsupported fragment type")
	ErrInvalidOutput        = errors.New("Invalid output size, frame rate, or sample rate")
	ErrInvalidDuration      = errors.New("Invalid timeline or clip duration")
)
