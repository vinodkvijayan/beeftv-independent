# Local model configuration persistence

The local desktop mode model channel no longer relies solely on the browser `localStorage`. When the front end starts, it reads the local snapshot through `/api/workspace/model-config`, and automatically saves it after the channel changes; the back end writes the snapshot atomically to `local-model-config.json` in the BeefTV application data directory.

- The configuration file is located in the application data directory, does not enter Git, and is not overwritten with front-end static resource updates.
- The temporary file + `rename` is used for writing, the file permission is `0600`, and the directory permission is `0700`.
- Multiple configuration handles on the same workspace path share an in-process lock; revision CAS and desensitization keys remain serialized across handles. Existing master files that are corrupt, `null`, or non-objects are not replaced by new writes.
- The channel with `id` only retains the key according to the same string ID; unmatched desensitized placeholders will refuse to write, the key of A will not be written to B, and the placeholder will not be saved as a key.
- Workspace paths only treat "not yet created suffixes" as recoverable; symbolic link loops or permission/non-directory errors will fail and two locks will not be generated for the same directory.
- BeefTV official computing power channel is managed by the local connection process, and the authorization key is individually encrypted and stored in the workspace without going through the model configuration interface, export or page.
- API Keys for other manual channels are still saved in the local configuration file and should not be submitted to the warehouse or logs.
- BeefTV's official computing power available model is based on the directory pulled after connection, and is not hard-coded in the warehouse.

When building with a new desktop for the first time, if the old version still has browser channel configuration, the front end will be automatically migrated to the local snapshot; subsequent reinstallation of the front end resources will not clear the model configuration.

The Canvas Assistant also reads model and channel credentials from this snapshot. When the manual channel only has a list of `models` and no corresponding `modelProfiles`, the assistant can follow the selected default text model and use the conversation protocol specified by the channel; the OpenAI format uses Chat Completions by default. Declared capabilities and protocols take precedence, disabled channels, non-text models, unsupported protocols, or missing keys remain unavailable. The built-in hosting channel continues to use its explicit model catalog.