package skills

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/skillhub"
)

type PublishPlan struct {
	PublicationTarget
	ReviewReason  string            `json:"reviewReason,omitempty"`
	Source        *skillhub.Release `json:"source,omitempty"`
	Instruction   string            `json:"instruction"`
	CanvasID      string            `json:"canvasId,omitempty"`
	ID            string            `json:"planId"`
	SkillID       string            `json:"skillId"`
	VersionID     string            `json:"versionId"`
	ContentHash   string            `json:"contentHash"`
	ArchiveSHA256 string            `json:"archiveSha256"`
	Metadata      skillhub.Metadata `json:"metadata"`
	Files         []skillhub.File   `json:"files"`
	Status        string            `json:"status"`
	SubmissionID  string            `json:"submissionId,omitempty"`
	Revision      int64             `json:"revision,omitempty"`
	Preview       *skillhub.Preview `json:"preview,omitempty"`
	CreatedAt     time.Time         `json:"createdAt"`
}

// The local source and the optional cloud update target are separate identities.
// Metadata.SkillID is populated only after this explicit target is validated.
type PublicationTarget struct {
	Kind          string `json:"publicationTarget"`
	MarketSkillID string `json:"marketSkillId,omitempty"`
}

func resolvePublicationTarget(localID string, meta *skillhub.Metadata, target *PublicationTarget) error {
	invalid := func(message string) error {
		return &kernel.AppError{Status: 400, Code: 400, Reason: "invalid_publication_target", Message: message}
	}
	if meta.SkillID != "" {
		return invalid("metadata.skillId cannot fill in the local machine or market number. For new skills, please select publicationTarget=new; for new versions of existing market skills, please select existing, and fill in the market number into marketSkillId. Please prepare your submission again.")
	}
	if target.Kind == "" {
		target.Kind = "new"
	}
	switch target.Kind {
	case "new":
		if target.MarketSkillID != "" {
			return invalid("New skills cannot specify existing market skill numbers; please clearly select the submission target and prepare again.")
		}
	case "existing":
		if target.MarketSkillID == localID || !agentSkillIDPattern.MatchString(target.MarketSkillID) {
			return invalid("marketSkillId must be the skill number you have published in the skills market, and the local skill number cannot be used; please select new for new submissions.")
		}
		meta.SkillID = target.MarketSkillID
	default:
		return invalid("publicationTarget only accepts new (new skills) or existing (new versions of existing market skills).")
	}
	return nil
}

func (s *Service) planFile(user, id string) (string, error) {
	if !agentSkillIDPattern.MatchString(id) {
		return "", kernel.BadAuthRequest("Contribution draft number is invalid")
	}
	return filepath.Join(s.marketUserDir(user), "plans", id+".json"), nil
}
func (s *Service) PublishPrepare(user, id string, meta skillhub.Metadata, target PublicationTarget) (*PublishPlan, error) {
	return s.PublishPrepareInCanvas(user, id, "", meta, target)
}
func (s *Service) PublishPrepareInCanvas(user, id, canvas string, meta skillhub.Metadata, target PublicationTarget) (*PublishPlan, error) {
	bundle, e := s.SkillPackageBundle(user, id)
	if e != nil {
		return nil, e
	}
	return s.preparePublicationBundle(user, id, canvas, meta, target, bundle)
}

// Repreparing changes metadata only. The saved source plan still binds the
// original owner, canvas and immutable local version, never a replacement file.
func (s *Service) PublishReprepare(user, sourcePlanID string, meta skillhub.Metadata, target PublicationTarget) (*PublishPlan, error) {
	unlock := s.lockMarket(user)
	defer unlock()
	source, err := s.PublishPlan(user, sourcePlanID)
	if err != nil {
		return nil, err
	}
	if source.SubmissionID != "" || source.Status != "awaiting_upload_confirmation" {
		return nil, kernel.NewAppError(409, "This manuscript has been uploaded, please refresh the status and modify it on the official website")
	}
	bundle, err := s.SkillPackageBundle(user, source.SkillID)
	if err != nil {
		return nil, err
	}
	if bundle.VersionID != source.VersionID || bundle.ContentHash != source.ContentHash {
		return nil, kernel.NewAppError(409, "This machine's skills have been updated, and the original manuscript is still retained; please check the current file and prepare again for submission.")
	}
	return s.preparePublicationBundle(user, source.SkillID, source.CanvasID, meta, target, bundle)
}

func (s *Service) preparePublicationBundle(user, id, canvas string, meta skillhub.Metadata, target PublicationTarget, bundle *SkillPackageBundle) (*PublishPlan, error) {
	if bundle.MarketRelease != nil && target.Kind == "" {
		return nil, &kernel.AppError{Status: 400, Code: 400, Reason: "invalid_publication_target", Message: "This skill comes from the market, please explicitly choose to publish a new skill, or an updated version of your own published market skill."}
	}
	if e := resolvePublicationTarget(id, &meta, &target); e != nil {
		return nil, e
	}
	files := map[string][]byte{}
	manifest := []skillhub.File{}
	for _, f := range bundle.Files {
		b, e := base64.StdEncoding.DecodeString(f.ContentBase64)
		if e != nil {
			return nil, e
		}
		if !skillhub.DataFilePath(f.Path) || skillhub.ContainsPrivateData(b) {
			return nil, kernel.BadAuthRequest("Please remove the private configuration or key before submitting")
		}
		files[f.Path] = b
		h := sha256.Sum256(b)
		manifest = append(manifest, skillhub.File{Path: f.Path, SHA256: hex.EncodeToString(h[:]), Size: int64(len(b)), MimeType: f.MimeType})
	}
	data, e := encodeSkillArchive(files)
	if e != nil {
		return nil, e
	}
	if len(data) > skillhub.MaxArchiveBytes {
		return nil, kernel.BadAuthRequest("Submission package exceeds 100MiB")
	}
	if meta.Name == "" {
		meta.Name = bundle.Name
	}
	if meta.Description == "" {
		meta.Description = bundle.Description
	}
	if meta.VersionLabel == "" {
		meta.VersionLabel = bundle.Version
	}
	if source := bundle.MarketRelease; source != nil {
		if meta.License == "" {
			meta.License = source.License
		}
		if meta.SourceURL == "" {
			meta.SourceURL = source.SourceURL
			if meta.SourceURL == "" {
				meta.SourceURL = "https://beeftv.app/skills/" + source.SkillID + "?release=" + source.ReleaseID
			}
		}
		if meta.Requirements == nil {
			meta.Requirements = source.Requirements
		}
		if meta.RequirementNotes == "" {
			meta.RequirementNotes = source.RequirementNotes
		}
		if meta.MinClientVersion == "" {
			meta.MinClientVersion = source.MinClientVersion
		}
	}
	if strings.TrimSpace(meta.License) == "" {
		return nil, kernel.BadAuthRequest("Please select a license for your contribution")
	}
	if meta.Requirements == nil {
		meta.Requirements = []string{}
	}
	if e := validatePublicationRequirements(meta.Requirements); e != nil {
		return nil, e
	}
	if meta.Showcase == nil {
		meta.Showcase = []skillhub.Showcase{}
	}
	sort.Slice(manifest, func(i, j int) bool { return manifest[i].Path < manifest[j].Path })
	sum := sha256.Sum256(data)
	p := &PublishPlan{PublicationTarget: target, Source: bundle.MarketRelease, Instruction: string(files["SKILL.md"]), CanvasID: canvas, ID: kernel.NewID(), SkillID: id, VersionID: bundle.VersionID, ContentHash: bundle.ContentHash, ArchiveSHA256: hex.EncodeToString(sum[:]), Metadata: meta, Files: manifest, Status: "awaiting_upload_confirmation", CreatedAt: time.Now()}
	file, _ := s.planFile(user, p.ID)
	if e = os.MkdirAll(filepath.Dir(file), 0700); e != nil {
		return nil, e
	}
	if e = os.WriteFile(strings.TrimSuffix(file, ".json")+".zip", data, 0600); e != nil {
		return nil, e
	}
	if e = writeMarketJSON(file, p); e != nil {
		return nil, e
	}
	return p, nil
}

func validatePublicationRequirements(requirements []string) error {
	if checkMarketRequirements(requirements) != nil {
		return &kernel.AppError{Status: 400, Code: 400, Reason: "invalid_skill_requirements", Message: "requirements only accept beeftv.canvas, model.image, model.video, model.audio. Please use an empty array [] for pure text skills, and write other conditions into requirementNotes; prepare again for submission after correction."}
	}
	return nil
}
func (s *Service) PublishPlans(user string) ([]PublishPlan, error) {
	unlock := s.lockMarket(user)
	defer unlock()
	files, e := filepath.Glob(filepath.Join(s.marketUserDir(user), "plans", "*.json"))
	if e != nil {
		return nil, e
	}
	plans := []PublishPlan{}
	for _, f := range files {
		var p PublishPlan
		if e = readMarketJSON(f, &p); e != nil {
			return nil, e
		}
		plans = append(plans, p)
	}
	sort.Slice(plans, func(i, j int) bool { return plans[i].CreatedAt.After(plans[j].CreatedAt) })
	return plans, nil
}
func (s *Service) PublishPlan(user, id string) (*PublishPlan, error) {
	file, e := s.planFile(user, id)
	if e != nil {
		return nil, e
	}
	var p PublishPlan
	if e = readMarketJSON(file, &p); e != nil {
		return nil, kernel.BadAuthRequest("Contribution draft does not exist")
	}
	return &p, nil
}

// PublishUpload and PublishSubmit are UI-only actions, never registered as model tools.
func (s *Service) PublishUpload(ctx context.Context, user, id, expectedHash string) (*PublishPlan, error) {
	unlock := s.lockMarket(user)
	defer unlock()
	p, e := s.PublishPlan(user, id)
	if e != nil {
		return nil, e
	}
	if p.ArchiveSHA256 != expectedHash {
		return nil, kernel.NewAppError(409, "The file to be uploaded has changed, please reconfirm")
	}
	if p.Status == "submitted" {
		return p, nil
	}
	if e := validatePublicationRequirements(p.Metadata.Requirements); e != nil {
		return nil, e
	}
	if p.SubmissionID == "" {
		metadata := p.Metadata
		if p.Kind == "existing" && metadata.SkillID == p.MarketSkillID {
			metadata.SkillID = ""
		}
		target := p.PublicationTarget
		if e := resolvePublicationTarget(p.SkillID, &metadata, &target); e != nil {
			return nil, e
		}
	}
	c, e := marketClient()
	if e != nil {
		return nil, e
	}
	token, e := s.marketToken(user, c)
	if e != nil {
		return nil, e
	}
	file, _ := s.planFile(user, id)
	var draft skillhub.Draft
	if p.SubmissionID == "" {
		if e = c.JSON(ctx, "POST", "submissions", token, id+"-create", p.Metadata, &draft); e != nil {
			return nil, e
		}
		p.SubmissionID = draft.SubmissionID
		p.Revision = draft.Revision
		p.Status = "uploading"
		if e = writeMarketJSON(file, p); e != nil {
			return nil, e
		}
	}
	// Read current revision on retries: upload may have succeeded before a lost response.
	if e = c.JSON(ctx, "GET", "submissions/"+p.SubmissionID, token, "", nil, &draft); e != nil {
		return nil, e
	}
	p.Revision = draft.Revision
	// The service canonicalizes ZIP headers. Compare file identity here; refresh
	// separately verifies the downloaded canonical ZIP against its server digest.
	if draft.ContentHash != "" && (draft.ContentHash != p.ContentHash || !samePublicationFiles(draft.Files, p.Files)) {
		return nil, kernel.NewAppError(409, "The server draft is different from the file confirmed for upload, please check and refresh the public preview")
	}
	if p.Preview != nil || p.Status == "needs_preview" || (len(draft.Files) > 0 && draft.ContentHash != "") {
		return s.refreshPublication(ctx, user, c, token, p)
	}
	if draft.Status == "submitted" || draft.Status == "in_review" || draft.Status == "published" {
		p.Status = draft.Status
		_ = writeMarketJSON(file, p)
		return p, nil
	}
	data, e := os.ReadFile(strings.TrimSuffix(file, ".json") + ".zip")
	if e != nil {
		return nil, e
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != expectedHash {
		return nil, kernel.NewAppError(409, "Verification of the file to be uploaded failed")
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, e := form.CreateFormFile("file", "skill.zip")
	if e != nil {
		return nil, e
	}
	if _, e = part.Write(data); e != nil {
		return nil, e
	}
	_ = form.WriteField("revision", fmt.Sprint(p.Revision))
	if e = form.Close(); e != nil {
		return nil, e
	}
	res, e := c.Request(ctx, "POST", "submissions/"+p.SubmissionID+"/uploads", token, form.FormDataContentType(), "", &body)
	if e != nil {
		return nil, e
	}
	if e = skillhub.Decode(res, &draft); e != nil {
		return nil, e
	}
	return s.refreshPublication(ctx, user, c, token, p)
}

func samePublicationFiles(left, right []skillhub.File) bool {
	if len(left) != len(right) {
		return false
	}
	files := make(map[string]skillhub.File, len(left))
	for _, file := range left {
		if _, exists := files[file.Path]; exists {
			return false
		}
		files[file.Path] = file
	}
	for _, file := range right {
		other, exists := files[file.Path]
		if !exists || other.Size != file.Size || other.SHA256 != file.SHA256 {
			return false
		}
		delete(files, file.Path)
	}
	return len(files) == 0
}
func (s *Service) PublishSubmit(ctx context.Context, user, id string, revision int64, digest string) (*PublishPlan, error) {
	unlock := s.lockMarket(user)
	defer unlock()
	p, e := s.PublishPlan(user, id)
	if e != nil {
		return nil, e
	}
	if p.Preview == nil || p.Preview.Revision != revision || p.Preview.PreviewDigest != digest {
		return nil, kernel.NewAppError(409, "The preview has changed, please reconfirm the public content")
	}
	c, e := marketClient()
	if e != nil {
		return nil, e
	}
	token, e := s.marketToken(user, c)
	if e != nil {
		return nil, e
	}
	var d skillhub.Draft
	var current skillhub.Preview
	if e = c.JSON(ctx, "GET", "submissions/"+p.SubmissionID+"/preview", token, "", nil, &current); e != nil {
		return nil, e
	}
	if current.Revision != revision || current.PreviewDigest != digest {
		return nil, kernel.NewAppError(409, "The server preview has changed, please reconfirm the public content.")
	}
	e = c.JSON(ctx, "POST", "submissions/"+p.SubmissionID+"/submit", token, p.ID+"-submit-"+digest, map[string]any{"revision": revision, "previewDigest": digest}, &d)
	if e != nil {
		return nil, e
	}
	p.Status = d.Status
	p.Revision = d.Revision
	file, _ := s.planFile(user, id)
	if e = writeMarketJSON(file, p); e != nil {
		return nil, e
	}
	return p, nil
}
func (s *Service) MarketSubmissions(ctx context.Context, user string) (any, error) {
	c, e := marketClient()
	if e != nil {
		return nil, e
	}
	token, e := s.marketToken(user, c)
	if e != nil {
		return nil, e
	}
	var result json.RawMessage
	e = c.JSON(ctx, "GET", "submissions", token, "", nil, &result)
	return result, e
}

func (s *Service) PublicationStatus(ctx context.Context, user, id string) (*PublishPlan, error) {
	unlock := s.lockMarket(user)
	defer unlock()
	p, e := s.PublishPlan(user, id)
	if e != nil {
		return nil, e
	}
	if p.SubmissionID == "" {
		return p, nil
	}
	c, e := marketClient()
	if e != nil {
		return nil, e
	}
	token, e := s.marketToken(user, c)
	if e != nil {
		return nil, e
	}
	var d skillhub.Draft
	if e = c.JSON(ctx, "GET", "submissions/"+p.SubmissionID, token, "", nil, &d); e != nil {
		return nil, e
	}
	if (d.Status == "draft" || d.Status == "ready_to_submit") && p.Preview != nil && d.Revision != p.Preview.Revision {
		p.Preview = nil
		p.Instruction = ""
		p.Metadata = d.Metadata
		p.Files = d.Files
		p.Revision = d.Revision
		p.Status = "needs_preview"
		f, _ := s.planFile(user, id)
		if e = writeMarketJSON(f, p); e != nil {
			return nil, e
		}
		return p, nil
	}
	if d.Status != "draft" && d.Status != "ready_to_submit" {
		p.Status = d.Status
		p.Revision = d.Revision
		f, _ := s.planFile(user, id)
		if e = writeMarketJSON(f, p); e != nil {
			return nil, e
		}
	}
	return p, nil
}
