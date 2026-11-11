# Independent copy — not an official BeefTV release

This repository is an independent copy of [glanderness/BeefTV](https://github.com/glanderness/BeefTV) at tag **v2.2.1** (`c01e37b2436d68cc0c28fbaabfad23c341bf15ea`), published by Vinod K Vijayan for private and non-commercial community use.

- It is **not** affiliated with, maintained by, or endorsed by BeefTV or @beefnoode.
- The application UI in this tree is an **English machine translation** of the upstream Chinese interface. Ant Design now uses `en_US`, and user-visible strings in `web/src` were translated. Comments, model-protocol text, and most backend messages are still Chinese. A few strings could not be translated because they are schemas or character classes. This is not a reviewed localization.
- Windows installers, when the Actions workflow succeeds, are attached to this repository's Releases and are unsigned. They are not the official downloads at `updates.beefapi.com`.
- Covered material stays under the [BeefTV Source Available License 1.0](LICENSE). Historical MIT portions remain MIT. See `NOTICE` and `THIRD_PARTY_NOTICES.md`.
- Changes in this copy: this banner, an English machine translation of the desktop UI, and `.github/workflows/windows-independent-build.yml`, which builds `windows/amd64` on a Windows runner and uploads the installer here. The official updater, R2, and COS publish steps are not used.

The upstream README follows.

---

<p align="center">
  <img src="assets/readme/beeftv-wordmark.svg" width="640" alt="BeefTV — High-performance, lightweight, AI-native video workspace">
</p>

<p align="center"><strong>High-performance · Lightweight · AI Native</strong></p>

<p align="center">
  A video creation workbench for the AI era. <br>
  Connect ideas, models and assets in a free canvas.
</p>

<p align="center">
  Advance creation with BeefTV Agent, extend methods with Skills, and reuse processes with Workflows. <br>
  From storyboards, materials to finished films, creation can continue to be edited, iterated and accumulated.
</p>

<p align="center">
  <a href="https://github.com/glanderness/BeefTV/stargazers"><img src="https://img.shields.io/github/stars/glanderness/BeefTV?style=flat-square&amp;logo=github&amp;label=Stars&amp;labelColor=303030&amp;color=E86C36" alt="BeefTV GitHub Stars"></a>
<a href="https://github.com/glanderness/BeefTV/releases/latest"><img src="https://img.shields.io/github/v/release/glanderness/BeefTV?style=flat-square&amp;label=Release&amp;labelColor=303030&amp;color=525252" alt="BeefTV latest version"></a>
<a href="QUICKSTART.md#Download and first-time opening"><img src="https://img.shields.io/badge/Desktop-macOS%20%7C%20Windows-525252?style=flat-square&amp;labelColor=303030" alt="Desktop version supports macOS and Windows"></a>
<a href="QUICKSTART.md"><img src="https://img.shields.io/badge/Workspace-Local--first-525252?style=flat-square&amp;labelColor=303030" alt="Local Priority Workspace"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-Source%20Available-525252?style=flat-square&amp;labelColor=303030" alt="Source code available, see LICENSE for license scope"></a>
</p>

<p align="center">
  <a href="https://beeftv.app/"><img src="assets/readme/button-website.svg" width="180" alt="Visit BeefTV official website"></a>
  <a href="https://github.com/glanderness/BeefTV/releases/latest"><img src="assets/readme/button-download.svg" width="175" alt="Download BeefTV desktop version"></a>
  <a href="https://beeftv.app/assets/beeftv-wecom-qr.png"><img src="assets/readme/button-community.svg" width="185" alt="Scan the QR code to join the BeefTV community"></a>
  <a href="https://x.com/beefnoode"><img src="assets/readme/button-x.svg" width="180" alt="Follow @beefnoode on X"></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="#Latest Update">Latest Update</a> ·
  <a href="#product Demonstration">Product Demonstration</a> ·
  <a href="#workflow">workflow</a> ·
  <a href="#beeftv-agent">Agent</a> ·
  <a href="#skills">Skills</a> ·
  <a href="docs/content/docs/overview/features.mdx">Feature List</a> ·
  <a href="QUICKSTART.md">Get started</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

##Latest updates

- **[v2.1.5](https://github.com/glanderness/BeefTV/releases/tag/v2.1.5)** — Added a new plug-in shortcut entrance and one-click connection to the LL2 model service.
- **[v2.1.4](https://github.com/glanderness/BeefTV/releases/tag/v2.1.4)** — Launched the included plug-in market and role replacement plug-in, added cost estimation and optimized video reference operations.
- **[v2.1.3](https://github.com/glanderness/BeefTV/releases/tag/v2.1.3)** — Open plug-in extension ecosystem, improve large canvas saving performance, improve error generation and agent compatibility.
- **[v2.1.2](https://github.com/glanderness/BeefTV/releases/tag/v2.1.2)** — Added new project and canvas backup export, improved video preview, storyboarding workflow and cross-end synchronization.
- **[v2.1.1](https://github.com/glanderness/BeefTV/releases/tag/v2.1.1)** — Added Seedance 2.5 sample conversion to HD and video editing capabilities, optimized assistant cache and external Agent access.

[View all versions and detailed instructions](https://github.com/glanderness/BeefTV/releases)

## Special thanks

Thank you to our partners, sponsors and customers who support BeefTV’s continued growth.

<table>
  <tr><th width="26%" align="center">鸣谢对象</th><th align="center">介绍</th></tr>
  <tr>
    <td align="center" valign="middle"><img src="assets/readme/partner-tencent-cloud.png" width="32" height="32" alt="腾讯云图标"><br><strong>腾讯云</strong></td>
    <td><a href="https://cloud.tencent.com/">腾讯云</a>提供云计算、人工智能与音视频服务，覆盖媒体存储、处理和分发等场景，服务开发者与企业的应用建设。感谢腾讯云为本项目提供的算力支持以及生态扶持。</td>
  </tr>
  <tr>
    <td align="center" valign="middle"><img src="assets/readme/partner-byteplus.png" width="32" height="32" alt="BytePlus 图标"><br><strong>BytePlus</strong></td>
    <td><a href="https://www.byteplus.com/en">BytePlus</a> 源自字节跳动的企业技术服务品牌，面向全球企业提供生成式 AI、云基础设施与音视频解决方案。感谢 BytePlus 海外孵化器对本项目的算力支持与生态扶持。</td>
  </tr>
  <tr>
    <td align="center" valign="middle"><img src="assets/readme/partner-ll2.png" width="32" height="32" alt="ll2.cn 图标"><br><strong>ll2.cn</strong></td>
    <td><a href="https://hub.ll2.cn?p=rw6t">ll2.cn</a>｜自营算力底座 · 官方直签批价。MiniMax-H3 0.05 元/秒（自部署 768P 满血）；deepseek-v4.1-flash 官方 4 折；Seedance 系列 7 折起；超分 0.018 元/秒；Vega系列 6折起。</td>
  </tr>
  <tr>
    <td align="center" valign="middle"><img src="assets/readme/partner-pccooler.png" width="120" alt="超频三标志"><br><strong>超频三</strong></td>
    <td><a href="https://www.cpspccooler.cn/">超频三</a>是深耕高性能计算硬件与散热系统的上市公司，提供 AI 模组化整机、AI 工作站等产品。结合超频三的硬件研发能力与 BeefTV 的 AIGC 软件生态，双方将共同探索软硬件一体化的本地 AI 创作解决方案。</td>
  </tr>
</table>

## Product Demonstration

<div>
  <video src="https://github.com/user-attachments/assets/da4081e0-26bc-424e-b20c-124f92ce6538" controls preload="metadata" playsinline></video>
</div>

## Workflow

**Leave the completed steps for the next creation. **

Connect assets, media processing and AI generation into an editable workflow. Take the **single character replacement workflow** as an example: input the action video and character reference image, first adapt the video frame rate, and then hand it to Seedance 2.0 Fast to generate the replacement result.

![Single character replacement workflow real editing interface: replaceable video and image input, frame rate adaptation, video generation nodes and model parameters](assets/readme/beeftv-character-workflow-editor.png)

<table>
  <tr><th width="50%">Original film</th><th width="50%">Full version of character replacement</th></tr>
  <tr>
    <td><video src="https://github.com/user-attachments/assets/1d8e5c42-d6be-40f5-be55-504b7381bf90" controls preload="metadata" playsinline></video></td>
    <td><video src="https://github.com/user-attachments/assets/cadf1e3b-e1fa-4a45-83a0-c8cdacc4d1b1" controls preload="metadata" playsinline></video></td>
  </tr>
</table>

[Production record](docs/content/docs/overview/examples.mdx#Workflow single character replacement)

- **Connect processing and generation**: Frame rate adaptation is completed locally, and the video and character map are used as reference for generation respectively.
- **Keep editable configuration**: Adjust nodes, connections, models, prompt words and output parameters, and save them as template versions.
- **Replace material, reuse arrangement**: Rebind the action video or character image, and continue to use the processing link; adjust constraints and parameters according to the new shot.

Template versions 13 and 14 in local 2.0.1 have been successfully run. The full version above also includes shot-by-shot correction, splicing, and original sound backfilling. These steps have not yet been encapsulated into the template; it does not mean that any material can be completed with one click or that it is frame-by-frame fidelity. Model generation is billed based on the channel used.

## BeefTV Agent

**Through chatting, stories can be turned into editable creative projects. **

> "Help me make a hit short drama about doomsday survival."

In the local case **"The Last Bottle of Water"**, the user explained the creation sequence and confirmed the generation plan, and the Agent built **25 nodes and 48 connections** on its own: from the script structure, 8-shot storyboard, to characters, scenes, first frames of shots, videos and Chinese narration, the process and materials are all left on the canvas.

<table>
  <tr><th width="25%">Character setting · Silence</th><th width="25%">Scene setting · Water tower distribution point</th><th width="25%">Generate shot one</th><th width="25%">Generate shot two</th></tr>
  <tr>
    <td><img src="assets/readme/beeftv-agent-drama-role-shenmo.webp" alt="Protagonist's silence setting diagram generated by Agent"></td>
    <td><img src="assets/readme/beeftv-agent-drama-scene-water-tower.webp" alt="Agent-generated doomsday water tower distribution point scene"></td>
    <td><video src="https://github.com/user-attachments/assets/0c0e1174-479d-4394-a4b2-7c64a3367e0a" controls preload="metadata" playsinline></video></td>
    <td><video src="https://github.com/user-attachments/assets/b304bdd1-5a3f-4e96-929b-46a9cbff29bf" controls preload="metadata" playsinline></video></td>
  </tr>
</table>

![BeefTV Agent actual use screen: characters and scene nodes are connected to storyboards and videos, and the production steps and execution progress are displayed on the right](assets/readme/beeftv-agent-drama-canvas.png)

- **Plan first**: Determine the world view, characters and storyboards, and write down the shot duration, screen, action and sound requirements.
- **Execute again**: Create nodes and reference connections, call the model after confirmation, and generate character diagrams, scene diagrams, lenses and narration.
- **Checkable and Continuous**: Read the actual product, check the setting diagram and the first frame of the storyboard, retain the successful material and failure status, and continue to adjust and edit.
- **Support external Agent/MCP access**: In the sidebar "BeefTV MCP" page, connect Claude Code and Codex to the local canvas with one click, and install a canvas usage instructions; clients such as Claude Desktop and Cursor can generate connection configuration access. For details, see [External Agent Access](docs/content/docs/backend/external-agents.mdx).

## Skills

**Turn creative methods into skills that can be used at any time. **

Provide creative assistants with methods, steps, and requirements for specific tasks. Browse the skills market, check the usage conditions and documents, and then install the specified version.

![BeefTV 2.0.1 Skills Market: Browse skills, uses, and fixed versions](assets/readme/beefv-2.0.1-skills.webp)

| Official skills | Actual delivery this time |
| --- | --- |
| Dual-lens text storyboard | Coffee short film: two shots of 4 seconds each, listing the images, sounds and items to be confirmed. |
| Interview outline | Community bookstore: three open questions, conditional questioning, reshoots and authorization list. |
| Material list organization | Coffee video + morning photo: usage classification, authorization record and duration, sound gap. |

- **On demand**: Enable or disable installed skills and manage your own skill library.
- **Keep version**: View updates and roll back to the installed historical version.
- **Rewritten according to custom**: Copy as a private version; the author can prepare for submission and confirm uploading and public review respectively.

Text skills do not need to configure multi-modal models; skills involving pictures, videos or audios need to configure corresponding capabilities according to their usage conditions.

## One canvas, complete creation link

- **Generate**: Generate text, pictures, videos and audio from prompt words or reference materials.
- **Organization**: Use nodes and connections to establish material relationships, creative context, and generation processes.
- **Processing**: Continue cutting, annotating, partially redrawing, splitting, referencing and combining results.
- **Iteration**: retain the process, reuse materials, and turn one generation into a continuously evolving workflow.

BeefTV also provides project libraries, personal asset libraries, asynchronous tasks, model channels and creation tools.

## Why choose BeefTV

| High Performance | Lightweight | AI Native |
| --- | --- | --- |
| Optimize rendering, media preview and task processing for complex canvases. | Local priority, you can start with a desktop workspace, and capabilities are loaded on demand. | Agent promotes creation, Skills provide methods, and workflow reuse steps. |

## Source code is available, supports customization and expansion

- You can freely configure text, image, video and audio model channels without binding a single Provider.
- Projects, canvases, materials and tasks are managed in a unified workspace, and data can be saved and migrated locally.
- The desktop is based on React, Go and Wails, and the model protocol and workbench capabilities can be customized or expanded.

## Get started

1. [下载桌面版](https://github.com/glanderness/BeefTV/releases/latest)，按[首次打开说明](QUICKSTART.md#下载与首次打开)进入本地工作区，无需注册。
2. 在「模型配置」中连接 BeefTV 官方账号，或添加自己的模型渠道。
3. 新建画布，添加参考素材，向创作助手描述目标；也可从节点开始自由创作。

For model configuration and source code construction, see [Quick Start](QUICKSTART.md), and for packaging requirements, see [Desktop Release Documentation](docs/desktop-release.md).

## Contributions and Licensing

Issues and Pull Requests are welcome. For the development process and testing requirements, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

The warehouse adopts a sub-scope license: starting from the first submission of a new license, new original content that meets the licensing conditions is applicable to [`BeefTV Source Available License 1.0`](LICENSE); historical content that has been published under MIT continues to be subject to the MIT terms retained by the same file, and upstream and third-party materials retain their respective licenses.

The new license allows for self-deployment, internal redevelopment, and use of BeefTV to produce and sell works; commercial resale, package sales, paid deployment or customized delivery of the covered software, as well as hosting functions for free or for a fee to third parties, all require prior written authorization. Independent tutorials, training and general technical consultation are chargeable and cannot be used to deliver software systems in disguise. Authorization contact: [lucas@bf-labs.cn](mailto:lucas@bf-labs.cn).

The new restrictions do not apply retroactively to historical MIT content, nor do they cover material independently licensed by third parties. This is a source code available license and the entire repository is not considered an open source project under standard MIT or OSI definitions. For specific scenarios and coverage boundaries, see [License Description](docs/content/docs/overview/licensing.mdx), and for upstream sources and third-party attribution, see [`NOTICE`](NOTICE).

## ⭐ Star History

<a href="https://www.star-history.com/?repos=glanderness%2FBeefTV&amp;type=date&amp;legend=bottom-right">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=glanderness/BeefTV&amp;type=date&amp;theme=dark&amp;legend=bottom-right" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=glanderness/BeefTV&amp;type=date&amp;legend=bottom-right" />
    <img alt="BeefTV GitHub Star History" src="https://api.star-history.com/chart?repos=glanderness/BeefTV&amp;type=date&amp;legend=bottom-right" />
  </picture>
</a>
