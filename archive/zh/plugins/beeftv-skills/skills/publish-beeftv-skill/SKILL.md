---
name: publish-beeftv-skill
description: Used when users request to submit creative methods, existing skills or files to the BeefTV skills market, or to check the status of this manuscript. Supports agents with terminal capabilities such as external Codex and Claude Code; no need to run BeefTV desktop application.
---

# Organize and submit creative methods

Help authors organize content, prepare private drafts, and publish publicly. Document submission and dialogue submission use the same set of services, and they will be released to the public immediately after the preview is confirmed.

1. Determine the scope of this submission. Only methods, necessary references, and user-selected examples are organized, not entire projects, canvas assets, chat logs, or account configurations. The built-in assistant prepares a local draft with `skill.draft` and `skill.publish.prepare`, which is then continued by a confirmation operation in the product; do not call the upload or publish interfaces on your behalf.
2. The external assistant prepares `SKILL.md` and the necessary files in an explicit directory.
3. Prepare metadata JSON outside the directory: name, description, license, versionLabel, and necessary sourceUrl, requirements, and showcase. Priority will be given to using the author's explicit license; if the source or adaptation authorization is unclear, ask the author and do not grant an open source license on your own.
4. Use `beeftv skills inspect DIRECTORY --metadata METADATA_FILE` to get the exact file listing, contentHash and archiveSha256. Show users these files, instructions, licenses, and examples of what will be uploaded. Only after the user explicitly confirms the upload scope will the upload continue.
5. Private `--state` files outside the directory specified for this submission will not be submitted to Git. Run `authorize`, give the output verificationUrl and userCode to the user for authorization in the browser, press the returned interval and then `poll`. Does not read, copy, or print the accessToken/deviceCode in the state file; does not use the model API Key or desktop cookies.
6. Use `upload DIRECTORY --metadata METADATA_FILE --state STATE_FILE --confirm-upload --content-hash HASH --archive-sha256 HASH` that matches the inspect result. This only generates a private draft and does not mean it has been published publicly.
7. Run `preview --state STATE_FILE` to show the user the author, meta information, actual files, and examples. After the user explicitly confirms the public submission of this version, then use the corresponding revision and previewDigest to execute `submit --confirm-submit` to immediately publish it to the public.
8. Use `status` to get the real release status and receipt. If the authorization expires, re-authorize and continue the same status file; if the upload receipt is lost, the original request will be retried and no duplicate draft will be created. New corresponding confirmation is required after preview or content changes. Use `revoke` to revoke submission authorization.

The commands all start with `beeftv skills`. It has been clearly confirmed that the same file and version will continue to be valid without repeated inquiries; confirmation cannot authorize other files or subsequent revisions. Only statuses supported by server receipts are reported: Uploaded, Pending Release, Published, or Withdrawn.