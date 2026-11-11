package transcription

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"infinite-canvas/backend/internal/mediatools"
)

// PrepareWAV writes the media stream to a temp file and converts it to 16 kHz
// mono PCM wav for whisper.cpp. The caller must invoke cleanup.
func PrepareWAV(ctx context.Context, reader io.Reader, mime string) (string, func(), error) {
	ffmpegBin, err := mediatools.ResolveFFmpeg()
	if err != nil {
		return "", nil, fmt.Errorf("Audio preprocessing dependencies are not installed (requires ffmpeg)")
	}
	tmpDir, err := os.MkdirTemp("", "beeftv-whisper-*")
	if err != nil {
		return "", nil, fmt.Errorf("Failed to create temporary directory: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(tmpDir) }
	inPath := filepath.Join(tmpDir, "input"+ExtForMIME(mime))
	inFile, err := os.Create(inPath)
	if err != nil {
		cleanup()
		return "", nil, fmt.Errorf("Failed to write to media to be transcribed: %w", err)
	}
	if _, err := io.Copy(inFile, reader); err != nil {
		inFile.Close()
		cleanup()
		return "", nil, fmt.Errorf("Failed to read media to be transcribed: %w", err)
	}
	if err := inFile.Close(); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("Failed to close temporary file: %w", err)
	}
	wavPath := filepath.Join(tmpDir, "audio16k.wav")
	cmd := exec.CommandContext(ctx, ffmpegBin, "-nostdin", "-y", "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath)
	mediatools.HideConsole(cmd)
	output, runErr := cmd.CombinedOutput()
	if runErr != nil {
		cleanup()
		detail := strings.TrimSpace(string(output))
		if len(detail) > 400 {
			detail = detail[len(detail)-400:]
		}
		return "", nil, fmt.Errorf("Audio preprocessing failed (ffmpeg): %s", detail)
	}
	return wavPath, cleanup, nil
}
