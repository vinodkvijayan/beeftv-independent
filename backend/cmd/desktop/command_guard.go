package main

import (
	"fmt"
	"strings"
)

// Desktop platform flags may be supplied by LaunchServices/WebView. Positional
// CLI commands must never continue into desktop startup or open a database.
func validateDesktopArgs(args []string) error {
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--data-dir" {
			if i+1 == len(args) {
				return fmt.Errorf("--data-dir requires an explicit absolute directory")
			}
			if _, err := explicitDesktopDataDir(args[i+1]); err != nil {
				return err
			}
			i++
			continue
		}
		if strings.HasPrefix(arg, "beeftv:") {
			if _, err := skillLinkRoute(arg); err != nil {
				return err
			}
			continue
		}
		switch arg {
		case "--harness-attach-only":
			return fmt.Errorf("--harness-attach-only needs to be specified at the same time --harness-runtime")
		case "mcp", "ops", "canvas", "asset", "task", "client", "help", "--help", "-h", "--version", "--json", "-json":
			return fmt.Errorf("This program is the BeefTV desktop application. CLI/MCP Please use the beeftv command line program; re-copy the client configuration in BeefTV settings")
		}
		// Cocoa also accepts preference overrides as flag/value pairs.
		if (strings.HasPrefix(arg, "-NS") || strings.HasPrefix(arg, "-Apple")) && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
			i++
			continue
		}
		if !strings.HasPrefix(arg, "-") {
			return fmt.Errorf("BeefTV desktop application does not support command %q; CLI/MCP please use beeftv command line program", arg)
		}
	}
	return nil
}
