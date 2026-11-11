package app

import (
	"context"
	"fmt"
	"io"

	"infinite-canvas/backend/internal/transcription"
)

type transcribeMediaOpener struct {
	service *Service
	userID  string
}

func (o transcribeMediaOpener) Open(ctx context.Context, resourceID string) (transcription.Media, io.ReadCloser, error) {
	_ = ctx
	if o.service == nil {
		return transcription.Media{}, nil, fmt.Errorf("The media to be transcribed cannot be read. It may have been deleted.")
	}
	resource, reader, err := o.service.OpenResource(o.userID, resourceID)
	if err != nil || reader == nil || resource == nil {
		return transcription.Media{}, nil, fmt.Errorf("The media to be transcribed cannot be read. It may have been deleted.")
	}
	return transcription.Media{MimeType: resource.MimeType}, reader, nil
}

func (s *Service) transcriptionExecutor(userID, baseURL string) *transcription.Executor {
	return &transcription.Executor{
		Media:  transcribeMediaOpener{service: s, userID: userID},
		Client: transcription.NewClient(baseURL),
	}
}
