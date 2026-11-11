package skills

import (
	"archive/zip"
	"bytes"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentLargeSkillInstruction(t *testing.T) {
	s, _ := agentSkillFixture(t)
	body := "---\nname: director\ndescription: Long skills test\n---" + strings.Repeat("lens", 13000)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": body})
	if _, err := s.ValidateAgentSkills("owner", []Pin{pin}); err != nil {
		t.Fatal(err)
	}
	resource, err := s.AgentVersion("owner", pin)
	if err != nil || resource.Instruction != body {
		t.Fatalf("large skill was rejected or truncated: %v", err)
	}
	large := installAgentSkill(t, s, map[string]string{"SKILL.md": "---\nname: too big\ndescription: upper limit test\n---" + strings.Repeat("chars", 90000)})
	if _, err := s.ValidateAgentSkills("owner", []Pin{large}); err == nil {
		t.Fatal("oversized skill accepted")
	}
}

func agentSkillFixture(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	raw, _ := db.DB()
	t.Cleanup(func() { raw.Close() })
	return New(repository.New(db), t.TempDir(), nil), db
}

func installAgentSkill(t *testing.T, s *Service, files map[string]string) Pin {
	t.Helper()
	var packageBytes bytes.Buffer
	zw := zip.NewWriter(&packageBytes)
	for name, content := range files {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(f, content)
	}
	zw.Close()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, _ := form.CreateFormFile("file", "user-skill.zip")
	file.Write(packageBytes.Bytes())
	form.Close()
	request := httptest.NewRequest("POST", "/skills/install", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.ParseMultipartForm(20 << 20)
	defer request.MultipartForm.RemoveAll()
	header := request.MultipartForm.File["file"][0]
	installed, err := s.InstallSkillUpload("owner", "zip", header, SkillInstallRequest{IsPrivate: true})
	if err != nil {
		t.Fatal(err)
	}
	return Pin{SkillID: installed.SkillID, VersionID: installed.VersionID, ContentHash: installed.ContentHash}
}

func TestInstalledUserSkillTasksUsePinnedBodyAndAuxiliaryFiles(t *testing.T) {
	s, _ := agentSkillFixture(t)
	cases := []struct {
		name, body, reference, path string
		scriptSupported             bool
		unsupportedCap              string
	}{
		{"Coffee short storyboard", "Read references/shots.md, create a draft shot for each of the three paragraphs, and do not generate it.", "Grinding beans; hand brewing; dessert", "references/shots.md", false, ""},
		{"interview slices", "Read references/interview.md, only use original words to mark the reserved intervals, and no fabricated interviews are allowed.", "00:02-00:06 The protagonist said: Practice every day.", "references/interview.md", false, ""},
		{"Sound review Python", "Read scripts/listen.py; submit confirmation when you need to run the script.", "print('audio ok')", "scripts/listen.py", true, ""},
		{"script directory singular", "Read script/run.js; submit confirmation when you need to run the script.", "console.log('ok')", "script/run.js", true, ""},
		{"Unsupported script interpreter", "Read scripts/legacy.txt; unsupported interpreters explicitly prompt.", "puts 'unsupported'", "scripts/legacy.txt", false, "unsupported_script_interpreter"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "---\nname: " + tc.name + "description: The creative process uploaded by the user\n---" + tc.body, tc.path: tc.reference})
			if _, err := s.ValidateAgentSkills("owner", []Pin{pin}); err != nil {
				t.Fatal(err)
			}
			resource, err := s.AgentVersion("owner", pin)
			if err != nil {
				t.Fatal(err)
			}
			file, err := s.AgentFile("owner", pin, tc.path)
			if err != nil || file.Content != tc.reference {
				t.Fatalf("file=%+v err=%v", file, err)
			}
			if file.ExecutionSupported != tc.scriptSupported {
				t.Fatalf("ExecutionSupported=%v, want %v", file.ExecutionSupported, tc.scriptSupported)
			}
			if tc.unsupportedCap == "" && len(resource.UnsupportedCapabilities) != 0 {
				t.Fatalf("unexpected UnsupportedCapabilities=%v", resource.UnsupportedCapabilities)
			}
			if tc.unsupportedCap != "" && (len(resource.UnsupportedCapabilities) != 1 || resource.UnsupportedCapabilities[0] != tc.unsupportedCap) {
				t.Fatalf("UnsupportedCapabilities=%v, want [%s]", resource.UnsupportedCapabilities, tc.unsupportedCap)
			}
			if _, err := s.AgentVersion("foreign", pin); err == nil {
				t.Fatal("private package leaked")
			}
			for _, path := range []string{"../SKILL.md", "/etc/passwd", "references/missing.md"} {
				if _, err := s.AgentFile("owner", pin, path); err == nil {
					t.Fatalf("path accepted %s", path)
				}
			}
		})
	}
}

func TestSkillPinUpdateRestartUninstallAndCorruption(t *testing.T) {
	s, db := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "# original\n\nKeep the original shooting requirements.", "references/shot.md": "Older lenses"})
	skill, _ := s.ownedSkill("owner", pin.SkillID)
	archive, _ := archiveFromZip(skillZip(t, map[string]string{"SKILL.md": "# new version\n\nUse the new version requirements instead.", "references/shot.md": "New lens"}), "")
	if err := s.addSkillArchiveVersion(skill, archive, "zip", "", "", "", "", false); err != nil {
		t.Fatal(err)
	}
	reopened := New(repository.New(db), s.dataDir, nil)
	old, err := reopened.AgentFile("owner", pin, "references/shot.md")
	if err != nil || old.Content != "Older lenses" {
		t.Fatalf("pinned version drifted %v %+v", err, old)
	}
	wrong := pin
	wrong.ContentHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := s.AgentVersion("owner", wrong); err == nil {
		t.Fatal("hash mismatch accepted")
	}
	other := installAgentSkill(t, s, map[string]string{"SKILL.md": "# another\n\nDescription"})
	wrong = pin
	wrong.VersionID = other.VersionID
	if _, err := s.AgentVersion("owner", wrong); err == nil {
		t.Fatal("foreign skill version accepted")
	}
	db.Model(&model.SkillFile{}).Where("skill_version_id = ? AND path = ?", pin.VersionID, "references/shot.md").Update("sha256", other.ContentHash)
	if _, err := s.AgentFile("owner", pin, "references/shot.md"); err == nil {
		t.Fatal("corrupt auxiliary accepted")
	}
	skill.IsPrivate = false
	if err := s.repo.SaveSkill(skill); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetSkillAdded("consumer", pin.SkillID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetSkillAdded("consumer", pin.SkillID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.AgentVersion("consumer", pin); err == nil {
		t.Fatal("uninstalled pin resumed")
	}
}
