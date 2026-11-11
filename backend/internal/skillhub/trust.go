package skillhub

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
)

// Trust keys are provisioned separately from the catalog and desktop updater.
// Without pinned keys the transport's configured HTTPS origin is the trust source.
func VerifyRelease(r *Release) error {
	raw := os.Getenv("BEEFTV_SKILLHUB_TRUSTED_KEYS")
	if raw == "" {
		if os.Getenv("BEEFTV_SKILLHUB_REQUIRE_SIGNATURE") == "true" {
			return fmt.Errorf("The skills market signature verification public key has not been configured yet")
		}
		return nil
	}
	var keys map[string]string
	if json.Unmarshal([]byte(raw), &keys) != nil || len(keys) == 0 {
		return fmt.Errorf("The skills market signature verification public key configuration is invalid.")
	}
	a := r.Attestation
	if a == nil || a.Algorithm != "Ed25519" {
		return fmt.Errorf("Skill version lacks trusted signature")
	}
	public, e := base64.StdEncoding.DecodeString(keys[a.KeyID])
	if e != nil || len(public) != ed25519.PublicKeySize {
		return fmt.Errorf("Skill version's signing key is not trusted")
	}
	payload, e := base64.StdEncoding.DecodeString(a.Payload)
	if e != nil {
		return fmt.Errorf("The skill version signature content is invalid")
	}
	sig, e := base64.StdEncoding.DecodeString(a.Signature)
	if e != nil || !ed25519.Verify(public, payload, sig) {
		return fmt.Errorf("Skill version signature verification failed")
	}
	var signed Release
	if json.Unmarshal(payload, &signed) != nil || signed.Attestation != nil {
		return fmt.Errorf("The skill signature content cannot be read")
	}
	actual := *r
	actual.Attestation = nil
	actual.Compatibility = nil
	signed.Compatibility = nil
	if !reflect.DeepEqual(signed, actual) {
		return fmt.Errorf("The skill version content does not match the signature")
	}
	return nil
}
