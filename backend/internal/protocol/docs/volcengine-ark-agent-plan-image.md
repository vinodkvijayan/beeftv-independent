# Volcano Ark Agent Plan image generation

This plug-in is for the Volcano Ark Agent Plan exclusive picture entrance. The request body is consistent with the official Ark Seedream protocol, but the Base URL and API Key must come from the Agent Plan console.

## Interfaces, Authentication and Zones

{{OPERATIONS}}

```http
POST {channel_base_url}/api/plan/v3/images/generations
Authorization: Bearer <AGENT_PLAN_API_KEY>
Content-Type: application/json
```

Differences from the official `/api/v3`:

| Item | Official Ark | Agent Plan |
| --- | --- | --- |
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| API Key | Inference Access Console Key | Agent Plan Exclusive Key |
| Billing | Post-inference payment/project quota | AFP package deduction |
| Request body | Seedream images/generations | Same as left |

Do not type the official Key to `/api/plan/v3`, nor type the Agent Plan Key to `/api/v3`.

## Parameter and field mapping

{{PARAMETERS}}

Current implementation: `aspectRatio -> size`, all `images -> image[]`; `extra` can transparently transmit `size`, `sequential_image_generation`, `sequential_image_generation_options`, `watermark`.

## Official information

- [Volcano Ark Agent Plan Document](https://www.volcengine.com/docs/82379/2375486)
- [Volcano Ark Visual Model API Document](https://www.volcengine.com/docs/82379)

{{CONTRACT}}
