// BeefTV 内置插件：LL2 (DMC) 算力与视频渠道（beeftv-plugin-ll2）
// 通过 app.settings 插槽提供一键 BYOK 配置面板，将 LL2 API Key 与预置协议模型一键同步至宿主「设置 -> 模型服务」。

export const DEFAULT_BASE_URL = "https://api.ll2.cn";
export const LL2_CHANNEL_ID = "ll2";
export const LL2_CHANNEL_NAME = "LL2 (DMC)";

const DEFAULT_VIDEO_REFERENCES = {
  promptMaxChars: 2000,
  minImages: 0,
  maxImages: 9,
  maxImageBytes: 30 * 1024 * 1024,
  minImageWidth: 0,
  maxImageWidth: 0,
  minImageHeight: 0,
  maxImageHeight: 0,
  minImageAspectRatio: 0,
  maxImageAspectRatio: 0,
  minImagePixels: 0,
  maxImagePixels: 0,
  maxVideos: 3,
  maxVideoBytes: 200 * 1024 * 1024,
  minVideoDurationSeconds: 0,
  maxVideoDurationSeconds: 15,
  maxVideoTotalDurationSeconds: 0,
  minVideoWidth: 0,
  maxVideoWidth: 0,
  minVideoHeight: 0,
  maxVideoHeight: 0,
  minVideoAspectRatio: 0,
  maxVideoAspectRatio: 0,
  minVideoPixels: 0,
  maxVideoPixels: 0,
  minVideoFps: 0,
  maxVideoFps: 0,
  maxAudios: 3,
  maxAudioBytes: 15 * 1024 * 1024,
  minAudioDurationSeconds: 0,
  maxAudioDurationSeconds: 15,
  maxAudioTotalDurationSeconds: 0,
  maxTotalReferences: 0,
};

export const LL2_PRESET_MODELS = [
  {
    model: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    family: "DeepSeek text",
    capability: "text",
    protocol: "chat-completion",
    endpoint: "POST /v1/chat/completions",
    capabilityConfig: {
      version: 1,
      text: {
        references: { promptMaxChars: 12000, maxImages: 0, maxImageBytes: 0 },
        streaming: true,
        thinking: true,
      },
    },
  },
  {
    model: "doubao-seedance-2-0-fast",
    displayName: "Seedance 2.0 Fast",
    family: "Seedance 2.0",
    capability: "video",
    protocol: "ll2-seedance-video",
    endpoint: "POST /seedance/api/v3/contents/generations/tasks",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          minVideoDurationSeconds: 2,
          minAudioDurationSeconds: 2,
        },
        duration: { selection: "range", min: 4, max: 15, step: 1, default: 5 },
        ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "adaptive"],
        defaultRatio: "16:9",
        resolutions: ["480p", "720p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: true },
        watermark: { supported: true, default: false },
        returnLastFrame: { supported: true, default: false },
        operations: ["text_to_video", "image_to_video", "reference_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "doubao-seedance-2-0",
    displayName: "Seedance 2.0",
    family: "Seedance 2.0",
    capability: "video",
    protocol: "ll2-seedance-video",
    endpoint: "POST /seedance/api/v3/contents/generations/tasks",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          minVideoDurationSeconds: 2,
          minAudioDurationSeconds: 2,
        },
        duration: { selection: "range", min: 4, max: 15, step: 1, default: 5 },
        ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9", "adaptive"],
        defaultRatio: "16:9",
        resolutions: ["480p", "720p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: true },
        watermark: { supported: true, default: false },
        returnLastFrame: { supported: true, default: false },
        operations: ["text_to_video", "image_to_video", "reference_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "viduq3-turbo",
    displayName: "Vidu Q3 Turbo",
    family: "Vidu Q3",
    capability: "video",
    protocol: "ll2-vidu-video",
    endpoint: "POST /vidu/ent/v2/text2video",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          maxImages: 2,
          maxVideos: 0,
          maxAudios: 0,
        },
        duration: { selection: "range", min: 1, max: 16, step: 1, default: 5 },
        ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
        defaultRatio: "16:9",
        resolutions: ["540p", "720p", "1080p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: true },
        watermark: { supported: true, default: false },
        operations: ["text_to_video", "image_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "viduq3-pro",
    displayName: "Vidu Q3 Pro",
    family: "Vidu Q3",
    capability: "video",
    protocol: "ll2-vidu-video",
    endpoint: "POST /vidu/ent/v2/text2video",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          maxImages: 2,
          maxVideos: 0,
          maxAudios: 0,
        },
        duration: { selection: "range", min: 1, max: 16, step: 1, default: 5 },
        ratios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
        defaultRatio: "16:9",
        resolutions: ["540p", "720p", "1080p"],
        defaultResolution: "720p",
        generateAudio: { supported: true, default: true },
        watermark: { supported: true, default: false },
        operations: ["text_to_video", "image_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "MiniMax-H3",
    displayName: "MiniMax H3",
    family: "MiniMax H3",
    capability: "video",
    protocol: "ll2-minimax-video",
    endpoint: "POST /v2/video_generation",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          maxVideoBytes: 50 * 1024 * 1024,
        },
        duration: {
          selection: "enum",
          values: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          default: 5,
        },
        ratios: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        defaultRatio: "16:9",
        resolutions: ["768P"],
        defaultResolution: "768P",
        generateAudio: { supported: false, default: false },
        watermark: { supported: false, default: false },
        operations: ["text_to_video", "image_to_video", "reference_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "Super Vega 1.0-pro-mini",
    displayName: "Super Vega 1.0 Pro Mini",
    family: "Super Vega",
    capability: "video",
    protocol: "ll2-super-vega-video",
    endpoint: "POST /super-vega/tasks",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          maxImages: 7,
          maxVideos: 1,
          maxAudios: 0,
        },
        duration: { selection: "range", min: 4, max: 15, step: 1, default: 5 },
        ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
        defaultRatio: "16:9",
        resolutions: ["720P", "1080P"],
        defaultResolution: "720P",
        generateAudio: { supported: true, default: true },
        watermark: { supported: false, default: false },
        operations: ["text_to_video", "image_to_video", "reference_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "Super Vega 1.0-lite",
    displayName: "Super Vega 1.0 Lite",
    family: "Super Vega",
    capability: "video",
    protocol: "ll2-super-vega-video",
    endpoint: "POST /super-vega/tasks",
    capabilityConfig: {
      version: 1,
      video: {
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          maxImages: 7,
          maxVideos: 1,
          maxAudios: 0,
        },
        duration: { selection: "range", min: 4, max: 15, step: 1, default: 5 },
        ratios: ["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"],
        defaultRatio: "16:9",
        resolutions: ["768P", "1080P"],
        defaultResolution: "768P",
        generateAudio: { supported: false, default: false },
        watermark: { supported: false, default: false },
        operations: ["text_to_video", "image_to_video", "reference_to_video"],
        defaultOperation: "text_to_video",
      },
    },
  },
  {
    model: "auto-hd",
    displayName: "Auto HD video super score",
    family: "Auto HD super score",
    capability: "video",
    protocol: "ll2-auto-hd-video",
    endpoint: "POST /hd/tasks",
    defaultOptions: {
      testVideoUrl:
        "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241115/cqqkru/1.mp4",
    },
    capabilityConfig: {
      version: 1,
      video: {
        durationSupported: false,
        references: {
          ...DEFAULT_VIDEO_REFERENCES,
          maxImages: 0,
          maxVideos: 1,
          maxVideoBytes: 500 * 1024 * 1024,
          maxVideoDurationSeconds: 300,
          maxAudios: 0,
        },
        duration: { selection: "enum", values: [5], default: 5 },
        ratios: [],
        defaultRatio: "",
        resolutions: ["1080p", "2k", "4k"],
        defaultResolution: "1080p",
        generateAudio: { supported: false, default: false },
        watermark: { supported: false, default: false },
        operations: ["reference_to_video"],
        defaultOperation: "reference_to_video",
      },
    },
  },
];

function getReact(host) {
  if (host?.React) return host.React;
  if (host?.ui?.React) return host.ui.React;
  if (typeof window !== "undefined") {
    return window.__BEEFTV_REACT__ || window.React || null;
  }
  return null;
}

export function upgradeLL2ModelProfile(profile) {
  if (!profile || typeof profile !== "object") return profile;
  if (!String(profile.protocol || "").startsWith("ll2-")) return profile;
  const preset = LL2_PRESET_MODELS.find((item) => item.model === profile.model);
  if (!preset) return profile;
  let next = profile;
  if (preset.defaultOptions?.testVideoUrl) {
    const currentUrl = String(next.defaultOptions?.testVideoUrl || "");
    if (!currentUrl || currentUrl.includes("cos.ap-guangzhou.myqcloud.com")) {
      next = {
        ...next,
        defaultOptions: {
          ...(next.defaultOptions || {}),
          ...preset.defaultOptions,
        },
      };
    }
  }
  const presetRes = preset.capabilityConfig?.video?.resolutions;
  const currentRes = next.capabilityConfig?.video?.resolutions;
  if (Array.isArray(presetRes) && Array.isArray(currentRes)) {
    const validSet = new Set(presetRes);
    if (currentRes.some((r) => !validSet.has(r))) {
      const filtered = currentRes.filter((r) => validSet.has(r));
      const resolutions = filtered.length > 0 ? filtered : [...presetRes];
      const defaultResolution = validSet.has(next.capabilityConfig.video.defaultResolution)
        ? next.capabilityConfig.video.defaultResolution
        : preset.capabilityConfig.video.defaultResolution;
      next = {
        ...next,
        capabilityConfig: {
          ...next.capabilityConfig,
          video: {
            ...next.capabilityConfig.video,
            resolutions,
            defaultResolution,
          },
        },
      };
    }
  }
  return next;
}

export function buildLL2ModelChannel({ apiKey, baseUrl, selectedModels }) {
  const cleanUrl = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  const cleanKey = String(apiKey || "").trim();
  const chosenSet = new Set(
    Array.isArray(selectedModels) && selectedModels.length
      ? selectedModels
      : LL2_PRESET_MODELS.map((item) => item.model),
  );
  const activePresets = LL2_PRESET_MODELS.filter((item) => chosenSet.has(item.model));
  const models = activePresets.map((item) => item.model);
  const modelProfiles = activePresets.map((item) => ({
    model: item.model,
    displayName: item.displayName,
    capability: item.capability,
    protocol: item.protocol,
    authType: "bearer",
    ...(item.defaultOptions ? { defaultOptions: item.defaultOptions } : {}),
    capabilityConfig: item.capabilityConfig,
  }));

  return {
    id: LL2_CHANNEL_ID,
    name: LL2_CHANNEL_NAME,
    scope: "user",
    baseUrl: cleanUrl,
    apiKey: cleanKey,
    hasApiKey: Boolean(cleanKey),
    apiFormat: "openai",
    models,
    modelProfiles,
  };
}

function createLL2SettingsPanel(host) {
  const React = getReact(host);
  if (!React) return () => null;
  const h = React.createElement;

  return function LL2SettingsPanel(props) {
    const existingChannel = React.useMemo(() => {
      try {
        const channels = host?.channels?.list?.() || [];
        return channels.find(
          (item) =>
            item.id === LL2_CHANNEL_ID ||
            String(item.baseUrl || "").includes("api.ll2.cn"),
        );
      } catch {
        return undefined;
      }
    }, []);

    const initialApiKey =
      props?.config?.apiKey ||
      host?.config?.get?.("apiKey", "") ||
      existingChannel?.apiKey ||
      "";
    const initialBaseUrl =
      props?.config?.baseUrl ||
      host?.config?.get?.("baseUrl", DEFAULT_BASE_URL) ||
      existingChannel?.baseUrl ||
      DEFAULT_BASE_URL;

    const [apiKey, setApiKey] = React.useState(String(initialApiKey));
    const [baseUrl, setBaseUrl] = React.useState(String(initialBaseUrl));
    const [showKey, setShowKey] = React.useState(false);
    const [selectedModels, setSelectedModels] = React.useState(() =>
      existingChannel?.models?.length
        ? existingChannel.models
        : LL2_PRESET_MODELS.map((item) => item.model),
    );
    const [catalogChecking, setCatalogChecking] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [onlineModels, setOnlineModels] = React.useState([]);
    const [synced, setSynced] = React.useState(
      Boolean(existingChannel?.hasApiKey || existingChannel?.apiKey),
    );
    const [statusMessage, setStatusMessage] = React.useState(
      existingChannel?.hasApiKey || existingChannel?.apiKey
        ? `Connected "${existingChannel.name}” channel (enabled${existingChannel.models?.length || 0} model)`
        : "",
    );
    const [errorMessage, setErrorMessage] = React.useState("");

    const toggleModel = (modelId) => {
      setSelectedModels((prev) =>
        prev.includes(modelId)
          ? prev.filter((item) => item !== modelId)
          : [...prev, modelId],
      );
    };

    const handleFetchCatalog = async () => {
      const trimmedKey = apiKey.trim();
      const trimmedUrl = baseUrl.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
      if (!trimmedKey) {
        setErrorMessage("Please fill in the LL2 API Key first");
        return;
      }
      setCatalogChecking(true);
      setErrorMessage("");
      try {
        let ids = [];
        if (typeof host?.channels?.fetchCatalog === "function") {
          const catalog = await host.channels.fetchCatalog({
            baseUrl: trimmedUrl,
            apiKey: trimmedKey,
            apiFormat: "openai",
          });
          ids = Array.isArray(catalog?.models) ? catalog.models : [];
        } else {
          const resp = await fetch("/api/ai/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseUrl: trimmedUrl,
              apiKey: trimmedKey,
              apiFormat: "openai",
            }),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || (typeof data?.code === "number" && data.code !== 0)) {
            throw new Error(
              data?.msg || data?.error || `Failed to read online directory (HTTP${resp.status}）`,
            );
          }
          const rawModels = Array.isArray(data?.data?.models)
            ? data.data.models
            : Array.isArray(data?.models)
              ? data.models
              : [];
          ids = rawModels
            .map((item) => (typeof item === "string" ? item : item?.id))
            .filter(Boolean);
        }
        setOnlineModels(ids);
        setStatusMessage(`Online catalog verification successful: total found${ids.length} upstream models`);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to read online directory");
      } finally {
        setCatalogChecking(false);
      }
    };

    const handleSaveAndSync = async () => {
      const trimmedKey = apiKey.trim();
      const trimmedUrl = baseUrl.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
      if (!trimmedKey) {
        setErrorMessage("Please fill in a valid LL2 API Key (sk-...)");
        return;
      }
      if (!selectedModels.length) {
        setErrorMessage("Please check at least 1 model to be synchronized");
        return;
      }
      setSaving(true);
      setErrorMessage("");
      try {
        const patch = { apiKey: trimmedKey, baseUrl: trimmedUrl };
        if (typeof props?.updateConfig === "function") {
          await props.updateConfig(patch);
        } else if (host?.config?.set) {
          await host.config.set(patch);
        }
        const channel = buildLL2ModelChannel({
          apiKey: trimmedKey,
          baseUrl: trimmedUrl,
          selectedModels,
        });
        if (!host?.channels?.upsert) {
          throw new Error("The current host version does not support synchronized model channels");
        }
        await host.channels.upsert(channel);
        setSynced(true);
        setStatusMessage(
          `Already "${LL2_CHANNEL_NAME}” with${channel.models.length} Synchronize each model to "Settings -> Model Service"!`,
        );
        host?.ui?.notify?.("LL2 channels and models have been synchronized to the model service", "success");
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Saving and syncing channels failed");
      } finally {
        setSaving(false);
      }
    };

    return h(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "4px 0",
        },
      },
      // 顶部品牌介绍卡片
      h(
        "div",
        {
          style: {
            borderRadius: "12px",
            border: "1px solid rgba(59, 130, 246, 0.22)",
            background:
              "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(16, 185, 129, 0.05) 100%)",
            padding: "14px 16px",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              marginBottom: "6px",
            },
          },
          h(
            "div",
            { style: { fontWeight: 600, fontSize: "14px" } },
            "LL2 (DMC) computing power and video channel · BYOK one-click access",
          ),
          h(
            "span",
            {
              style: {
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "999px",
                background: "rgba(16, 185, 129, 0.14)",
                color: "#059669",
                fontWeight: 600,
              },
            },
            "Official built-in plug-in",
          ),
        ),
        h(
          "p",
          {
            style: {
              margin: 0,
              fontSize: "12px",
              opacity: 0.75,
              lineHeight: 1.6,
            },
          },
          "Just fill in an LL2 API Key and you can configure a total of 6 sets of model protocols for DeepSeek V4.1, Seedance 2.0, Vidu Q3, MiniMax H3, Super Vega 1.0 and Auto HD video super-resolution with one click, without changing BeefTV’s original default model configuration.",
        ),
      ),

      // 表单区
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "12px",
          },
        },
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          h(
            "label",
            {
              htmlFor: "ll2-plugin-base-url",
              style: { fontSize: "12px", fontWeight: 600 },
            },
            "Interface address (Base URL)",
          ),
          h("input", {
            id: "ll2-plugin-base-url",
            type: "text",
            value: baseUrl,
            onChange: (e) => setBaseUrl(e.target.value),
            placeholder: DEFAULT_BASE_URL,
            style: {
              width: "100%",
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid rgba(128,128,128,0.28)",
              background: "transparent",
              fontSize: "13px",
              fontFamily: "monospace",
            },
          }),
        ),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "6px" } },
          h(
            "label",
            {
              htmlFor: "ll2-plugin-api-key",
              style: { fontSize: "12px", fontWeight: 600 },
            },
            "LL2 API Key",
          ),
          h(
            "div",
            { style: { display: "flex", gap: "8px" } },
            h("input", {
              id: "ll2-plugin-api-key",
              "aria-label": "LL2 API Key",
              type: showKey ? "text" : "password",
              value: apiKey,
              onChange: (e) => setApiKey(e.target.value),
              placeholder: "sk-...",
              style: {
                flex: 1,
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid rgba(128,128,128,0.28)",
                background: "transparent",
                fontSize: "13px",
                fontFamily: "monospace",
              },
            }),
            h(
              "button",
              {
                type: "button",
                onClick: () => setShowKey((v) => !v),
                style: {
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(128,128,128,0.28)",
                  background: "transparent",
                  fontSize: "12px",
                  cursor: "pointer",
                },
              },
              showKey ? "hide" : "show",
            ),
            h(
              "button",
              {
                type: "button",
                disabled: catalogChecking,
                onClick: handleFetchCatalog,
                style: {
                  padding: "0 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(59, 130, 246, 0.35)",
                  background: "rgba(59, 130, 246, 0.08)",
                  color: "#2563eb",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: catalogChecking ? "wait" : "pointer",
                },
              },
              catalogChecking ? "Verifying..." : "Verify online catalog",
            ),
          ),
        ),
      ),

      // 预置模型与协议映射清单
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            },
          },
          h(
            "span",
            { style: { fontSize: "12px", fontWeight: 600 } },
            `Preset protocol model (selected${selectedModels.length} / ${LL2_PRESET_MODELS.length}）`,
          ),
          h(
            "button",
            {
              type: "button",
              onClick: () =>
                setSelectedModels(
                  selectedModels.length === LL2_PRESET_MODELS.length
                    ? []
                    : LL2_PRESET_MODELS.map((item) => item.model),
                ),
              style: {
                border: "none",
                background: "transparent",
                color: "#2563eb",
                fontSize: "12px",
                cursor: "pointer",
              },
            },
            selectedModels.length === LL2_PRESET_MODELS.length ? "Deselect all" : "Select all models",
          ),
        ),
        h(
          "div",
          {
            style: {
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "8px",
            },
          },
          LL2_PRESET_MODELS.map((item) => {
            const checked = selectedModels.includes(item.model);
            const isOnline =
              onlineModels.includes(item.model) ||
              onlineModels.some((m) =>
                String(m).toLowerCase().endsWith(item.model.toLowerCase()),
              );
            return h(
              "label",
              {
                key: item.model,
                style: {
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: checked
                    ? "1px solid rgba(59, 130, 246, 0.45)"
                    : "1px solid rgba(128, 128, 128, 0.2)",
                  background: checked ? "rgba(59, 130, 246, 0.05)" : "transparent",
                  cursor: "pointer",
                  fontSize: "12px",
                },
              },
              h("input", {
                type: "checkbox",
                checked,
                onChange: () => toggleModel(item.model),
                style: { marginTop: "3px" },
              }),
              h(
                "div",
                { style: { flex: 1, minWidth: 0 } },
                h(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "4px",
                      fontWeight: 600,
                    },
                  },
                  h("span", null, item.displayName),
                  h(
                    "span",
                    {
                      style: {
                        fontSize: "10px",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background:
                          item.capability === "text"
                            ? "rgba(59, 130, 246, 0.12)"
                            : "rgba(139, 92, 246, 0.12)",
                        color: item.capability === "text" ? "#2563eb" : "#7c3aed",
                      },
                    },
                    item.capability === "text" ? "text" : "video",
                  ),
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: "11px",
                      opacity: 0.65,
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                  },
                  `${item.model} · ${item.endpoint}`,
                ),
                isOnline
                  ? h(
                      "div",
                      { style: { fontSize: "10px", color: "#059669", marginTop: "2px" } },
                      "● The upstream directory has been confirmed online",
                    )
                  : null,
              ),
            );
          }),
        ),
      ),

      // 状态反馈区
      errorMessage
        ? h(
            "div",
            {
              role: "alert",
              style: {
                padding: "10px 12px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#dc2626",
                fontSize: "12px",
              },
            },
            errorMessage,
          )
        : null,
      statusMessage
        ? h(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "rgba(16, 185, 129, 0.1)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                color: "#059669",
                fontSize: "12px",
              },
            },
            h("span", null, statusMessage),
            synced
              ? h(
                  "button",
                  {
                    type: "button",
                    onClick: () => host?.ui?.navigate?.("/settings?section=channels"),
                    style: {
                      padding: "4px 10px",
                      borderRadius: "6px",
                      border: "1px solid rgba(16, 185, 129, 0.4)",
                      background: "rgba(16, 185, 129, 0.12)",
                      color: "#047857",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    },
                  },
                  "Go to the model service to view and test →",
                )
              : null,
          )
        : null,

      // 底部操作按钮
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            paddingTop: "4px",
          },
        },
        h(
          "button",
          {
            type: "button",
            disabled: saving,
            onClick: handleSaveAndSync,
            style: {
              padding: "8px 18px",
              borderRadius: "8px",
              border: "none",
              background: "#2563eb",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: saving ? "wait" : "pointer",
            },
          },
          saving ? "Syncing..." : "Save and sync to model service with one click",
        ),
      ),
    );
  };
}

export function activate(host) {
  const SettingsPanel = createLL2SettingsPanel(host);
  const dispose = host.contribute("app.settings", {
    id: "ll2-settings",
    label: "LL2 computing power and video channels",
    component: SettingsPanel,
  });
  return () => {
    if (typeof dispose === "function") dispose();
  };
}

export default { activate };
