package prompts

import (
	"fmt"
	"strings"
)

const (
	OperationStoryboardPlan       = "storyboard_plan"
	OperationStoryboardRepair     = "storyboard_repair"
	OperationStoryboardFirstFrame = "storyboard_first_frame"
	OperationStoryboardVideo      = "storyboard_video"
	OperationCharacterExtract     = "character_extract"
	OperationChapterAssetsExtract = "chapter_assets_extract"
	OperationCharacterTurnaround  = "character_turnaround"
	OperationShortDramaOutline    = "short_drama_outline"
	OperationSkillDraft           = "skill_draft"
)

const legacyStoryboardVideoPromptPreamble = "Generate a single sequence of video execution cues. A shot only retains a narrative goal, a main movement and a main action chain; the camera movement must have a starting point, a motive and a stopping point. Prioritize character identity, performance, key actions and continuity, and secondary environmental effects can be simplified."

func defaultPromptDefinitions() []PromptOperationDefinition {
	return []PromptOperationDefinition{
		{
			Operation: OperationChapterAssetsExtract, Label: "Extraction of chapter characters, scenes and props", Category: "role", OutputType: "json", SchemaKey: "chapter-assets/v1",
			Description:    "Extract the characters, scenes where the plot actually takes place, and props that affect the plot from the chapter text, and enter them into the assets to be confirmed list respectively.",
			Variables:      []PromptTemplateVariable{{Label: "Project name", Placeholder: "{{项目名称}}"}, {Label: "Chapter name", Placeholder: "{{章节名称}}"}, {Label: "Project style", Placeholder: "{{项目画风}}"}},
			DefaultContent: `You are a short drama asset director. Extract characters, scenes and props by chapter facts. Aliases of the same identity are merged, and assets that do not appear in the text are not fabricated; unspecified visual information is written as "Unspecified in the text." The character includes plot positioning, stable appearance, clothing, body shape, personality, consistency prompts, three-view prompts and language, voice age, and timbre. The scene describes the spatial layout, environment and lighting; the props describe the material, shape and plot use. If there is no corresponding asset, an empty array is returned.`,
		},
		{
			Operation: OperationStoryboardPlan, Label: "Storyboard planning", Category: "Storyboard", OutputType: "json", SchemaKey: "storyboard-plan/v3",
			Description:    "Plan the plot, project style, and current character version into executable shots.",
			Variables:      []PromptTemplateVariable{{Label: "Project name", Placeholder: "{{项目名称}}"}, {Label: "Project style", Placeholder: "{{项目画风}}"}, {Label: "User requirements", Placeholder: "{{用户要求}}"}},
			DefaultContent: DefaultStoryboardPromptTemplate(),
		},
		{
			Operation: OperationStoryboardRepair, Label: "Storyboard repair", Category: "Storyboard", OutputType: "json", SchemaKey: "storyboard-plan/v3",
			Description:    "Fix storyboard structure, fields and shot complexity returned by model.",
			Variables:      []PromptTemplateVariable{{Label: "Check error", Placeholder: "{{校验错误}}"}, {Label: "Project style", Placeholder: "{{项目画风}}"}},
			DefaultContent: `You are a film and television storyboard JSON restoration director. Plot information must be retained when repairing the structure. Complexity overruns must be resolved by removing mirrors or redistributing content. Mistakes must not be covered up by deleting key plots. If the verification error is that the lines/narration are too long, the scenes must be dismantled or condensed into lines that can be read in a single shot, and the key plots should be retained. Do not put the overly long dialogue back as it is. Maintain the visual medium, character identities, costumes, props, and continuity of the original project and do not alter the style without authorization. Only fixes for validation errors and resulting lens organization issues.`,
		},
		{
			Operation: OperationStoryboardFirstFrame, Label: "First frame of storyboard", Category: "generate", OutputType: "text",
			Description: "Convert the single shot structure into the first frame prompt word used by the picture model.",
			Variables:   []PromptTemplateVariable{{Label: "project vision", Placeholder: "{{项目视觉}}"}, {Label: "First frame composition", Placeholder: "{{首帧构图}}"}, {Label: "Performance starting state", Placeholder: "{{表演起始状态}}"}, {Label: "Negative requirements", Placeholder: "{{负面要求}}"}},
			DefaultContent: `生成单一、可执行的分镜首帧。严格继承项目视觉媒介和角色资产；画面明确主体左右位置、视线、前中后景、遮挡、视觉焦点、可信光源与材质。只描述静止首帧，不提前写后续运动，不添加画外人物、无来源光线、文字或水印。

【项目视觉】
{{项目视觉}}

【首帧构图】
{{首帧构图}}

【表演起始状态】
{{表演起始状态}}

【负面要求】
{{负面要求}}`,
		},
		{
			Operation: OperationStoryboardVideo, Label: "Storyboard video", Category: "generate", OutputType: "text",
			Description: "Convert single-shot structures into compact execution cues for use with video models.",
			Variables:   []PromptTemplateVariable{{Label: "project vision", Placeholder: "{{项目视觉}}"}, {Label: "shot intention", Placeholder: "{{镜头意图}}"}, {Label: "First frame composition", Placeholder: "{{首帧构图}}"}, {Label: "Performance and Scheduling", Placeholder: "{{表演与调度}}"}, {Label: "camera", Placeholder: "{{摄影机}}"}, {Label: "time beat", Placeholder: "{{时间节拍}}"}, {Label: "movement and ending", Placeholder: "{{运动与结尾}}"}, {Label: "sound", Placeholder: "{{声音}}"}, {Label: "execution priority", Placeholder: "{{执行优先级}}"}, {Label: "Negative requirements", Placeholder: "{{负面要求}}"}},
			DefaultContent: `【项目视觉】
{{项目视觉}}

【镜头意图】
{{镜头意图}}

【首帧构图】
{{首帧构图}}

【表演与调度】
{{表演与调度}}

【摄影机】
{{摄影机}}

【时间节拍】
{{时间节拍}}

【运动与结尾】
{{运动与结尾}}

【台词与声音】
{{声音}}

【执行优先级】
{{执行优先级}}

【负面要求】
{{负面要求}}`,
		},
		{
			Operation: OperationCharacterExtract, Label: "Character card extraction", Category: "role", OutputType: "json", SchemaKey: "character-breakdown/v1",
			Description:    "Extract character assets from the chapter body that need to be consistent across shots.",
			Variables:      []PromptTemplateVariable{{Label: "Project name", Placeholder: "{{项目名称}}"}, {Label: "Chapter name", Placeholder: "{{章节名称}}"}, {Label: "Project style", Placeholder: "{{项目画风}}"}},
			DefaultContent: `You are the Shorts Character Asset Director. Only extract characters who actually appear, speak, or have a clear role in the plot in the chapter, and whose visual or sound consistency needs to be maintained in subsequent productions. Ignore system announcements, pure objects, identityless crowds, and one-time passers-by with no lasting role value; merge the names, exclusive titles, and aliases of the same character. Information that is not specified in the text must be written as "not specified in the text." You are not allowed to change the character relationships, historical background, or make up numbered names. The character settings must be specific, stable, and can be used for subsequent three-view and video consistency control.`,
		},
		{
			Operation: OperationCharacterTurnaround, Label: "Three views of the character", Category: "role", OutputType: "text",
			Description:    "Generate front, side and back views according to the current character version and project style.",
			Variables:      []PromptTemplateVariable{{Label: "Character name", Placeholder: "{{角色名称}}"}, {Label: "Project style", Placeholder: "{{项目画风}}"}, {Label: "Character setting", Placeholder: "{{角色设定}}"}},
			DefaultContent: `Create a three-view setting table for professional characters. The picture is strictly divided into three equal-width vertical areas, from left to right: the whole body from the front, the whole body from the right side, and the whole body from the back. The three perspectives must be of the same character, the same costume, the same hairstyle, the same body shape and the same proportions, using a standing neutral posture, showing the top of the head to the soles of the feet. Use a pure, neutral light color and evenly set lighting for the background. It is only responsible for isolating the outline and must not change the painting or rendering medium of the project's style. Text, borders, prop descriptions, expression changes, and extra characters are prohibited.`,
		},
		{
			Operation: OperationShortDramaOutline, Label: "Short play outline", Category: "Project", OutputType: "json", SchemaKey: "short-drama-outline/v1",
			Description:    "Generate short play titles, introductions and chapter texts based on one-sentence stories for project creation and import.",
			Variables:      []PromptTemplateVariable{{Label: "Number of chapters", Placeholder: "{{章节数量}}"}, {Label: "narrative structure", Placeholder: "{{叙事结构}}"}, {Label: "word count per chapter", Placeholder: "{{每章字数}}"}, {Label: "narrative perspective", Placeholder: "{{叙事视角}}"}, {Label: "overall tone", Placeholder: "{{整体基调}}"}, {Label: "role size", Placeholder: "{{角色规模}}"}, {Label: "Chapter length", Placeholder: "{{章节篇幅}}"}},
			DefaultContent: `你是短剧编剧。根据用户的一句话故事，生成一部短剧的标题、一句话简介和 {{章节数量}} 个章节。生成要求：叙事采用{{叙事结构}}结构，每章约 {{每章字数}} 字，使用{{叙事视角}}视角，整体基调{{整体基调}}，主要角色约 {{角色规模}}，章节篇幅{{章节篇幅}}。`,
		},
		{
			Operation: OperationSkillDraft, Label: "skills draft", Category: "Skills", OutputType: "json", SchemaKey: "skill-draft/v1",
			Description:    "Generate names, categories, introductions and instruction drafts for reusable creative skills based on user ideas.",
			Variables:      []PromptTemplateVariable{},
			DefaultContent: `You are a skills writing assistant. Generate a draft for a "reusable creative skill" based on the user's ideas. Keep skill names short, no more than 20 words. The category tag must be one of drama, ecommerce, creative, social, and others. The introduction should not exceed 120 words, describing the applicable scenarios, input conditions and final output. Instructions are written in Markdown, at least 300 words, for subsequent reading by models using this skill in canvas. They must include role settings, inputs and constraints, step-by-step execution processes, checklists, and output formats. Tool steps only describe the required capabilities, inputs, outputs and confirmation points, and do not make up specific tool names, nor write tools, nodes, permissions, budgets or approvals as capabilities granted by skills; when executing, always refer to the list of capabilities actually exposed in the operating environment.`,
		},
	}
}

func protectedPromptContext(operation string, values map[string]string) string {
	switch operation {
	case OperationStoryboardPlan:
		return storyboardProtectedContext(values)
	case OperationStoryboardRepair:
		return storyboardRepairProtectedContext(values)
	case OperationCharacterExtract:
		return characterExtractProtectedContext(values)
	case OperationChapterAssetsExtract:
		return strings.Join([]string{
			fmt.Sprintf("【Task】\nExtract characters, scenes and props from the chapter \"%s\" of the short play project \"%s\".", values["Project name"], values["Chapter name"]),
			"【Project style】" + values["Project style"],
			"【Chapter text】" + values["Chapter text"],
			"【Protected Output Contract】" + promptOutputContract(operation),
		}, "\n\n")
	case OperationCharacterTurnaround:
		return strings.Join([]string{"[Character name]" + values["Character name"], "【Project style】" + values["Project style"], "【Character setting】" + values["Character setting"]}, "\n\n")
	case OperationShortDramaOutline:
		return strings.Join([]string{
			"【User Story】" + values["user stories"],
			"【Protected Output Contract】" + promptOutputContract(operation),
		}, "\n\n")
	case OperationSkillDraft:
		return strings.Join([]string{
			"【User Thoughts】" + values["User thoughts"],
			"【Protected Output Contract】" + promptOutputContract(operation),
		}, "\n\n")
	default:
		return ""
	}
}

func promptOutputContract(operation string) string {
	switch operation {
	case OperationStoryboardPlan, OperationStoryboardRepair:
		return "Server-side fixed JSON Schema storyboard-plan/v3 (cannot be overridden by operational templates or user customization):" + storyboardPlanJSONSchema
	case OperationCharacterExtract:
		return "Server-side fixed JSON Schema character-breakdown/v1 (cannot be overridden by operational templates or user customization):" + characterBreakdownJSONSchema
	case OperationChapterAssetsExtract:
		return "Server-side fixed JSON Schema chapter-assets/v1 (cannot be overridden by operational templates or user customization):" + ChapterAssetsJSONSchema
	case OperationShortDramaOutline:
		return "Server-side fixed JSON Schema short-drama-outline/v1 (cannot be overridden by operational templates or user customization):" + shortDramaOutlineJSONSchema + "Only output a JSON object, not markdown code blocks or other text."
	case OperationSkillDraft:
		return "Server-side fixed JSON Schema skill-draft/v1 (cannot be overridden by operational templates or user customization):" + skillDraftJSONSchema + "Only output a JSON object, not markdown code blocks or other text."
	default:
		return "The current operation outputs ordinary text prompt words, without JSON Schema."
	}
}

const shortDramaOutlineJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "synopsis", "chapters"],
  "properties": {
    "title": {"type": "string"},
    "synopsis": {"type": "string"},
    "chapters": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "content"],
        "properties": {
          "title": {"type": "string"},
          "content": {"type": "string"}
        }
      }
    }
  }
}`

const skillDraftJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["skillName", "tag", "description", "instruction"],
  "properties": {
    "skillName": {"type": "string"},
    "tag": {"type": "string", "enum": ["drama", "ecommerce", "creative", "social", "others"]},
    "description": {"type": "string"},
    "instruction": {"type": "string"}
  }
}`

const storyboardPlanJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "logline", "styleGuide", "characters", "locations", "shots"],
  "properties": {
    "title": {"type": "string"},
    "logline": {"type": "string"},
    "styleGuide": {"type": "string", "maxLength": 120},
    "characters": {"type": "array", "items": {"type": "string"}},
    "locations": {"type": "array", "items": {"type": "string"}},
    "shots": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "description", "durationSeconds", "dialogue", "characterIds", "narrativeIntent", "viewerPOV", "performanceBlocking", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "visualPrompt", "videoPrompt", "camera", "motion", "timeBeats", "mustHave", "optionalDetails", "continuityOut", "negativePrompt", "assetRefs"],
        "properties": {
          "title": {"type": "string"},
          "description": {"type": "string"},
          "durationSeconds": {"type": "integer", "minimum": 1, "maximum": 60},
          "dialogue": {"type": "string"},
"characterIds": {"type": "array", "description": "Fill in the current character asset ID first; fill in the character name for characters whose assets have not been confirmed", "items": {"type": "string"}},
          "narrativeIntent": {"type": "string"},
          "viewerPOV": {"type": "string"},
          "performanceBlocking": {"type": "string"},
          "shotSize": {"type": "string"},
          "emotion": {"type": "string"},
          "lightingAndAtmosphere": {"type": "string"},
          "audioEffects": {"type": "string"},
          "visualPrompt": {"type": "string"},
          "videoPrompt": {"type": "string"},
          "camera": {"type": "string"},
          "motion": {"type": "string"},
          "timeBeats": {"type": "string"},
          "mustHave": {"type": "array", "maxItems": 3, "items": {"type": "string"}},
          "optionalDetails": {"type": "array", "items": {"type": "string"}},
          "continuityOut": {"type": "string"},
          "negativePrompt": {"type": "string"},
          "assetRefs": {
            "type": "array",
            "maxItems": 6,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["nodeId", "role", "priority"],
              "properties": {
                "nodeId": {"type": "string"},
                "role": {"type": "string", "enum": ["character", "environment", "wardrobe", "prop", "weapon", "style", "motion", "audio"]},
                "priority": {"type": "integer", "minimum": 0, "maximum": 100}
              }
            }
          }
        }
      }
    }
  }
}`

const ChapterAssetsJSONSchema = `{
  "type": "object", "additionalProperties": false,
  "required": ["characters", "scenes", "props"],
  "properties": {
    "characters": {"$ref": "#/$defs/characterBreakdown/properties/characters"},
    "scenes": {"type": "array", "items": {"$ref": "#/$defs/asset"}},
    "props": {"type": "array", "items": {"$ref": "#/$defs/asset"}}
  },
  "$defs": {
    "asset": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "description", "prompt"],
      "properties": {"name": {"type": "string"}, "description": {"type": "string"}, "prompt": {"type": "string"}}
    },
    "characterBreakdown": ` + characterBreakdownJSONSchema + `
  }
}`

const characterBreakdownJSONSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["characters"],
  "properties": {
    "characters": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "aliases", "role", "appearance", "clothing", "physique", "personality", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"],
        "properties": {
          "name": {"type": "string"},
          "aliases": {"type": "array", "items": {"type": "string"}},
          "role": {"type": "string"},
          "appearance": {"type": "string"},
          "clothing": {"type": "string"},
          "physique": {"type": "string"},
          "personality": {"type": "string"},
          "props": {"type": "string"},
          "consistencyPrompt": {"type": "string"},
          "multiViewPrompt": {"type": "string"},
          "voiceLanguage": {"type": "string"},
          "voiceAge": {"type": "string"},
          "voiceTimbre": {"type": "string"}
        }
      }
    }
  }
}`

func storyboardProtectedContext(values map[string]string) string {
	return strings.Join([]string{
		"【Plot】" + values["plot"],
		"[User’s request this time]" + values["User requirements"],
		"[Current canvas assets]" + values["canvas assets"],
		"[Current project style]" + values["Project style"],
		"[Current character version]" + values["character version"],
		StoryboardExecutionContract(values["Single shot duration rules"], values["Shot quantity rules"]),
	}, "\n\n")
}

func storyboardRepairProtectedContext(values map[string]string) string {
	return strings.Join([]string{
		"【Plot】" + values["plot"],
		"[User’s request this time]" + values["User requirements"],
		"[Current canvas assets]" + values["canvas assets"],
		"[Original verification error]" + values["Check error"],
		"[Current project style]" + values["Project style"],
		"[Current character version]" + values["character version"],
		StoryboardExecutionContract(values["Single shot duration rules"], values["Shot quantity rules"]),
		"[Original output that needs fixing]" + values["raw output"],
	}, "\n\n")
}

func StoryboardExecutionContract(durationRule string, countRule string) string {
	return `[Protected Execution Contract]
-` + durationRule + `
- ` + countRule + `- A single shot can have up to 2 main characters, 1 main camera, 1 main action chain, 3 timeBeats and 3 mustHave; if the limit is exceeded, the camera must be disassembled or redistributed within the fixed number of shots.
- Dialogue only contains the lines or short narration actually spoken in this scene. The upper limit of the number of words is calculated as a maximum of about 5 Chinese characters per second (at least 24 words); extremely long lines/narration must be separated or streamlined, and dialogue must not be used to carry long narratives.
- characterIds takes priority in filling in the assetId in the current character version; the character only has a name, and if the asset has not yet been confirmed, fill in the character name, and the server will retain the name reference. Don't make up IDs; returns an empty array if there are no roles.
- assetRefs can only reference nodeIds in the current canvas asset; don't make up IDs based on similar names. Each mirror has a maximum of 6. The larger the priority, the more important it is.
- styleGuide has a maximum of 120 Chinese characters; visualPrompt only describes the first frame, and videoPrompt only describes the motion and ending status.
- The frame ratio is controlled by the video node parameters. The prompt words must not write the specific ratio, and do not discuss the frame configuration.
- Only return full JSON, no Markdown or interpretation.
-` + promptOutputContract(OperationStoryboardPlan)
}

func characterExtractProtectedContext(values map[string]string) string {
	return strings.Join([]string{
		fmt.Sprintf("【Task】\nExtract characters from the chapter \"%s\" of the short play project \"%s\".", values["Project name"], values["Chapter name"]),
		"【Project style】" + values["Project style"],
		"【Chapter text】" + values["Chapter text"],
		"【Protected Output Contract】" + promptOutputContract(OperationCharacterExtract) + "\n严格 JSON 示例：{\"characters\":[{\"name\":\"角色名\",\"aliases\":[],\"role\":\"剧情定位与人物关系\",\"appearance\":\"稳定外貌\",\"clothing\":\"固定服装\",\"physique\":\"体型体态\",\"personality\":\"表演基线\",\"props\":\"\",\"consistencyPrompt\":\"跨镜头一致性约束\",\"multiViewPrompt\":\"三视图结构重点\",\"voiceLanguage\":\"语言口音\",\"voiceAge\":\"声音年龄感\",\"voiceTimbre\":\"音色语速力度\"}]}",
	}, "\n\n")
}
