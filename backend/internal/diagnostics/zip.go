package diagnostics

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"time"
)

func buildZIP(brandName string, bundleID string, manifest manifest, collection *collection) ([]byte, error) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeZipFile(archive, "manifest.json", append(manifestData, byte(10))); err != nil {
		return nil, err
	}
	newline := string(rune(10))
	readme := fmt.Sprintf("%s User diagnostic package %s%s Diagnosis number: %s%s Time range: %s to %s%s%s This file is actively exported by the user and only contains a desensitization diagnostic summary within a limited time range. %s", brandName, newline, newline, bundleID, newline, collection.Window.From.Format(time.RFC3339), collection.Window.To.Format(time.RFC3339), newline, newline, newline)
	if err := writeZipFile(archive, "README.txt", []byte(readme)); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "client/events.jsonl", collection.ClientEvents); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/events.jsonl", collection.BackendEvents); err != nil {
		return nil, err
	}
	for name, record := range map[string]any{"context/client-coverage.json": collection.ClientCoverage, "backend/event-coverage.json": collection.TraceCoverage} {
		body, err := json.MarshalIndent(record, "", "  ")
		if err != nil {
			return nil, err
		}
		if err := writeZipFile(archive, name, append(body, byte(10))); err != nil {
			return nil, err
		}
	}
	if err := writeJSONL(archive, "backend/assistant-turns.jsonl", collection.AssistantTurns); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/assistant-runtime.jsonl", collection.AssistantEvidence); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/resources.jsonl", collection.Resources); err != nil {
		return nil, err
	}
	findings, err := json.MarshalIndent(collection.Findings, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeZipFile(archive, "findings.json", append(findings, byte(10))); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/tasks.jsonl", collection.Tasks); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/canvas-bindings.jsonl", collection.CanvasBindings); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/task-logs.jsonl", collection.TaskLogs); err != nil {
		return nil, err
	}
	if err := writeJSONL(archive, "backend/upstream-calls.jsonl", collection.APICalls); err != nil {
		return nil, err
	}
	runtimeData, err := json.MarshalIndent(collection.Runtime, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeZipFile(archive, "context/runtime.json", append(runtimeData, byte(10))); err != nil {
		return nil, err
	}
	environmentData, err := json.MarshalIndent(collection.Environment, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := writeZipFile(archive, "context/environment.json", append(environmentData, byte(10))); err != nil {
		return nil, err
	}
	if collection.ModelConfig != nil {
		configData, err := json.MarshalIndent(collection.ModelConfig, "", "  ")
		if err != nil {
			return nil, err
		}
		if err := writeZipFile(archive, "context/model-config.json", append(configData, byte(10))); err != nil {
			return nil, err
		}
	}
	if collection.UpdateLog != nil {
		metadata, err := json.MarshalIndent(collection.UpdateLog, "", "  ")
		if err != nil {
			return nil, err
		}
		if err := writeZipFile(archive, "desktop/update-log.json", metadata); err != nil {
			return nil, err
		}
		if err := writeZipFile(archive, "desktop/update.log", []byte(collection.UpdateLog.Text)); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func writeJSONL[T any](archive *zip.Writer, name string, records []T) error {
	var data bytes.Buffer
	for _, record := range records {
		encoded, err := json.Marshal(record)
		if err != nil {
			return err
		}
		data.Write(encoded)
		data.WriteByte(10)
	}
	return writeZipFile(archive, name, data.Bytes())
}

func writeZipFile(archive *zip.Writer, name string, data []byte) error {
	file, err := archive.Create(name)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	return err
}
