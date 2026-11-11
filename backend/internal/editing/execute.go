package editing

import (
	"context"
	"fmt"
	"infinite-canvas/backend/internal/mediatools"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

const (
	renderOutputName     = "render-output.mp4"
	ffmpegLogTailMax     = 64 << 10
	ffmpegErrorTailBytes = 400
)

// Renderer executes a compiled semantic plan with native ffmpeg.
// It materializes opaque sources, probes tracks, lowers the plan, and writes
// one bounded MP4. It does not compile a second plan or persist workspace resources.
type Renderer struct {
	Sources SourceOpener
	FFmpeg  string
}

// RenderedOutput is the local encode result before workspace resource composition.
type RenderedOutput struct {
	Path        string
	Size        int64
	Width       int
	Height      int
	DurationMs  int64
	SubtitleSRT string
}

func (r *Renderer) ffmpegBinary() (string, error) {
	if r != nil && strings.TrimSpace(r.FFmpeg) != "" {
		return r.FFmpeg, nil
	}
	return ResolveFFmpegBinary()
}

func reportProgress(progress Progress, stage string, percent int) error {
	if progress == nil {
		return nil
	}
	return progress(stage, percent)
}

// Render materializes sources, binds probe facts, and encodes the plan.
// On success the caller must invoke cleanup after consuming Path.
// On failure cleanup has already run.
func (r *Renderer) Render(ctx context.Context, plan *Plan, progress Progress) (RenderedOutput, func(), error) {
	if plan == nil || !plan.HasMedia() {
		return RenderedOutput{}, nil, ErrNoMedia
	}
	ffmpegBin, err := r.ffmpegBinary()
	if err != nil {
		return RenderedOutput{}, nil, err
	}
	if err := reportProgress(progress, "Prepare the media…", 10); err != nil {
		return RenderedOutput{}, nil, err
	}
	workDir, files, cleanup, err := r.materialize(ctx, plan)
	if err != nil {
		return RenderedOutput{}, nil, err
	}
	fail := func(err error) (RenderedOutput, func(), error) {
		if cleanup != nil {
			cleanup()
		}
		return RenderedOutput{}, nil, err
	}
	facts := map[string]SourceFacts{}
	for sourceID, path := range files {
		fact, probeErr := Probe(ctx, path)
		if probeErr != nil {
			return fail(probeErr)
		}
		facts[sourceID] = fact
	}
	if err := ApplySourceFacts(plan, facts); err != nil {
		return fail(err)
	}
	if plan.SubtitleSRT != "" {
		if err := os.WriteFile(filepath.Join(workDir, SubtitleFileName), []byte(plan.SubtitleSRT), 0600); err != nil {
			return fail(fmt.Errorf("Failed to write subtitle file"))
		}
	}
	target := filepath.Join(workDir, renderOutputName)
	args := BuildFFmpegArgs(*plan, files, target)
	if len(args) == 0 {
		return fail(fmt.Errorf("Unable to generate render command"))
	}
	if err := reportProgress(progress, "Rendering…", 30); err != nil {
		return fail(err)
	}
	cmd := exec.CommandContext(ctx, ffmpegBin, args...)
	mediatools.HideConsole(cmd)
	cmd.Dir = workDir
	log := &ffmpegLogTail{max: ffmpegLogTailMax}
	cmd.Stdout = log
	cmd.Stderr = log
	runErr := cmd.Run()
	output := log.Text()
	if runErr != nil || (plan.SubtitleSRT != "" && log.FontFailure()) {
		return fail(fmt.Errorf("ffmpeg rendering failed: %s", ffmpegErrorDetail(output, runErr)))
	}
	outputFacts, size, err := verifyRenderedOutput(ctx, target, plan)
	if err != nil {
		return fail(err)
	}
	width, height := plan.Output.Width, plan.Output.Height
	if width <= 0 {
		width = DefaultWidth
	}
	if height <= 0 {
		height = DefaultHeight
	}
	return RenderedOutput{
		Path:        target,
		Size:        size,
		Width:       width,
		Height:      height,
		DurationMs:  outputFacts.DurationMs,
		SubtitleSRT: plan.SubtitleSRT,
	}, cleanup, nil
}

func verifyRenderedOutput(ctx context.Context, path string, plan *Plan) (SourceFacts, int64, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return SourceFacts{}, 0, fmt.Errorf("Failed to read rendering product")
	}
	if stat.Size() == 0 {
		return SourceFacts{}, 0, fmt.Errorf("Rendering product is empty")
	}
	facts, err := Probe(ctx, path)
	if err != nil {
		return SourceFacts{}, 0, fmt.Errorf("The rendering product is not valid media")
	}
	if !facts.HasVideo {
		return SourceFacts{}, 0, fmt.Errorf("Rendered product is missing video track")
	}
	if !facts.HasAudio {
		return SourceFacts{}, 0, fmt.Errorf("Rendered product is missing audio track")
	}
	if facts.DurationMs <= 0 {
		return SourceFacts{}, 0, fmt.Errorf("Rendering product duration is invalid")
	}
	if plan != nil && !outputDurationWithinPlan(plan.DurationMs, facts.DurationMs, plan.Output.FPS) {
		return SourceFacts{}, 0, fmt.Errorf("Rendering product duration is invalid")
	}
	return facts, stat.Size(), nil
}

func outputDurationWithinPlan(planMs, probedMs int64, fps int) bool {
	if planMs <= 0 || probedMs <= 0 {
		return false
	}
	delta := planMs - probedMs
	if delta < 0 {
		delta = -delta
	}
	if fps <= 0 {
		fps = DefaultFPS
	}
	// A legal low-frame-rate encode is quantized to complete video frames.
	// Keep the normal bound, allowing at most one frame plus container slack.
	tolerance := max(int64(OutputDurationToleranceMs), (1000+int64(fps)-1)/int64(fps)+100)
	return delta <= tolerance
}

func ffmpegErrorDetail(output string, runErr error) string {
	detail := strings.TrimSpace(output)
	if len(detail) > ffmpegErrorTailBytes {
		detail = detail[len(detail)-ffmpegErrorTailBytes:]
	}
	if detail != "" {
		return detail
	}
	if runErr != nil {
		return runErr.Error()
	}
	return "unknown encoder error"
}

type ffmpegLogTail struct {
	mu          sync.Mutex
	max         int
	buf         []byte
	fontFailure bool
	scanTail    string
}

func (t *ffmpegLogTail) Write(p []byte) (int, error) {
	if t == nil {
		return len(p), nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	// Font warnings may occur early, before a long encode fills the diagnostic
	// tail. Retain the verdict and a small overlap for split stderr writes.
	scan := t.scanTail + string(p)
	t.fontFailure = t.fontFailure || SubtitleFontFailure(scan)
	if len(scan) > 256 {
		scan = scan[len(scan)-256:]
	}
	t.scanTail = scan
	if t.max <= 0 {
		return len(p), nil
	}
	if len(p) >= t.max {
		t.buf = append(t.buf[:0], p[len(p)-t.max:]...)
		return len(p), nil
	}
	overflow := len(t.buf) + len(p) - t.max
	if overflow > 0 {
		if overflow >= len(t.buf) {
			t.buf = t.buf[:0]
		} else {
			t.buf = t.buf[overflow:]
		}
	}
	t.buf = append(t.buf, p...)
	return len(p), nil
}

func (t *ffmpegLogTail) Text() string {
	if t == nil {
		return ""
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

func (t *ffmpegLogTail) FontFailure() bool {
	if t == nil {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.fontFailure
}

func (r *Renderer) materialize(ctx context.Context, plan *Plan) (string, map[string]string, func(), error) {
	tmpDir, err := os.MkdirTemp("", "beeftv-render-*")
	if err != nil {
		return "", nil, nil, fmt.Errorf("Failed to create temporary directory: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(tmpDir) }
	files := map[string]string{}
	for _, sourceID := range plan.SourceIDs() {
		if err := ctx.Err(); err != nil {
			cleanup()
			return "", nil, nil, err
		}
		if sourceID == "" {
			cleanup()
			return "", nil, nil, fmt.Errorf("Fragment missing valid media reference")
		}
		if r == nil || r.Sources == nil {
			cleanup()
			return "", nil, nil, fmt.Errorf("The media referenced by the timeline cannot be read and may have been deleted")
		}
		reader, err := r.Sources.Open(ctx, sourceID)
		if err != nil || reader == nil {
			cleanup()
			return "", nil, nil, fmt.Errorf("The media referenced by the timeline cannot be read and may have been deleted")
		}
		path := filepath.Join(tmpDir, fmt.Sprintf("src-%d.mp4", len(files)))
		file, err := os.Create(path)
		if err != nil {
			reader.Close()
			cleanup()
			return "", nil, nil, fmt.Errorf("Failed to write to temporary media: %w", err)
		}
		if _, err := io.Copy(file, reader); err != nil {
			file.Close()
			reader.Close()
			cleanup()
			return "", nil, nil, fmt.Errorf("Failed to read timeline media: %w", err)
		}
		if err := file.Close(); err != nil {
			reader.Close()
			cleanup()
			return "", nil, nil, fmt.Errorf("Failed to write to temporary media: %w", err)
		}
		if err := reader.Close(); err != nil {
			cleanup()
			return "", nil, nil, fmt.Errorf("Failed to read timeline media: %w", err)
		}
		files[sourceID] = path
	}
	return tmpDir, files, cleanup, nil
}
