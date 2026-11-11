package generation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// readSpeechAudioEvents accepts OpenAI speech audio deltas and BeefTV's
// signed-result URL extension. A heartbeat or EOF is never a completed song.
func readSpeechAudioEvents(ctx context.Context, data []byte) ([]byte, string, error) {
	var audio bytes.Buffer
	done := false
	resultURL := ""
	for _, frame := range sseFrameBoundaryPattern.Split(string(data), -1) {
		var lines []string
		for _, line := range strings.Split(strings.ReplaceAll(frame, "\r\n", "\n"), "\n") {
			if strings.HasPrefix(line, "data:") {
				lines = append(lines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
		raw := strings.Join(lines, "\n")
		if raw == "" || raw == "[DONE]" {
			continue
		}
		var event struct {
			Type     string          `json:"type"`
			Audio    string          `json:"audio"`
			AudioURL string          `json:"audio_url"`
			Error    json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			return nil, "", fmt.Errorf("Audio event cannot be parsed: %w", err)
		}
		if len(event.Error) > 0 && string(event.Error) != "null" {
			return nil, "", errors.New("Music generation failed, please check task details")
		}
		switch event.Type {
		case "speech.audio.delta":
			if done {
				return nil, "", errors.New("Receive additional content after audio completion")
			}
			chunk, err := base64.StdEncoding.DecodeString(event.Audio)
			if err != nil {
				return nil, "", errors.New("Invalid audio event encoding")
			}
			audio.Write(chunk)
		case "speech.audio.done":
			if done {
				return nil, "", errors.New("Duplicate audio completion events received")
			}
			done = true
			resultURL = event.AudioURL
		case "error":
			return nil, "", errors.New("Music generation failed, please check task details")
		}
	}
	if !done {
		return nil, "", errors.New("The music generation connection was interrupted and the completion result was not received; please check the original task first to avoid repeated payments.")
	}
	if resultURL != "" {
		if audio.Len() > 0 || !IsPublicMediaURL(resultURL) {
			return nil, "", errors.New("The music generation result address is invalid")
		}
		return GetExternalBinary(WithRequestKind(ctx, "download"), resultURL)
	}
	if audio.Len() == 0 {
		return nil, "", errors.New("Music generation result is empty")
	}
	return audio.Bytes(), "audio/mpeg", nil
}
