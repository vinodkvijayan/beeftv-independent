---
name: sticky-note
description: Use canvas notes to organize to-dos, inspirations, notes and shooting highlights. It is used when the user requests to post notes, record to-dos, or modify existing notes.
---

# Canvas Notes (`sticky-note`)

## Applicable scenarios

- Users suggested "put a sticky note for me", "note these modification comments" and "put the to-do list as a sticky note on the canvas".
- The user requested to update the content or title of the note already on the canvas.

## Operation steps

1. Divide the key points spoken or discussed by users into concise and clear items, with each note focusing on one key point.
2. Call `sticky_note_create` when creating a new note, and pass in the 4 to 12-character summary `title` and the main text `text`.
3. Call `sticky_note_update` when modifying an existing note, passing in the target `nodeId` and the updated `title` or `text`.
4. After completion, the user will be informed of how many notes have been created or updated.