# BeefTV for DeepSeek Harness

The DSH native workbench for AI video creation reuses the BeefTV canvas, projects, materials, skills, plug-ins and model settings on the left side, and the resident DSH native Agent on the right side.

## First generation running mode

- The independent workspace is saved in `storages/beeftv/workspace` of DSH home. It only uses the running package built into the plug-in. You can connect the BeefTV account or configure the built-in Key in the workbench.
- Connecting to local BeefTV requires `/Applications/BeefTV.app` version 2.2.0 or higher. The plug-in first reads the application version. If the version is lower, it only prompts for an upgrade and does not start the application. After passing the check, open the application, wait for its local private IPC to be ready, then access it, and directly use the original account to connect, project and materials.
- Generate proposals and approval mechanisms for reusing BeefTV. Model inference uses DSH's current model configuration.
- First version supports macOS Apple Silicon, DSH 0.2.2-rc.1. The native running package comes from `/Applications/BeefTV.app` built and installed from the current source code.

## Build and install

First update `/Applications/BeefTV.app` according to the existing process of the warehouse, and then execute it sequentially from the root directory of the warehouse.

```sh
node plugins/deepseek-harness/package-runtime.mjs
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add "file:$(pwd)/plugins/deepseek-harness"
```

Packaging will put the installation version's executable file, CLI and running resources into the plug-in. There is no need to open the BeefTV desktop window when running independently. Each time you repackage or modify the plug-in, you must re-execute the above CLI installation command, and then restart DeepSeek Harness to load the update. The `file:` installation may copy a single file through a hard link. Rebuilding the running package directory will cause the installed copy to continue to retain old files, and the installation must be refreshed. The plug-in package is named `dsh-beeftv`, and the sidebar entry is BeefTV.

## Permissions and data

Host obtains runtime capabilities through the local private IPC, and the account and model keys remain in BeefTV’s original storage. The browser only gets the temporary canvas access address during the current connection life cycle. Switching connections revokes the old MCP client and the backend only shuts down the instance started by the plugin.

Agent accesses the workspace through the existing BeefTV MCP. Build submissions, as well as gateway calls marked as write, build, or unrecognized in the business directory, are approved by DSH requests. Directories are explicitly marked as read-only and can be read directly without committing the resulting call. After approval, use BeefTV's `caller` pattern to check the version and submit the task. The canvas view context only contains routes, canvas identifiers, and selected nodes. Existing workspaces are connected in situ, and independent workspaces are saved separately.

The running package follows the BeefTV LICENSE and NOTICE included with the package, and third-party resources retain their respective licenses.