import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ModelChannel } from "@/stores/use-config-store";

// 一个连接只有一份 API Key 和一份 Secret Key，能填哪种凭证由模型实际使用的请求
// 协议决定。协议换了而凭证没跟着换，上游只会返回鉴权失败；方舟还会因为把 Agent
// Plan 专属 Key 用在原生接口上多扣费。这里按协议算出该填的字段名和注意事项，
// 界面只负责显示。
const SIGNATURE_CREDENTIALS: Record<string, { apiKeyLabel: string; secretKeyLabel: string; apiKeyHelp: string; secretKeyHelp: string }> = {
    "volcengine-v4": {
        apiKeyLabel: "Access Key（AK）",
        secretKeyLabel: "Secret Key（SK）",
        apiKeyHelp: "Jimeng uses the AK/SK signature of the Volcano engine, not the API Key of Ark: fill in the Access Key here, and fill in the Secret Key in the Secret Key below. You must have both.",
        secretKeyHelp: "Used in pairs with the Access Key above.",
    },
    tc3: {
        apiKeyLabel: "SecretId",
        secretKeyLabel: "SecretKey",
        apiKeyHelp: "The Tencent Cloud interface is signed with SecretId and SecretKey: fill in SecretId here, and fill in SecretKey in the Secret Key below. Both must be present.",
        secretKeyHelp: "Used in pairs with the SecretId above.",
    },
    "aws-sigv4": {
        apiKeyLabel: "Access Key ID",
        secretKeyLabel: "Secret Access Key",
        apiKeyHelp: "The AWS interface is signed with Access Key ID and Secret Access Key: fill in the Access Key ID here, and fill in the Secret Access Key for the Secret Key below.",
        secretKeyHelp: "Used in pairs with the Access Key ID above.",
    },
};
const SIGNATURE_AUTH_TYPES = new Set(Object.keys(SIGNATURE_CREDENTIALS));
// 协议目录没有随插件一起加载时，靠这些固定的协议 ID 仍能认出要两种密钥。
const BUILTIN_SIGNATURE_PROTOCOLS: Record<string, string> = {
    "volcengine-jimeng-video": "volcengine-v4",
    "volcengine-jimeng-image": "volcengine-v4",
    "tencent-hunyuan-video": "tc3",
    "tencent-hunyuan-image": "tc3",
    "aws-bedrock-converse": "aws-sigv4",
    "aws-bedrock-invoke-model": "aws-sigv4",
};
const ARK_AGENT_PLAN_PROTOCOLS = new Set(["volcengine-ark-agent-plan-video", "volcengine-ark-agent-plan-image"]);
const ARK_NATIVE_PROTOCOLS = new Set(["volcengine-ark-video", "volcengine-ark-image"]);

const STANDARD_KEY_HELP = "Can be left blank after selecting a non-authentication protocol (e.g. Ollama). Reading the model directory still requires the key.";
const ARK_KEY_HELP = "Ark has two types of keys, which cannot be mixed: the ordinary Ark key is matched with /api/v3, and the Agent Plan exclusive key is matched with /api/plan/v3. Only one type should be filled in for a connection. After selecting the model and protocol, it will be written which one to fill in.";
const ARK_AGENT_PLAN_HELP = "Only fill in the Agent Plan exclusive Key. Filling in a normal Ark Key will cause the call to fail and may result in extra charges.";
const ARK_NATIVE_HELP = "Common Ark Key, used for Ark native interface (/api/v3). Agent Plan Exclusive Key Do not fill in here.";
const ARK_MIXED = "The models in this connection need to use ordinary Ark Key and Agent Plan exclusive Key respectively. One Key can only be equipped with one kind of interface: please split it into two connections.";
const SIGNATURE_MIXED = "This connection contains both AK/SK signed models and models that only fill in the API Key: please split it into two connections, and only put the model with the same certificate in one connection.";

/** none 表示协议自己不要凭证，因此不参与「一份连接一种凭证」的判断。 */
export type ServiceCredentialKind = "ark-native" | "ark-agent-plan" | "signature" | "standard" | "none";

export type ServiceCredentialGuide = {
    kind: ServiceCredentialKind | "mixed";
    apiKeyLabel: string;
    apiKeyPlaceholder: string;
    apiKeyHelp: string;
    secretKeyLabel: string;
    secretKeyHelp?: string;
    secretKeyRequired: boolean;
    /** 混用凭证时对用户说的话；读取模型和保存前会用它拦住。 */
    conflict?: string;
};

type CredentialChannel = Pick<ModelChannel, "models" | "modelProfiles" | "interfaceType" | "baseUrl">;

/** 运行时协议目录优先；目录没加载时才退回配置里记录的 authType 和内置映射。 */
export function protocolAuthType(protocol: string | undefined, recorded: string | undefined, protocols: ModelProtocolDefinition[] = []): string | undefined {
    if (!protocol) return undefined;
    return protocols.find((item) => item.value === protocol)?.authType || recorded;
}

export function protocolSignatureAuth(protocol?: string, authType?: string): string | undefined {
    if (authType && SIGNATURE_AUTH_TYPES.has(authType)) return authType;
    return protocol ? BUILTIN_SIGNATURE_PROTOCOLS[protocol] : undefined;
}

export function protocolCredentialKind(protocol?: string, authType?: string): ServiceCredentialKind | undefined {
    if (!protocol) return undefined;
    if (authType === "none") return "none";
    if (protocolSignatureAuth(protocol, authType)) return "signature";
    if (ARK_AGENT_PLAN_PROTOCOLS.has(protocol)) return "ark-agent-plan";
    if (ARK_NATIVE_PROTOCOLS.has(protocol)) return "ark-native";
    return "standard";
}

/** 选中需要两种密钥的协议时，告诉用户这两个值分别填在哪个位置。 */
export function signatureCredentialHint(authType?: string): string | undefined {
    const copy = authType ? SIGNATURE_CREDENTIALS[authType] : undefined;
    if (!copy) return undefined;
    return `This protocol needs to be used${copy.apiKeyLabel}and${copy.secretKeyLabel}Two key signature: fill in the key field of "Connection Information"${copy.apiKeyLabel}, fill in "Advanced Settings"${copy.secretKeyLabel}, if one is missing, the signature will fail.`;
}

function hostOf(baseUrl: string) {
    try {
        return new URL(baseUrl.trim());
    } catch {
        return undefined;
    }
}

function isJimengHost(baseUrl: string) {
    return hostOf(baseUrl)?.hostname === "visual.volcengineapi.com";
}

function isArkHost(baseUrl: string) {
    return /^ark\.[a-z0-9-]+\.volces\.com$/.test(hostOf(baseUrl)?.hostname || "");
}

// 方舟同一台主机上，普通 Key 和 Agent Plan 专属 Key 的差别在路径上。文本那类通用
// 协议看不出属于哪一边，只能按用户填的地址判断：/api/plan/ 走 Plan，其余走普通。
function arkKeyKindFromPath(baseUrl: string): ServiceCredentialKind | undefined {
    const url = hostOf(baseUrl);
    if (!url || !isArkHost(baseUrl)) return undefined;
    return /^\/api\/plan(\/|$)/.test(url.pathname) ? "ark-agent-plan" : "ark-native";
}

export function serviceCredentialGuide(channel: CredentialChannel, protocols: ModelProtocolDefinition[] = []): ServiceCredentialGuide {
    const kinds = new Set<ServiceCredentialKind>();
    const signatureAuths = new Set<string>();
    for (const model of channel.models || []) {
        const profile = channel.modelProfiles?.find((item) => item.model === model);
        const protocol = profile?.protocol || channel.interfaceType;
        const authType = protocolAuthType(protocol, profile?.authType, protocols);
        const declared = protocolCredentialKind(protocol, authType);
        // 通用文本协议本身不占凭证类型；在方舟主机上按地址判断它用的是哪一类 Key。
        const kind = declared === "standard" ? arkKeyKindFromPath(channel.baseUrl) || declared : declared;
        if (!kind || kind === "none") continue;
        kinds.add(kind);
        const signature = protocolSignatureAuth(protocol, authType);
        if (signature) signatureAuths.add(signature);
    }
    const awaitingCredential = [...kinds].some((kind) => kind !== "none");
    const arkMixed = kinds.has("ark-native") && kinds.has("ark-agent-plan");
    const signatureMixed = signatureAuths.size > 1 || (kinds.has("signature") && kinds.size > 1);
    if (arkMixed || signatureMixed) {
        const conflict = arkMixed ? ARK_MIXED
            : signatureAuths.size > 1 ? `The models in this connection need to be used respectively${[...signatureAuths].map((auth) => SIGNATURE_CREDENTIALS[auth].apiKeyLabel).join(" and")} Signature, one key can only match one type: please split it into two connections.`
            : SIGNATURE_MIXED;
        // 混用时字段说明和下方提示会重复，只留下面那一条。
        return { kind: "mixed", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your API Key", apiKeyHelp: "", secretKeyLabel: "Secret Key（SK）", secretKeyRequired: false, conflict };
    }
    // 还没选模型时只靠域名判断：即梦开放平台只有 AK/SK 一种凭证。
    const [signatureAuth] = signatureAuths.size ? [...signatureAuths] : !awaitingCredential && isJimengHost(channel.baseUrl) ? ["volcengine-v4"] : [];
    if (signatureAuth) {
        const copy = SIGNATURE_CREDENTIALS[signatureAuth];
        return { kind: "signature", apiKeyLabel: copy.apiKeyLabel, apiKeyPlaceholder: `Paste${copy.apiKeyLabel.replace(/（.*$/, "")}`, apiKeyHelp: copy.apiKeyHelp, secretKeyLabel: copy.secretKeyLabel, secretKeyHelp: copy.secretKeyHelp, secretKeyRequired: true };
    }
    if (kinds.has("ark-agent-plan")) return { kind: "ark-agent-plan", apiKeyLabel: "Agent Plan Exclusive Key", apiKeyPlaceholder: "Paste the Agent Plan exclusive Key", apiKeyHelp: ARK_AGENT_PLAN_HELP, secretKeyLabel: "Secret Key（SK）", secretKeyRequired: false };
    if (kinds.has("ark-native")) return { kind: "ark-native", apiKeyLabel: "Ark API Key", apiKeyPlaceholder: "Paste Ark API Key", apiKeyHelp: ARK_NATIVE_HELP, secretKeyLabel: "Secret Key（SK）", secretKeyRequired: false };
    // 插件接入的服务由插件读取模型，「目录仍需要密钥」那句对它不成立。
    const pluginService = protocols.find((item) => item.module && item.value === channel.interfaceType);
    const apiKeyHelp = pluginService ? (pluginService.authType === "none" ? "This service does not require a key and can be left blank." : "")
        : isArkHost(channel.baseUrl) ? ARK_KEY_HELP : STANDARD_KEY_HELP;
    return { kind: "standard", apiKeyLabel: "API Key", apiKeyPlaceholder: "Paste your API Key", apiKeyHelp, secretKeyLabel: "Secret Key（SK）", secretKeyRequired: false };
}