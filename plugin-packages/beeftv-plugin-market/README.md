#BeefTV plug-in market (`beeftv-plugin-market`)

`beeftv-plugin-market` is pre-installed with the BeefTV desktop package and enabled by default (located in `agent-host/bundled-plugins/`), and is mounted in the "Plug-in Market" column on the left side of the plug-in center through the `pluginCenter.section` slot.

## Features

- **Selected recommendation list (domestic acceleration chain)**: When connected to the Internet, `Sunnyender-org/beeftv-plugins`'s `registry.json` will be read and cached locally through the domestic directly connected `cdn.jsdelivr.net` mirror and GitHub official source (`raw.githubusercontent.com`); when the network is disconnected or times out, it will automatically and seamlessly fall back to the local cache and built-in offline copy.
- **npm Community Search**: Retrieve community plugin packages on the selected download source (default `https://registry.npmmirror.com`) by `beeftv-plugin` / `pi-package`.
- **Download source switching**: Support switching between domestic mirror (`https://registry.npmmirror.com`, default) and npm official source (`https://registry.npmjs.org`).
- **Remote details and multi-source online installation**: You can read the plug-in `README.md`, warehouse link and version information online when it is not installed; when you click to install or update, you can download and install online from the npm image, pre-packaged image `.tgz` (including SHA-256 verification) and `github:owner/repo`.