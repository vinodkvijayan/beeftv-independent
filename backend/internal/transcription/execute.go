package transcription

import (
	"context"
	"fmt"
)

type Executor struct {
	Media  MediaOpener
	Client *Client
}

func reportProgress(progress Progress, stage string, percent int) error {
	if progress == nil {
		return nil
	}
	return progress(stage, percent)
}

func (e *Executor) Run(ctx context.Context, resourceID, language string, progress Progress) (Result, error) {
	if e == nil || e.Media == nil {
		return Result{}, fmt.Errorf("The media to be transcribed cannot be read. It may have been deleted.")
	}
	media, reader, err := e.Media.Open(ctx, resourceID)
	if err != nil || reader == nil {
		return Result{}, fmt.Errorf("The media to be transcribed cannot be read. It may have been deleted.")
	}
	defer reader.Close()
	if !IsTranscribableMIME(media.MimeType) {
		return Result{}, fmt.Errorf("Only supports audio and video file transcoding")
	}
	if err := reportProgress(progress, "Waiting for transcription service", 15); err != nil {
		return Result{}, err
	}
	wavPath, cleanup, err := PrepareWAV(ctx, reader, media.MimeType)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		return Result{}, err
	}
	if err := reportProgress(progress, "Transcribing…", 40); err != nil {
		return Result{}, err
	}
	client := e.Client
	if client == nil {
		client = NewClient("")
	}
	segments, languageOut, err := client.Transcribe(ctx, wavPath, language)
	if err != nil {
		return Result{}, err
	}
	if err := reportProgress(progress, "Organize subtitles…", 80); err != nil {
		return Result{}, err
	}
	return Result{Segments: segments, SRT: BuildSRT(segments), Language: languageOut}, nil
}
