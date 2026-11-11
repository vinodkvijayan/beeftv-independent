#BeefTV 2.0.1 real machine footage recording

## Special thanks to brand materials

- According to the initial cooperation partners provided by users, Tencent Cloud and BytePlus are added; a unified two-column form is adopted, with the official icon and name on the left, and a brief introduction and official website link on the right, after contribution and license.
- `partner-tencent-cloud.png`: `https://cloudcache.tencent-cloud.com/qcloud/favicon.ico` lossless conversion quoted from Tencent Cloud official website, 32 × 32, 927 bytes.
- `partner-byteplus.png`: Save `https://sf-bpcms.bytepluscdn.com/obj/byteplus-public-aiso/portal/assets/favicon.png` quoted by BytePlus official website as it is, 32 × 32, 554 bytes.
- The icons are stored in the warehouse, and the display does not rely on third-party hot links; the brand name uses body text to be compatible with light and dark backgrounds. Subsequently added objects will follow the structure of one object per line.
- The service introduction is based on the two official websites and BytePlus’ About Us page; BytePlus overseas incubator’s computing power support and ecological support acknowledgment are based on the information clearly provided by the user, and no specific investment, resource quota, certification or exclusive cooperation is claimed. Trademarks belong to the original rights holders.

## README video layout adjustment

- The workflow homepage is changed to two MP4 players in the same row: the complete original film on the left, and the existing characters on the right are replaced with the full version. The duplicate stills on the homepage and the independent result player below are removed.
- The original film web page copy `beeftv-character-source-demo.mp4` comes from the previously preserved complete `replacement-full-source.mp4`; 720 × 1280, about 20.34 seconds, H.264 / AAC, 4,635,446 bytes, retaining the complete content, original sound and watermark, and the playback index is advanced. The original file has not been modified.
- The Agent homepage is changed to four columns: character settings, scene settings, generated shot one (original shot 4), generated shot two (original shot 6), and the separate second shot at the bottom is removed.
- The Chinese and English README is synchronized with the workflow video of the case page. GitHub rendering checks retain 5 players per document, and the six-part media anonymous segmented response passes; the players use table HTML blocks and follow the authenticated attachment parsing method.

Material based on native `/Applications/BeefTV.app` 2.0.1. Early interface screenshots are only cropped and compressed; character comparison pictures extract frames from existing videos; screenshots of the new workflow editor are provided by users and retained as they are. Each type of material is explained separately at the end of the article, and there is no redrawing of the interface or generation results.

**Current status:** The Agent case on the homepage has been changed to the actual short play production of "The Last Bottle of Water", showing the existing pictures, videos and narration; the entire film is not yet completed, see "Agent Short Play Main Case" at the end of the article. The coffee text storyboard remains in the Skills case. The main workflow case is the replacement of a single character in the new version; early frame capture verification is retained as historical evidence. 2.0 Continuous screen recording is not yet complete.

| File | Operation path | Proven content |
| --- | --- | --- |
| `beeftv-2.0.1-skills.webp` | Sidebar → Skills → Skill Market | The actual names, uses and market status of the three official 1.0.0 skills |
| `beeftv-2.0.1-skill-storyboard.webp` | Dual-lens text storyboard → View and install → Read SKILL.md | Fixed version, file check, usage conditions and installation confirmation interface |
| `beeftv-2.0.1-workflow-editor.webp` | Canvas → Workflow → Single character replacement workflow → Edit | Real template input, depth extraction, generation steps and connections |

## Verification boundary for first collection

- The skill market is marked "The effect has not been verified", and the details show that there are no public test records. The skill installation or operation has not been completed this round, and screenshots cannot be used to verify the effect.
- Two successful historical records of single character replacement workflow use the same input and do not retain the corresponding running status in the current canvas. This cannot be used as proof of the reuse of two different sets of materials.
- When trying to create a new keyframe extraction workflow, the installation version prompts "The local media encoder is not available, please update the installation version and try again." The unsaved draft has been abandoned and the original template has not been changed.
- Recent Agent skits still have pending builds and unfinished steps, and are not considered complete delivery cases. There is no click-to-pay confirmation, retry to generate or modify the project content.
- A new demo project "BeefTV 2.0 · Creation and Reuse" has been created, with a blank canvas at the end of the first collection.
- The user has authorized the new text call budget to not exceed 5 yuan, and no new pictures or videos will be generated; no model calls are actually initiated in this round, and the new cost is 0.

## Materials to be replenished and recovery points

There is still a lack of 2.0 demonstration videos, complete Agent task cases, actual input and output of the three skills, and proof of workflow operation of the two sets of materials.

The skill market loaded once and timed out; then the computer capture interface repeatedly returned macOS ScreenCaptureKit -3812 parameter error, and rebinding the window also failed. The current tool does not have an application evocation interface, and repeated attempts have been stopped. After restoring the window capture, continue from the above demo project; do not rerun the paid tasks of the original short play, and do not combine the screenshots into a video to pretend to be a continuous screen recording.

## Subsequent blocking repair and actual machine verification

- ScreenCaptureKit -3811 occurred during the screenshot retest; it was restored after adjusting the size through "zoom the window", and the screenshots were taken successfully three times in a row. After the installation version is updated and restarted, the screenshot of the workflow results is also successful. The evidence supports window capture session or geometric state anomalies. The internal cause of the computer operating tool has not yet been located, and there is no guarantee that it will not recur in the long term. System permissions have not been reset or system services have been restarted.
- The original installation package only has ffprobe and lacks native FFmpeg; the build script is silently skipped when the encoder is missing. Encoder and license file checks before macOS build have been added, and missing inputs will exit with a non-zero status.
- Inject existing encoders and licenses into a unique installation path via existing local update scripts. Version remains at 2.0.1; release gate, frontend build, packaged media detection and final signature checks passed. The staging app for building has been removed by the existing script.
- Packaged FFmpeg completes H.264 encoding under a reduced system PATH. The original error reporting path of the installation version "Workflow → New → Keyframe Interception" is undisabled and nodes can be added.
- Create and save "Keyframe Extraction·Local Processing" in the demo canvas, connect the video input and frame capture output, import the existing racing video and run it; the interface displays "Completed 1/1", and the real first frame is output.
- `beeftv-2.0.1-workflow-local-verified.jpg` is the actual screenshot of the successful result. This item only proves that the single-input local frame capture is successful. It has not yet completed the multiplexing of the two sets of inputs, and does not represent the verification of the generation effect of the original single-character replacement template.
- Fixed the problem that the paid model is not called in the verification, and the cost of adding a new model is 0.

## Case completion

The operating environment remains BeefTV 2.0.1 with the only installation path. The case canvas is "BeefTV 2.0 · Creation and Reuse".

| Documentation | Source and Processing | Verified Content |
| --- | --- | --- |
| `beeftv-2.0.1-agent-delivery.jpg` | Original window capture, 2498 × 1680 | Two new text nodes and Agent completion instructions |
| `beeftv-2.0.1-agent-delivery.webp` | The top 64 pixels of the above image are cropped, 2498 × 1616 | Editable storyboard delivery screenshot for homepage |
| `beeftv-2.0.1-workflow-local-verified.jpg` | The first set of input raw captures, 2498 × 1680 | Racing video frame capture successful, completed 1 / 1 |
| `beeftv-2.0.1-workflow-reuse.jpg` | Second set of input raw captures, 2940 × 1684 | Success again after replacing Neon Street View video, still version 1 |
| `beeftv-2.0.1-workflow-first.webp` | The first group of original images are cropped, 1500 × 1300 | At the same time, the version, completion status, input and output are retained; the template name refers to the original image |
| `beeftv-2.0.1-workflow-second.webp` | The second set of original images are cropped at the same position, 1500 × 1300 | Compare the real output of the same template under different inputs |

### Agent and skills

- Two-shot text storyboard: The two-shot storyboard of the coffee short has been returned and items to be confirmed have been returned. After confirmation, the Agent creates "Coffee Short Film · Shot 1" and "Coffee Short Film · Shot 2" on the right side of the existing workflow. Each node includes duration, image and sound. The scope of delivery is text storyboarding, not the finished film.
- Interview outline: core questions returned to the community bookstore, opening, three sets of open questions and conditional questioning, reshoot list and authorization pending confirmation items. Interface text verification results are accessible through the installed version.
- Material list: The usage of coffee videos and early morning photos and the authorization stated by the user have been returned, indicating the remaining duration and sound gaps; it is clear that the media has not been read. Interface text verification results are accessible through the installed version.
- All three tasks are text tasks, use the interface to select `deepseek-v4.1-flash`. Another confirmation request completes the delivery of two text nodes; no new images, videos, or audios are generated. The upper limit of budget authorization is 5 yuan, but this round of interface does not provide a verifiable text bill, does not write the 0 value that is not priced by the SDK as free, and does not declare the actual deduction amount.

The skill market details loading timed out. Read the official 1.0.0 `SKILL.md` original text through the connected BeefTV tool, import it as a private local skill, and then choose to execute it in the installed Agent; the process acceptance of the market installation button has not been completed this round. The file contents of the three local copies are consistent with the official file hash:

| Market Skill ID | Version | SKILL.md SHA-256 |
| --- | --- | --- |
| `official-storyboard-text` | 1.0.0 | `3736e0554bfbc50baf0decb6c9ec71d6f5ba8a654a963ab6725afe53faa51637` |
| `official-interview-outline` | 1.0.0 | `2a45904927ac5ad8e216db0eab7af50cc9aa8e0f763fd474332c75062f2b8886` |
| `official-material-inventory` | 1.0.0 | `4b7bc5ddc83627952b09cf7f9ce0d865c8bcb133287630393a6850501dc6a350` |

### Workflow reuse

The same "Keyframe Extraction·Local Processing" template version 1, interception time 0 seconds. The first group contains existing racing videos, and the second group contains existing neon street scene videos; the second time only replaces the input and reruns. "Completed 1 / 1" is displayed both times, and the output is the driver and the first frame of the street view respectively. No model call does not represent the acceptance of the results of the generative workflow.

### Capture limits

Subsequent window captures were abnormal again: small-sized white images such as 230 × 278 and 316 × 342 appeared, as well as empty WebP files. After the user is unlocked, the interface text can be restored, and the adjustment window has not restored valid screenshots. Repeated capture has been stopped and invalid files of this round have been removed. Valid originals and derived WebPs are preserved.

There is still a lack of new 2.0 continuous screen recording, as well as valid screenshots of interviews and material collection; their text results have been verified in the installation version. The homepage continues to clearly mark the original video as an early interface demonstration, and does not concatenate screenshots to pretend to be a screen recording.

## Single character replacement main case

Users requested that the locally optimized single character replacement process be used as the main case on the home page. Check that the installed version is still 2.0.1 and the current template is version 14; the version number has not changed with local binary updates. Reads the current canvas via the connected BeefTV, supplemented by local SQLite read-only check templates and run status. No changes were made to the template, original canvas nodes or new model generation initiated.

### Current version and evidence

- Template `c605c8ac744de536471d92a695d571ff`: video input → `video.frame-rate` (24 fps) → `generate.video`; reference picture input generated by character image connection. The model is `beefapi::seedance-2.0-fast`, 9:16, and the duration follows the adaptation video. The old depth node has been removed.
- Version 13 runs `1c981bd069270851749e1635b140e467` succeeded, both the adaptation and generation steps succeed; the resource `5f4d687346dd3cae0bd7bd70b31ff199` is generated.
- Version 14 runs `66fa2ada1729524e2bbd3f7ea6df2821` succeeded and generates resource `5e4821f1dd3fbd9158f61aa8566df5d8`; the result is named "Second half first draft (not adopted)" in the canvas and is not regarded as final quality pass.
- The current final video resource `e11c14ac0dd3d24782c4d489ef11b0b8`, material `replacement-full-fast-20261024-final`, node "Single character replacement | 2.0 Fast full version". Check via asset.get that it is the final work of subsequent imports, not a direct output of version 14.
- The production process and existing delivery records clearly include local generation correction, special effects restoration, splicing, and original sound backfilling. Some 480p clips are enlarged, and there are differences in the generation and reconstruction of action details. Both the README and the case page retain this distinction and do not claim universal one-click completion, frame-by-frame fidelity, or native 720p throughout the film.

### New material

| Documentation | Source and Processing |
| --- | --- |
| `beeftv-character-workflow-editor.png` | Screenshot of the real workflow editor provided by the user, 2388 × 1234; copied as it is without cropping, compressing or redrawing, replacing the previous structural diagram. |
| `beeftv-character-reference.webp` | Character images in local material resources, scaled down to 720 × 720, without redrawing or text removal. |
| `beeftv-character-source-close.webp` / `beeftv-character-result-close.webp` | 4.5 second frame of the complete original video and final file, scaled down to 450 × 800. |
| `beeftv-character-source-motion.webp` / `beeftv-character-result-motion.webp` | 12.0 second frame of the same two files, scaled down to 450 × 800. |
| `beeftv-character-replacement-demo.mp4` | Current final video copied as is, 8555901 bytes; H.264/AAC, 720 × 1280, 24 fps, container duration 20.340680 seconds. |

Final video SHA-256: `3136d1a4ee3f87d87db4fb6723ffa3d03aa4cc156c070651b907400dfbedc5bd`. FFmpeg in the installation package is used to extract frames, and the display frames are not stretched, modified, watermarked, or individually modified. The example itself is an AI character replacement work, not a record of real character behavior.

### This round of verification boundary

The installation version opens the original canvas and enters the final node player; the automatic window capture still returns an abnormal white image, and then uses the real editor screenshot provided by the user, and a new continuous screen recording is not completed. The control frames were directly checked, and the final video was checked for media detection and full-film decoding. This round only reuses existing results, and there is no new model fee. There are still uncommitted changes to the frame rate adaptation code of the workflow in the workspace. What is recorded here is the local updated version. It does not state that these new steps have been provided with the remote official release version.

## Agent short play main case

Users requested a demonstration of an original skit project that created a complex canvas through chat. Read canvas `ZaKJf2b2HWQthidRFUyYo` (revision 120), work title "The Last Bottle of Water": 25 nodes, 48 ​​connections, including script structure, 8 shot storyboards, 3 character pictures, 2 scene pictures, 2 independent narrations, 8 first frame nodes and 8 video nodes. It was planned to be 59 seconds long and was not a completed film.

### Operation and inspection records

- The public user message of the local Agent session requires that the script structure be done first, then characters, scenes, and finally the video be generated; it has been clearly confirmed and production has started. When reading, only the public text, tool name, and operation count of the user and assistant are extracted. System prompts, model inference, or credentials are not disclosed.
- The session records node creation, storyboard preparation, node configuration, generation plan submission and task reading. Images use `gpt-image-2.5`, videos use Seedance 2.0 Fast, and independent narration uses MiniMax Speech 2.8 HD.
- There are 5 setting pictures and the first frame of shots 2–6 successful; the videos of shots 4, 5, and 6 are successful, and the other 5 videos have not yet been generated; the first frames of shots 1, 7, and 8 are in a failed state.
- The session contains 10 `media_overview`, the objects are five setting pictures and five first frames; no `media_review` calls are seen. The assistant's material review description cannot be expanded to continuous video, sound or full film acceptance has been completed.
- The installation version is still 2.0.1, the original canvas has been opened, and the script, characters, scenes, narration and storyboard nodes can be read in the interface. Only the viewport is adjusted to fit the screen, no nodes are modified or a build is initiated.
- Automatic window capture returns ScreenCaptureKit -3811; trying the system's built-in screenshot tool also times out, exits and stops repeated attempts. No new complex canvas panoramic screenshots have been taken, no fake application interface as a replacement.

### Product source

All images and media come from local resources bound to the canvas. The images are only proportionally reduced and compressed by WebP, and the videos and narrations are copied as they are; no new generation or additional model fees are required. The video cover is the real frame at 2 seconds of the corresponding video.

| File prefix `beeftv-agent-drama-` | Original resource ID |
| --- | --- |
| `role-shenmo.webp` | `97c6511342dc4d9d0953c3c7f7028b2b` |
| `role-xiaoman.webp` | `e1e30f5109ba1f2d7caf4d6f02dc775a` |
| `role-laodao.webp` | `177ae40213472512f3b7f8d8d0427a26` |
| `scene-water-tower.webp` | `4b27737d91823dd37c465104d421917d` |
| `scene-street.webp` | `18fd863482bec7d99abad188f01df31d` |
| `shot-4-first-frame.webp` | `8e4504c304e54772f98c54489d557579` |
| `shot-6-first-frame.webp` | `3bdf2b1a4d565881b1af403af2cc71f1` |
| `shot-4.mp4` / `shot-4-poster.webp` | `2f8dccebe9f13f4af1cd949ec4fe1e91` |
| `shot-5.mp4` / `shot-5-poster.webp` | `c02fc589b23e29146fbe612c67c92dfd` |
| `shot-6.mp4` / `shot-6-poster.webp` | `87cd40d5c0d305082c41dddaf5f8f1db` |
| `narration-opening.mp3` | `121de19b871befd7ecd8e342c211faa5` |
| `narration-ending.mp3` | `98fcb813883d2a20ff13bcfa7b20b01c` |

The videos are all H.264/AAC, 720 × 1280, 24 fps, and the container duration is 8.096, 6.080, and 9.088 seconds respectively; the video stream and canvas node duration are slightly shorter than the container, so the public copy only takes about 8/6/9 seconds to write. The measured duration of the two narration MP3s is approximately 3.831 and 4.551 seconds. Three videos and two narrations were fully decoded and passed; the video covers, selected characters, and scene images can all be viewed directly. Passing the decoding does not mean passing the subjective plot, action, lip-sync or sound acceptance.

Only raw footage is shown, without being combined into a complete skit; no subtitles or timelines are generated, and there is no claim that the project has completed end-to-end automated acceptance.

### Actual usage screenshots added by users

Original 2376 × 1552 screenshot provided by `beeftv-agent-drama-canvas.png` to the user, reproduced as is without cropping, compression or redrawing. Displays characters and scene settings, storyboards and video nodes, material reference connections, and the step progress in the Agent dialogue on the right. It has been placed under the settings and lens display pictures of the Chinese and English README, and is connected to the case page.

This screenshot completes the missing canvas usage picture above due to the auto-capture failure; the auto-capture service itself is still unresolved. The screenshots also clearly retain the actual status of pending confirmation, in progress, to be completed, etc., and are not used as proof that the entire film has been accepted.
## README Picture verification before publishing (2026-10-24)

- 24 local images referenced in the Chinese and English README and case pages: the files exist, the path cases are consistent, and are not ignored by Git; the PNG/JPEG/WebP decoding check passes.
- Full preview browser check: all 20 pictures are loaded successfully, including character pictures, scene pictures and actual screenshots of Agent usage.
- Although part of the converted WebP in the preview can be decoded by FFmpeg, the browser refuses to load it; after the preview is switched to JPEG, it all passes. The original image of the warehouse has not been replaced.
- 17 new images have not yet been submitted. These materials must be submitted together when publishing the README, not just Markdown; after pushing, the actual loading results need to be reviewed on the GitHub page.

## New product demonstration video (2026-10-24)

### GitHub in-page playback fix

#### Subsequent positioning of the black frame of the independent player

- User feedback that lens 4 can be played, and the other three homepage players have black frames. Anonymous capture of the real homepage to confirm: `src` in shot 4 in the table is the media CDN signature address; the remaining three are still `github.com/user-attachments` jump addresses, and each has an unresolved `gh:secured-asset-reference` placeholder element.
- Minimal GitHub rendering comparison: top-level `<video>` and `<p><video>` retain the above placeholder elements; unstyled `<div>`, table container, and bare attachment URLs resolve correctly to media CDNs. Add an unstyled HTML block container to the independent player, retaining the content, order and original table layout, without modifying attachments and encoding.
- Previously, only the number of players, public access to attachments, and independent local page playback were verified, which was not enough to cover the attachment parsing process in GitHub pages; this gap has been filled in `scripts/verify-readme-videos.py`.
- Regression checks simultaneously verify the GitHub render of the document, unresolved placeholder elements, actual CDN origin, and anonymous video segmented responses. The public homepage before the repair was accurately detected with 3 placeholder elements; the three documents after the repair all had 4 parsed players and no placeholder elements.

- Root cause: The cover Markdown link jumps to the GitHub blob file page, not the player; GitHub's Markdown rendering will remove the `<video>` of the ordinary warehouse MP4 address, retaining the GitHub user attachment address. Previously the remote HTTP accessibility check was not sufficient to authenticate the player.
- Refer to the `<video controls>` scheme in the table in the Hypit README. Currently, both Chinese and English README and case pages use GitHub video attachments; the order of chapters and the three-column table layout remain unchanged.
- Attachments are created through the upload interface used by `internal/attachments/client.go` of the official GitHub CLI. The address and file size are recorded in `video-attachments.json`. The document saves the stable attachment address and does not save the short-term signature address.
- The web copies of the three short drama scenes are `beeftv-agent-drama-shot-{4,5,6}-web.mp4`, 2,286,138 / 1,522,906 / 2,335,706 bytes respectively; the original resolution, frame rate and complete content are retained, H.264 / yuv420p + AAC, the playback index is advanced, and the original film is not modified.
- All five videos were decoded and faststart checked. The GitHub Markdown rendering interface reserves 4 players for the Chinese and English README and case pages respectively.
- After the attachment is associated to the public warehouse through draft preview, five requests without login credentials all return `206 video/mp4`, which can be loaded in byte segments. The browser directly reads the GitHub attachment and plays it segment by segment. All five segments are advanced to the end, with a duration of 44.952 / 20.341 / 8.096 / 6.080 / 9.088 seconds. The media error is empty; the demo video pause and jump checks pass.
- The table player in GitHub's actual Markdown rendered output is loaded, and the three-column layout and two settings images are retained. The first request in the network check is about 2.4 seconds, which only represents the current network observation and does not promise the starting time in different regions.

- 来源：用户提供的 `10月24日-BeefTV新版演示宣传片-X.mp4`，原片约 127 MiB、44.93 秒、2564 × 1440、60 fps，保留原文件不变。
- 网页版：`beeftv-demo-2.0.mp4`，6,699,829 字节（约 6.39 MiB），1920 × 1078、30 fps，H.264 / yuv420p + AAC，容器时长 44.952 秒，未裁剪内容。视频 CRF 26、峰值码率约束 1500 kbit/s，音频 96 kbit/s；复杂画面和小字会有压缩损失。
- `moov` 位于偏移 32，`mdat` 位于偏移 47,793，可先读取播放索引再逐步加载；全量音视频解码通过。
- 封面 `beeftv-demo-2.0-poster.jpg` 取自新版视频第 24 秒，不再显示旧演示封面。中英文 README 已接入封面与仓库内视频链接。
- 内置浏览器通过支持字节范围请求的本地 HTTP 播放器验证：识别 1920 × 1078 与 44.952 秒，readyState=4，点击后时间推进到 27.488 秒且无媒体错误。此结果不代表公网起播时间。
- GitHub 附件上传未完成：Chrome 操作被 macOS ScreenCaptureKit -3811 阻塞，内置浏览器打开 GitHub 上传页超时。当前 README 为封面点击入口，不能视为 GitHub 页内原生播放器已经验收；发布前需取得 GitHub 视频附件地址，替换入口并在线复查播放、拖动和起播速度。
