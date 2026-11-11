package main

import (
	"flag"
	"io"
	"os"

	"infinite-canvas/backend/internal/diagnostics"
)

func runDiagnostics(args []string) error {
	if len(args) == 0 || args[0] != "analyze" {
		return &cliError{code: exitUsage, reason: "invalid_diagnostics_command", msg: "Usage: beeftv diagnostics analyze --file <diagnostics.zip>"}
	}
	flags := flag.NewFlagSet("diagnostics analyze", flag.ContinueOnError)
	file := flags.String("file", "", "Diagnostic ZIP file")
	if err := flags.Parse(args[1:]); err != nil {
		return flagError(err)
	}
	if *file == "" || flags.NArg() != 0 {
		return &cliError{code: exitUsage, reason: "diagnostics_file_required", msg: "Please specify the diagnostic ZIP file via --file"}
	}
	f, err := os.Open(*file)
	if err != nil {
		return &cliError{code: exitNotFound, reason: "diagnostics_file_unavailable", msg: "Unable to read diagnostic file"}
	}
	defer f.Close()
	// The product exports at most 10 MiB; bound hostile offline inputs too.
	const maxInput = 16 << 20
	body, err := io.ReadAll(io.LimitReader(f, maxInput+1))
	if err != nil || len(body) > maxInput {
		return &cliError{code: exitBadRequest, reason: "diagnostics_input_invalid", msg: "Diagnostic file cannot be read or exceeds 16 MiB"}
	}
	findings, err := diagnostics.AnalyzeBundle(body)
	if err != nil {
		return &cliError{code: exitBadRequest, reason: "diagnostics_bundle_invalid", msg: "The diagnostic package is corrupt or in an unsupported format, a schema 3 diagnostic package is required"}
	}
	return emitJSON(findings)
}
