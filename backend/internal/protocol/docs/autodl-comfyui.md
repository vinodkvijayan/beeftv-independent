# {{NAME}}

## Interface

AutoDL.Art wraps the ComfyUI workflow into an asynchronous task interface. Use `POST /api/v1/comfyui/comfyui_workflow/{workflow_id}` for task creation, and the host runtime template is `/api/v1/comfyui/comfyui_workflow/{model}`; use `GET /api/v1/comfyui/comfyui_workflow/result/{task_id}` for query results, and the host runtime template is `/api/v1/comfyui/comfyui_workflow/result/{task_id}`. `workflow_id` is passed in from the model field and cannot be written into the channel address. Creating an interface only returns the task ID, and the host is responsible for polling according to the unified task life cycle.

## Model

AutoDL's model selection corresponds to the ComfyUI workflow ID. Different workflows can declare different parameters, and the workflow contribution in the plug-in manifest is responsible for describing the parameters, default values, and canvas capabilities. The current built-in examples use `minimax_h3_lightx2v_no_pic`, which represents the MiniMax H3 Vincent video workflow. Subsequently added workflows only need to increase the workflow contribution and do not need to modify the generation service code.

## Parameters

请求体为 JSON。常用字段包括 `prompt`、`duration` 和 `resolution`；实际工作流可以扩展自己的参数 schema。工作流声明的分辨率选项属于供应商枚举，画布必须保留其完整值，例如 `768p竖`、`768p横`，插件仅在发送前统一转换为小写，不在宿主中增加 AutoDL 专用归一化。状态返回值位于 `data.status`，任务 ID 位于 `data.task_id`，成功结果位于 `data.results`。结果数组中的地址是短期 URL，成功后必须立即由宿主下载到宿主资源存储，不能把临时地址直接写入画布长期数据。

## Authentication

Use AutoDL token as `Authorization` request header. The token should be configured in the channel key store and only read by backend outbound requests, without entering the plugin manifest, browser URL, logs, or persistent task body. The Token group should select the ComfyUI group of AutoDL.

## Status and results

`QUEUED` is mapped to queuing, `RUNNING` is mapped to processing, `SUCCESS` is mapped to success, and `FAILED` is mapped to failure. On success without `data.results`, the host should return a true error instead of generating an empty node. The video results are read in MIME by the host, downloaded and saved, and the user interface only consumes the saved resources.

## Official

- [AutoDL ComfyUI API](https://autodl.art/docs/comfyui_api/)
- [AutoDL Token Management](https://autodl.art/large-model/tokens)

{{CONTRACT}}
