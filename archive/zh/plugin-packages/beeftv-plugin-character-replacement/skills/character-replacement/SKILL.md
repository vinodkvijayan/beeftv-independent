---
name: character-replacement
description: AI video character replacement and full-film interval interpolation skills: Perform "key frame precise substitution + Seedance 2.5 video element replacement" two-stage high-fidelity replacement for single/multiplayer shots, and insert the replaced shots into the full film timeline without loss.
---

# AI character replacement studio (`character-replacement`)

## Applicable scenarios

- The user wants to replace a certain character in an existing video clip or skit scene (single-person screen, or the left, middle, or right character in a two-person/multi-person frame) with a new target character image.
- Users need to control the replacement range: `full-person` (complete character including appearance and clothing), `visible-part` (currently visible part), `face-hair` (face and hair only), `clothing` (clothing only), `arm-hand` (arms and hands).
- The user hopes to keep the camera movement, character action rhythm, hand-held props (such as folders, cold weapons, etc.) and other unreplaced characters in the original video 100% unchanged.
- After replacing a single or several shots, the user hopes to completely insert the replaced shots into the original full film timeline according to the time interval (`startMs ~ endMs`) and retain the continuous original sound of the original film.

## Two-stage high-fidelity orchestration steps

1. **识别现场素材节点**：
   - 原镜头关键帧图片节点 `sourceKeyframeNodeId`（作为图1：提供原镜头构图、光影、遮挡关系与其余人物）。
   - 目标新角色参考图节点 `targetCharacterNodeId`（作为图2：提供新角色面部与服装特征）。
   - 原镜头视频节点 `sourceVideoNodeId`（提供原视频运镜与动作轨迹）。
2. **调用 `character_replacement_arrange` 工具**：
   - 传入 `shotTitle`、`position`（`single` / `left` / `center` / `right`）、`genderHint`（`person` / `male` / `female`）、`sourceDescription`（如「穿黑色西装的男人」）、`targetDescription`（如「戴银框眼镜、穿酒红色丝绒西装的年轻霸总」）与 `replacementScope`。
   - 传入 `sourceKeyframeNodeId`、`targetCharacterNodeId` 和 `sourceVideoNodeId`，工具会自动：
     1. 编译结构化防串脸关键帧替换提示词，创建 Step 2 关键帧换人 `image` 节点；
     2. 编译视频角色替换提示词，创建 Step 3 视频替换 `video` 节点并自动配置 `videoEditOperation: "replace_element"`（锁定时长与画幅跟随原视频）；
     3. 建立 `[原关键帧 + 目标角色图] -> [关键帧换人节点]` 与 `[原镜头视频 + 关键帧换人节点] -> [视频角色替换节点]` 的完整参考连线。
   - 若上游参考节点已就绪且用户要求直接生成，可将 `proposeGeneration` 设为 `true` 发起生成提议。
3. **全片时间线区间无损回插（可选 Step 4）**：
   - 当替换镜头视频节点生成完成后，调用 `character_replacement_splice_timeline`，传入 `fullVideoNodeId`、`fullDurationMs` 与 `replacements: [{ nodeId, startMs, endMs }]`。
   - 工具会自动将原全片切分为「原片前段 → 替换镜头 → 原片后段」并写入画布 Timeline v2，默认保留原片完整连续音轨，随后可直接调用 `canvas_timeline_deliver` 渲染交付完整成片。
