package depthruntime

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type signedManifestEnvelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}

func decodeManifestJSON(data []byte, destination any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("Listing contains redundant content")
	}
	return nil
}

func verifySignedManifest(raw []byte, public ed25519.PublicKey) (Manifest, error) {
	if len(public) != ed25519.PublicKeySize {
		return Manifest{}, errors.New("Missing trusted deep component public key")
	}
	var envelope signedManifestEnvelope
	if err := decodeManifestJSON(raw, &envelope); err != nil {
		return Manifest{}, fmt.Errorf("Deepin component signature encapsulation is invalid: %w", err)
	}
	payload, payloadErr := base64.StdEncoding.DecodeString(strings.TrimSpace(envelope.Payload))
	signature, signatureErr := base64.StdEncoding.DecodeString(strings.TrimSpace(envelope.Signature))
	if payloadErr != nil || signatureErr != nil || len(signature) != ed25519.SignatureSize || !ed25519.Verify(public, payload, signature) {
		return Manifest{}, errors.New("Deepin component manifest signature verification failed")
	}
	var manifest Manifest
	if err := decodeManifestJSON(payload, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("Invalid content of deepin component list: %w", err)
	}
	if manifest.Version != 2 || len(manifest.Runtimes) == 0 {
		return Manifest{}, errors.New("The deep component manifest version or runtime package is empty")
	}
	return manifest, nil
}

// VerifyManifest uses the same trust contract in the release gate and installer.
func VerifyManifest(raw []byte, public ed25519.PublicKey) (Manifest, error) {
	return verifySignedManifest(raw, public)
}
