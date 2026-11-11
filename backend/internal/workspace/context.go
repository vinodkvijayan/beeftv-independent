package workspace

import (
	"errors"
	"strings"
)

// Context is the stable ownership scope for a local installation. ID remains
// compatible with existing user_id columns until the schema migration phase.
type Context struct {
	ID      string `json:"id"`
	DataDir string `json:"dataDir"`
}

func (c Context) Validate() error {
	if strings.TrimSpace(c.ID) == "" {
		return errors.New("Workspace ID cannot be empty")
	}
	if strings.TrimSpace(c.DataDir) == "" {
		return errors.New("The workspace data directory cannot be empty")
	}
	return nil
}
