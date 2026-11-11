# Changelog

All notable public changes to BeefTV are documented in this file.

## Unreleased

## v2.2.1

- Added "Yinsheng Yunshu One Calculation" built-in channel plug-in: fill in the API Key in the plug-in or model service, and you can add 32 text, picture and video models with one click. Local reference pictures, reference videos and audios will be automatically uploaded; complete the screen ratio, resolution, duration, generation quantity and result reading rules of each model according to the official documents.
- Revision of the plug-in page and account settings: Unify the card layout of the "plug-in" page and the skill and asset pages. Selected recommendations will be opened instantly using local cache and refreshed in the background; the "Login to BeefTV" account entrance and "Contact Us" are integrated at the bottom of the left column, and the account and balance, general settings, models and built-in plug-ins can be centrally managed in the account settings (online recharge currently only displays previews and is marked as "not yet open").
- Canvas and skill interaction optimization: Click the canvas folder to open the full-screen grid preview layer, which supports retracting the blank space and dismissing it with one click; the "Automatically run skill script" switch is moved to the top bar of the skill page; the model service adds a Gemini-compatible interface with the `/v1beta/openai` path, which directly displays the actual request address (`/v1` is no longer repeated when the version prefix has been written), and text models can test connectivity one by one according to the interface format; DeepSeek Harness The plug-in can directly perform paid generation under full permissions. The confirmation card for other permission modes will indicate the model, quantity and estimated cost.
- Generation error report and retry experience repair: When the request is rejected by the model service during the submission stage (such as parameters not supported, reference images do not meet the requirements, and the balance is insufficient), it will be directly judged as a failure. After modifying the prompt words, parameters or materials, it can be regenerated immediately on the original node, and there will no longer be misjudgments. "Continue retrieval" or lock the send button; directly display the specific Chinese reasons returned by the server (including the specific reference material), click "View Diagnosis" to also see the failure record; fix the storyboard batch queue to occasionally get stuck, the top column conflict prompt is blocked, and the external Agent generation failed and was not written back to the node, project materials and video capabilities were lost after the workspace was restored, and the problem of misrepresenting the mute parameters of the video model with sound was fixed.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.2.0

- Upgrade instructions: After the upgrade, the official computing power needs to be reconnected. After reconnecting, the old official service will be automatically removed, and there is no need to re-select the model for the old canvas.
- Upgrade Notes: Skills installed in `~/.agents/skills` by other tools will no longer be automatically read. These skills that previously appeared automatically in "My Skills" will be removed. If necessary, use "Import File" to add them again. The original files on the computer will not be deleted.
- Creation Assistant: Improve the cache reuse of continuous conversations. Models that support caching have the opportunity to respond faster and at lower costs; only do what you ask for and keep the quantity you set; storyboard drafts can be named according to skills; after the canvas is modified, the nodes and fields that have been changed will be listed.
- Video generation: Turn off the sound, the screen ratio will take effect, and the vertical screen will no longer become a horizontal screen; the assistant can set the resolution.
- One-click access to external agents: Connect Claude Code or Codex to BeefTV with one click in the settings, and install the canvas usage skills, which can be disconnected at any time.
- Model service: "More Service Providers" adds 18 new connection defaults, including service providers such as DeepSeek, Kimi, Wisdom Spectrum, Silicon Mobile, OpenRouter, etc., as well as local services such as LiteLLM and vLLM. The name and address are automatically filled in after selection; "Request Protocol" is renamed "Interface Format" and folded into a line after selection; the plug-in center only places plug-ins; the request addresses of Wisdom Spectrum pictures and videos are fixed.
- Text generation is only requested once according to the selected interface format, and the error reported tells the real reason; deactivated interfaces no longer appear in the selection.
- Skills: The market submission rules are the same as those of this machine. Skills with scripts are supported. They can be installed from GitHub and released without review. The assistant will run the skill script after your confirmation, or it can be set to run automatically. The default time limit is 5 minutes and the maximum is 30 minutes.
- Canvas and dubbing: Audio nodes support Seed-Audio 1.0 to adjust pitch and volume, and add Uranus preset timbres; the all-in-one audio reference allows you to unselect timbres; multi-select nodes can be stored in folders with one click; the node title display is improved when the canvas is reduced; dragging and zooming the canvas is smoother.
- Improve the image quality options of gpt-image-2.6, gpt-image-2.6-flare, and gpt-image-2.6-sunburst; the assistant can create a new canvas.
- Stability repair: Fixed the problem that the creative assistant could not talk normally when connecting to some model services; after submitting the image task, a temporary network error will continue to query the original task, and the failure will not be falsely reported, and the real reason will be displayed for consecutive failures; the specific reason will be prompted when the reference material cannot be read; the wrong content will no longer be pasted when pasting, and you can paste directly after clicking the button on the canvas; the lost picture will restore the error prompt, and the material library will not become empty when a single picture cannot be read; the timeline preview will be displayed truthfully when the video is being prepared; retry generation will no longer overwrite modifications elsewhere; Windows The window will not exceed the screen when starting; the workflow editing pop-up window is highly collapsed and some services with built-in Keys are incorrectly handed over to the official computing power for processing.
- Enhanced file protection for assistant and external tool connection credentials: on disks that support file permissions, other ordinary users cannot read; permissions for data directories are no longer inherited on Windows.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.6

- RunningHub 和 ComfyUI 改为市场插件：在插件市场安装后，RunningHub 的工作流和 AI 应用、ComfyUI 里保存的工作流都能当模型用，图片、视频、音频都能生成。内置的 RunningHub 设置页、字段映射编辑器和测试台已移除，之前保存的 Key 和工作流不会自动带过来，升级后需要安装插件并重新填写。
- 插件更好写、更好管：清单只留一种写法，生成服务可以用 JS 实现，插件能自己列出模型；插件中心会提示新版本，精选插件自动更新，手动更新和安装一样要确认。
- 技能规则放开：去掉大小和文件数限制，其他工具装到 `~/.agents/skills` 的技能会自动进入「我的技能」，可在技能页关闭。
- 插件和技能文档重写：从五分钟上手开始，补上清单参考、生成服务和技能页。
- 画布创作更顺手：智能分镜表可以手动新建，`Alt/Option` 拖动复制节点，框选后批量下载素材；点击缩略图在光标处插入 `@图片N`，支持点选或快捷键连线引用；新增提示词预设，可直接导入 `.docx`、`.txt`、`.md` 剧本。
- 资产库与导出：画布生成的中间结果归入生成历史，不再混进个人资产库；资产库支持上传 MP3 等音频，详情页可复制生成提示词；时间线导出减少重复编码，修复分镜视频合并后尾帧定格。
- 稳定性修复：修复画布容量检查可能卡死、长任务租约续期和 Windows 更新回滚问题，以及失败卡片按钮、提示词清空后面板消失、重试误报冲突等问题。

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.5

- The "Plug-in" entrance in the sidebar is directly connected to the command panel: a new "Plug-in" entrance is added to the left navigation bar of the main interface (below the skills) and the `⌘K` command panel. Click to open the plug-in center to manage installed plug-ins or browse the plug-in market; official and sample plug-in packages have been simultaneously released to npm official sources and domestic mirrors.
- New `LL2 (DMC)` shortcut connection for model service: Select `LL2 (DMC)` from the service provider list on the left side of the "Connect your model service" pop-up window, automatically fill in the connection name, service address and pre-select 9 commonly used text, video generation and video super-resolution models and corresponding protocols. After pasting the API Key, you can "save and activate with one click", or enter the second step to select the model as needed.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.4

- The plug-in market is launched with the package and the character replacement plug-in: the desktop installation package has a built-in plug-in market and LL2 custom channel video protocol plug-in, which supports accelerated browsing of domestic mirrors, viewing instructions and one-click online installation; the plug-in market selects a newly added "Character Replacement" plug-in, which supports two-stage video character replacement workbench and timeline splicing.
- Video node reference mode interacts with the thumbnail role: when connecting a reference picture or video, the top of the prompt word bar provides "First and Last Frame / Universal Reference" segment switching; in the first and last frame mode, the reference picture thumbnail directly displays the "First Frame / Last Frame" corner mark and a two-picture one-click swap button. In the Universal Reference Mode, the thumbnail provides a "First Frame" prompt word shortcut button; when disconnecting the reference picture, the residual frame settings are automatically cleared.
- BeefTV official computing power estimated cost display: the public price list is automatically synchronized when the model catalog is refreshed, and the built-in assistant confirmation card, ordinary generation proposal and storyboard batch generation confirmation box uniformly display the itemized estimated costs and totals (supports per picture, per second, per Token conversion and first deduction and then settlement instructions, and the built-in Key channel is billed according to the actual channel); fixes the problem that some picture models do not appear in the assistant model list.
- Generation stability, error desensitization and interface optimization: Fixed the problem of media upload detection being occasionally interrupted without retry, the web link in the error report being mistakenly truncated, and the problem of residual keys in the error message under the old version of the system WebView; fixing the top category bar when scrolling in the skills market and hiding the page turning button when scrolling on a single page.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.3

- The first version of the plug-in market and extension ecology is online: built-in official plug-in market (supports recommended browsing and npm plug-in search), supports one-click installation from the market, and importing plug-ins from local directories or compressed packages; open canvas custom nodes, add node menus, independent pages, and built-in assistant tool extensions. Enabling or disabling plug-ins takes effect immediately without restarting.
- Large canvas capacity limit and saving performance: The settings page supports customizing the single canvas capacity limit (adjustable up to 512 MB), and the local project cover can be saved in the browser IndexedDB to reduce the size of a single canvas; the database enables parameterized queries to solve the problem of slow log escaping taking too long and polling false positive version conflicts when saving a 100-megabyte large canvas.
- Generation experience and error prompt optimization: Seedream image generation turns off watermarks by default; the generation failure card directly displays the specific error reason of the upstream after desensitization, and no longer only displays the general generation failure; cleans up the residual first and last frame characters after the video reference mode is switched, and converges the resolution options actually supported by Seedance 2.0 fast/mini; fixes the canvas save lock issue during automatic updates on the desktop.
- Network compatibility and history volume optimization: restore the local deployment and TUN/Fake-IP proxy compatibility strategy, release the IP network segment restrictions of media URLs by default and skip the pre-upload of reference materials for non-video tasks; optimize the size of the media overview preview image and automatically crop the consumed historical tool images to reduce the overhead of long session requests.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.2

- Canvas video preview, frame capture and reference material upload: Videos that fail to be decoded by the browser support on-demand transcoding H.264 (yuv420p) compatible copies during playback and automatic first frame generation, fixing the problem of black screen when extracting the first and last frames and no preview of video nodes; extending the local file upload confirmation wait and ignoring canceled requests, eliminating false positives when large videos are stored and switching canvases; when local media files are missing, a clear 404 is returned and the cache header is not written.
- Project and canvas backup and export: Added "Export Project", "Export Current Canvas" and "Export Folder" entries to the project list card, folder menu, canvas top bar menu and save status pop-up window; supports automatically skipping lost or damaged historical materials and artboards and recording them in the backup list, ensuring that valid canvases and materials are completely packaged and can be imported and restored.
- Seedance 2.5 and generation task experience: complete the conversion of Seedance 2.5 sample to high-definition, output last frame switch, video secondary model selection and picture reverse push prompt word entry; identify permission error codes such as channel grouping exclusion and retain upstream non-2xx response details to avoid false positives as general network errors; fix the node residual running state and configuration desensitization recovery problem after the generation is completed and bound.
- Built-in assistant and storyboard workflow: Unify the shot prompt word draft, storyboard linkage synchronization and storyboard-only mode; support the generation of single and three-level approval mode and one-time order creation in the background, and automatically wake up the assistant to review the film after the generation is completed; further streamline the assistant system prompt words and tool definitions, eliminating repeated re-reading of the canvas; the three comic creation skills are mounted by default.
- Cross-end collaboration and canvas performance: The top bar displays the source and summary of external changes, supports locating changed nodes and one-click undo; fixes the problem of local expired canvas cache covering new versions; reduces the rendering overhead during the video prompt panel and zoom gesture; supports BytePlus Asia-Pacific control surface and audio and video reference material upload.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.1

- New capabilities for video and picture generation: Seedance 2.5 supports first generating 480P samples to preview the composition and movements, and converting from the samples to high-definition with one click when satisfied; the canvas adds video extension, video partial redrawing, reverse push prompt words, output last frame, and generation of continuous picture groups.
- The built-in assistant is faster and saves credit: the system command and skill directory prefixes are restructured, the canvas dynamic summary and plan are moved to the end of the request, the cache hit rate of prompt words for multiple rounds of dialogue and tool calls is greatly improved; the three "lucky plus one" comic creation skills are built-in (script disassembly, character setting, storyboard prompt words), and the stability of cross-channel streaming response is fixed.
- The synchronization between opening the canvas and the background is more stable: when the canvas is opened, the finished pictures and video nodes maintain their original size and position, and are no longer enlarged and moved by the default minimum size; the background tasks of unmatched nodes no longer repeatedly try to bind every 5 seconds before the canvas is changed, and are automatically skipped after deleting the canvas and continued after restoring the canvas, significantly reducing background power consumption and log refresh.
- External Agent (MCP) experience upgrade: only common business operations are exposed by default, and the underlying operations are converged into two unified entrances: query list and execution call, which greatly reduces the context occupied by external tools; the picture viewing tool directly returns the picture content for external Agent review.
- Channel and protocol compatibility: identify the video cloud transfer waiting state and automatically follow the object storage redirection; Seedream 4.5 supports selecting the output image format; remove Agnes 2.5, MiniMax H3 and client prompt word length hard-coded interception, repair custom channel capability judgment and Kling official interface authentication.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.1.0

- Desktop automatic updates are faster and more stable: incremental update packages (`.delta.zip`) and binary differential patches are supported. The unchanged runtime and plug-ins are directly verified and reused on the machine. The regular upgrade download size is greatly reduced; the complete package is automatically rolled back when the increment is unavailable or the verification does not match.
- Domestic update downloads preferentially connect to domestic sources (CNB), and are dual-sourced with Cloudflare R2: when encountering a connection timeout or low speed, it automatically switches to another source and continues downloading from the downloaded bytes, and finally uniformly verifies the file hash and Ed25519 signature.
- The generated parameters and reference materials are uniformly verified by the server: when using a custom channel (BYOK) or a model that has not issued a capability statement from the server, the client will no longer block requests in advance, hide parameter controls, gray out models, or automatically delete mounted reference materials.
- Fixed the issue where the canvas node send button occasionally stuck in the loading state: nodes to be retrieved or error reported are no longer misjudged as being generated, and recovery entries such as "Continue Retrieval" and "Recheck Status" are directly displayed at the bottom; when the local node status cannot be resent directly, a persistent prompt for the specific reason is displayed above the input box.
- Skills and settings interface: Prioritize the display of Chinese titles for imported skills and standardize the truncation of long names and introductions; fix the problem of double borders and inconsistent heights in the password input box on the settings page.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.0.6

- Retrieval of generated results is more stable: for images and videos generated with a BeefTV account, the results are first saved in the cloud and then downloaded directly. Large-size Seedream images and videos are no longer unretrievable due to download interruptions; reference images are directly uploaded to the cloud and no longer forwarded through the interface.
- After exiting, refreshing or disconnecting from the network during the generation, reopening the canvas will resume the original task to retrieve the results without resubmission or repeated deductions; video and AI super scores can also continue to retrieve the generated results in the background.
- Failed nodes are displayed according to the conclusion given by the server: when the original task is determined to have failed, it can be regenerated directly, and it will no longer stop at "Continue Retrieval"; if the original record cannot be found after submitting with a BeefTV account, click "Continue Retrieval" to resubmit it once with the original number (no repeated deductions). The original task will be automatically put back on the canvas while it is still being executed. If the node cannot be confirmed after the retention period, the node will be unlocked.
- The duration, resolution and other options of the video model follow the online model directory. After the new model is online, refresh the model list and you can use it.
- Reference pictures support TIFF, AVIF, and HEIC; pictures with a .png extension that are actually AVIF or HEIC will be automatically converted to PNG; if the format is not supported, it will prompt which reference picture it is.
- Custom models: When "Reduce Dynamic Effects" is turned on, the model type can be selected normally; the type of the added model can be changed directly in the list; if the request protocol is missing when saving, the protocol settings of this model will be automatically opened; similar video models newly added in the same channel will inherit the selected protocol.
- Partially redrawn to make text and buttons clearly readable in light theme.
- Editing timeline: Dragging the first segment through the middle of the next segment will swap the order. Dragging only a little will still give way to the subsequent segments.
- The result video of deep motion capture is supplemented to 30 frames, which also takes effect on Windows.
- Online update decompression is faster and no longer times out when there are many files on Windows.
- Seedream, Gemini, Jimeng, OpenAI Images and Grok image channels that come with Keys are now executed by official protocol plug-ins; when the plug-ins are deactivated, a prompt will be displayed before generation.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material.

## v2.0.5

- The built-in assistant supports viewing the readable thoughts returned by the model, which are folded by default and separated from the tool progress and the reply text; copying the reply still only copies the main text. The text continues to be displayed paragraph by paragraph as the model returns.
- After a new user connects for the first time, the built-in assistant uses DeepSeek V4.1 Flash by default; users who have already selected a model will keep their original selection, and refreshing the directory, reauthorizing, and changing accounts will not automatically change it.
- Improved the smoothness of Mac canvas panning and zooming, reducing blurring effects during gestures, line decoration, full page redrawing, and repeated mounting of nodes; fixed the issue of missing some nodes when panning after restoring the saved perspective.
- The first clip in the editing timeline can be dragged to make way for clips on the same track; when a single clip fails to load, a name prompt will appear, and other clips will continue to be previewed.
- Seedream image size is verified according to the specific model, and the recognition of domestic Pro and Flash models is corrected; unsupported sizes will be given an operable prompt before generation.
- Some failed image tasks can continue to retrieve existing results in the background and save them back to the canvas. This change is limited to image recovery and does not include the complete video and super-resolution automatic recovery process.
- When adding a model manually, you need to explicitly select the type such as image, video, or text. Text is no longer selected by default. Select again when adding the next model to avoid using the wrong type.
- Topaz's over-score description is changed to deduct the upper limit of the fee first, and settle according to the actual usage after the bill verification is completed. The total withholding amount is no longer displayed as the unit price.
- For model service settings, write down the required credentials according to the protocol. When using different credentials, you will be prompted to split them into independent connections. If you cannot read the model list, you can manually fill in the model ID to continue configuration.
- Corrected the success judgment and request parameters of Jimeng official video, as well as the retrieval of Runway, Luma, and Grok video results; the reference material is checked according to the capabilities of the selected model.
- When the video is to be retrieved, compatible protocol fixes can be installed normally; old tasks of Luma and Runway continue to use the original task numbers to retrieve results without regeneration.
- Updated official connection presets for discontinued video services; protocol definitions still used by existing connections or unfinished tasks will be retained.

Note: Some audio and video understanding, subtitles and assistant film layout still need to be manually checked against the original material. When the model does not return readable thoughts, the thoughts will not be displayed out of thin air; the streaming display speed still depends on the model return speed.

## v2.0.4

- Zooming and panning of large canvases (tens to hundreds of nodes) are changed to distant view thumbnail rendering: all nodes are still visible in the distant view, and automatically return to the complete card after zooming in, significantly reducing lag and flickering.
- Dragging nodes only updates relevant connections, reducing redrawing of the entire page; the assistant waits for the canvas to be saved before initiating operations. If it encounters a version conflict, it will suspend the batch of writing and re-read to avoid replaying expired operations.
- When the generation result has been saved but the canvas is still in the loading or error state, the saved result will be displayed instead; the reason for the failure of the pre-generation check will continue to be displayed in the generation panel and will be cleared the next time it is prepared.
- The upper limit of reference materials is changed to be limited by type: pictures, videos, and audios are each configured with a limit according to the model's capabilities, and a total number is no longer used to block subsequent additions; the over-limit prompt is directly displayed in the reference content panel, and the type, current quantity, and upper limit are clearly stated.
- Reference audio and output duration are checked according to official documents: the minimum length of a single segment of Seedance reference audio is 2 seconds, and the minimum length of output is 4 seconds; when stopped, it will be written clearly which item, what it is now, and how much it needs to be changed to.
- The response format (response_format) of the third-party image channel can be selected as b64_json or url. The three paths of front-end direct connection, back-end built-in request and official OpenAI Images plug-in will be sent according to the configuration.
- A new "wheel operation" has been added to the canvas appearance, which can be fixed to zoom or pan, and no longer relies solely on the device step size to guess (the default is still automatic); the handwritten character name and material title in the prompt word remain the original text, and "one-click quotation" and @ only append the material reference at the end.
- Generation no longer replaces the existing name of the node: when initiating generation from a text node, the name you give remains unchanged, and the node is named according to the prompt word only when it is still the default name.
- When creating a new node, select the compatible model in the model group with the same name according to the remembered parameters. The last parameters of the image and video nodes will continue to be memorized; the display and selection of newly created personal materials after classification have been fixed, as well as the problem of COS/OSS endpoints repeatedly splicing buckets.
- The creation assistant can read image nodes that only save resource addresses; static images are sent according to original pixels, long images and small words are no longer compressed and lost, and local details can be viewed according to original pixels.
- Fixed the issue where the canvas displays "Uncertain submission result" when the upstream has explicitly rejected image input and blocks retry after modification; the desktop side restores the local timeout policy; the generated submission of external MCP/CLI no longer requires the confirmation round of the built-in assistant.
- The paid submission of the creative assistant must hold the limited authorization written in the confirmation card. Subsequent model calls cannot upgrade the unconfirmed plan to authorization; the confirmation card displays video footage and cost estimates, and unquoted pictures and dubbing are clearly billed separately.
- Calling FFmpeg/ffprobe under Windows no longer pops up the console window.

Note: The audio and video model may still miss the cut point or write the wrong homonym. The subtitles and images need to be checked against the original film; the subtitle typesetting and partial text modification of the assistant's finished film still need to be manually checked. The automatic retrieval changes of "The upstream has been generated and the canvas cannot be pulled into the film" are still under review and are not in this version.

## v2.0.3

- The length of the video prompt words is changed to be verified according to the selected model and interface, the universal default interception of 8000 characters is removed, and the prompt words are not automatically truncated.
- The newly inserted reference material reference follows the specific material, and still corresponds to the original image after adjusting the connection; improve the correspondence between characters and materials in the Seedance all-round reference.
- Fixed the issue where clicking the reference button in the material column was invalid; when the material table conflicts with the actual reference, a prompt will be issued before generation.
- Failed videos will be retried using the prompt words, materials and parameters saved in the original task; if you need to use later modified content, please create a new request from the node's generation entrance. Tasks in progress or completed continue to retrieve existing results.
- Extend the waiting time for super quotation, creation and recovery requests, and improve the prompts when the network times out and the source file is unavailable.

Note: The handwritten numbers in the old prompt words remain in the original order; the existing custom word limit is still in effect, and the default limit can be restored in the model settings. Generated details such as character clothing and hairstyles may still be unstable.

## v2.0.2

- Supports layer splitting and associated group pictures of configured Seedream channels, and the generated results are saved to the canvas respectively.
- Fixed the issue where the assistant cannot check the results after generating multiple images; the entire image production does not currently support layer splitting or grouping images, and will prompt before generation.
- Improved task resumption, stop and progress display of the Creation Assistant, and fixed issues with reading the current canvas and selecting review materials.
- Limited retry when uploading reference images encounters a temporary failure, and the original upload record will be continued after interruption.
- Fixed multi-image requests for some external video channels and task query interruption caused by temporary DNS errors.
- Assistant wide tables can be scrolled horizontally within the sidebar.
- Fixed an issue where the skill installation link failed to open again when Windows was already running BeefTV; the link still only opened the installation confirmation page of the specified version.

Known limitations: The audio-visual model may still miss the cut point or write the wrong homophone, and the subtitles and images need to be checked against the original film; the subtitle typesetting and partial text modification of the assistant's finished film still require manual inspection.

## v2.0.1

- Added a reusable canvas workflow that allows you to edit templates, bind inputs, select multi-image results and perform media processing; the built-in account supports Topaz image and video super-resolution.
- Fixed canvas update loss when task recovery, multi-image generation quantity matching and task verification after workflow cancellation, retaining generated results and subsequent edits.
- The diagnostic package supplements cross-boot recording, assistant execution and material inspection, supports offline analysis through CLI; fixes authorization errors and cross-domain request issues when the assistant exits.
- The skills market supports fixed version installation, file viewing, start and stop, rollback and private rewriting; the author can continue drafting on the client and confirm private uploading and public submission for review respectively.
- The skill link opens the installation confirmation page of the specified version and displays the review summary; text skills do not require the configuration of a multi-modal model.
- The new version of the installation package and automatic updates use the Cloudflare R2 download source. The old client retains the update entry and continues to verify signatures and complete files.

Known limitations: The audio and video model may still miss the cut point or write the wrong homonym, and the subtitles and images need to be checked against the original film; the subtitle typesetting and only the modification of the ending text of the assistant's finished film still require manual inspection.

## v2.0.0

- The built-in assistant can prepare storyboards, organize reference materials and generate plans. After confirmation, continue to check the results, edit and export into films and editable projects.
- Added default multi-modal model selection for audio and video review; other creative tools can still be used when not configured, and clear prompts for media checks that cannot be completed.
- Added reference material reading, independent audio and video inspection and local modification tools, and saved inspection records to facilitate verification of results and continued editing.
- The skills market supports browsing and installing fixed versions; submissions can be prepared through the web page, CLI or external assistant, and uploaded and publicly submitted for review for confirmation respectively.
- Large reference materials support multi-part uploading and continuation after interruption, and the progress of uploading, downloading, verification and saving are displayed respectively.
- Fixed the problem of returning the generated results to the canvas, old node occupation and repeated downloading; large canvas export uses the native save entrance.
- Improved clip preview, low frame rate video playback and vertical subtitles, updated project license portal, third-party license, and source code description.

Known limitations: The audio-visual model may still miss the cut point or write the wrong homonym, and the subtitles and images need to be checked against the original film; the assistant's subtitle typesetting and only modification of the ending text of the finished film are still being verified.

## v1.7.27

- Music 3.0 generates MP3 at 44.1 kHz and 256 kbps by default; the settings only display the actually supported formats, and existing FLAC settings are automatically adjusted to MP3.
- Keep connected during the generation of corporate music, and save the complete audio after receiving it; connection interruption or error content will not be regarded as successful generation, nor will it be automatically regenerated.
- The desktop update list and installation package use the Guangzhou COS download source, and continue to verify the signature, file size and hash before installation.

## v1.7.26

- Fixed the issue where the confirmation box for deleting model channels cannot be displayed when "Reduce Dynamic Effects" is turned on.
- When the reference image upload fails, it accurately indicates that the generation has not started yet, and you are allowed to actively retry later.
- Tasks whose submission results are still unknown will continue to retain the original records to avoid turning queries or retrievals into repeated generation.
- Display the size of the Deep Capture component before downloading and wait for confirmation. Domestic download sources are used first, and backup sources are switched when there is a pause; after restarting, the user decides whether to continue the task.
- Storage settings centrally manage the storage of depth components and reference material objects, supporting test uploading, reading and cleaning; custom channels can select the transmission method of reference materials.
- Midjourney generates a fixed four pictures each time, and the four results are saved separately and can still be viewed when the canvas is reopened.

## v1.7.25

- Save complete parameters and reference materials before generation; when the submission result is uncertain, query the original task first to avoid repeated generation. Completed results can continue to be retrieved, and the number of simultaneous downloads is limited.
- Optimize canvas object naming, reference material selection and video settings; reference video thumbnails are loaded on demand to reduce waiting and memory usage when a large number of materials are used.
- Fixed model menu positioning, light and dark theme contrast, and prompt word size settings; environmental self-checks supplement browser storage and running environment checks, and diagnostic content is isolated by account.
- GPT Image 2.5 opens up full quality and size options, and uses the low-quality level by default; successful image downloads can restore the original image to avoid overwriting the results with unfinished receipts.
- Supports connecting to local and LAN model services, and continues to use system proxy settings when proxy environment variables are not set.
- Fixed domestic video parameters and watermark settings, updated object storage dependencies; the desktop package completed the media detection tool, and the macOS installation image improved mounting compatibility.

## v1.7.24

- Fixed the problem of "capturing the last frame" degenerating into the first frame when the video is not preloaded. If the decoding fails, it will automatically fall back to pull the H.264 playback copy and pop up the capture completion prompt; enable the native dark title bar and dark startup background color on the Windows desktop.
- Added "Update Failure Troubleshooting" to the sidebar, which supports opening the log folder and exporting the desensitized `update.log` summary in the diagnostic package; the preparation for installation timeout distinguishes the verification, decompression and preparation for installation phases.
- Preserve users' concurrent additions, deletions, and modifications to canvas nodes and timelines during the storage of historical media; fix the crash due to array method compatibility issues when the old desktop WebView opens the canvas.
- External video models need to explicitly select the protocol. The Sora protocol prompts unsupported multi-material restrictions before submission, and a new reusable JSON video protocol is added; the BytePlus channel is supported to automatically identify the Volcano Ark protocol and Dreamina video editing, continuation and automatic duration.
- H3 first and last frames, character multi-view and Styles mode have clear proportion limit prompts; close the H3 Max intermediate frame entrance and retain the clean button of historical residual parameters.
- Distinguish between local credential error and insufficient disk space error, distinguish between request not yet sent and submission result not confirmed (409), breakpoint resumption only reuses cache bytes when strong verification matches.

## v1.7.23

- Fixed the problem of old unstored media nodes in the canvas intercepting the write-back of newly generated results, and clicking "Continue Retrieval" to flash and return an error; the canvas material binding is automatically completed when the generation is completed or continues to be retrieved.
- The Windows installation wizard is simplified to one-click installation, which creates a desktop shortcut by default and opens the software after completion; direct writing to the target directory eliminates "error 32" caused by anti-virus software scanning temporary directories, supports direct selection of the drive letter root directory, automatically closes running old processes, and fixes Chinese garbled characters on the installation interface.

## v1.7.22

- All video channels give priority to retrieving upstream results; when the download is interrupted or the link fails, the original task link is refreshed. BeefTV's official computing power can also switch to backup files without regeneration.
- Fixed the issue where multiple workflow results retrieved the wrong material after the link was updated, and identified videos, pictures, and audio according to actual files.
- The duration input of H3 Max and Max Turbo supports decimal seconds, and H3 Max supports intermediate frame and reference sequence settings; fixes the problem that the advanced settings menu is blocked by the elastic layer.

## v1.7.21

- After the video generation is completed, the upstream results will be downloaded first to reduce the wait for retrieval; when the download fails, the backup file of the same video will be automatically retrieved without regeneration.
- Switch to the backup address in time when the download is interrupted or there is no progress for a long time; canceling the retrieval will stop the current download.

## v1.7.20

- Added MiniMax H3 and H3 Max, providing RMB quotation together with H3 Max Turbo.
- H3 supports 2K/4K, first and last frames, and multi-image, video, and audio reference; the first 5 reference images are free, after which a per-image fee will be displayed.
- Corrected the screen ratio of H3 video request, key frame video follows the picture ratio.
- The waiting time for deep motion capture is consistent with the backend, and the original task will be restored after restarting; the generated videos can continue to be retrieved.

## v1.7.19

- Only decompress once after downloading the update, and display the progress of verification, saving, decompression and preparation for installation. When it fails, you can see the reason and try again.
- Records left by previous import failures will no longer be treated as unsaved before updating. If saving fails, you can return to processing, try again, or continue updating after confirmation; continuing to update may lose unsaved modifications.
- If the directory is occupied during Windows installation, it will automatically retry and display Chinese instructions and error codes. When the installation fails, we will try to restore the original program.
- After turning on "Reduce Dynamic Effects", the default model menu will remain on the screen and can be opened and selected normally.

## v1.7.18

- Added MiniMax H3 Max Turbo video model, supporting 480p, 768p, 1080p, displaying the current RMB price per second.
- Supports first and last frames, only last frames and specified dubbing; the generated results are saved using the canvas and restored from the original task.

## v1.7.17

- Fixed the issue of macOS video player not responding when clicking full screen.
- The progress, size and speed are displayed when the generation results are retrieved. The download after the video generation is completed will also be displayed. If the download is interrupted, it will be automatically retried. "Continue retrieval" will not regenerate or charge again.
- The result is put back into the canvas only after the download is completed, and only the relevant nodes are updated and other edits will not be overwritten.
- When the results cannot be written to the canvas for a long time, the wait will end and prompts to continue retrieval, instead of spinning in circles; the background download of generated results supports stopping and continuing.
- When publishing pictures in batches, waiting in line no longer consumes the number of automatic retries. Only requests that are actually sent are counted.
- Fixed the issue where the BeefTV official computing power video model was called as a text model and reported an error; the settings page and drop-down will no longer freeze when there are many models.
- Fixed an issue where some BeefTV official computing power picture models disappeared from the picture list due to old protocol configuration.
- The diagnostic package completes the missing task records and comes with a desensitized model configuration summary to facilitate troubleshooting of default model and channel deletion issues.
- Deletion operations in canvas lists, editors and folders will be confirmed first.
- Newbie guidance has been added to the homepage, and "3D Director's Desk" and "Beef Agent" have been added to the creation portal.
- Improved subtitle and timeline editing, material classification and batch operations, model directory refresh, and recovery after desktop update failure.
- Windows installation packages can choose the installation location; storage migration is no longer blocked when temporary files are occupied.
- The old conversations of the built-in assistant are kept as read-only records, and continuing to send messages will automatically open a new conversation and continue the previous content.
- Even if the first round fails, is disconnected, or restarts after the old session is connected, the same connected session will be reused and the context will be retained.

## v1.7.16

- The subtitle window of the audio and video nodes supports automatic cloud transcription and can read the transcription model of the connected BeefTV account.
- Support hy-asr-3.0-preview, recognition results can be edited, saved to canvas and exported to SRT; local whisper.cpp transcription is retained.
- Transcription models are displayed separately from dubbing and music generation models to avoid using mismatched interfaces.
- When the cloud transcription is interrupted and the result is uncertain, the submission will not be automatically repeated to avoid repeated billing.

## v1.7.15

- Adjust the workspace sidebar, canvas tools and material panel, retaining the theme, update and help entrances.
- Added confirmation when deleting a node being generated; after switching canvases or accounts, the old confirmation will not delete other canvas contents by mistake.
- The version record retains the local draft, which can be previewed and downloaded; the current draft is retained before restoring the historical version.
- Fixed unexpected closing of material reference menu, click penetration and keyboard navigation issues.
- Historical videos only load preview when hovered or focused, and download is canceled after leaving.
- Windows provides video transcoding tools in the package; videos that cannot be played directly can be previewed on demand and the originals can be retained.
- Improve the retrieval of video results under domestic networks; read the backup interface for the same task after a normal line failure, without regeneration.
- Fixed Windows connection, canvas media and scroll wheel interaction issues.
- Added Ubuntu 24.04 x64 desktop package, supporting packaged CLI and MCP.

## v1.7.14

- Assistants on compatible channels will automatically try to resume when there is no new content for a long time, retain completed operations, and can still stop at any time.
- The video node will automatically display the first frame without modifying the canvas to prevent the prepared generation plan from expiration.
- Fixed the problem of accidentally leaving by pressing Backspace on the canvas, and the issue of deleted content not being saved in time when leaving or switching canvases.
- The generated plan displays the specific reasons and waiting status for failure to start; long tasks display the waiting time.
- Multiple partial edits in the same round are continued according to the version on each canvas, and the original operating identity is retained when restoring; when external deletion conflicts with local editing, local content is retained and prompts for processing.
- Fixed the problem of truncated reading of large canvases. The assistant can read complete nodes, connections and timelines in pages.
- Fixed the problem of still using the old model after switching assistant models; continuing to use the original model when restoring unfinished rounds.
- Fixed an issue where the workspace canvas search was incorrectly filtered in full access mode, causing other canvases to not be found.
- Narration editing can detect actual pauses and listen to the trimmed audio again to check the last words and retained content.
- Fixed an issue where the assistant still displays the previous failure prompt after the material is successfully read and the supplementary resources are successfully loaded.
- When deleting material records, the canvas and historically used resources are retained to avoid affecting existing works.
- Model configuration supports search selection, retaining custom services and temporarily unavailable model settings.
- Improved BeefTV MCP's connection status and management portal, sidebar collapse and social portal, and provided in-app Chinese update instructions.

## v1.7.13

- The connection entrance is changed to "Connect BeefTV", and the new login authorization and wallet console use beeftv.app; the connected enterprise account is retained.
- Authoring Assistant supports image, video and audio references, on-the-fly supplementary content and fixed-version skills, and resumes interrupted work using persistent sessions.
- The assistant can bind uploaded materials to canvas reference nodes; the skill selector supports direct installation of ZIP and Markdown skills.
- Built-in assistants with options for read-only, current canvas, or full access; cross-canvas edits can be undone in the round.
- Authorized session materials can still be read after switching assistant permissions; fixed the issue where new results are overwritten by the old canvas when multiple images are generated again.
- Assistant can crop and arrange footage, add narration and subtitles, and render video previews locally.
- Assistant conversations directly display the finished version, which can be played, downloaded, and restored after reopening the conversation.
- When the model reply fails, completed operations are retained and an entry point is provided for continued processing.
- External Agents can use complete business tools through MCP/CLI without repeatedly selecting execution permissions in BeefTV.
- Completed node movement, deletion, removal of connections and model directories; fixed the issue of installation cache left behind by failed updates.

## v1.7.12

- Seedance 2.0 and 2.5 have unified names, and the model list no longer displays real-life material models repeatedly.
- Model selection and assistant generation confirmation display of current quotes.
- Model settings from old projects are retained and can still be used.

## v1.7.11

- Save the canvas node before generating the image, and stop submitting when saving conflicts to avoid finding the result node after the generation is completed.
- When the image has been generated but the canvas update fails, the original task is retained and the resource can be reloaded without generating it again.
- Fixed the problem of "Reload Resources" being unavailable on the desktop, and the problem of being generated being displayed after resuming the task.

## v1.7.10

- Real-person video models are uniformly displayed as Seedance 2.0-real person, Seedance 2.5-real person, and model selection, settings and name search remain consistent.
- API model IDs, pricing and channel routing remain unchanged.

## v1.7.9

- Added Seedance 2.0 and 2.5 real-life material versions, the price is displayed when selecting a model, and the standard version retains the original price.
- Fixed an issue where the model directory may be refreshed and the storyboard workbench may automatically switch to different charging levels when restoring settings.
- Check the availability status and quotation of the real-life material version before generating and retrying, and the assistant confirms that the card displays the unit price simultaneously.

## v1.7.8

- Fixed an issue where the page crashed and could not be played after clicking to preview some videos.
-Fixed the issue where the turned off video sound switch was turned back on when restoring settings.
- Fixed an issue where Windows could not complete the verification after downloading the update package.

## v1.7.7

- Before generating, check whether the channel can read the reference material. If an online link is required, you can fill it in directly and continue generating, or switch channels.
- Display the preparation stage when processing reference material, and then submit the generation task after completion.
- Fixed an issue that caused the task to be unable to be parsed due to the audio, watermark and other switch parameters of some video channels.

## v1.7.6

- Unify the layout of the material library, generation history and canvas material selection, and improve the narrow window display and application loading screen.
- After uploading materials, switching pages will still complete the upload, and returning to the page will not create materials again.
- Add confirmation before permanently deleting the generated history. Projects that fail to be deleted in batches can be retried individually.
- Provides an entrance to restore old recycle bin materials and retains previously archived materials.
- Improved image scaling and video playback controls in material details.

## v1.7.5

- The desktop update supports resumed downloads and automatic retries, displays download progress, speed and remaining time, and provides clearer network error prompts.
- Fixed the problem that the audio and video in the asset details on the desktop cannot be played: after reading the media through local resource authentication, the saved works can still be played after restarting.
- Fixed the issue where the relative download address was misjudged as an invalid address after the video generation was completed.
- Added a fully parameterized video protocol with a user-configurable address, supporting picture, video and audio reference materials.
- Improved ability recognition and loading timeout of custom model directories.
- Fixed the problem of losing extension when renaming media when saving in macOS.

The old updater of Windows v1.6.20–v1.6.22 cannot recognize the directory structure of the new version. Please close the application and manually extract the complete installation package of the new version; keep the original user data directory. In-app updates are available for v1.6.23 and later.

## v1.7.3

- Add guided setup for OpenAI, Google Gemini, Volcano Ark and compatible model services, with searchable catalogs and manual model entry.
- Preserve selected models and explicit protocol settings when refreshing custom catalogs.
- Wait for completed generation results during model tests and preserve actionable authentication errors.
- Encrypt local provider settings, backup settings and custom task headers; omit credentials from the browser's persisted configuration cache.
- Require upgrades from released Windows installers and failed-launch rollback tests against the final Windows package before publication.

## v1.7.2

- Restore the bundled Windows MCP command-line tool and prevent MCP connections from accidentally opening another desktop window.
- Add separate Claude Desktop setup instructions and stop offering connections when installation files are incomplete.
- Keep Windows runtime discovery outside AppData so packaged MCP clients cannot reuse an old virtualized runtime file.
- Start the Windows assistant in the background without opening a Node console window.
- Explain blocked model-service addresses and DNS failures with actionable connection guidance.

- Automatically remove completed upgrade folders after the local workspace starts successfully, while preserving failed upgrades for recovery. Windows also removes its released lock file; macOS retains the empty lock for compatibility with older update helpers.

- Fix the canvas assistant being unavailable when following a default text model from a custom local channel.
- Keep explicit model capabilities, protocol restrictions, and channel credentials in effect when resolving assistant connections.

## v1.7.1

- Choose the canvas assistant model directly beside the message input.
- Start with GPT 6 Astra after connecting BeefTV Official Compute, and keep your chosen model when refreshing the catalog.
- Offer Astra, Opus 5.5, DeepSeek V4.1 Flash, and GLM 5.3 when available on the connected account.
- Save model changes before starting the next assistant request.

## v1.6.23

- Add a canvas assistant for drafting scenes, editing nodes, connecting references, and proposing image or video generation for confirmation.
- Keep assistant conversations and canvas changes recoverable across restarts, with conflict checks and per-turn undo.
- Let external agents connect through the bundled CLI and MCP using revocable read-only or read-write access.
- Share canvas operations and generation delivery across manual editing and agents, preserving original tasks during recovery.
- Unify media rendering and workspace backup paths while retaining existing projects, assets, and tasks.

## v1.6.22

- Add a director workbench for staging objects, cameras, motion paths, and shot previews.
- Keep director references and exported previews attached to the correct scene when switching or closing the workbench.
- Preserve shot prompts, camera motion, and independent paths when editing or duplicating scenes.
- Restore the canvas archive import entry in the project library.

## v1.6.21

- Keep copied media nodes on the canvas when regenerating them, including changing a copied video's resolution.
- Upload local Seedance reference media before generation, supporting large files and validating media limits before submission.
- Preserve reference dimensions and use the same media preparation path for built-in and protocol-based video generation.

## v1.6.20

- Keep media file extensions when saving or renaming downloads in the Windows file dialog, while preserving overwrite confirmation and cancellation.
- Use the actual media format for asset-library downloads, including MOV, SVG, WAV and M4A.

## v1.6.19

- Explain account quota shortages with actionable balance, token and plan guidance.
- Distinguish completed videos that could not be saved from generation failures, directing users to recover the original result without paying again.
- Preserve structured provider errors and request IDs through video creation, polling and manual result recovery.

## v1.6.18

- Continue polling the original video task after Windows socket resets or connection aborts instead of failing immediately.
- Retry interrupted media downloads without submitting a new paid generation, while preserving cancellation and retry limits.
- Explain Windows network disconnects clearly in saved task errors and include native Windows recovery regression checks in desktop releases.

## v1.6.17

- Restore the audio toggle for BeefTV Official Compute Seedance models so silent video requests explicitly disable audio.
- Repair missing task diagnostics columns when upgrading from preview databases that reused migration numbers, preserving existing projects and tasks.
- Distinguish local task storage failures from model parameter errors and explain when generation has not been submitted.
- Require two complete rounds of real generation acceptance across six image and video paths before publishing desktop updates.

## v1.6.16

- Recover transient video download disconnects using the original provider task, with bounded background recovery for supported video protocols.
- Add “Retrieve results” to failed video task details on the canvas and in desktop task history; query and download the original result without creating another paid generation.
- Treat lost submission receipts as unconfirmed instead of silently resubmitting; keep explicit rate limits and pre-dispatch rejections retryable.
- Show readable, sanitized task log summaries and prevent late task detail responses from reopening or replacing a different task.

## v1.6.15

- Preserve specific generation errors, request IDs, timings and bounded request history in copied diagnostics, including after reopening a task.
- Distinguish local input and response-size limits, provider failures, and errors while saving or applying generated results.
- Include task image settings, reference counts and limits without copying prompts, credentials or media addresses; preserve request evidence during background polling and clear it when retrying.

## v1.6.14

- Keep canvas task details up to date with the desktop backend while a task is running, including progress, logs and start/completion times.
- Stop detail polling after completion and cancel pending reads when closing or switching tasks; show a retry notice when details cannot be refreshed.

## v1.6.13

- Accept Windows PowerShell ZIP path separators when installing signed depth components while retaining traversal and duplicate-file protection.
- Use the configured Windows/macOS system proxy for optional depth-component downloads, matching the desktop updater and preserving explicit environment proxy/bypass settings.
- Include Windows x64 depth-video processing from v1.6.12 with signed optional runtimes. CPU inference is tested; NVIDIA CUDA support is a community testing preview with a one-time CPU fallback for device failures. First use downloads components, and CPU processing can be slow and memory intensive.
- Expand the director workspace with scene controls, camera following, aspect frames, screenshots and panorama generation history.
- Preserve director scene covers and task recovery context, and improve canvas crop and trim controls at low zoom.
- Check for desktop updates periodically and support downloading and installing from one action while saving work first.
- Prevent late uploads and screenshots from overwriting reopened director scenes; drain panorama result writers before switching workspaces.
- Stamp director cover and output edits before persistence so refreshed canvases retain their previews.
- Install the matching Chromium browser in CI and tolerate subpixel rounding in model-picker layout checks.

## v1.6.12

- Add Windows x64 depth-video processing with the fixed Small model, signed optional CPU/CUDA runtimes, resumable verified downloads, and process-tree cancellation.
- Validate CUDA with a real model probe and fall back once to CPU for device failures. CUDA hardware support is a community testing preview; CPU inference has been tested on Windows with 2-second and 15-second clips.
- Fix Windows PowerShell 5.1 runtime-builder encoding and align the worker's video-duration limit with the app.
- Serialize component installation and stop download verification and extraction when cancelled.
- First use downloads optional components; CPU processing can be slow and memory intensive. Apple Silicon Mac processing remains unchanged.

## v1.6.11

- Fix local reference images being rejected before submitting Wan 3.0 video tasks through BeefTV Official Compute.
- Share verified enterprise video contracts across the model catalog, reference validation, and request preparation; preserve explicit protocols for other models.
- Reject unsupported reference types and counts before submission, and retain actionable media guidance in task history.
- Honor installed protocol media declarations and include the shared contracts in container builds.

## v1.6.10

- Check reference-video frame rates on WhatsToken material-conversion routes, including ordinary, fragmented and mixed MP4 files.
- Explain frame-rate, unsupported-codec and asset-access errors with actionable guidance that survives task history reloads.
- Preserve authentication errors and request identifiers when formatting media errors.

## v1.6.9

- Fix built-in BeefTV Official Compute Seedance profiles selecting a package name instead of the installed video provider ID, which caused false "interface not installed" failures before submission.
- Repair existing enterprise profiles automatically and accept previously saved OpenAI Videos protocol aliases without bypassing disabled plugins.
- Verify imported and restored Seedance profiles against the shipped provider catalog and test legacy aliases through the installed plugin runtime.

## v1.6.8

- Read missing reference-video dimensions even when duration is already known, and reject unreadable or out-of-range video before submission.
- Validate local and inline video dimensions from the actual file instead of trusting stale metadata.
- Explain pixel-limit failures with the affected reference, actual dimensions and allowed range.

## v1.6.7

- Ask for confirmation before paid Seedance 2.0 standard and 2.5 reference-video generation on affected channels where the requested aspect ratio may not be honored.
- Show frame, edit and extension settings that follow the source media, and explain first-frame compatibility errors with actionable guidance.
- Preserve generated videos and show a notice when their measured aspect ratio differs from the submitted request.

## v1.6.6

- Preserve structured provider error codes when polling Seedance tasks, so temporary route outages do not ask users to change model settings.

## v1.6.5

- Preserve explicit Seedance 2.5 reference/edit/extend task intent in provider requests.
- Recognize temporary model route unavailability as an actionable provider error.

## v1.6.4

- Restore Seedance image, video and audio references for built-in BeefTV Official Compute models after catalog import and configuration reload.
- Migrate the old built-in zero-reference profile while preserving unrelated custom limits, and align Seedance submission with the Videos API.
- Recognize Seedance capabilities for OpenAI Videos model profiles in both frontend and backend validation.

## v1.6.3

- Preserve explicit first/last-frame roles and adaptive aspect ratios for Seedance 2.5, including official model aliases and BeefTV Official Compute requests.
- Keep reference generation distinct from frame, edit and extension constraints; retain explicitly selected reference and extension modes.
- Add a supported-mode selector to the professional video canvas and explain when output parameters follow input media.
- Explain nested TaskTypeConstraint failures with actionable guidance and retain the same message and diagnostic IDs after task reload.

## v1.6.2

- Retire the unfinished built-in Agent product surface: the canvas dock, creation entry, home capability card, Agent query parameters, Agent settings and the `/agent/*` API are no longer reachable, so partially working Agent flows can no longer be entered by mistake.
- Enforce the retirement at the product boundary: generic task creation, task retry and the task worker refuse `cloud_agent`, `cloud_agent_step` and `agent_memory_compact` work instead of executing it as an ordinary paid text generation, and the periodic Agent memory compaction no longer runs in the background.
- Keep historical Agent runs, profiles, memories and tasks in place with no destructive migration.
- Manual creation and generation keep their existing authorization, quoting, approval, idempotency and cancellation behaviour on the canvas and in the creation workspace; canvas editing and connections, projects, assets, local storage, model channels, the built-in BeefTV Official Compute connection and the v1.6.0 depth workflow are unchanged. The retired Agent approval and memory endpoints are removed together with the rest of `/agent/*`.
- Remove the unused local `AgentPort` wiring, the test-only `generation.Engine`/`Deps` wrapper that had no production caller, and the unreferenced experimental `cmd/mcp` stdio entry.
- Simplify the core CI gates to the checks that guard the local product surface.
## v1.6.1

- Explain input and output moderation failures by text, image, video and audio, including copyright, privacy and counterfeit-content restrictions.
- Preserve specific failure guidance and request IDs when reloading task history; avoid attributing general moderation failures to real-person references.
- Distinguish upstream billing problems, configured usage limits, concurrency limits and model permissions, including errors wrapped in generic request codes.
- Keep uncertain submissions and unchanged moderation failures from automatically generating another request.

## v1.6.0

- Add depth action capture to the canvas video-processing menu on Apple Silicon Macs, with an optional local runtime and separately cached Small model weights.
- Download and verify depth components from the BeefTV release, with a Hugging Face fallback for model weights and visible task progress.
- Keep video first-frame posters visible until hover playback presents a decoded frame, preventing black flashes when playback starts or stops.
- Preserve current generation, reference-media, desktop-update, and task-retry contracts while integrating the new workflow.

## v1.5.9

- Validate reference image dimensions, aspect ratios, file sizes and audio/video duration using each model's configured capabilities before submitting.
- Preserve supported reference counts, resolutions and durations instead of silently dropping media or downgrading requested settings.
- Support local and inline reference audio for BeefTV Official Compute and native Ark channels, while retaining provider-specific audio-only rules.
- Show actionable reference conversion and request-size errors in both canvas nodes and task history, with safe diagnostics and no unsafe unchanged retries.

## v1.5.8

- Add a persistent light/dark switch to the workspace sidebar, with matching home, asset library, menus and settings surfaces.
- Restore canvas appearance controls with light, dark and custom modes; keep each canvas appearance independent from the workspace theme.
- New canvases follow the workspace theme unless an explicit default appearance is saved.

## v1.5.7

- Desktop update checks and downloads now use Cloudflare-hosted files, preserving signed manifests and package integrity verification.
- Publish immutable platform packages before switching the update feed, with verified downloads and protection against incomplete or older releases.
- Check Seedance reference audio total duration and explain gateway media validation failures with the affected clip and actionable limits.

## v1.5.6

- Validate Seedance reference audio/video duration before submission and preserve duration metadata for character voice samples.
- Explain material conversion failures with actionable duration limits and retain request identifiers for support.
- Keep existing task polling available and prevent unsafe resubmission while provider acceptance is uncertain.

## v1.5.5

- Desktop update checks and downloads now use the current user's static HTTP/HTTPS system proxy on macOS and Windows when no explicit environment proxy is configured.
- Keep a manual update check in the sidebar and show a retry action when checking fails, instead of hiding connection failures.
- Preserve proxy bypass rules, signed manifest verification and package integrity checks throughout redirected downloads.

## v1.5.4

- Generation failures now explain the cause and the next action across canvas nodes, task history and custom channels.
- Distinguish content moderation, account quota, provider billing, invalid parameters, rate limits, uncertain submissions and failed result downloads without guessing refunds or the offending input.
- Preserve safe error codes and request identifiers for support, including business errors returned with HTTP 200 and JSON errors inside media downloads.
- Prevent unsafe unchanged batch retries; edited prompts and reference media can be submitted as new attempts after moderation failures.
- Cover all 42 currently declared BeefTV Official Compute error codes with a shared frontend and backend regression contract.
- Improved the shared model picker with a viewport-safe, internally scrollable layout and consistent single-line model options.
- Removed redundant model icons, secondary descriptions, and stale option backgrounds from model selection UI.
- Restored native right-click paste behavior in canvas prompt editors and added regression coverage.
- Added regression coverage for generation output delivery, model picker overflow, and local generation error handling.
- Added a canonical local app update script to keep one installed BeefTV application instead of accumulating duplicate builds.

## v1.5.3

- Desktop builds show the installed version in the sidebar and check for published updates on startup.
- Signed updates can be downloaded in the app, then installed with an explicit restart while keeping local projects, assets, settings and connections.
- Pending canvas, director and timeline saves are checked before restarting; failed downloads or verification leave the current installation intact.
- Maintainers can build and publish signed macOS and Windows update packages from main. Existing installations need one manual upgrade to this version before in-app updates are available.

## v1.5.2

- Improved canvas node rendering and inline image cropping, annotation, and local redraw interactions.
- Rebuilt the recycle bin with a fixed two-row viewport, selection, recovery, and confirmed permanent deletion.
- Fixed project cover selection across media nodes and canvases, including fallbacks and centered empty placeholders.
- Added a short product demo and updated the README branding.

## v1.5.1

- Initial public BeefTV snapshot.
- Local-first AI video workspace with image, video, audio, text, asset, canvas, and model-channel workflows.
- BeefTV Official Compute remains a built-in local channel while its model catalog is discovered dynamically.
