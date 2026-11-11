package transcription

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type whisperSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

type whisperVerboseJSON struct {
	Segments []whisperSegment `json:"segments"`
	Language string           `json:"language"`
}

type Client struct {
	BaseURL string
	HTTP    *http.Client
	Model   string
	APIKey  string
}

func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		HTTP:    &http.Client{Timeout: 20 * time.Minute},
	}
}

func (c *Client) Transcribe(ctx context.Context, wavPath string, language string) ([]Segment, string, error) {
	if c == nil || c.BaseURL == "" {
		return nil, "", fmt.Errorf("The local transcription service is not configured: please set %s", BaseURLEnv)
	}
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Minute}
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	audio, err := os.Open(wavPath)
	if err != nil {
		return nil, "", fmt.Errorf("Failed to read audio to be transcribed: %w", err)
	}
	defer audio.Close()
	if c.Model != "" {
		info, err := audio.Stat()
		if err != nil {
			return nil, "", fmt.Errorf("Failed to read audio size")
		}
		if info.Size() > 25<<20 {
			return nil, "", fmt.Errorf("The audio transcribed in the cloud exceeds 25 MB, please shorten the material and try again.")
		}
		if err := writer.WriteField("model", c.Model); err != nil {
			return nil, "", err
		}
	}
	part, err := writer.CreateFormFile("file", filepath.Base(wavPath))
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, audio); err != nil {
		return nil, "", fmt.Errorf("Failed to upload audio: %w", err)
	}
	if err := writer.WriteField("response_format", "verbose_json"); err != nil {
		return nil, "", err
	}
	if strings.TrimSpace(language) != "" {
		if err := writer.WriteField("language", strings.TrimSpace(language)); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	endpoint := c.BaseURL + "/inference"
	if c.Model != "" {
		endpoint = strings.TrimSuffix(c.BaseURL, "/v1") + "/v1/audio/transcriptions"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.Model != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	// Never forward credentials or replay a paid upload across redirects.
	client := *httpClient
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, "", ctx.Err()
		}
		return nil, "", fmt.Errorf("Unable to connect to the transcription service, please check the connection and try again")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if c.Model != "" {
			return nil, "", fmt.Errorf("Cloud transcription failed (HTTP %d), please check the connection, balance or material and try again", resp.StatusCode)
		}
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, "", fmt.Errorf("The local transcription service returns %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, "", fmt.Errorf("Failed to read the transcription result: %w", err)
	}
	segments, languageOut, err := DecodeVerboseJSON(payload)
	if err != nil {
		return nil, "", err
	}
	if len(segments) == 0 {
		if c.Model == "" {
			return nil, "", fmt.Errorf("Speech content not recognized by local transcription service")
		}
		return nil, "", fmt.Errorf("The transcription service did not return subtitles with time, please check whether the material contains speech")
	}
	return segments, languageOut, nil
}

func DecodeVerboseJSON(payload []byte) ([]Segment, string, error) {
	var parsed whisperVerboseJSON
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, "", fmt.Errorf("Transcription result parsing failed: %w", err)
	}
	segments := make([]Segment, 0, len(parsed.Segments))
	for _, seg := range parsed.Segments {
		if strings.TrimSpace(seg.Text) == "" {
			continue
		}
		segments = append(segments, Segment{
			StartMs: int64(math.Round(seg.Start * 1000)),
			EndMs:   int64(math.Round(seg.End * 1000)),
			Text:    strings.TrimSpace(seg.Text),
		})
	}
	return segments, parsed.Language, nil
}
