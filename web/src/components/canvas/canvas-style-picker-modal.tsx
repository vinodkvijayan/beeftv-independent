import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Copy, Eye, Palette, Pencil, Plus, Search, SlidersHorizontal, Star, Trash2, UserRound } from "lucide-react";
import { App, Button, Input } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { nanoid } from "nanoid";

import { StyleProfileEditorModal } from "@/components/canvas/style-profile-editor-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { resolveEmbeddedAssetUrl } from "@/lib/embedded-runtime";
import { createStyleProfileSnapshot, parseStyleProfile, serializeStyleProfile, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import {
    compileCanvasStylePreset,
    customCanvasStylePreset,
    recommendedCanvasStylePresets,
    type CanvasStylePreset,
    type ProjectStyleSelection,
} from "@/lib/canvas/canvas-style-system";
import { createStyleProfile, deleteStyleProfile, listStyleProfiles, setStyleProfileFavorite, touchStyleProfile, updateStyleProfile, type UserStyleProfile } from "@/services/api/style-profiles";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";

export type { CanvasStylePreset } from "@/lib/canvas/canvas-style-system";

// 分类按短剧制作语境组织：先看媒介，再看题材与视觉气质，避免用品牌名称代替画风。
const PROJECT_STYLE_SCOPE = "[Use Boundary] This specification is the baseline of the art and image style of the entire project, and is used to unify character assets, clothing materials, architectural worldview, color language and film texture; it is not a prompt word for a certain picture or shot. The specific scene content, composition, scenery, camera position, camera movement, action, light source position, weather and single scene mood are determined by the plot and storyboard nodes, and may not be mechanically copied from this specification.";

const legacyCanvasStylePresets: CanvasStylePreset[] = [
    {
        id: "urban-live-action",
        title: "Urban live-action short drama",
        category: "Real shots",
        description: "Neutral urban tones, real East Asian actors and life styles; unified natural light, urban materials and restrained performances to serve workplace and emotional themes.",
        tags: ["workplace", "emotion", "real life"],
        prompt: [
            "[Project Positioning] The realistic light film style of contemporary Chinese urban live-action short dramas. The visual core is real characters, believable living spaces and restrained sophistication; the entire film maintains a unified natural skin color, real materials and modern urban temperament, and does not use studio portraits, advertising blockbusters or Internet celebrity filters.",
            "[Project Color System] The color palette used in the entire project is approximately 60% neutral white, matte gray, light wood and cement color, 30% low saturation navy blue, gray green and camel, and 10% amber, burgundy or project identification color. This ratio is used to control the overall frequency of character clothing, scene art, and asset libraries. It does not require each picture to be mechanically satisfied; skin color always remains natural, warm, and neutral.",
            "[Character Design System] Uniformly adopts real East Asian skeletal features and contemporary age sense. The facial features, hairstyle, body shape, makeup and professional temperament are natural and stable; the skin texture and micro-expressions are retained, and no uniform Internet celebrity faces, excessive skin grinding, exaggerated European-style deep facial features or cross-set age drift are used.",
            "[Clothing and material system] Create a character wardrobe of suits, shirts, knitwear, windbreakers and casual wear based on occupation, income, season and personality. The main color matching is subject to the project color palette; wool, cotton, leather, glass, metal and plastic maintain real roughness, and the iconic clothing and accessories of the fixed character form reusable assets.",
            "[Architectural World View] The unified use of credible contemporary Chinese offices, apartments, cafes, shopping malls, communities and urban public spaces. The architectural scale, furniture system, Chinese logos and living facilities conform to the local context; different locations can have different identities, but they must not jump to European and American cities, empty model rooms or future science fiction spaces.",
            "[Image and dynamic baseline] The entire film adopts natural light, credible real-life light sources, moderate contrast and realistic performance rhythm; the dynamic temperament is restrained, stable, and life-like, allowing the storyboard to choose static observation or sports photography according to the plot, but does not use dazzling movements without narrative motivation and abuse of slow motion.",
            "[Asset Consistency] Fix the face shape, hairstyle, body shape, wardrobe number and common props for the main characters, and fix the space layout, material board and identification system for the main locations; cross-episode changes must be driven by the plot, time or season and leave traces in the character assets or scene asset versions.",
            "[Global Disable] Prohibits default faces of European and American characters, plastic skin, strong green-orange filters, oversaturated neon, cheap studio shots, incorrect Chinese, building area drift, random clothing color changes, and the same asset changing materials in different nodes.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/urban-live-action.jpg",
    },
    {
        id: "period-live-action",
        title: "Ancient costume/era real person",
        category: "Real shots",
        description: "First, focus on a single historical period, and then unify the character makeup, clothing system, utensils and architecture; use low-saturated oriental colors and material details to establish the credibility of the era.",
        tags: ["Ancient costume", "Republic of China", "history"],
        prompt: [
            "[Project Positioning] Realistic oriental aesthetics of live-action short dramas with historical themes. When the project is started, a clear era sub-type must be identified from the ancient dynasty, the Republic of China or other eras based on the novel, and a unique era research baseline must be formed; the entire project's character system, service path, utensils and buildings only follow this baseline.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 55% off-white, dark gray, wood brown and earthy yellow, 30% indigo, bamboo green, dark red and moon white, and 15% cinnabar, gilt, jade or project identity color. This ratio controls the overall distribution of clothing factions, building materials, and prop assets; class differences are expressed through color purity, fabric grade, and metal usage.",
            "[Character Design System] Uniformly adopts real East Asian skeletal profiles, makeup and hair styles that match the era, and establishes differences based on age, status, etiquette, and labor status; the characters' crowns, buns, beards, scars, body postures, and identity marks are fixed, and no modern idol makeup or aesthetic templates that have nothing to do with the times are used.",
            "[Clothing and material system] The ancient subtype established a system based on lapel shape, sleeve type, belt, hat, shoes, and patterns; the Republic of China subtype established a hierarchy based on cheongsam, gown, student uniform, military uniform, and suit. Silk, linen, yarn, brocade, leather, wood, jade and metal use a unified material library, and weapons, jewelry and utensils must belong to a clear era.",
            "[Architectural World View] The ancient subtype uses Chinese wooden structures, brackets, tile roofs, courtyards, cloisters, gardens and urban systems; the Republic of China subtype uses Shikumen, arcades, mansions, stations, newspapers and old street systems. The project only uses the architectural library of the selected era to unify the age texture and traces of use of wood, brick, stone, and mortar.",
            "[Image and dynamic baseline] The entire film maintains the believable light sense of the era such as natural skylight, window paper diffusion, candlelight and lanterns. Performances and actions follow the status etiquette and clothing weight; the dynamic style is solemn, restrained, and has real inertia. The specific rhythm and scheduling are determined by the storyboard.",
            "[Asset consistency] Establish an era manual, character wardrobe, pattern library, artifact library and building module library; the hair accessories, clothing layers and identity patterns of the same character cannot be changed randomly. Scene repairs, clothing stains and identity upgrades can only be updated according to the plot version.",
            "[Global Ban] Dynasty mixing and matching, modern zippers and furniture, cheap chemical fiber reflective materials, plastic accessories, Japanese torii gates, European castles, modern idol makeup, random petal filters, and weapons and artifacts that have not been attributed to the era are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/period-live-action.jpg",
    },
    {
        id: "suspense-noir",
        title: "Suspense crime night scene",
        category: "Real shots",
        description: "The blue and black low-illumination base is combined with a small amount of dangerous colors to unify the city night scene material, real scene light and psychological oppression temperament, serving clues and reversing the theme.",
        tags: ["Suspense", "crime", "reverse"],
        prompt: [
            "[Project Positioning] A realistic dark tone system for modern Chinese suspense crime live-action short dramas, with low illumination, real urban textures and psychological oppression as the visual motif of the entire film; the style serves to hide and reveal information, but any scene must keep the characters, environment and key narrative information readable.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 65% blue-black, charcoal gray and cold cement colors, 25% cyan fluorescent, dirty yellow sodium lamp and cool white screen colors, and 10% dark red, magenta or project dangerous colors. Accent colors only bear the visual responsibility of danger, power, or key clues, and do not spread into the neon effect of the entire film.",
            "[Character Design System] Uniformly adopts real East Asian characters and their natural age status, allowing traces of fatigue, fine lines, stubble, scars and occupational stress; the character's face shape, hairstyle, scars and mental state have version records, and the villain is shaped through the behavior and identity system, without the use of exaggerated facial makeup.",
            "[Apparel and Material System] Establish a library of dark matte jackets, uniforms, casual clothes and professional clothing, and distinguish identities through tailoring, wear and materials; IDs, communication equipment, files, monitoring equipment and key props use a unified design language to avoid highly reflective materials from destroying the dark tone system.",
            "[Architectural World View] The old residential buildings, stairwells, underground spaces, offices, warehouses, convenience stores, streets and suburban facilities in Chinese cities are uniformly used to form a material library of wet walls, glass, metal, cement and old coatings; different locations share the same urban area and age information.",
            "[Image and dynamic baseline] The entire film maintains a low-key but readable relationship between light and dark, an interpretable sense of urban real-life light, and a restrained psychological tension; the dynamic style focuses on observation, following, and a sense of oppression. The specific information disclosure method is designed by storyboards, and neon, smoke, or camera shaking are not regarded as suspense itself.",
            "[Asset Consistency] Establish versions of scars and clothing for characters, establish plane relationships, material panels, and lighting baselines for major locations, and establish unique appearance and status records for key props; cross-episode changes must correspond to clear plot events.",
            "[Global Disable] It is forbidden to make the game unreadable, cyberpunk sea of lights, sourceless outline light, excessive smoke, villain facial makeup, plasma curiosity, wrong policing and city logos, regional drift in the same location and random deformation of key assets.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/suspense-noir.jpg",
    },
    {
        id: "chinese-2d",
        title: "Chinese comics 2D",
        category: "2D animation",
        description: "Semi-realistic Chinese comic characters, mineral oriental colors and meticulous scene system; stable line drawings, clear silhouettes and unified two-dimensional assets to ensure cross-collection consistency.",
        tags: ["ancient style", "Xianxia", "two-dimensional"],
        prompt: [
            "[Project Positioning] A semi-realistic 2D animation system for Chinese comics with themes of oriental antiquity and fairy tales, uniformly using hand-drawn line drawings with varying thicknesses, celluloid character coloring, and meticulous environment drawing; the entire project maintains a two-dimensional painting language and does not mix plastic figures, three-dimensional renderings, or Japanese cute templates.",
            "[Project Color System] The weight of the entire project color palette is approximately 55% moon white, indigo, azurite and soot, 30% cinnabar, indigo, bamboo green and ocher, 15% gold, bright cyan or project magic color. This ratio is used to coordinate character camps, scene color palettes, and special effects assets; each main character has a fixed primary color, secondary color, and identification color.",
            "[Character Design System] Adult characters uniformly adopt a head and body size of about 7 to 8 and an oriental bone profile. Eye proportions, face shape, hairline, hair bundles, eyebrows and age sense follow the same character design specifications; different characters are distinguished by silhouette, height difference, hairstyle and clothing structure, and the front, side and back reference pictures must belong to the same two-dimensional design.",
            "[Clothing and material system] Hanfu, Jinzhuang, armor, sect clothes and magic weapons form a style library according to identity and camp, with fixed collars, sleeve types, waistbands, patterns and colors; silk, linen, metal, and jade are distinguished by two-dimensional textures, line density and highlight shapes, and three-dimensional realistic material maps are not used.",
            "[Architectural World View] Uniformly use Chinese wooden structures, brackets, cornices, tiles, covered bridges, mountain gates, ancient cities, bamboo forests, sea of clouds and oriental landscape systems to establish reusable building modules and scene palettes; no European castles, Japanese torii gates or modern urban elements appear in the world view.",
            "[Image and dynamic baseline] The entire film maintains clear silhouettes, two to three levels of character light and shade, meticulous scene layers, and a moderate sense of ink and air; the animation uses clear, limited but accurate two-dimensional movements of key postures, and mouth shapes, hair, clothes, and special effects follow a unified animation rhythm, and specific actions are determined by storyboards.",
            "[Asset Consistency] Establish character line drawing specifications, standard color cards, expression tables, clothing disassembly parts, spell color plates, building modules and special effects element libraries; any new assets must first match line thickness, coloring level and texture density before entering storyboard production.",
            "[Global Disabled] 3D plastic texture, figure photography, European and American comic muscle templates, juvenile big eyes, random face and hairstyle changes of characters, drifting clothing patterns, background style jumps, out-of-control spell colors, and screen text watermarks are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/chinese-2d.jpg",
    },
    {
        id: "ink-narrative",
        title: "Ink narrative",
        category: "stylized animation",
        description: "The white space on rice paper dominates, and burnt ink, light ink and a small amount of cinnabar are used to organize the narrative; the identity of the characters is distinguished by stable outlines, brushwork and color points, rather than being abstracted into unrecognizable ink balls.",
        tags: ["ink", "Oriental", "emotions"],
        prompt: [
            "[Project Positioning] A narrative animation project constructed in the language of Chinese ink painting, uniformly using rice paper fiber, wet and dry brushstrokes, fly white, accumulated ink, broken ink and light strokes; the entire film maintains a balance between poetic blank space and character recognisability, and does not interpret ink as a random filter.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 70% rice paper warm white and white space, 20% five-level gray composed of burnt ink, thick ink, and light ink, and 10% cinnabar, azurite, ocher or project point colors. Point color assigns fixed responsibilities according to roles, camps and key artifacts, and does not randomly change between different assets.",
            "[Character Design System] Characters adopt a stable head and body, facial outline, bun and outer outline system. Different characters have fixed brush stroke rhythm, outline features and point colors; near reality and far simplicity are unified drawing levels, but any simplification must not destroy the identity of the character.",
            "[Clothing and material system] Gowns, robes, hats, cloaks, weapons and study utensils are distinguished by the density of ink lines, dry and wet changes and limited patterns; the collars, belts, hair accessories and key props of fixed characters maintain clear shapes, and the clothing can be integrated into the gesture but cannot lose its structure.",
            "[Architectural World View] Unifiedly establish an ink asset library of landscapes, villages, pavilions, courtyard walls, covered bridges, boats and ancient roads, with Chinese-style structures, near real and far virtual, and ink color levels to keep the world consistent; fog, water, clouds and white paper share the same white space rule.",
            "[Image and dynamic baseline] The whole film expresses the sense of light through ink color density, paper whiteness, edge virtuality and point color brightness; dynamically adopts the unified principle of outline first, pen gesture following, and natural growth of ink. The transition language can come from ink droplets, brush strokes or blank space, and the specific actions and scheduling are determined by the storyboard.",
            "[Asset Consistency] Create unified samples of character brushes, standard ink levels, point color cards, clothing outlines, architectural structures and natural elements; newly added assets must first pass the paper texture, stroke scale, grayscale and point color responsibility checks.",
            "[Global Disable] Western-style watercolor illustrations, random splashes of ink, full-screen dirty gray, disappearing character facial features, different stroke styles for each asset, melted building structures, excessive colors, cheap paper grain filters, and randomly generated text seals are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/ink-narrative.jpg",
    },
    {
        id: "three-d-cartoon",
        title: "3D cartoon skit",
        category: "3D animation",
        description: "Stylized three-dimensional characters with sharp outlines, soft textures and bright colors; use readable expressions, exaggerated rhythm and stable assets to support comedy, parent-child and healing content.",
        tags: ["3D", "Comedy", "cure"],
        prompt: [
            "[Project Positioning] A stylized 3D cartoon short play system for comedy, parent-child and healing content, uniformly adopting simple shapes, clear silhouettes, semi-matte materials, soft sub-surface scattering and readable expressions; maintaining the texture of cartoons and not entering the cheap plastic toys or hyper-realistic uncanny valley.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 50% warm white, light wood, soft gray and sky colors, 35% high-recognition character main colors, and 15% project finishing colors such as yellow, coral red, mint green, etc. Colors are assigned according to role, location and function, always ensuring stable brightness differentiation between character assets and environmental assets.",
            "[Character Design System] Adults have a unified head and body of about 5 to 6, and children have a head and body of about 3.5 to 4.5. The head and hands can be moderately exaggerated but the joint structure is reasonable; differences are established through the proportion of eyes, nose and mouth, hairstyle, body shape and silhouette. All characters share the same modeling language and expression exaggeration scale.",
            "[Clothing and material system] Clothing styles and patterns are simplified into reusable large color blocks. Cotton, knitted, denim, leather and metal are distinguished by a unified roughness range; props adopt moderately rounded edges and clear functional shapes to maintain consistent proportions, materials and detail density in the same world.",
            "[Architectural World View] Uniformly use rounded corners, simplified geometry and clear functional divisions to build urban apartments, schools, shops, offices, parks or fantasy towns; the background asset detail level is lower than that of the characters but has reasonable functions, and all locations follow the same proportions, materials and color systems.",
            "[Image and Dynamic Baseline] The entire film maintains soft light, controlled highlights, clean outlines and bright rhythm; character movements uniformly follow preparatory movements, squeeze and stretch, follow, ease in and out, and clear pauses. The exaggeration range is restricted by the project performance manual, and the specific actions are determined by the storyboard.",
            "[Asset Consistency] Establish standard character proportions, expression tables, material balls, clothing swatches, prop proportions and building module libraries; all new assets must match the existing corner radius, roughness, color purity and level of detail.",
            "[Global Disable] Plastic dolls that are reflective, stiff T-Pose, all characters with the same face, oversized glass eyes, pore-level realistic skin, random head and body changes, blurred background textures, model wearing, floating props, and realistic assets that do not belong to the same art system are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/three-d-cartoon.jpg",
    },
    {
        id: "fantasy-3d",
        title: "Chinese style 3D fantasy",
        category: "3D animation",
        description: "Semi-realistic oriental characters, believable Chinese architecture and layered materials form a fantasy world; the color of spells is restricted by the camp, and volumetric lighting and special effects only enhance the focus of action and narrative.",
        tags: ["fantasy", "spell", "grand scene"],
        prompt: [
            "[Project Positioning] A semi-realistic 3D animated short drama system with oriental fantasy themes, uniformly using oriental character design, movie-level PBR materials, Chinese fantasy architecture and hierarchical spell visual language; the project spectacle is based on the logic of Chinese art and architecture, and does not apply the Western fantasy world template.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 55% indigo, jet black, cool gray, bronze and mist white, 30% camp colors such as vermilion, indigo, sapphire, dark gold, etc., and 15% single highlight energy color. This ratio is used for the overall planning of clans, characters, buildings, and spell assets; each faction and character's energy color has a unique responsibility.",
            "[Character Design System] Adult characters uniformly adopt a head and body of about 7.5 to 8, real oriental bone physiology and moderately idealized facial features. Skin, hair and eyes follow the same semi-realistic rendering standards; hair crowns, hair bundles, height, body shape and identity symbols are fixed, and power levels are expressed through clothing levels and energy rules.",
            "[Clothes and Material System] Robes, costumes, armors, cloaks, sect patterns, hair crowns and magical instruments form a camp-based asset library; silk, brocade, leather, metal, jade and wood use unified PBR standards and roughness ranges, and weapons, pendants and clothing layers have stable structures.",
            "[Architectural World View] Unify the use of Chinese-style wooden mountain gates, palaces, pavilions, cities, caves, plank roads, mountains, rivers, seas of clouds, and oriental altars, and establish a module library of brackets, roof ridges, tiles, rocks, and clouds; all wonders must evolve from Chinese structures and cannot be mixed with European spires, Gothic churches, and random exotic collages.",
            "[Image and dynamic baseline] The entire film maintains a credible sense of volume, controlled special effects brightness, real materials, and weighty animation performance; spells follow a unified shape grammar, particle density, energy color, and power grading. The movement patterns of characters and the environment are consistent. Specific combat actions and scheduling are determined by storyboards.",
            "[Asset Consistency] Establish three views of the character, sect color palette, clothing disassembly, material balls, weapons and instruments, building modules, spell templates and power level tables; any upgrades, damage or dress changes are managed as causal asset versions.",
            "[Global Disable] European castles, default elf faces, Western-style plate armor mixes, plastic materials, rainbow particles, full-screen overexposure special effects, random changes in the spell system, unreasonable character changes and weapon changes, and cross-cultural drift of building assets are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/fantasy-3d.jpg",
    },
    {
        id: "future-tech",
        title: "future technology",
        category: "Sci-fi real shot",
        description: "A clean white space, sophisticated industrial structures, and cool light constitute a believable near future; technology comes from functions and materials, and does not rely on full-screen neon and floating interfaces.",
        tags: ["Technology", "near future", "Hard science fiction"],
        prompt: [
            "[Project Positioning] A realistic hard science fiction short play system on China's science and technology themes in the near future, with deducible technology, clear functional structure and restrained sense of advancement as the core; the world is about ten to thirty years ahead of the present, and all equipment, clothing and spaces must be able to explain their uses, without using empty science fiction decorations.",
            "[Project Color System] The color palette used in the entire project is approximately 65% cool white, light gray, titanium and transparent materials, 25% graphite black, deep sea blue and low saturated industrial colors, and 10% turquoise or electric blue status indicator color. Highlight colors are only used for device status, permissions and risk reminders, and do not spread to color the environment.",
            "[Character Design System] Characters maintain true East Asian bones, natural age and professional credibility, and distinguish scientific research, engineering, medical, security and management roles through precise tailoring, functional equipment and identification details; prosthetics or wearable devices must conform to the human body structure and have clear functions.",
            "[Apparel and material system] Establish modular work clothes, protective clothing, commuter clothing and lightweight exoskeleton systems, uniformly using matte technical fabrics, titanium alloys, ceramics, transparent polymers and precision glass; seams, buckles, sensors and wear locations must comply with the use logic.",
            "[Architectural World View] Unified use of credible China's near-future laboratories, data centers, transportation hubs, smart residences, advanced manufacturing and urban public facilities; the space emphasizes structure, maintenance channels, guidance and equipment scale, and technological upgrades are built on the existing city rather than replacing it out of thin air.",
            "[Image and dynamic baseline] The entire film maintains clarity, calmness, low noise, and high material readability. The light sources come from overhead lights, work lights, screens, and natural skylight; dynamics emphasize precision operation, mechanical feedback, and spatial order. The specific camera position and rhythm are determined by the storyboard.",
            "[Asset Consistency] Establish equipment models, interface protocols, status light responsibilities, role permission colors, clothing modules and space guidance manuals; similar devices share a structural language, and upgrades and damage must form a traceable version.",
            "[Global Disable] Non-functioning holographic screens, full-screen blue HUD, random glowing lines, neon city shells, plastic space suits, incorrect mechanical structures, device size drift, garbled English characters, and equating future technology with cyberpunk are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/future-tech.jpg",
    },
    {
        id: "cyberpunk-neon",
        title: "cyberneon",
        category: "Sci-fi real shot",
        description: "The high-density Asian night city, damp old materials and controlled neon form a near future of technological imbalance; character identities are distinguished by prosthetics, class clothing and corporate colors.",
        tags: ["cyberpunk", "neon", "city night scene"],
        prompt: [
            "[Project Positioning] The cyberpunk short drama system in Asia's high-density cities. The visual core is the coexistence of advanced technology and old cities, the collision of corporate order and street life; neon is only a part of the business, transportation and identity system, and the world must retain traces of real life.",
            "[Project Color System] The color palette used in the entire project is approximately 55% pitch black, old cement, wet metal and soot, 30% cool cyan, dirty yellow and screen white, and 15% magenta, alert red or corporate identity color. Each highlight color is bound to a camp or function to avoid indiscriminate rainbow neon.",
            "[Character Design System] Characters adopt real East Asian bones and clear class differences. Prosthetic eyes, interfaces, prosthetic limbs and subcutaneous equipment follow unified technical generations; street characters, corporate employees and law enforcement officers are distinguished by silhouette, degree of modification, wear and tear and identity marks.",
            "[Apparel and material system] Establish a library of functional jackets, waterproof layers, corporate uniforms, old workwear and modified accessories, and uniformly use worn nylon, rubber, old leather, oxidized metal, transparent plastic and low-brightness electronic components; clothing must be moveable, stowable and weather-proof.",
            "[Architectural World View] The unified use of high-density Asian blocks, old building additions, underground transportation, corporate towers, maintenance shops, night markets and narrow residential units, Chinese signs and local facilities are credible; new technologies appear in the form of additions, coverings and intrusions into the old city.",
            "[Image and Dynamic Baseline] The entire film maintains readable night scenes, controlled moisture reflections, well-sourced real-life light sources, and a dynamic sense of street congestion and corporate space order; rain, smoke, and glitches only appear when the plot requires them, and cannot obscure character performances and key information.",
            "[Asset Consistency] Establish corporate logos, street guidance, prosthetic generation, equipment interfaces, character modifications and clothing wear versions; signboards, lines and spatial relationships in the same location remain stable across sets.",
            "[Global Disable] Purely decorative neon, all characters equipped with prosthetics, sourceless color outline lights, Japanese cities replacing Chinese context, English garbled characters, full-screen rain and fog, overexposed signs, random mechanical tattoos and future equipment without functional logic are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/cyberpunk-neon.jpg",
    },
    {
        id: "retro-hong-kong",
        title: "Retro Hong Kong style",
        category: "Real shots of the era",
        description: "The film colors, dense neighborhoods and lifestyle clothing of Chinese-speaking cities in the 1980s and 1990s; using tungsten warm light, green shadows and real era artifacts to create a sense of nostalgia.",
        tags: ["Hong Kong style", "film", "Era City"],
        prompt: [
            "[Project Positioning] A retro Hong Kong-style short drama system with Chinese urban themes from the 1980s to the 1990s, centered on real life in the era, compact neighborhoods and the texture of film photography; nostalgia comes from the way of service, space and character status, and does not rely on yellowing filters or star imitation makeup.",
            "[Project Color System] The color palette used in the entire project is approximately 50% cream white, old wall gray, dark green and wood brown, 35% tungsten warm yellow, turquoise shadow, denim blue and dark red, 15% signature red, taxi color or character identification color. Color maintains film latitude and natural skin tones.",
            "[Character Design System] Uniformly adopts real East Asian skeletal physiognomy and clear era hairstyle, makeup and body posture, and establishes differences according to occupation and class; characters are identified by eyebrow shape, curly hair, short hair, glasses, watches and stable clothing silhouettes, and do not copy specific celebrity faces.",
            "[Apparel and Material System] Build a wardrobe of broad-shouldered suits, shirts, knits, denim, windbreakers, dresses and workwear, using real cotton, wool, leather, polyester and metal accessories; styles, patterns, buttons, shoes and accessories are locked to a clear era.",
            "[Architectural World View] Use arcades, old-style residences, tea restaurants, video halls, offices, markets, docks, buses and streets with dense signboards in a unified manner, and retain window machines, ceramic tiles, iron gates, telephones and contemporary transportation; smartphones and contemporary urban furniture are not allowed to be mixed.",
            "[Image and Dynamic Baseline] The entire film uses moderate film grain, soft highlights, and a natural mixture of tungsten lights and cold light from the window. The dynamics maintain the steady rhythm of handheld observation and classic feature films; specific scenes, zooms, and movements are determined by the storyboard.",
            "[Asset Consistency] Establish era artifact lists, character wardrobes, signature glyphs, vehicles, interior materials, and film color baselines; time advancement is reflected through clothing, hairstyles, and urban update versions.",
            "[Global Disable] One-click yellowing filters, modern mobile phones and vehicles, brands from the wrong era, excessive neon, mixed use of Japanese Showa styles, face-changing of specific celebrities, cheongsam photos in studios, street scenes that are so clean that they are distorted, and random Traditional Chinese garbled characters are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/retro-hong-kong.jpg",
    },
    {
        id: "clay-stop-motion",
        title: "Clay freeze",
        category: "stop motion animation",
        description: "The clay characters, miniature scenery and frame-by-frame actions retain the traces of hand-sculpting; the model proportions, material particles and lighting scales are unified to form a warm and touchable handmade world.",
        tags: ["clay", "freeze frame", "Handmade texture"],
        prompt: [
            "[Project Positioning] A stop-motion animation short play system made of handmade clay characters and miniature sets. The visual core is touchable materials, real model scale and frame-by-frame performance; the entire project retains moderate hand-sculpted traces and does not pretend to be a smooth three-dimensional animation.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 55% clay, off-white, old wood and paper primary colors, 30% character main colors and scene functional colors, and 15% coral red, mustard yellow, lake blue or project finishing colors. The color has a slight unevenness to it from solid pigments.",
            "[Character Design System] Characters adopt unified head and body, eyeball, mouth shape replacement and skeleton joint rules, and are distinguished by nose shape, hairstyle, body shape and clothing silhouette; fingerprints, seams and replacement mouth shapes can be appropriately retained, but the front, side and back structures must be consistent and can be produced.",
            "[Clothing and material system] Clothes are made from a combination of thin clay, cloth, wool, paper and fine metal parts, and wood, stone, glass and food are simulated with miniature materials; each material maintains discernible particles, thickness and handmade edges to avoid a uniform plastic surface.",
            "[Architectural World View] The buildable miniature houses, streets, shops, natural landscapes and indoor scenes are uniformly used. The structure is constrained by the size of the real model, lighting fixtures and photography space; the background and props follow the same scale and hand-made language.",
            "[Image and Dynamic Baseline] The entire film maintains the true depth of field, soft volumetric light and slight frame-by-frame rhythm of studio miniature photography. The movements emphasize clear key postures, weights and pauses; motion blur is not allowed to cover up freeze-frame features, and the specific performance is determined by the storyboard.",
            "[Asset Consistency] Establish character skeleton, replacement face, hand shape, standard color clay, scale, scenery module and prop production table; damage, dress-up and expression components must be maintained according to the asset version.",
            "[Global Disable] Glossy CGI, plastic toy reflections, real human skin, model proportion drift, joint deformation out of thin air, material scale errors, excessive depth of field blur, random fingerprint stains, and seemingly infinite real space on the set are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/clay-stop-motion.jpg",
    },
    {
        id: "black-white-noir",
        title: "black and white silent film",
        category: "Stylized real shot",
        description: "Black-and-white grayscale, tough light and shadow, and restrained performance create a drama that is readable without dialogue; the contemporary texture comes from composition, materials, and performance, without relying on retro filters.",
        tags: ["black and white", "silent film", "Cinematic feel"],
        prompt: [
            "[Project Positioning] A stylized live-action short play system with black-and-white film and silent film narrative as the core, emphasizing outline, composition, physical performance and visual metaphor; there may be a small number of period props, but the project will not be fixed to a certain historical era.",
            "[Project Color System] The entire project uses black, white and five levels of neutral gray as the main colors, allowing a very small amount of monochromatic emphasis as a narrative clue; the relationship between light and dark gives priority to the character hierarchy and the readability of information, and it is forbidden to suppress the picture into a ball of black or over-bleach.",
            "[Character Design System] The characters maintain authentic East Asian bones and clear silhouettes, and the makeup, hair and age are natural and stable; the characters are distinguished by hat brim, collar type, posture, gestures and light and shadow placement, and the front, side and back settings must still be clear in grayscale.",
            "[Clothing and material system] The clothing establishes black and white gray brightness difference, texture density and outline structure according to the character's identity, using the real contrast of wool, cotton, leather, metal and glass; the pattern does not rely on color and must be discernible through material and brightness.",
            "[Architectural World View] Uniformly use geometrically clear and well-defined urban streets, interiors, stations, theaters and industrial spaces; walls, glass, masonry, metal and fog are all controlled by grayscale material libraries, without adding narrative spectacle backgrounds.",
            "[Image and dynamic baseline] Use hard light, side light, backlight and local highlights to create drama, allowing a small amount of film grain and halo; the performance is conveyed through pauses, sightlines, movements and exaggerated but believable body movements, and the specific rhythm is determined by the storyboard.",
            "[Asset Consistency] Establish grayscale color cards, character outlines, hats and props value tables, light and shadow baselines, and scene composition rules; the clothing textures and logo props of the same character still need to be stable under different exposures.",
            "[Global Disable] It is forbidden to apply brown retro filters, completely black pictures, modern color screens to steal scenes, excessive smoke, exaggerated stage makeup, meaningless fish-eye deformation, confusion of character silhouettes and subtitle watermarks.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/black-white-noir.jpg",
    },
    {
        id: "space-opera",
        title: "space opera",
        category: "science fiction animation",
        description: "The grand interstellar scale and distinctive camp costumes combine with believable aerospace structure; use colors, emblems and materials to build political and adventure narratives rather than stacking up cosmic wonders.",
        tags: ["Interstellar", "camp", "epic"],
        prompt: [
            "[Project Positioning] A space opera project in the context of Eastern narrative, integrating interstellar navigation, camp politics, family relationships and adventure growth; the world view allows for grand spectacle, but character motivations, technical limitations and spatial scale must be clear and traceable.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 45% space black, cool gray, silver white and cabin white, 35% camp main color and fleet identification color, and 20% nebula purple, energy blue or alert orange as narrative emphasis; each camp only has stable main colors and auxiliary colors.",
            "[Character Design System] Characters adopt real oriental bones or unified animated proportions, and are distinguished by military rank, camp emblem, hairstyle, body shape, and functional equipment; space suits, driving suits, and dresses must adapt to human activities, and the proportions of the character's face and body are stable across viewing angles.",
            "[Clothing and material system] Establish modules for cabin work clothes, tactical space suits, fleet uniforms, diplomatic dresses and maintenance suits, and uniformly use composite fibers, ceramics, metals, transparent masks and soft seals; interfaces, fasteners, emblems and life support devices have functional logic.",
            "[Architectural World View] The circular space station, bridge, propulsion module, colony, orbital elevator and low-gravity living area are uniformly used. The structure follows the logic of pressure chamber, maintenance channel, gravity and lighting; the wonders serve the scale of civilization and do not randomly collage alien buildings.",
            "[Image and Dynamic Baseline] Maintain the level of deep space black and working light in the cabin, and use restrained volumetric light and credible screen reflections; the movements reflect inertia, weightlessness, wearing equipment and space constraints, and the specific combat and movement are determined by the storyboard.",
            "[Asset Consistency] Establish a version table of ship models, camp emblems, cabin materials, interface standards, weapon sizes, character uniforms, and energy colors; any ship upgrades, damage, and changes must have plot reasons.",
            "[Global Ban] Prohibits the direct application of real space suits, planet size distortion, the same color for all camps, non-functional HUD, mixing of magic and technology rules, ship structure penetration, random changes in character equipment, and copyrighted brand logos.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/space-opera.jpg",
    },
    {
        id: "comic-pop",
        title: "comic storyboard",
        category: "stylized animation",
        description: "High-contrast block surfaces, dot textures and comic rhythms form a readable action comedy vision; exaggeration comes from composition, onomatopoeia and gesture, while character assets still maintain continuity.",
        tags: ["comics", "action", "high contrast"],
        prompt: [
            "[Project Positioning] A comic storyboard style oriented towards action, comedy and urban adventure, uniformly using clear outlines, flat painted surfaces, dot textures and rhythmic frames; the picture can be exaggerated, but the character relationship, action direction and spatial continuity must be reliable.",
            "[Project Color System] The entire project uses off-white, jet black and neutral gray as the structural background color, 30% uses highly saturated red, yellow, blue or the main color of the project, and 10% uses a single impact color to focus on danger, speed or emotion; the color must form character and camp identification.",
            "[Character Design System] Uniformly adopts stable head-to-body proportions, strong outlines, clear hairstyles and repeatable emoticons; characters are distinguished by silhouettes, clothing blocks, postures and props, and exaggerated expressions must not change the basic face shape and identity.",
            "[Clothes and Material System] Clothing details are simplified into large color blocks, thick line patterns and a small amount of highlights. Cotton, leather, metal, denim and glass are distinguished by line density and highlight shapes; combat or action clothing must take into account mobility.",
            "[Architectural World View] Use urban spaces such as blocks, shops, schools, offices, stations, and rooftops that can be quickly identified. The background is expressed with geometric blocks, perspective lines, and limited dots; the scene does not compete with character outlines, nor does it use realistic brand logos.",
            "[Image and dynamic baseline] Actions use speed lines, impact shapes, stop poses and clear centers of gravity, and the switching rhythm is controlled by storyboards; the lens can simulate frame segmentation, but the readability of expressions, gestures and action directions must not be sacrificed.",
            "[Asset Consistency] Establish character standard angles, expression tables, line widths, dot density, onomatopoeic glyphs and action special effects templates; different shots share the same lines, color blocks and texture rules.",
            "[Global Ban] It is forbidden to mix realistic photos with comic characters, random line thickness, full-screen speed lines in all pictures, complex backgrounds suppressing characters, garbled onomatopoeic text, character face-changing, wrong limb structure, and excessive bloody curiosity.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/comic-pop.jpg",
    },
    {
        id: "storybook-fantasy",
        title: "picture book fairy tale",
        category: "illustration animation",
        description: "Paper particles, soft color blocks and hand-painted edges form a warm fairy tale world; the characters' expressions and outlines are clear, avoiding the generalized soft-focus filter that makes the picture book feel.",
        tags: ["picture book", "fairy tale", "warm"],
        prompt: [
            "[Project Positioning] A picture book fairy tale animation system oriented to growth, parent-child and fable narratives, uniformly using hand-painted edges, paper particles, limited color blocks and readable character expressions; the story world can be fantastic, but the emotions and character relationships remain warm, concrete and understandable.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 55% paper warm white, fog blue, sage green and light wood color, 30% character and scene main colors, and 15% honey yellow, coral red or starlight gold as narrative point colors; avoid all pictures becoming pastel gradients.",
            "[Character Design System] Characters adopt a unified picture book head and body, rounded but different outlines, and clear proportions of eyes, nose, and mouth, and are distinguished by hats, hairstyles, ears, body types, and clothing; the front, side, and back views must retain the same hand-drawn styling features.",
            "[Clothes and Material System] Clothes use touchable materials such as cloth, knitting, leather, wooden buttons, paper and wool, and the patterns are simplified to a small number of repeating elements; the character logo objects, collars, cuffs, and shoes remain stable.",
            "[Architectural World View] Unified use of readable scenes such as villages, forests, attics, stations, riverbanks, markets, and small castles. The architectural structure is hand-built and picture book perspective; fantasy elements are deformed from daily objects, and there is no illogical exotic collage.",
            "[Image and Dynamic Baseline] Maintain soft but directional light and shadow, paper texture and limited animation rhythm. The movements emphasize breathing, center of gravity, eyes and clothes. The specific movements and lens scheduling are determined by the storyboard.",
            "[Asset Consistency] Establish standard color cards, paper textures, brush edges, character proportions, expression tables, scene modules and magic point color rules; new assets must match existing lines and grain scales.",
            "[Global Ban] Plastic 3D, excessive soft focus, characters with the same face, excessive candy colors, shadow direction drift, complex text watermarks, out-of-control detail density, random hair changes, and making children's characters into the uncanny valley are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/storybook-fantasy.jpg",
    },
    {
        id: "surreal-dream",
        title: "Surreal dream",
        category: "Stylized real shot",
        description: "Realistic materials are juxtaposed with impossible spaces, and dreams are expressed through mirroring, scale dislocation and foggy light; all surreal changes serve the character's psychology and narrative clues.",
        tags: ["dream", "Surreal", "psychological"],
        prompt: [
            "[Project Positioning] A surreal dream skit system with real characters entering impossible spaces as the core. Dreams are not random spectacles, but a traceable visual system composed of characters’ memories, desires, fears and choices; there must be clear differences and return rules between real and dream passages.",
            "[Project Color System] Use natural neutral gray and low-saturated environmental colors for realistic passages, use 35% foggy white, light gold, cold cyan and dark purple for dream passages, and 15% fixed symbolic colors to carry the psychological clues of the characters; the same symbolic color cannot be changed at will between different characters.",
            "[Character Design System] The character maintains the true East Asian bone structure, age and body proportions. The dream only allows regular deformation in hairstyle, clothing, scale, shadow or local materials; the front, side and back structure must still be able to confirm that it is the same character.",
            "[Clothing and Material System] Realistic clothing follows the logic of life. Dream clothing can express psychology through repetition, inversion, transparency, too large or too small, but fabrics, buttons, shoes and logo objects need to maintain traceable variations.",
            "[Architectural World View] Uniformly use space syntax such as mirrored rooms, endless stairs, floating streets, inverted buildings, empty halls, and nature in the fog; each impossible space is bound to a narrative rule, and randomly generated castles and starry skies are not piled together.",
            "[Image and dynamic baseline] Reality uses credible light sources and stable lenses, and dreams use slow floating, specular reflection, scale changes, and discontinuous transitions; special effects remain controlled, and specific dream actions and rhythms are determined by the storyboard.",
            "[Asset Consistency] Establish symbolic colors, dream rules, character mark objects, before and after space deformation comparisons, mirror materials and transition syntax tables; each deformation can correspond to plot nodes and can be restored.",
            "[Global Disable] Unreasonable random deformation, full-screen smoke, excessive mirroring, all spaces floating, no difference between dreams and reality, character facial features melting, symbol meaning drifting, and noise to cover up generation errors are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/surreal-dream.jpg",
    },
    {
        id: "nature-healing",
        title: "natural healing",
        category: "Real shots",
        description: "Real natural light, plants and handmade life form a relaxed local texture; healing is expressed with seasons, sounds and small actions, without advertising-style empty shots.",
        tags: ["Heal", "natural", "slow life"],
        prompt: [
            "[Project Positioning] A natural healing live-action short drama system oriented towards family relationships, homecoming, growth and emotional repair. The core is the characters' life actions and relationship changes in a specific natural environment; nature is not a decorative background, but a real space that participates in the narrative.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 55% leaf green, moss green, earth color and off-white, 30% wood, stone, sky and seasonal environment colors, 15% ocher red, mustard yellow or character identification color; maintain natural white balance and seasonal continuity.",
            "[Character Design System] Characters adopt real East Asian faces, natural age and living conditions, retaining sun marks, hair, body posture and traces of labor; differences are established through clothing layers, movement habits, hairstyles and personal belongings, and commercial advertisement-style refined characters are not used.",
            "[Clothes and Materials System] Establish a wardrobe of cotton and linen, knitted, old denim, rain gear, work clothes, canvas shoes and straw hats. The materials retain wrinkles, dirt, sweat and traces of use; coats, bags and handmade items that fix the role form identification assets.",
            "[Architectural World View] Use mountain village residences, forest huts, farms, teahouses, riverbanks, vegetable gardens, markets and small town edge spaces in a unified manner, and retain wood, stone, soil, old walls, tools and local living facilities; the architecture should have regional and seasonal evidence.",
            "[Image and dynamic baseline] Use real daylight, cloudy sky diffusion, campfires and indoor warm lights to allow wind, rain, insects and environmental sounds to enter the picture; dynamically observe the characters' tiny actions and relationship pauses to avoid taking only beautiful natural empty shots.",
            "[Asset Consistency] Establish seasonal color cards, plant and farm tool libraries, residential layouts, character wardrobes, handcrafted items, and weather continuity records; seasonal changes should bring visible but progressive asset versions.",
            "[Global Disable] Commercial B&B advertising, excessive aerial photography, saturated filters, European and American countryside replacing Chinese local life, clean and uninhabited natural spaces, always exquisite characters, random seasonal changes, and empty slow motion of healing are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/nature-healing.jpg",
    },
    {
        id: "real-life-documentary",
        title: "real life documentary",
        category: "Real shots",
        description: "Natural gray earth color, real East Asian ordinary people and local Chinese living space; retaining environmental traces and observational image quality, making family and social issues more credible.",
        tags: ["family", "grow", "Documentary"],
        prompt: [
            "[Project Positioning] A system of real-life documentary short dramas on family, growth and social issues, close to observational drama documentaries: real ordinary people in East Asia, real Chinese local space, natural exposure and moderate imperfection; the whole film pursues the credibility of life evidence and character relationships, and does not pursue advertising-level sophistication.",
            "[Project Color System] The weight of the color palette used in the entire project is approximately 70% natural gray, off-white, old wood, earth color and cement color, 20% environmental colors of local walls, furniture, plants and public facilities, and 10% clothing, daily necessities or project identification colors. The color palette allows for changes with seasons and regions, but always maintains low saturation, natural white balance and local authenticity.",
            "[Character Design System] Select East Asian characters with real age, body shape, family relationships and career traces, retaining wrinkles, sun marks, eye bags, hair and living conditions; makeup and hair are close to daily life, and family members maintain credible similarities. Do not use internet celebrity faces, uniform exquisite makeup and styles that do not meet living conditions.",
            "[Apparel and material system] Establish wardrobes such as home clothes, work clothes, school uniforms, ordinary shirts, down jackets and cloth shoes according to seasons, occupations and economic conditions, retaining wrinkles, wear and traces of repeated use; daily necessities adopt true brand neutral designs and reasonable service life, and do not create new display items.",
            "[Architectural World View] Use Chinese old communities, urban villages, ordinary residences, schools, hospitals, factories, wet markets, bus stations and county streets in a unified manner, retaining cables, drying, stains, crowded furniture and Chinese public signs; the project location shares a clear region, age and economic environment.",
            "[Image and dynamic baseline] The entire film maintains natural light, on-site mixed color temperature, moderate grain and observational performance, allowing pauses, repetitions and slight imperfections in the real environment; the dynamic style is simple and close to the characters, and does not use dazzling photography or sensational techniques of consumer suffering. The specific scheduling is determined by the storyboard.",
            "[Asset Consistency] Establish an asset library for family member appearance relationships, character wardrobes, life prop usage traces, residential layout, community facilities, and regional identification assets; wear, growth, and seasonal changes caused by time must be maintained as continuous versions.",
            "[Global Ban] Commercial advertising lighting, excessive skin polishing, exquisite model houses, European and American cities replacing Chinese local spaces, strong film filters, staged suffering, uniform Internet celebrity faces, props without traces of life, and mistaking documentaries into low-definition and dirty scenes are prohibited.",
            PROJECT_STYLE_SCOPE,
        ].join("\n"),
        imageUrl: "/short-drama-styles/real-life.jpg",
    },
];

const legacyStyleUpgrades: Partial<Record<string, ProjectStyleSelection>> = {
    "urban-live-action": { world: "urban", tone: "romantic", medium: "live-action", character: "realistic" },
    "period-live-action": { world: "historical", tone: "epic", medium: "live-action", character: "realistic" },
    "suspense-noir": { world: "suspense", tone: "dark", medium: "live-action", character: "realistic" },
    "chinese-2d": { world: "xianxia", tone: "epic", medium: "2d-guoman", character: "semi-real" },
    "ink-narrative": { world: "xianxia", tone: "healing", medium: "ink", character: "semi-real" },
    "three-d-cartoon": { world: "urban", tone: "light-comedy", medium: "3d-cartoon", character: "stylized" },
    "fantasy-3d": { world: "xianxia", tone: "epic", medium: "3d-anime", character: "semi-real" },
    "future-tech": { world: "science-fiction", tone: "epic", medium: "live-action", character: "realistic" },
    "cyberpunk-neon": { world: "science-fiction", tone: "dark", medium: "live-action", character: "realistic" },
    "space-opera": { world: "science-fiction", tone: "epic", medium: "3d-anime", character: "semi-real" },
    "nature-healing": { world: "pastoral", tone: "healing", medium: "live-action", character: "realistic" },
    "real-life-documentary": { world: "urban", tone: "healing", medium: "live-action", character: "realistic" },
};

const resolvedLegacyCanvasStylePresets = legacyCanvasStylePresets.map((preset) => {
    const upgrade = legacyStyleUpgrades[preset.id];
    if (!upgrade) return preset;
    const compiled = compileCanvasStylePreset(upgrade);
    const upgraded = { ...compiled, id: preset.id, imageUrl: preset.imageUrl };
    return { ...upgraded, profile: createStyleProfileSnapshot({ ...compiled.profile!, presetId: preset.id }) };
});

const resolvableCanvasStylePresets: CanvasStylePreset[] = [...recommendedCanvasStylePresets, ...resolvedLegacyCanvasStylePresets];

// 风格中心不靠重复卡片虚增数量；旧 ID 仍留在解析集合中，保证历史项目可以恢复。
export const canvasStylePresets: CanvasStylePreset[] = resolvableCanvasStylePresets.filter((preset, index, presets) => presets.findIndex((candidate) => candidate.prompt === preset.prompt) === index);

export function resolveCanvasStylePreset(id?: string) {
    return resolvableCanvasStylePresets.find((preset) => preset.id === id) || customCanvasStylePreset(id);
}

export function resolveProjectCanvasStyle(presetId?: string, profileJson?: string | null): CanvasStylePreset | undefined {
    const preset = resolveCanvasStylePreset(presetId);
    const profile = parseStyleProfile(profileJson);
    if (!profile) return preset;
    return {
        id: profile.presetId,
        title: profile.title,
        category: preset?.category || "Project style package",
        description: profile.description,
        tags: [...profile.tags],
        prompt: profile.prompt,
        imageUrl: profile.coverUrl || preset?.imageUrl || "/short-drama-styles/real-life.jpg",
        selection: preset?.selection,
        profile,
    };
}

const STYLE_FAVORITES_KEY = "canvas:style-library:favorites";
const STYLE_RECENT_KEY = "canvas:style-library:recent";
const LOCAL_STYLE_PROFILES_KEY = "canvas:style-library:profiles";

type StyleCenterTab = "system" | "mine" | "favorites" | "recent";
type SystemStyleLibraryItem = { kind: "system"; preset: CanvasStylePreset };
type UserStyleLibraryItem = { kind: "user"; preset: CanvasStylePreset; entity: UserStyleProfile };
type StyleLibraryItem = SystemStyleLibraryItem | UserStyleLibraryItem;
type StyleEditorState = { profile: StyleProfileSnapshot; entityId?: string };

export function CanvasStylePickerModal({ open, value, currentProfile, startInEditor = false, applying = false, onClose, onSelect }: {
    open: boolean;
    value?: string;
    currentProfile?: StyleProfileSnapshot | null;
    startInEditor?: boolean;
    applying?: boolean;
    onClose: () => void;
    onSelect: (preset: CanvasStylePreset) => void;
}) {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const theme = canvasThemes[useActiveTheme()];
    const localMode = isLocalWorkspaceMode();
    const [detailPreset, setDetailPreset] = useState<CanvasStylePreset | null>(null);
    const [tab, setTab] = useState<StyleCenterTab>("system");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All");
    const [systemFavoriteIds, setSystemFavoriteIds] = useState<string[]>([]);
    const [recentIds, setRecentIds] = useState<string[]>([]);
    const [editor, setEditor] = useState<StyleEditorState | null>(null);
    const [localProfiles, setLocalProfiles] = useState<UserStyleProfile[]>(readLocalStyleProfiles);
    const profilesQuery = useQuery({ queryKey: ["style-profiles"], queryFn: listStyleProfiles, enabled: open && !localMode });
    const profileEntities = localMode ? localProfiles : profilesQuery.data?.profiles || [];

    useEffect(() => {
        if (!open) return;
        setTab("system");
        setQuery("");
        setCategory("All");
        setSystemFavoriteIds(readStyleIds(STYLE_FAVORITES_KEY));
        setRecentIds(readStyleIds(STYLE_RECENT_KEY));
        if (localMode) setLocalProfiles(readLocalStyleProfiles());
        setEditor(startInEditor && currentProfile?.source !== "user" && currentProfile ? { profile: editableCopy(currentProfile) } : null);
    }, [currentProfile, localMode, open, startInEditor]);

    const userItems = useMemo<UserStyleLibraryItem[]>(() => profileEntities.flatMap((entity) => {
        const preset = userStylePreset(entity);
        return preset ? [{ kind: "user" as const, preset, entity }] : [];
    }), [profileEntities]);
    const systemItems = useMemo<SystemStyleLibraryItem[]>(() => canvasStylePresets.map((preset) => ({ kind: "system", preset })), []);
    const categories = useMemo(() => ["All", ...Array.from(new Set(canvasStylePresets.map((preset) => preset.category)))], []);

    useEffect(() => {
        if (!open || !startInEditor || !currentProfile || currentProfile.source !== "user" || editor || (!localMode && (profilesQuery.isFetching || profilesQuery.isError))) return;
        const sourceId = currentProfile.sourceProfileId || currentProfile.presetId;
        const sourceEntity = profileEntities.find((profile) => profile.id === sourceId);
        const sourceProfile = sourceEntity ? parseStyleProfile(sourceEntity.profileJson) : null;
        if (sourceEntity && sourceProfile) {
            setEditor({ profile: editableCopy(sourceProfile, sourceEntity.id), entityId: sourceEntity.id });
            return;
        }
        if (localMode || profilesQuery.isFetched) setEditor({ profile: editableCopy(currentProfile) });
    }, [currentProfile, editor, localMode, open, profileEntities, profilesQuery.isError, profilesQuery.isFetched, profilesQuery.isFetching, startInEditor]);

    const visibleItems = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase("en-US");
        let source: StyleLibraryItem[] = tab === "system" ? systemItems : tab === "mine" ? userItems : tab === "favorites"
            ? [...systemItems.filter((item) => systemFavoriteIds.includes(item.preset.id)), ...userItems.filter((item) => item.kind === "user" && item.entity.favorite)]
            : [...userItems.filter((item) => item.kind === "user" && item.entity.lastUsedAt).sort((a, b) => String(b.entity.lastUsedAt).localeCompare(String(a.entity.lastUsedAt))), ...recentIds.flatMap((id) => systemItems.filter((item) => item.preset.id === id))];
        if (tab === "system" && category !== "All") source = source.filter((item) => item.preset.category === category);
        if (keyword) source = source.filter((item) => `${item.preset.title} ${item.preset.category} ${item.preset.description} ${item.preset.tags.join(" ")}`.toLocaleLowerCase("en-US").includes(keyword));
        return source;
    }, [category, query, recentIds, systemFavoriteIds, systemItems, tab, userItems]);

    const saveMutation = useMutation({
        mutationFn: ({ profile, apply }: { profile: StyleProfileSnapshot; apply: boolean }) => {
            if (localMode) {
                const id = editor?.entityId || nanoid();
                const now = new Date().toISOString();
                const existing = localProfiles.find((item) => item.id === id);
                const entity: UserStyleProfile = {
                    id,
                    userId: "local",
                    name: profile.title || "unnamed style",
                    description: profile.description || "",
                    coverUrl: profile.coverUrl || "",
                    tagsJson: JSON.stringify(profile.tags || []),
                    profileJson: serializeStyleProfile(profile),
                    favorite: existing?.favorite ?? false,
                    lastUsedAt: existing?.lastUsedAt,
                    revision: (existing?.revision || 0) + 1,
                    createdAt: existing?.createdAt || now,
                    updatedAt: now,
                };
                const next = [entity, ...localProfiles.filter((item) => item.id !== id)];
                setLocalProfiles(next);
                persistLocalStyleProfiles(next);
                return Promise.resolve({ profile: entity, apply });
            }
            return editor?.entityId
                ? updateStyleProfile(editor.entityId, serializeStyleProfile(profile)).then((result) => ({ ...result, apply }))
                : createStyleProfile(serializeStyleProfile(profile)).then((result) => ({ ...result, apply }));
        },
        onSuccess: async ({ profile, apply }) => {
            await queryClient.invalidateQueries({ queryKey: ["style-profiles"] });
            const preset = userStylePreset(profile);
            setEditor(null);
            setTab("mine");
            message.success("Style saved to My Styles");
            if (apply && preset) selectItem({ kind: "user", preset, entity: profile });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "Style saving failed"),
    });
    const favoriteMutation = useMutation({
        mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => {
            if (localMode) {
                const next = localProfiles.map((item) => item.id === id ? { ...item, favorite, updatedAt: new Date().toISOString() } : item);
                setLocalProfiles(next);
                persistLocalStyleProfiles(next);
                return Promise.resolve({ id, favorite });
            }
            return setStyleProfileFavorite(id, favorite);
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["style-profiles"] }),
        onError: (error) => message.error(error instanceof Error ? error.message : "Collection status update failed"),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => {
            if (localMode) {
                const next = localProfiles.filter((item) => item.id !== id);
                setLocalProfiles(next);
                persistLocalStyleProfiles(next);
                return Promise.resolve({ id });
            }
            return deleteStyleProfile(id);
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["style-profiles"] }); message.success("style deleted"); },
        onError: (error) => message.error(error instanceof Error ? error.message : "Style deletion failed"),
    });

    function selectItem(item: StyleLibraryItem) {
        if (applying) return;
        const { preset } = item;
        const next = [preset.id, ...recentIds.filter((id) => id !== preset.id)].slice(0, 12);
        setRecentIds(next);
        localStorage.setItem(STYLE_RECENT_KEY, JSON.stringify(next));
        if (item.kind === "user") {
            if (localMode) {
                const nextProfiles = localProfiles.map((entity) => entity.id === item.entity.id ? { ...entity, lastUsedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : entity);
                setLocalProfiles(nextProfiles);
                persistLocalStyleProfiles(nextProfiles);
            } else {
                void touchStyleProfile(item.entity.id).then(() => queryClient.invalidateQueries({ queryKey: ["style-profiles"] })).catch((error) => message.warning(error instanceof Error ? error.message : "Recent usage record update failed"));
            }
        }
        onSelect(preset);
    }
    function toggleSystemFavorite(presetId: string) {
        const next = systemFavoriteIds.includes(presetId) ? systemFavoriteIds.filter((id) => id !== presetId) : [presetId, ...systemFavoriteIds];
        setSystemFavoriteIds(next);
        localStorage.setItem(STYLE_FAVORITES_KEY, JSON.stringify(next));
    }
    function createNewStyle() {
        setEditor({ profile: blankUserStyle() });
    }
    function copyPreset(preset: CanvasStylePreset) {
        setEditor({ profile: editableCopy(preset.profile || createStyleProfileSnapshot(preset), undefined, `${preset.title} copy`, preset.imageUrl) });
    }
    function confirmDelete(entity: UserStyleProfile) {
        modal.confirm({ title: `Delete "${entity.name}”？`, content: "Snapshots already saved in the project will not be deleted, but the style will be removed from My Styles.", okText: "Delete", cancelText: "Cancel", okButtonProps: { danger: true }, onOk: () => deleteMutation.mutateAsync(entity.id) });
    }

    return (
        <>
            <AppModal rootClassName="canvas-style-picker-modal" open={open} title={null} footer={null} centered width="min(1240px, calc(100vw - 24px))" onCancel={onClose} flush>
                <div className="canvas-style-center-shell flex min-h-0 flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                    <header className="flex min-h-16 flex-col gap-3 border-b px-4 py-3 pr-12 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pr-14" style={{ borderColor: theme.node.stroke }}>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold">style center</h2>
                            <p className="mt-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>System Specifications · Personal Style · Project Snapshots</p>
                        </div>
                        <div className="flex min-w-0 gap-2 sm:items-center">
                            <Input allowClear className="style-center-search min-w-0 flex-1" prefix={<Search className="size-3.5 text-foreground/35" />} value={query} placeholder="Search for a style, subject or medium" onChange={(event) => setQuery(event.target.value)} />
                            <Button type="primary" className="shrink-0" icon={<Plus className="size-3.5" />} onClick={createNewStyle}>New style</Button>
                        </div>
                    </header>
                    <div className="style-center-workspace grid min-h-0 flex-1">
                        <aside className="style-center-sidebar thin-scrollbar min-h-0 overflow-auto border-b p-2 sm:p-3 lg:border-b-0 lg:border-r" style={{ borderColor: theme.node.stroke }}>
                            <nav className="style-center-primary-nav flex gap-1 lg:flex-col" aria-label="style center view">
                                <StyleCenterNavItem active={tab === "system"} icon={<Palette className="size-3.5" />} label="system style" count={systemItems.length} onClick={() => setTab("system")} />
                                <StyleCenterNavItem active={tab === "mine"} icon={<UserRound className="size-3.5" />} label="my style" count={userItems.length} onClick={() => setTab("mine")} />
                                <StyleCenterNavItem active={tab === "favorites"} icon={<Star className="size-3.5" />} label="Collection" onClick={() => setTab("favorites")} />
                                <StyleCenterNavItem active={tab === "recent"} icon={<Clock3 className="size-3.5" />} label="Recently used" onClick={() => setTab("recent")} />
                            </nav>
                            {tab === "system" ? (
                                <div className="style-center-category-panel mt-2 border-t pt-2 lg:mt-4 lg:pt-3" style={{ borderColor: theme.node.stroke }}>
                                    <div className="hidden px-2 pb-1.5 text-[var(--fs-tiny)] font-medium lg:block" style={{ color: theme.node.muted }}>Classification</div>
                                    <nav className="style-center-category-nav flex gap-1 lg:flex-col" aria-label="System style classification">
                                        {categories.map((item) => <button key={item} type="button" aria-current={category === item ? "page" : undefined} className={`style-center-category-item h-9 shrink-0 rounded-md px-2.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 ${category === item ? "is-active font-medium" : ""}`} onClick={() => setCategory(item)}>{item}</button>)}
                                    </nav>
                                </div>
                            ) : null}
                        </aside>
                        <main className="flex min-h-0 min-w-0 flex-col">
                            <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-4" style={{ borderColor: theme.node.stroke }}>
                                <div className="min-w-0 truncate text-xs font-medium">{styleCenterViewTitle(tab, category)}</div>
                                <div className="shrink-0 text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>{visibleItems.length}  style</div>
                            </div>
                            <div className="style-center-grid thin-scrollbar min-h-0 flex-1 content-start overflow-y-auto p-3 sm:p-4">
                            {visibleItems.map((item) => (
                                <StyleCenterCard
                                    key={`${item.kind}-${item.preset.id}`}
                                    item={item}
                                    active={item.preset.id === value}
                                    applying={applying}
                                    favorite={item.kind === "user" ? item.entity.favorite : systemFavoriteIds.includes(item.preset.id)}
                                    theme={theme}
                                    onApply={() => selectItem(item)}
                                    onDetail={() => setDetailPreset(item.preset)}
                                    onFavorite={() => item.kind === "user" ? favoriteMutation.mutate({ id: item.entity.id, favorite: !item.entity.favorite }) : toggleSystemFavorite(item.preset.id)}
                                    onCopy={() => copyPreset(item.preset)}
                                    onEdit={item.kind === "user" ? () => setEditor({ profile: editableCopy(item.preset.profile!, item.entity.id), entityId: item.entity.id }) : undefined}
                                    onDelete={item.kind === "user" ? () => confirmDelete(item.entity) : undefined}
                                />
                            ))}
                            {!visibleItems.length ? <EmptyStyleCenter tab={tab} loading={!localMode && profilesQuery.isLoading} failed={!localMode && profilesQuery.isError} color={theme.node.muted} onCreate={createNewStyle} onBrowse={() => { setTab("system"); setQuery(""); }} /> : null}
                            </div>
                        </main>
                    </div>
                </div>
            </AppModal>
            <CanvasStyleDetailModal open={Boolean(detailPreset)} preset={detailPreset} selected={detailPreset?.id === value} onClose={() => setDetailPreset(null)} onSelect={(preset) => { setDetailPreset(null); const item = [...systemItems, ...userItems].find((candidate) => candidate.preset.id === preset.id); if (item) selectItem(item); }} />
            <StyleProfileEditorModal open={Boolean(editor)} initialProfile={editor?.profile || null} saving={saveMutation.isPending} onClose={() => setEditor(null)} onSave={(profile, apply) => saveMutation.mutate({ profile, apply })} />
        </>
    );
}

function readStyleIds(key: string) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 100) : [];
    } catch {
        return [];
    }
}

function readLocalStyleProfiles(): UserStyleProfile[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(LOCAL_STYLE_PROFILES_KEY) || "[]") as unknown;
        return Array.isArray(parsed) ? parsed.filter((value): value is UserStyleProfile => Boolean(value && typeof value === "object" && typeof (value as UserStyleProfile).id === "string" && typeof (value as UserStyleProfile).profileJson === "string")) : [];
    } catch {
        return [];
    }
}

function persistLocalStyleProfiles(profiles: UserStyleProfile[]) {
    try {
        localStorage.setItem(LOCAL_STYLE_PROFILES_KEY, JSON.stringify(profiles));
    } catch {
        // Private browsing or a full local quota should not make system styles unusable.
    }
}

function StyleCenterCard({ item, active, applying, favorite, theme, onApply, onDetail, onFavorite, onCopy, onEdit, onDelete }: { item: StyleLibraryItem; active: boolean; applying: boolean; favorite: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onApply: () => void; onDetail: () => void; onFavorite: () => void; onCopy: () => void; onEdit?: () => void; onDelete?: () => void }) {
    const { preset } = item;
    return (
        <article className={`style-center-card group flex min-w-0 flex-col overflow-hidden rounded-md border ${active ? "is-active" : ""}`} style={{ background: theme.canvas.background, borderColor: active ? theme.node.activeStroke : theme.node.stroke, boxShadow: active ? `inset 0 0 0 1px ${theme.node.activeStroke}` : undefined }}>
            <div className="relative overflow-hidden border-b" style={{ borderColor: theme.node.stroke }}>
                <button type="button" className="style-center-card-cover block w-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset" style={{ "--tw-ring-color": theme.node.activeStroke } as CSSProperties} onClick={onDetail} aria-label={`View${preset.title}normative`}>
                    <img src={resolveEmbeddedAssetUrl(preset.imageUrl)} width="640" height="360" alt={`${preset.title}Indicative of painting style`} className="h-full w-full object-cover transition-transform" />
                </button>
                <button type="button" className={`style-center-favorite-action absolute right-2 top-2 grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 ${favorite ? "is-active" : ""}`} onClick={onFavorite} aria-label={favorite ? "Cancel favorites" : "Collection"} title={favorite ? "Cancel favorites" : "Collection"}><Star className="size-3.5" fill={favorite ? "currentColor" : "none"} /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-3 pt-3">
                <div className="flex min-w-0 items-center gap-2 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}><span className="truncate">{item.kind === "user" ? "my style" : preset.category}</span>{active ? <span className="ml-auto flex shrink-0 items-center gap-1 font-medium" style={{ color: theme.node.activeStroke }}><Check className="size-3" />current</span> : null}</div>
                <h3 className="mt-1.5 truncate text-sm font-semibold">{preset.title}</h3>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5" style={{ color: theme.node.muted }}>{preset.description}</p>
                <div className="mt-2 flex min-h-6 flex-wrap gap-1">{preset.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-foreground/5 px-1.5 py-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{tag}</span>)}</div>
            </div>
            <footer className="mt-2 flex min-h-11 items-center gap-1 border-t px-2" style={{ borderColor: theme.node.stroke }}>
                <IconAction label="View specifications" onClick={onDetail}><Eye className="size-3.5" /></IconAction>
                <IconAction label="Copy and edit" onClick={onCopy}><Copy className="size-3.5" /></IconAction>
                {onEdit ? <IconAction label="Editing style" onClick={onEdit}><Pencil className="size-3.5" /></IconAction> : null}
                {onDelete ? <IconAction label="Delete style" danger onClick={onDelete}><Trash2 className="size-3.5" /></IconAction> : null}
                <Button type="default" size="small" className={`style-center-apply-button ml-auto ${active ? "is-current" : ""}`} disabled={active || applying} icon={active ? <Check className="size-3.5" /> : <Palette className="size-3.5" />} onClick={onApply}>{active ? "current" : "Application"}</Button>
            </footer>
        </article>
    );
}

function IconAction({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
    return <button type="button" className={`style-center-icon-action grid size-8 place-items-center rounded-md outline-none focus-visible:ring-2 ${danger ? "is-danger" : ""}`} onClick={onClick} aria-label={label} title={label}>{children}</button>;
}

function StyleCenterNavItem({ active, icon, label, count, onClick }: { active: boolean; icon: ReactNode; label: string; count?: number; onClick: () => void }) {
    return <button type="button" aria-current={active ? "page" : undefined} className={`style-center-nav-item flex h-11 min-w-fit items-center gap-2 rounded-md px-2.5 text-xs outline-none transition-colors focus-visible:ring-2 lg:w-full ${active ? "is-active font-medium" : ""}`} onClick={onClick}>{icon}<span className="whitespace-nowrap">{label}</span>{count !== undefined ? <span className="ml-auto tabular-nums opacity-55">{count}</span> : null}</button>;
}

function styleCenterViewTitle(tab: StyleCenterTab, category: string) {
    if (tab === "mine") return "my style";
    if (tab === "favorites") return "collection style";
    if (tab === "recent") return "Recently used";
    return category === "All" ? "All system styles" : category;
}

function EmptyStyleCenter({ tab, loading, failed, color, onCreate, onBrowse }: { tab: StyleCenterTab; loading: boolean; failed: boolean; color: string; onCreate: () => void; onBrowse: () => void }) {
    return <div className="col-span-full grid min-h-64 place-items-center text-center"><div><Search className="mx-auto size-5" style={{ color }} /><p className="mt-2 text-xs font-medium">{loading ? "Loading style library" : failed && tab !== "system" ? "My style failed to load, please check the login status or backend service" : tab === "mine" ? "I don’t have my own style yet" : tab === "favorites" ? "There is no collection style yet" : tab === "recent" ? "No usage record yet" : "No matching system style"}</p><div className="mt-3 flex justify-center gap-2">{tab === "mine" && !failed ? <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreate}>New style</Button> : null}<Button size="small" onClick={onBrowse}>Browse system styles</Button></div></div></div>;
}

export function userStylePreset(entity: UserStyleProfile): CanvasStylePreset | null {
    const profile = parseStyleProfile(entity.profileJson);
    if (!profile) return null;
    return { id: profile.presetId, title: profile.title, category: "my style", description: profile.description, tags: [...profile.tags], prompt: profile.prompt, imageUrl: profile.coverUrl || entity.coverUrl || "/short-drama-styles/real-life.jpg", profile };
}

function blankUserStyle(): StyleProfileSnapshot {
    return createStyleProfileSnapshot({ presetId: `draft-${nanoid()}`, title: "unnamed style", description: "", tags: [], prompt: "", assets: [], source: "user", revision: 1 });
}

function editableCopy(profile: StyleProfileSnapshot, entityId?: string, title?: string, coverUrl?: string): StyleProfileSnapshot {
    return createStyleProfileSnapshot({ ...profile, presetId: entityId || `draft-${nanoid()}`, sourceProfileId: entityId, title: title || profile.title, coverUrl: profile.coverUrl || coverUrl, source: "user", revision: entityId ? profile.revision : 1 });
}

export function CanvasStyleDetailModal({ open, preset, selected = false, onClose, onSelect }: { open: boolean; preset: CanvasStylePreset | null; selected?: boolean; onClose: () => void; onSelect?: (preset: CanvasStylePreset) => void }) {
    const theme = canvasThemes[useActiveTheme()];
    const sections = preset ? parseStyleSections(preset.prompt) : [];
    return (
        <AppModal rootClassName="canvas-style-detail-modal" open={open} title={null} footer={null} centered destroyOnHidden width="min(820px, calc(100vw - 24px))" onCancel={onClose} flush>
            {preset ? <div className="canvas-style-detail-shell flex flex-col overflow-hidden" style={{ color: theme.node.text, background: theme.node.panel }}>
                <div className="flex h-44 shrink-0 items-center justify-center overflow-hidden border-b sm:h-52" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}>
                    <img src={resolveEmbeddedAssetUrl(preset.imageUrl)} width="960" height="540" alt={`${preset.title}Indicative of painting style`} className="h-full w-full object-contain" style={preset.id === "black-white-noir" ? { filter: "grayscale(1) contrast(1.08)" } : undefined} />
                </div>
                <header className="border-b px-4 py-3 pr-12 sm:px-5 sm:pr-12" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-center gap-2 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.activeStroke }}><span>{preset.category}</span><span className="flex items-center gap-1" style={{ color: theme.node.muted }}><SlidersHorizontal className="size-3" />{preset.profile?.assets.length ? `${preset.profile.assets.length} execution assets` : "Prompt Universal"}</span></div>
                    <h2 className="mt-1 text-base font-semibold">{preset.title}</h2>
                    <p className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{preset.description}</p>
                </header>
                <div className="grid shrink-0 grid-cols-3 divide-x border-b text-[var(--fs-tiny)]" style={{ borderColor: theme.node.stroke }}>
                    <StyleDetailMetric label="Execution method" value={preset.profile?.assets.length ? "portfolio assets" : "Prompt Universal"} muted={theme.node.muted} />
                    <StyleDetailMetric label="execution strategy" value={preset.profile?.executionPolicy === "strict-assets" ? "Strict verification" : "Compatibility downgrade"} muted={theme.node.muted} />
                    <StyleDetailMetric label="snapshot version" value={`r${preset.profile?.revision || 1}`} muted={theme.node.muted} />
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5">
                    {preset.profile?.assets.length ? <section className="border-b py-3" style={{ borderColor: theme.node.stroke }}><h3 className="text-xs font-semibold">execution assets</h3><div className="mt-2 divide-y" style={{ borderColor: theme.node.stroke }}>{preset.profile.assets.map((asset) => <div key={asset.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0"><span className="block truncate font-medium">{asset.title}</span><span className="mt-0.5 block text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{kindOptionsLabel(asset.kind)} · {asset.provider}</span></span><span className="shrink-0 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>{asset.status === "validated" ? "Verified" : asset.status === "unavailable" ? "Not available" : "To be verified"}</span></div>)}</div></section> : null}
                    {sections.map((section) => <section key={section.title} className="border-b py-3 last:border-b-0" style={{ borderColor: theme.node.stroke }}><h3 className="text-xs font-semibold">{section.title}</h3><p className="mt-1.5 text-xs leading-5" style={{ color: theme.node.muted }}>{section.content}</p></section>)}
                    {preset.profile?.negativePrompt ? <section className="border-b py-3 last:border-b-0" style={{ borderColor: theme.node.stroke }}><h3 className="text-xs font-semibold">Global Negative Prompt</h3><p className="mt-1.5 whitespace-pre-wrap text-xs leading-5" style={{ color: theme.node.muted }}>{preset.profile.negativePrompt}</p></section> : null}
                </div>
                <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3 sm:px-5" style={{ borderColor: theme.node.stroke }}><Button onClick={onClose}>Close</Button>{onSelect ? <Button type="primary" disabled={selected} icon={selected ? <Check className="size-3.5" /> : <Palette className="size-3.5" />} onClick={() => onSelect(preset)}>{selected ? "Current style" : "Choose this style"}</Button> : null}</footer>
            </div> : null}
        </AppModal>
    );
}

function StyleDetailMetric({ label, value, muted }: { label: string; value: string; muted: string }) {
    return <div className="min-w-0 px-3 py-2.5 text-center"><span className="block" style={{ color: muted }}>{label}</span><span className="mt-0.5 block truncate font-medium">{value}</span></div>;
}

function kindOptionsLabel(kind: string) {
    return kind === "lora" ? "LoRA" : kind === "template" ? "Picture template" : kind === "reference" ? "Reference picture group" : "prompt word module";
}

function parseStyleSections(prompt: string) {
    return prompt.split("\n").map((line) => {
        const match = line.match(/^【([^】]+)】(.*)$/);
        return match ? { title: match[1], content: match[2] } : { title: "Supplementary specifications", content: line };
    }).filter((section) => section.content);
}
