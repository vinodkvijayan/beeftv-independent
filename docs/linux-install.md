# Linux installation

The Linux x64 package targets Ubuntu 24.04, using GTK 3 and WebKitGTK 4.1. Other distributions have not yet been verified to be operational; ARM64 is not part of the current distribution.

It is recommended to download `BeefTV-vX.Y.Z-linux-amd64.deb`, the dependencies will be automatically completed during installation:

```bash
sudo apt install ./BeefTV-vX.Y.Z-linux-amd64.deb
```

Once the installation is complete launch BeefTV from the Apps menu. Use the above command to install the new version; use `sudo apt remove beeftv` to uninstall, which will not delete user data. The DEB is managed by a package manager and does not use automatic in-app updates.

When using portable ZIP, first install the running dependencies:

```bash
sudo apt-get update
sudo apt-get install -y libgtk-3-0t64 libwebkit2gtk-4.1-0 gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav ffmpeg fonts-noto-cjk unzip
```

Download `BeefTV-vX.Y.Z-linux-amd64.zip`, extract it to a directory writable by the current user, and then run:

```bash
unzip BeefTV-vX.Y.Z-linux-amd64.zip
./BeefTV-linux/BeefTV
```

Preserve the entire `BeefTV-linux` directory and its name. The built-in Node, Agent, official plug-in and `cli/beeftv` are all in this directory, and there is no need to install the global Node. Automatic updates replace a complete set of program files and retain a recovery copy in case of failure, so the parent directory of the installation directory also requires write permissions for the current user.

Working data is placed in `~/.config/BeefTV` by default (follow this directory when setting `XDG_CONFIG_HOME`); do not place working data in the program directory. External Agent can be accessed through the package `BeefTV-linux/cli/beeftv`.

This package requires a graphical desktop session. For servers without graphical desktops, please use an independent backend deployment method.