package depthruntime

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var errDownloadStalled = errors.New("The download source has not responded for a long time. Please check the network and continue downloading.")

type Artifact struct {
	URLs         []string       `json:"urls"`
	Size         int64          `json:"size"`
	SHA256       string         `json:"sha256"`
	Parts        []ArtifactPart `json:"parts,omitempty"`
	Files        int            `json:"files,omitempty"`
	ExpandedSize int64          `json:"expandedSize,omitempty"`
}

type ArtifactPart struct {
	URLs   []string `json:"urls"`
	Size   int64    `json:"size"`
	SHA256 string   `json:"sha256"`
}

type Progress struct {
	Downloaded int64
	Total      int64
	Source     string
}

func Download(ctx context.Context, artifact Artifact, target string, report func(Progress)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if artifact.Size <= 0 || len(strings.TrimSpace(artifact.SHA256)) != 64 || (len(artifact.URLs) == 0 && len(artifact.Parts) == 0) {
		return errors.New("Deepin component download description is invalid")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
		return err
	}
	if len(artifact.Parts) > 0 {
		return downloadParts(ctx, artifact, target, report)
	}
	temporary := target + ".download"
	// Cancellation can leave all bytes present before the final hash finishes.
	// Verify that cache before sending a Range request that would start past EOF.
	if info, err := os.Stat(temporary); err == nil && info.Size() == artifact.Size {
		if err := verifyFileContext(ctx, temporary, artifact); err == nil {
			if err := ctx.Err(); err != nil {
				return err
			}
			return publishVerifiedDownload(temporary, target)
		} else if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := os.Remove(temporary); err != nil {
			return fmt.Errorf("Cleaning corrupted component cache failed: %w", err)
		}
	}
	var lastErr error
	for _, source := range artifact.URLs {
		for attempt := 0; attempt < 3; attempt++ {
			if err := downloadSource(ctx, source, temporary, artifact.Size, report); err != nil {
				lastErr = err
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if errors.Is(err, errDownloadStalled) {
					break
				}
				continue
			}
			if err := verifyFileContext(ctx, temporary, artifact); err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				lastErr = err
				if info, statErr := os.Stat(temporary); statErr == nil && info.Size() < artifact.Size {
					continue
				}
				_ = os.Rename(temporary, target+".corrupt")
				break
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := publishVerifiedDownload(temporary, target); err != nil {
				return fmt.Errorf("Failed to publish deep component: %w", err)
			}
			return nil
		}
	}
	return fmt.Errorf("Deepin component download failed: %w", lastErr)
}

func downloadParts(ctx context.Context, artifact Artifact, target string, report func(Progress)) error {
	if len(artifact.Parts) > 16 {
		return errors.New("The number of deep component shards exceeds the limit")
	}
	var total int64
	for _, part := range artifact.Parts {
		if part.Size <= 0 || part.Size >= 2<<30 || len(part.URLs) == 0 || len(strings.TrimSpace(part.SHA256)) != 64 {
			return errors.New("Deep component shard description is invalid")
		}
		total += part.Size
	}
	if total != artifact.Size {
		return errors.New("Deep component fragment size is inconsistent with the full package")
	}
	var downloaded int64
	for index, part := range artifact.Parts {
		if err := ctx.Err(); err != nil {
			return err
		}
		partPath := fmt.Sprintf("%s.part-%03d", target, index+1)
		partArtifact := Artifact{URLs: part.URLs, Size: part.Size, SHA256: part.SHA256}
		if verifyFileContext(ctx, partPath, partArtifact) != nil {
			err := Download(ctx, partArtifact, partPath, func(progress Progress) {
				if report != nil {
					report(Progress{Downloaded: downloaded + progress.Downloaded, Total: artifact.Size, Source: progress.Source})
				}
			})
			if err != nil {
				return fmt.Errorf("Downloading deep component shard %d failed: %w", index+1, err)
			}
		}
		downloaded += part.Size
	}
	assembled := target + ".assemble"
	output, err := os.OpenFile(assembled, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return err
	}
	defer os.Remove(assembled)
	for index := range artifact.Parts {
		if err := ctx.Err(); err != nil {
			_ = output.Close()
			return err
		}
		part, openErr := os.Open(fmt.Sprintf("%s.part-%03d", target, index+1))
		if openErr != nil {
			_ = output.Close()
			return openErr
		}
		_, copyErr := io.Copy(output, contextReader{ctx, part})
		_ = part.Close()
		if copyErr != nil {
			_ = output.Close()
			return copyErr
		}
	}
	if err := output.Close(); err != nil {
		return err
	}
	if err := verifyFileContext(ctx, assembled, artifact); err != nil {
		return fmt.Errorf("Reassembly depth component verification failed: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := publishVerifiedDownload(assembled, target); err != nil {
		return fmt.Errorf("Failed to publish full depth component: %w", err)
	}
	for index := range artifact.Parts {
		_ = os.Remove(fmt.Sprintf("%s.part-%03d", target, index+1))
	}
	return nil
}

func publishVerifiedDownload(source, target string) error {
	if runtime.GOOS == "windows" && pathExists(target) {
		return publishWindowsRuntime(source, target)
	}
	return os.Rename(source, target)
}

func downloadSource(ctx context.Context, source string, temporary string, total int64, report func(Progress)) error {
	return downloadSourceWithIdleTimeout(ctx, source, temporary, total, report, 30*time.Second)
}

func downloadSourceWithIdleTimeout(ctx context.Context, source string, temporary string, total int64, report func(Progress), idleTimeout time.Duration) error {
	sourceCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var offset int64
	if info, err := os.Stat(temporary); err == nil {
		offset = info.Size()
		if offset > total {
			offset = 0
		}
	}
	req, err := http.NewRequestWithContext(sourceCtx, http.MethodGet, source, nil)
	if err != nil {
		return err
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	response, err := downloadClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("Download source returns HTTP %d", response.StatusCode)
	}
	flags := os.O_CREATE | os.O_WRONLY
	if response.StatusCode == http.StatusPartialContent && offset > 0 {
		flags |= os.O_APPEND
	} else {
		offset = 0
		flags |= os.O_TRUNC
	}
	file, err := os.OpenFile(temporary, flags, 0o640)
	if err != nil {
		return err
	}
	defer file.Close()
	written := offset
	buffer := make([]byte, 256*1024)
	// A live connection may stop delivering bytes without closing. Cancel only
	// this source so the verified mirror can resume the existing partial file.
	idle := time.AfterFunc(idleTimeout, cancel)
	defer idle.Stop()
	for {
		count, readErr := response.Body.Read(buffer)
		if count > 0 {
			idle.Reset(idleTimeout)
			if _, err := file.Write(buffer[:count]); err != nil {
				return err
			}
			written += int64(count)
			if report != nil {
				report(Progress{Downloaded: written, Total: total, Source: source})
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if ctx.Err() == nil && sourceCtx.Err() != nil {
				return errDownloadStalled
			}
			return readErr
		}
	}
	return file.Sync()
}

func verifyFile(path string, artifact Artifact) error {
	return verifyFileContext(context.Background(), path, artifact)
}

func verifyFileContext(ctx context.Context, path string, artifact Artifact) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() != artifact.Size {
		return fmt.Errorf("Download size mismatch: got %d want %d", info.Size(), artifact.Size)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, contextReader{ctx, file}); err != nil {
		return err
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), artifact.SHA256) {
		return errors.New("SHA-256 check failed")
	}
	return nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
