package skillhubcli

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/skillhub"
)

type bundle struct {
	Metadata      skillhub.Metadata `json:"metadata"`
	Files         []skillhub.File   `json:"files"`
	ContentHash   string            `json:"contentHash"`
	ArchiveSHA256 string            `json:"archiveSha256"`
	ArchiveBytes  int               `json:"archiveBytes"`
	Archive       []byte            `json:"-"`
}

func inspectBundle(directory, metadataFile string) (*bundle, error) {
	if directory == "" || metadataFile == "" {
		return nil, fail("metadata_required", "Please specify the skills directory and --metadata file")
	}
	f, err := os.Open(metadataFile)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var metadata skillhub.Metadata
	decoder := json.NewDecoder(io.LimitReader(f, 64<<10))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&metadata); err != nil {
		return nil, fmt.Errorf("Submission meta information is not valid JSON: %w", err)
	}
	if metadata.Name == "" || metadata.Description == "" || metadata.License == "" || metadata.VersionLabel == "" {
		return nil, fail("invalid_metadata", "Contribution meta information requires name, introduction, license and version")
	}
	if utf8.RuneCountInString(metadata.Description) > skillhub.MaxDescriptionRunes {
		return nil, fail("invalid_metadata", "Submission meta information introduction cannot exceed 1024 words")
	}
	if metadata.Requirements == nil {
		metadata.Requirements = []string{}
	}
	if metadata.Showcase == nil {
		metadata.Showcase = []skillhub.Showcase{}
	}
	root, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	rootInfo, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !rootInfo.IsDir() || rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, fail("invalid_directory", "Please provide a real skills catalog")
	}
	files := map[string][]byte{}
	caseNames := map[string]bool{}
	var total int64
	err = filepath.WalkDir(root, func(file string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if file == root {
			return nil
		}
		rel, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		for _, part := range strings.Split(rel, "/") {
			if (strings.HasPrefix(part, ".") && part != ".env" && !strings.HasPrefix(strings.ToLower(part), ".env.")) || part == "__MACOSX" || strings.EqualFold(part, "node_modules") {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fail("invalid_package", "Skill packs cannot contain soft links")
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		base := strings.ToLower(filepath.Base(rel))
		if base == ".env" || strings.HasPrefix(base, ".env.") || base == "credentials.json" || base == "tokens.json" || base == "secrets.json" || base == "auth.json" || strings.Contains(base, "private_key") || base == "id_rsa" || base == "id_ed25519" || strings.HasSuffix(base, ".pem") || strings.HasSuffix(base, ".key") {
			return fail("private_file", "The file seems to contain submission credentials or private keys, please remove them first")
		}
		if !info.Mode().IsRegular() || !skillhub.DataFilePath(rel) || caseNames[strings.ToLower(rel)] {
			return fail("invalid_package", "Skill pack contains unsafe paths or duplicate names")
		}
		remaining := int64(skillhub.MaxPackageBytes) - total
		if info.Size() > remaining {
			return fail("package_too_large", "Skill file exceeds publishing size limit")
		}
		input, err := os.Open(file)
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(input, remaining+1))
		input.Close()
		if err != nil {
			return err
		}
		if skillhub.ContainsPrivateData(data) {
			return fail("private_file", "The file seems to contain submission credentials or private keys, please remove them first")
		}
		total += int64(len(data))
		if total > skillhub.MaxPackageBytes {
			return fail("package_too_large", "Skill file exceeds publishing size limit")
		}
		files[rel] = data
		caseNames[strings.ToLower(rel)] = true
		return nil
	})
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(files["SKILL.md"]) {
		return nil, fail("invalid_package", "SKILL.md must be UTF-8")
	}
	if _, err = skillhub.SkillName(files["SKILL.md"]); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	result := &bundle{Metadata: metadata, Files: []skillhub.File{}, ContentHash: skillhub.ContentDigest(files)}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for _, name := range names {
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(0600)
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return nil, err
		}
		if _, err = entry.Write(files[name]); err != nil {
			return nil, err
		}
		mimeType := mime.TypeByExtension(filepath.Ext(name))
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		result.Files = append(result.Files, skillhub.File{Path: name, SHA256: skillhub.Digest(files[name]), Size: int64(len(files[name])), MimeType: mimeType})
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	if archive.Len() > skillhub.MaxArchiveBytes {
		return nil, fail("package_too_large", "The compressed package exceeds 100 MiB")
	}
	result.Archive = archive.Bytes()
	result.ArchiveBytes = archive.Len()
	result.ArchiveSHA256 = skillhub.Digest(result.Archive)
	return result, nil
}
