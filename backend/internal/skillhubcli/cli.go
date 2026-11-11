// Package skillhubcli implements remote market commands without a desktop runtime.
package skillhubcli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"infinite-canvas/backend/internal/skillhub"
)

type Error struct {
	Code            int
	Reason, Message string
	RetryAfter      string
}

func (e *Error) Error() string          { return e.Message }
func fail(reason, message string) error { return &Error{Code: 2, Reason: reason, Message: message} }

type arguments struct {
	command    string
	positional []string
	options    map[string]string
}

func parse(args []string) (arguments, error) {
	a := arguments{command: "help", options: map[string]string{}}
	if len(args) == 0 {
		return a, nil
	}
	a.command = args[0]
	for i := 1; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "--") {
			a.positional = append(a.positional, arg)
			continue
		}
		key := strings.TrimPrefix(arg, "--")
		switch key {
		case "json", "confirm-upload", "confirm-submit", "help":
			a.options[key] = "true"
		case "market", "release", "target", "capabilities", "page", "page-size", "output", "agent", "scope", "project", "state", "metadata", "content-hash", "archive-sha256", "revision", "preview-digest":
			if i+1 >= len(args) || strings.HasPrefix(args[i+1], "--") {
				return a, fail("invalid_arguments", "Missing --"+key+" value")
			}
			if _, exists := a.options[key]; exists {
				return a, fail("invalid_arguments", "Parameter duplication: --"+key)
			}
			i++
			a.options[key] = args[i]
		default:
			return a, fail("invalid_arguments", "Unknown parameters:"+arg)
		}
	}
	return a, nil
}

func emit(out io.Writer, value any) error { return json.NewEncoder(out).Encode(value) }

func Run(ctx context.Context, args []string, out io.Writer) error {
	err := run(ctx, args, out)
	var remote *skillhub.Error
	if errors.As(err, &remote) {
		code := 9
		switch remote.Status {
		case 400, 422:
			code = 8
		case 401, 403:
			code = 6
		case 404:
			code = 3
		case 409:
			code = 4
		}
		message := remote.Message
		if message == "" {
			message = "Skill Market request failed"
		}
		return &Error{Code: code, Reason: remote.Reason, Message: message, RetryAfter: remote.RetryAfter}
	}
	return err
}

func run(ctx context.Context, args []string, out io.Writer) error {
	a, err := parse(args)
	if err != nil {
		return err
	}
	if a.command == "help" || a.command == "--help" || a.options["help"] == "true" {
		_, err = io.WriteString(out, "beeftv skills — A skills marketplace client that doesn’t require running BeefTV\n\nsearch QUERY [--target codex|claude-code|beeftv] [--json]\nshow SKILL_ID --release RELEASE_ID\nfetch SKILL_ID --release RELEASE_ID --output DIRECTORY\ninstall SKILL_ID --release RELEASE_ID --agent codex|claude-code --scope project|user\ninspect DIRECTORY --metadata FILE\nauthorize --state FILE\npoll --state FILE\nupload DIRECTORY --metadata FILE --state FILE --confirm-upload --content-hash HASH --archive-sha256 HASH\npreview|status|revoke --state FILE\nsubmit --state FILE --confirm-submit --revision NUMBER --preview-digest DIGEST\n\nPublic inquiries do not log in. Submission requires browser authorization, and uploading and publishing are confirmed separately.\nAll network commands can use --market to specify a trusted HTTPS market or native test service.")
		return err
	}
	base := a.options["market"]
	if base == "" {
		base = os.Getenv("BEEFTV_SKILLHUB_URL")
	}
	if base == "" {
		base = skillhub.DefaultURL
	}
	c, err := skillhub.New(base)
	if err != nil {
		return err
	}
	capabilities := []string{}
	if value := a.options["capabilities"]; value != "" {
		for _, v := range strings.Split(value, ",") {
			capabilities = append(capabilities, strings.TrimSpace(v))
		}
	}
	switch a.command {
	case "search":
		page, size, err := pageOptions(a)
		if err != nil {
			return err
		}
		result, err := c.Search(ctx, strings.Join(a.positional, " "), a.options["target"], capabilities, page, size)
		if err != nil {
			return err
		}
		return emit(out, result)
	case "show", "fetch", "install":
		if len(a.positional) != 1 || a.options["release"] == "" {
			return fail("release_required", "Please specify the skill ID and --release release ID")
		}
		target := a.options["target"]
		if a.command == "install" {
			target = a.options["agent"]
		}
		discovery, err := c.Discover(ctx, a.positional[0], a.options["release"], target, capabilities)
		if err != nil {
			return err
		}
		r := &discovery.Release
		if a.command == "show" {
			return emit(out, discovery)
		}
		if a.command == "install" {
			if discovery.Compatibility.Status != "supported" {
				return fail("capability_check_required", "Target Assistant does not yet meet the usage requirements stated in this version, please check the details first")
			}
			available := map[string]bool{}
			for _, v := range capabilities {
				available[v] = true
			}
			for _, required := range r.Requirements {
				if !available[required] {
					return fail("capability_check_required", "Goal helpers lack the ability to declare:"+required)
				}
			}
			if r.MinClientVersion != "" {
				return fail("client_version_unverified", "This skill requires a specific client version, please confirm compatibility in the target application first")
			}
		}
		data, err := c.Archive(ctx, r.DownloadURL)
		if err != nil {
			return err
		}
		files, err := skillhub.VerifyArchive(data, r)
		if err != nil {
			return &Error{Code: 4, Reason: "archive_integrity", Message: err.Error()}
		}
		destination := a.options["output"]
		if a.command == "install" {
			destination, err = installDestination(a, r, files)
			if err != nil {
				return err
			}
		}
		if destination == "" {
			return fail("output_required", "fetch requires --output target directory")
		}
		installed, err := writeRelease(destination, files, r, c.BaseURL())
		if err != nil {
			return err
		}
		return emit(out, map[string]any{"skillId": r.SkillID, "releaseId": r.ReleaseID, "contentHash": r.ContentHash, "path": installed, "installed": a.command == "install", "activated": false, "integrity": "origin-and-content-digests", "verification": "unverified"})
	case "inspect", "publish", "authorize", "poll", "upload", "preview", "submit", "status", "revoke":
		return runPublishing(ctx, c, a, out)
	default:
		return fail("unknown_command", fmt.Sprintf("Unknown skill command: %s", a.command))
	}
}
