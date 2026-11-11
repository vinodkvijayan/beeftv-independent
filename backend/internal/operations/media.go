package operations

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/editing"
	"infinite-canvas/backend/internal/mediatools"
)

// MediaSourceOpener is optional: domain implementations must open only owned,
// ready resource bytes. No path or URL received from a model reaches ffmpeg.
type MediaSourceOpener interface {
	OpenMediaResource(context.Context, string, string) (io.ReadCloser, error)
}

type MediaSource struct {
	CanvasID      string `json:"canvasId"`
	NodeID        string `json:"nodeId,omitempty"`
	AssetID       string `json:"assetId,omitempty"`
	ResourceID    string `json:"resourceId"`
	Version       string `json:"version"`
	StartMs       int64  `json:"startMs"`
	EndMs         int64  `json:"endMs"`
	TimestampKind string `json:"timestampKind,omitempty"`
}

type MediaPart struct {
	Type     string      `json:"type"`
	MimeType string      `json:"mimeType"`
	Data     string      `json:"data"`
	SHA256   string      `json:"sha256"`
	Source   MediaSource `json:"source"`
}

type MediaResult struct {
	Source           MediaSource            `json:"source"`
	DurationMs       int64                  `json:"durationMs"`
	HasVideo         bool                   `json:"hasVideo"`
	HasAudio         bool                   `json:"hasAudio"`
	Content          []MediaPart            `json:"content"`
	BlackIntervals   []MediaInterval        `json:"blackIntervals,omitempty"`
	SilenceIntervals []MediaInterval        `json:"silenceIntervals,omitempty"`
	SilenceDetection *MediaSilenceDetection `json:"silenceDetection,omitempty"`
	MeanDB           *float64               `json:"meanDb,omitempty"`
	PeakDB           *float64               `json:"peakDb,omitempty"`
	Note             string                 `json:"note,omitempty"`
	Evidence         []string               `json:"evidence,omitempty"`
	Image            *MediaImageRead        `json:"image,omitempty"`
}

type MediaSilenceDetection struct {
	NoiseDB           float64 `json:"noiseDb"`
	MinimumDurationMs int64   `json:"minimumDurationMs"`
	TimestampKind     string  `json:"timestampKind"`
}

type MediaInterval struct {
	StartMs int64 `json:"startMs"`
	EndMs   int64 `json:"endMs"`
}

type mediaArgs struct {
	CanvasID        string                `json:"canvasId"`
	NodeID          string                `json:"nodeId"`
	AssetID         string                `json:"assetId"`
	ResourceID      string                `json:"resourceId"`
	ExpectedVersion string                `json:"expectedVersion"`
	StartMs         int64                 `json:"startMs"`
	EndMs           int64                 `json:"endMs"`
	Mode            string                `json:"mode"`
	Evidence        *mediaEvidenceRequest `json:"evidence,omitempty"`
	ImageCrop       *MediaImageCrop       `json:"imageCrop,omitempty"`
}

type mediaEvidenceRequest struct {
	StartMs *int64   `json:"startMs"`
	EndMs   *int64   `json:"endMs"`
	Modes   []string `json:"modes"`
	Checks  bool     `json:"checks"`
}

const mediaEvidenceSchema = `{"type":"object","description":"Read the evidence within 15 seconds at a time","properties":{"startMs":{"type":"integer"},"endMs":{"type":"integer"}," modes":{"type":"array","items":{"type":"string","enum":["frames","video","audio"]}},"checks":{"type":"boolean"}},"required":["startMs","endMs","modes"]}`

// ValidateMediaReference shares the owned-node/asset linkage checks with chat
// admission. Client-supplied resource IDs never grant access on their own.
func ValidateMediaReference(domain Domain, userID, canvasID, nodeID, assetID, resourceID string) (string, error) {
	id, err := resolveMediaResource(&Context{Domain: domain, UserID: userID}, mediaArgs{
		CanvasID: canvasID, NodeID: nodeID, AssetID: assetID, ResourceID: resourceID,
	})
	if err != nil {
		return "", err
	}
	resource, err := domain.OwnedReadyResource(userID, id)
	if err != nil {
		return "", err
	}
	return resource.MimeType, nil
}

func registerMediaOps(r *Registry) {
	registerMediaReview(r)
	summaries := map[string]string{
		"media.overview": "Get media version, duration and overview (optional evidence within 15 seconds); overview cannot replace continuous video review",
		"media.inspect":  "Read media segments (up to 15 seconds each; images can be viewed with imageCrop partitions)",
		"media.check":    "Objectively measure black screen, volume and silent pauses; it cannot judge the content of the sound and cannot replace actual listening.",
	}
	for _, id := range []string{"media.overview", "media.inspect", "media.check"} {
		operation := id
		required := `["canvasId"]`
		if operation != "media.overview" {
			required = `["canvasId","expectedVersion"]`
		}
		properties := ""
		if operation == "media.overview" {
			properties = `,"evidence":` + mediaEvidenceSchema
		} else if operation == "media.inspect" {
			properties = `,"imageCrop":` + mediaImageCropSchema
		}
		r.Register(Op{AssistantCanvas: true, ID: operation, Summary: summaries[operation], ReadOnly: true, Scope: ScopeCanvas,
			Params:  json.RawMessage(fmt.Sprintf(`{"type":"object","properties":{"canvasId":{"type":"string"},"nodeId":{"type":"string"},"assetId":{"type":"string"},"resourceId":{"type":"string"},"expectedVersion":{"type":"string","minLength":1},"startMs":{"type":"integer"},"endMs":{"type":"integer"},"mode":{"type":"string","description":"frames静态截图（不能判断连续运动或声音）；video连续；audio声音","enum":["frames","video","audio"]}%s},"required":%s}`, properties, required)),
			Handler: func(ctx *Context, raw json.RawMessage) (any, error) { return runMedia(ctx, operation, raw) }})
	}
}

func resolveMediaResource(ctx *Context, args mediaArgs) (string, error) {
	if strings.TrimSpace(args.CanvasID) == "" || (args.NodeID == "") == (args.AssetID == "") {
		return "", InvalidArg("invalid_media_target", "Specify canvasId and a nodeId or assetId")
	}
	// Read the owned canvas even for asset targets; scope authorization is enforced
	// by the registry before this function, not by model-provided claims.
	raw, err := ctx.Domain.UserCanvasProject(ctx.UserID, args.CanvasID)
	if err != nil {
		return "", mapDomainError(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return "", AsError(err)
	}
	var target any
	if args.NodeID != "" {
		for _, candidate := range canvasNodes(doc) {
			if node, ok := candidate.(map[string]any); ok && node["id"] == args.NodeID {
				target = node
				break
			}
		}
		if target == nil {
			return "", PermissionDenied("node_not_in_canvas", "Node does not belong to the specified canvas")
		}
	} else {
		asset, err := ctx.Domain.OwnedAsset(ctx.UserID, args.AssetID)
		if err != nil {
			return "", mapDomainError(err)
		}
		if asset == nil {
			return "", NotFound("asset_not_found", "Material does not exist")
		}
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &target); err != nil {
			return "", PreconditionFailed("media_reference_unreadable", "Material reference cannot be read", nil)
		}
	}
	ids := map[string]bool{}
	collectMediaResourceIDs(target, ids)
	if args.ResourceID != "" {
		if !ids[args.ResourceID] {
			return "", PermissionDenied("media_not_referenced", "This resource is not associated with the specified material or node")
		}
		return args.ResourceID, nil
	}
	if len(ids) != 1 {
		return "", InvalidArg("media_resource_required", "The target must have a media resource, or specify its associated resourceId")
	}
	for id := range ids {
		return id, nil
	}
	return "", NotFound("media_not_found", "media does not exist")
}

func collectMediaResourceIDs(value any, ids map[string]bool) {
	switch v := value.(type) {
	case map[string]any:
		for key, item := range v {
			if key == "resourceId" {
				if id, ok := item.(string); ok && strings.TrimSpace(id) != "" {
					ids[id] = true
				}
			}
			if key == "storageKey" || key == "content" {
				if value, ok := item.(string); ok {
					if id := assets.ResourceID(value); id != "" {
						ids[id] = true
					}
				}
			}
			collectMediaResourceIDs(item, ids)
		}
	case []any:
		for _, item := range v {
			collectMediaResourceIDs(item, ids)
		}
	}
}

// ReferencedMediaResourceIDs extracts canonical references from an already owned
// document. Callers still validate each resource ownership and readiness.
func ReferencedMediaResourceIDs(raw json.RawMessage) ([]string, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	collectMediaResourceIDs(value, ids)
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result, nil
}

const maxMediaSourceBytes int64 = 256 << 20
const maxMediaPartBytes int64 = 8 << 20

type contextReader struct {
	context.Context
	io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.Context.Err(); err != nil {
		return 0, err
	}
	return r.Reader.Read(p)
}

func runMedia(opCtx *Context, operation string, raw json.RawMessage) (any, error) {
	var args mediaArgs
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	if args.ImageCrop != nil && (operation != "media.inspect" || (args.Mode != "" && args.Mode != "frames") || args.StartMs != 0 || args.EndMs != 0 || !args.ImageCrop.valid()) {
		return nil, InvalidArg("invalid_image_crop", "The local range of the image must be within the original image and can only be used for the zero interval frames check of the image.")
	}
	if args.Evidence != nil {
		if operation != "media.overview" || args.Evidence.StartMs == nil || args.Evidence.EndMs == nil || len(args.Evidence.Modes) == 0 || len(args.Evidence.Modes) > 3 {
			return nil, InvalidArg("invalid_media_evidence", "Only overview supports evidence, explicitly providing startMs, endMs and modes 1 to 3.")
		}
		if *args.Evidence.StartMs < 0 || *args.Evidence.EndMs <= *args.Evidence.StartMs || *args.Evidence.EndMs-*args.Evidence.StartMs > 15000 {
			return nil, InvalidArg("invalid_media_interval", "The evidence interval must be a clear positive interval, up to 15 seconds each time")
		}
		seen := map[string]bool{}
		for _, mode := range args.Evidence.Modes {
			if (mode != "frames" && mode != "video" && mode != "audio") || seen[mode] {
				return nil, InvalidArg("invalid_media_evidence", "The evidence mode can only be non-repeating frames, video, audio")
			}
			seen[mode] = true
		}
	}
	resourceID, err := resolveMediaResource(opCtx, args)
	if err != nil {
		return nil, err
	}
	resource, err := opCtx.Domain.OwnedReadyResource(opCtx.UserID, resourceID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if resource == nil || resource.Size > maxMediaSourceBytes {
		return nil, PreconditionFailed("media_too_large", "Media checking currently supports assets up to 256 MiB", nil)
	}
	isImage := strings.HasPrefix(resource.MimeType, "image/") || strings.EqualFold(resource.Kind, "image")
	genericMime := resource.MimeType == "" || resource.MimeType == "application/octet-stream"
	if args.ImageCrop != nil && !isImage && !genericMime {
		return nil, InvalidArg("invalid_image_crop", "Partial image inspection only applies to image materials")
	}
	opener, ok := opCtx.Domain.(MediaSourceOpener)
	if !ok {
		return nil, Unsupported("media_unavailable", "The current workspace does not support media inspection")
	}
	ctx, cancel := context.WithTimeout(opCtx.Context, 90*time.Second)
	defer cancel()
	body, err := opener.OpenMediaResource(ctx, opCtx.UserID, resourceID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	if body == nil {
		return nil, PreconditionFailed("media_unavailable", "The media cannot be read at the moment", nil)
	}
	defer body.Close()
	readDone := make(chan struct{})
	defer close(readDone)
	go func() {
		select {
		case <-ctx.Done():
			_ = body.Close()
		case <-readDone:
		}
	}()
	dir, err := os.MkdirTemp("", "beeftv-media-*")
	if err != nil {
		return nil, PreconditionFailed("media_storage_unavailable", "Media check temporary space is not available", nil)
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, "source")
	file, err := os.OpenFile(input, os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return nil, PreconditionFailed("media_storage_unavailable", "Media check temporary space is not available", nil)
	}
	hash := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(contextReader{ctx, body}, maxMediaSourceBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		return nil, PreconditionFailed("media_read_failed", "Media read failed", nil)
	}
	if n > maxMediaSourceBytes {
		return nil, PreconditionFailed("media_too_large", "Media checking currently supports assets up to 256 MiB", nil)
	}
	// Uploaded playlists may point at unrelated local files or network URLs.
	// Accept self-contained binary containers only before invoking any decoder.
	if !selfContainedMedia(input) {
		return nil, Unsupported("media_format_unsupported", "Current inspection supports common image, MP4, WebM, WAV, MP3, OGG and FLAC files")
	}
	if !isImage && genericMime {
		if _, _, cfgErr := imageConfig(input); cfgErr == nil || cfgErr == errImageTooManyPixels {
			isImage = true
		}
	}
	if args.ImageCrop != nil && !isImage {
		return nil, InvalidArg("invalid_image_crop", "Partial image inspection only applies to image materials")
	}
	version := hex.EncodeToString(hash.Sum(nil))
	if operation != "media.overview" && args.ExpectedVersion == "" {
		return nil, InvalidArg("media_version_required", "Read the overview first, then provide expectedVersion")
	}
	if args.ExpectedVersion != "" && args.ExpectedVersion != version {
		return nil, Conflict("stale_media_version", "The material content has changed, please re-read the overview", map[string]any{"currentVersion": version})
	}
	facts, err := probeMediaFacts(ctx, input, isImage)
	if err != nil {
		if err == errImageTooManyPixels {
			return nil, PreconditionFailed("media_too_large", "The image pixel exceeds the upper limit of 32 million", nil)
		}
		if isImage {
			return nil, Unsupported("media_format_unsupported", "Current image inspection supports PNG, JPEG, WebP, GIF, BMP and TIFF files")
		}
		return nil, PreconditionFailed("media_probe_failed", "Unable to check media, please make sure ffprobe is installed and the material can be read", nil)
	}
	prepared := preparedMedia{input: input, directory: dir, source: MediaSource{CanvasID: args.CanvasID, NodeID: args.NodeID, AssetID: args.AssetID, ResourceID: resourceID, Version: version}, facts: facts, image: isImage}
	if args.Evidence == nil {
		return prepared.read(ctx, operation, args)
	}
	args.StartMs, args.EndMs = *args.Evidence.StartMs, *args.Evidence.EndMs
	modes := append([]string{}, args.Evidence.Modes...)
	if args.Evidence.Checks {
		modes = append(modes, "check")
	}
	var result MediaResult
	var total int64
	for index, mode := range modes {
		args.Mode = mode
		op := "media.inspect"
		if mode == "check" {
			op = "media.check"
		}
		part, err := prepared.read(ctx, op, args)
		if err != nil {
			return nil, err
		}
		if index == 0 {
			result = part
		} else if mode == "check" {
			result.BlackIntervals, result.MeanDB, result.PeakDB = part.BlackIntervals, part.MeanDB, part.PeakDB
			result.SilenceIntervals, result.SilenceDetection, result.Note = part.SilenceIntervals, part.SilenceDetection, part.Note
		} else {
			result.Content = append(result.Content, part.Content...)
		}
		for _, content := range part.Content {
			// File parts are generated and base64 encoded locally; account for
			// the entire bundle, not each mode's independent allowance.
			total += int64(base64.StdEncoding.DecodedLen(len(content.Data)))
		}
		if total > maxMediaPartBytes {
			return nil, PreconditionFailed("media_part_too_large", "The total amount of media evidence is too large. Please narrow the inspection range or reduce the mode.", nil)
		}
	}
	result.Evidence = modes
	return result, nil
}

// Every mode reads the same owned snapshot prepared by runMedia. No mode
// resolves mutable node references, reopens source bytes, hashes or probes.
type preparedMedia struct {
	input, directory string
	source           MediaSource
	facts            editing.SourceFacts
	image            bool
}

func (p preparedMedia) read(ctx context.Context, operation string, args mediaArgs) (MediaResult, error) {
	facts, image, input, dir := p.facts, p.image, p.input, p.directory
	if operation == "media.overview" {
		args.StartMs = 0
		args.EndMs = facts.DurationMs
	}
	if operation == "media.check" && args.StartMs == 0 && args.EndMs == 0 {
		args.EndMs = facts.DurationMs
	}
	if !image && (args.StartMs < 0 || args.EndMs <= args.StartMs || args.EndMs > facts.DurationMs) {
		return MediaResult{}, InvalidArg("invalid_media_interval", "The clip interval must be within the duration of the material")
	}
	if image && (args.StartMs != 0 || args.EndMs != 0 || args.Mode == "video" || args.Mode == "audio" || operation == "media.check") {
		return MediaResult{}, InvalidArg("invalid_media_interval", "Pictures only support overview or zero interval frames check")
	}
	if operation == "media.inspect" && args.EndMs-args.StartMs > 15000 {
		return MediaResult{}, InvalidArg("media_interval_too_long", "View or listen for up to 15 seconds at a time")
	}
	if operation == "media.check" && args.EndMs-args.StartMs > 300000 {
		return MediaResult{}, InvalidArg("media_interval_too_long", "Maximum 5 minutes per objective test")
	}
	source := p.source
	source.StartMs, source.EndMs = args.StartMs, args.EndMs
	result := MediaResult{Source: source, DurationMs: facts.DurationMs, HasVideo: facts.HasVideo, HasAudio: facts.HasAudio, Content: []MediaPart{}}
	if image {
		return p.readImage(ctx, operation, args, result)
	}
	bin, err := editing.ResolveFFmpegBinary()
	if err != nil {
		return MediaResult{}, PreconditionFailed("media_ffmpeg_unavailable", "Media checking requires ffmpeg", nil)
	}
	if operation == "media.check" {
		command := []string{"-nostdin", "-hide_banner", "-ss", mediaSeconds(args.StartMs), "-i", input, "-t", mediaSeconds(args.EndMs - args.StartMs)}
		if facts.HasVideo {
			command = append(command, "-vf", "blackdetect=d=0.15:pix_th=0.1")
		}
		if facts.HasAudio {
			command = append(command, "-af", "volumedetect,silencedetect=noise=-35dB:d=0.12")
		}
		output, err := mediaCommand(ctx, bin, append(command, "-f", "null", "-")...)
		if err != nil {
			return MediaResult{}, err
		}
		result.BlackIntervals, result.MeanDB, result.PeakDB = parseMediaChecks(string(output), args.StartMs)
		if facts.HasAudio {
			result.SilenceIntervals = parseMediaSilence(string(output), args.StartMs, args.EndMs)
			result.SilenceDetection = &MediaSilenceDetection{NoiseDB: -35, MinimumDurationMs: 120, TimestampKind: "source_time"}
		}
		result.Note = "Objective measurement: The black screen may be intentional; the presence of an audio track does not mean there is sound; the volume cannot determine the sound content. The mute interval is limited to this request, expressed in the original material time, and is only for finding candidate pauses, not word timestamps; after cropping, use media.inspect audio to actually listen and confirm the cut point."
		return result, nil
	}
	mode := args.Mode
	if mode == "" || operation == "media.overview" {
		mode = "frames"
	}
	if operation == "media.overview" && !facts.HasVideo {
		return result, nil
	}
	if mode == "frames" {
		if !facts.HasVideo {
			return MediaResult{}, InvalidArg("media_no_video", "This material has no screen")
		}
		count := 4
		if operation == "media.overview" {
			count = 3
		}
		for i := 0; i < count; i++ {
			at := args.StartMs + (args.EndMs-args.StartMs)*int64(2*i+1)/int64(2*count)
			output := filepath.Join(dir, fmt.Sprintf("frame-%d.jpg", i))
			command := []string{"-nostdin", "-v", "error", "-i", input}
			if !image {
				command = append(command, "-ss", mediaSeconds(at))
			}
			command = append(command, "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease", "-y", output)
			if _, err := mediaCommand(ctx, bin, command...); err != nil {
				return MediaResult{}, err
			}
			part, err := mediaFilePart(output, "image", "image/jpeg", result.Source)
			if err != nil {
				return MediaResult{}, err
			}
			part.Source.StartMs = at
			part.Source.EndMs = at
			part.Source.TimestampKind = "requested_seek"
			result.Content = append(result.Content, part)
			var total int
			for _, item := range result.Content {
				total += base64.StdEncoding.DecodedLen(len(item.Data))
			}
			if int64(total) > maxMediaPartBytes {
				return MediaResult{}, PreconditionFailed("media_part_too_large", "The media preview is too large, please narrow the inspection range.", nil)
			}
		}
		return result, nil
	}
	if mode != "video" && mode != "audio" {
		return MediaResult{}, InvalidArg("invalid_media_mode", "mode must be frames, video or audio")
	}
	if mode == "audio" && !facts.HasAudio {
		return MediaResult{}, InvalidArg("media_no_audio", "This material has no audio track")
	}
	if mode == "video" && !facts.HasVideo {
		return MediaResult{}, InvalidArg("media_no_video", "This material has no screen")
	}
	mime, output := "video/mp4", filepath.Join(dir, "clip.mp4")
	command := []string{"-nostdin", "-v", "error", "-i", input, "-ss", mediaSeconds(args.StartMs), "-t", mediaSeconds(args.EndMs - args.StartMs)}
	if mode == "audio" {
		mime, output = "audio/wav", filepath.Join(dir, "clip.wav")
		command = append(command, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le")
	} else {
		command = append(command, "-vf", "scale=640:-2", "-c:v", "libx264", "-preset", "fast", "-crf", "27", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart")
	}
	if _, err := mediaCommand(ctx, bin, append(command, "-fs", strconv.FormatInt(maxMediaPartBytes+1, 10), "-y", output)...); err != nil {
		return MediaResult{}, err
	}
	part, err := mediaFilePart(output, "media", mime, result.Source)
	if err != nil {
		return MediaResult{}, err
	}
	result.Content = append(result.Content, part)
	return result, nil
}

func mediaSeconds(ms int64) string { return fmt.Sprintf("%.3f", float64(ms)/1000) }

type limitedMediaLog struct{ data []byte }

func (b *limitedMediaLog) Write(p []byte) (int, error) {
	n := len(p)
	if len(b.data)+n > 1<<20 {
		return 0, fmt.Errorf("media output limit")
	}
	b.data = append(b.data, p...)
	return n, nil
}

func mediaCommand(ctx context.Context, bin string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	mediatools.HideConsole(cmd)
	var log limitedMediaLog
	cmd.Stdout = &log
	cmd.Stderr = &log
	if err := cmd.Run(); err != nil {
		return nil, PreconditionFailed("media_processing_failed", "Media processing failed or timed out, please narrow the check interval and try again.", nil)
	}
	return log.data, nil
}

func mediaFilePart(file, kind, mime string, source MediaSource) (MediaPart, error) {
	stat, err := os.Stat(file)
	if err != nil || stat.Size() == 0 {
		return MediaPart{}, PreconditionFailed("media_processing_failed", "Media processing did not produce valid content", nil)
	}
	if stat.Size() > maxMediaPartBytes {
		return MediaPart{}, PreconditionFailed("media_part_too_large", "The fragment is too large, please narrow the inspection range.", nil)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return MediaPart{}, PreconditionFailed("media_processing_failed", "Media processing results cannot be read", nil)
	}
	hash := sha256.Sum256(data)
	return MediaPart{Type: kind, MimeType: mime, Data: base64.StdEncoding.EncodeToString(data), SHA256: hex.EncodeToString(hash[:]), Source: source}, nil
}

func selfContainedMedia(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	buf := make([]byte, 12)
	n, _ := file.Read(buf)
	buf = buf[:n]
	for _, magic := range [][]byte{{0xff, 0xd8, 0xff}, {0x89, 'P', 'N', 'G'}, []byte("GIF8"), []byte("II*\x00"), []byte("MM\x00*"), []byte("BM"), {0x1a, 0x45, 0xdf, 0xa3}, []byte("OggS"), []byte("fLaC"), []byte("ID3")} {
		if len(buf) >= len(magic) && string(buf[:len(magic)]) == string(magic) {
			return true
		}
	}
	return (len(buf) >= 12 && ((string(buf[4:8]) == "ftyp") || (string(buf[:4]) == "RIFF" && (string(buf[8:12]) == "WAVE" || string(buf[8:12]) == "WEBP")))) || (len(buf) >= 2 && buf[0] == 0xff && buf[1]&0xe0 == 0xe0)
}

var mediaBlackPattern = regexp.MustCompile(`black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)`)
var mediaVolumePattern = regexp.MustCompile(`(mean|max)_volume: ([-\d.]+) dB`)
var mediaSilencePattern = regexp.MustCompile(`silence_(start|end):\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)`)

func parseMediaSilence(log string, startMs, endMs int64) []MediaInterval {
	intervals := []MediaInterval{}
	start := int64(-1)
	appendInterval := func(from, to int64) {
		if from < startMs {
			from = startMs
		}
		if to > endMs {
			to = endMs
		}
		if to > from {
			intervals = append(intervals, MediaInterval{from, to})
		}
	}
	for _, match := range mediaSilencePattern.FindAllStringSubmatch(log, -1) {
		seconds, err := strconv.ParseFloat(match[2], 64)
		if err != nil {
			continue
		}
		if seconds < 0 {
			seconds = 0
		}
		if maximum := float64(endMs-startMs) / 1000; seconds > maximum {
			seconds = maximum
		}
		// FFmpeg processes a seeked interval with local timestamps. Clamp any
		// decoder padding to the authorized requested source interval.
		at := startMs + int64(seconds*1000)
		if at < startMs {
			at = startMs
		}
		if match[1] == "start" {
			if start < 0 {
				start = at
			}
		} else {
			if start < 0 {
				start = startMs
			}
			appendInterval(start, at)
			start = -1
		}
	}
	// Some decoders omit the final end event; a reported silence_start has
	// already met FFmpeg's minimum duration, so close it at the request end.
	if start >= 0 {
		appendInterval(start, endMs)
	}
	return intervals
}

func parseMediaChecks(log string, startMs int64) ([]MediaInterval, *float64, *float64) {
	intervals := []MediaInterval{}
	for _, match := range mediaBlackPattern.FindAllStringSubmatch(log, -1) {
		start, _ := strconv.ParseFloat(match[1], 64)
		end, _ := strconv.ParseFloat(match[2], 64)
		intervals = append(intervals, MediaInterval{startMs + int64(start*1000), startMs + int64(end*1000)})
	}
	var mean, peak *float64
	for _, match := range mediaVolumePattern.FindAllStringSubmatch(log, -1) {
		value, err := strconv.ParseFloat(match[2], 64)
		if err == nil {
			if match[1] == "mean" {
				mean = &value
			} else {
				peak = &value
			}
		}
	}
	return intervals, mean, peak
}
