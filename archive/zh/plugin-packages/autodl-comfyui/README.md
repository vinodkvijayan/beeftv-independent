# AutoDL ComfyUI Video and Audio

该插件把BeefTV统一媒体请求转换为 AutoDL.Art ComfyUI 工作流参数。视频图片先按 `media.role` 区分首帧、尾帧和普通参考图，再按 `media.order` 生成工作流要求的 `ref_image_N`；数字后缀只表示上游工作流槽位，不再承担首尾帧语义。新增 `minimax_h3_zm_u24` 与 `minimax_h3_zm_u08` 多参考工作流，`@图片1` 会映射为 `ref_image_0`。

This plug-in is maintained by BeefTV Contributors and is used to adapt to AutoDL.Art related service interfaces; it does not mean that BeefTV has an affiliation, authorization or cooperative relationship with this service provider.

See [docs/interface.md](docs/interface.md) for the complete interface, workflow branches, and field rules.