package eagle

import (
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"infinite-canvas/backend/internal/kernel"
)

// Client talks to the user-local Eagle HTTP API and opens jailed library files.
type Client struct {
	transport http.RoundTripper
}

func New() *Client {
	return &Client{}
}

func (c *Client) Library(rawBaseURL string) (*Library, error) {
	baseURL, err := validateBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	var response struct {
		Status string `json:"status"`
		Data   struct {
			Folders            []Folder `json:"folders"`
			ApplicationVersion string   `json:"applicationVersion"`
			Library            struct {
				Path string `json:"path"`
				Name string `json:"name"`
			} `json:"library"`
		} `json:"data"`
	}
	if err := c.jsonRequest(http.MethodGet, baseURL, "/api/library/info", nil, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" {
		return nil, errors.New("Eagle does not return a successful status, please confirm that Eagle has been started and the material library is opened.")
	}
	folders := flattenFolders(response.Data.Folders, "")
	return &Library{
		ApplicationVersion: response.Data.ApplicationVersion,
		LibraryName:        response.Data.Library.Name,
		LibraryPath:        response.Data.Library.Path,
		Folders:            folders,
	}, nil
}

func (c *Client) Items(rawBaseURL string, query ItemQuery) ([]Item, error) {
	baseURL, err := validateBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	limit := query.Limit
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}
	params := url.Values{}
	params.Set("limit", fmt.Sprintf("%d", limit))
	params.Set("offset", fmt.Sprintf("%d", offset))
	if query.FolderID != "" {
		params.Set("folders", query.FolderID)
	}
	if strings.TrimSpace(query.Keyword) != "" {
		params.Set("keyword", strings.TrimSpace(query.Keyword))
	}
	var response struct {
		Status string `json:"status"`
		Data   []Item `json:"data"`
	}
	if err := c.jsonRequest(http.MethodGet, baseURL, "/api/item/list?"+params.Encode(), nil, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" {
		return nil, errors.New("Eagle did not return the material list")
	}
	for index := range response.Data {
		item := &response.Data[index]
		item.Extension = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(item.Extension)), ".")
		normalizeItemCollections(item)
	}
	return response.Data, nil
}

func (c *Client) OpenFile(rawBaseURL string, itemID string) (*File, error) {
	if !validItemID(itemID) {
		return nil, kernel.BadAuthRequest("Eagle asset ID is invalid")
	}
	baseURL, err := validateBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	library, err := c.Library(rawBaseURL)
	if err != nil {
		return nil, err
	}
	thumbnailPath, err := c.thumbnailPath(baseURL, itemID, "Eagle did not return the material path", "Eagle material path encoding is invalid")
	if err != nil {
		return nil, err
	}
	resolved, err := originalPath(thumbnailPath, itemID, library.LibraryPath)
	if err != nil {
		return nil, err
	}
	return openLocalFile(resolved, "Unable to read Eagle raw file, please confirm that the library is still available")
}

func (c *Client) OpenThumbnail(rawBaseURL string, itemID string) (*File, error) {
	if !validItemID(itemID) {
		return nil, kernel.BadAuthRequest("Eagle asset ID is invalid")
	}
	baseURL, err := validateBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	library, err := c.Library(rawBaseURL)
	if err != nil {
		return nil, err
	}
	thumbnailPath, err := c.thumbnailPath(baseURL, itemID, "Eagle does not return thumbnail path", "Eagle thumbnail path encoding is invalid")
	if err != nil {
		return nil, err
	}
	jailed, err := thumbnailInsideLibrary(thumbnailPath, itemID, library.LibraryPath)
	if err != nil {
		return nil, err
	}
	return openLocalFile(jailed, "Unable to read Eagle thumbnail")
}

func (c *Client) thumbnailPath(baseURL *url.URL, itemID string, missingMessage string, encodingMessage string) (string, error) {
	var response struct {
		Status string `json:"status"`
		Data   string `json:"data"`
	}
	pathQuery := "/api/item/thumbnail?id=" + url.QueryEscape(itemID)
	if err := c.jsonRequest(http.MethodGet, baseURL, pathQuery, nil, &response); err != nil {
		return "", err
	}
	if response.Status != "success" || strings.TrimSpace(response.Data) == "" {
		return "", errors.New(missingMessage)
	}
	decoded, err := url.PathUnescape(response.Data)
	if err != nil {
		return "", errors.New(encodingMessage)
	}
	return decoded, nil
}

func (c *Client) AddItem(rawBaseURL string, request AddItemRequest) (*CreatedItem, error) {
	if !isMediaDataURL(request.URL) {
		return nil, kernel.BadAuthRequest("Writing to Eagle only accepts image, video or audio data")
	}
	if strings.TrimSpace(request.Name) == "" {
		return nil, kernel.BadAuthRequest("Asset name must be provided when writing to Eagle")
	}
	baseURL, err := validateBaseURL(rawBaseURL)
	if err != nil {
		return nil, err
	}
	var response struct {
		Status string      `json:"status"`
		Data   CreatedItem `json:"data"`
	}
	if err := c.jsonRequest(http.MethodPost, baseURL, "/api/item/addFromURL", request, &response); err != nil {
		return nil, err
	}
	if response.Status != "success" {
		return nil, errors.New("Eagle refuses to write material")
	}
	return &response.Data, nil
}

func (c *Client) CreateFolder(rawBaseURL string, name string, parentID string) error {
	if strings.TrimSpace(name) == "" {
		return kernel.BadAuthRequest("Eagle folder name cannot be empty")
	}
	baseURL, err := validateBaseURL(rawBaseURL)
	if err != nil {
		return err
	}
	payload := struct {
		FolderName string `json:"folderName"`
		Parent     string `json:"parent,omitempty"`
	}{FolderName: strings.TrimSpace(name), Parent: strings.TrimSpace(parentID)}
	var response struct {
		Status string `json:"status"`
	}
	if err := c.jsonRequest(http.MethodPost, baseURL, "/api/folder/create", payload, &response); err != nil {
		return err
	}
	if response.Status != "success" {
		return errors.New("Eagle folder creation failed")
	}
	return nil
}

func flattenFolders(folders []Folder, parentID string) []Folder {
	result := make([]Folder, 0, len(folders))
	for _, folder := range folders {
		folder.ParentID = parentID
		children := flattenFolders(folder.Children, folder.ID)
		folder.Children = nil
		result = append(result, folder)
		result = append(result, children...)
	}
	return result
}

func openLocalFile(path string, missingMessage string) (*File, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.New(missingMessage)
	}
	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return &File{Path: path, Name: filepath.Base(path), Size: stat.Size(), MimeType: mimeType, Body: file}, nil
}
