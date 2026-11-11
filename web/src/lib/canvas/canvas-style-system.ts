import type { StyleProfileSnapshot } from "@/lib/canvas/style-profile";

export type ProjectStyleWorldId = "xianxia" | "urban" | "historical" | "suspense" | "science-fiction" | "pastoral";
export type ProjectStyleToneId = "epic" | "dark" | "light-comedy" | "romantic" | "healing";
export type ProjectStyleMediumId = "live-action" | "3d-anime" | "3d-cartoon" | "2d-guoman" | "ink";
export type ProjectStyleCharacterId = "realistic" | "semi-real" | "anime" | "stylized";

export type ProjectStyleSelection = {
    world: ProjectStyleWorldId;
    tone: ProjectStyleToneId;
    medium: ProjectStyleMediumId;
    character: ProjectStyleCharacterId;
};

export type CanvasStylePreset = {
    id: string;
    title: string;
    category: string;
    description: string;
    tags: string[];
    prompt: string;
    imageUrl: string;
    selection?: ProjectStyleSelection;
    profile?: StyleProfileSnapshot;
};

type StyleOption<T extends string> = {
    id: T;
    label: string;
    description: string;
    prompt: string;
    palette?: string;
    wardrobe?: string;
    environment?: string;
    motion?: string;
    forbidden: string;
};

export const projectStyleWorlds: Array<StyleOption<ProjectStyleWorldId>> = [
    {
        id: "xianxia",
        label: "Xianxia",
        description: "Sects, fairy cities, caves, seas of clouds and magic rules together constitute the world of Eastern practice.",
        prompt: "The world of Oriental Xianxia is based on sects, realms, magical weapons, spiritual beasts and the order of cause and effect; wonders evolve from Chinese landscapes, wooden buildings, Taoist imagery and practice systems, and all locations share clear rules of time, geography and power.",
        palette: "Cloud white, dark blue, sapphire, cinnabar, bronze and camp energy colors",
        wardrobe: "Robes, costumes, armor, sect patterns, hair crowns, waistbands and magic weapons establish a stable asset hierarchy based on identity and camp.",
        environment: "Mountain gates, palaces, pavilions, caves, fairy cities, seas of clouds, ancient battlefields and mortal towns adopt Chinese structures and oriental landscape spaces",
        motion: "The movement of swords, body movements, spells and robes must have momentum, accumulation, force reception and landing points. The power level is expressed through scale and environmental feedback.",
        forbidden: "European castle, Gothic church, Japanese torii gate, Western magic circle, random game UI, sect and spell rule drift",
    },
    {
        id: "urban",
        label: "contemporary city",
        description: "Organize modern short dramas based on believable Chinese cities, professional identities and life relationships.",
        prompt: "The contemporary Chinese urban world is based on occupation, family, income, community and urban public life; character actions, spatial functions, Chinese signs and living facilities must conform to the clear urban and social context.",
        palette: "Neutral white, matte gray, light wood, cement color and restrained character identification color",
        wardrobe: "Clothing creates a wardrobe based on occupation, income, season and personality, and fixed accessories serve as role identification",
        environment: "Offices, apartments, schools, hospitals, shopping malls, neighborhoods, communities and public transportation maintain local scale and traces of use",
        motion: "The performance is close to the daily focus, pauses and micro-expressions, and the camera movement serves the character relationship and information disclosure.",
        forbidden: "European and American city replacement, empty model rooms, incorrect Chinese, clothing without professional logic, internet celebrity filters and advertising posing",
    },
    {
        id: "historical",
        label: "Costume history",
        description: "First, lock in a single era, and then unify the etiquette system, Taoism, utensils and architecture.",
        prompt: "The historical world must first lock in a unique dynasty or era sub-type based on the story, and the character system, etiquette, clothing, weapons, utensils, transportation and architecture all obey the same research baseline.",
        palette: "Off-white, dark gray, wood brown, earthy yellow, indigo, bamboo green and limited cinnabar gold",
        wardrobe: "The shape of lapels, sleeves, belts, hats, shoes and patterns establish systems based on era, class and status.",
        environment: "Timber structures, courtyards, cloisters, towns, palaces, countryside and roads follow the structure and materials of the selected era.",
        motion: "Character movements take into account etiquette, clothing weight, weapon inertia and specific life labor.",
        forbidden: "Dynasty mix and match, modern zipper furniture, Japanese or European architecture, plastic accessories and modern idol makeup",
    },
    {
        id: "suspense",
        label: "Mysterious crime",
        description: "Real urban textures, clue systems and psychological pressure form a readable suspense world.",
        prompt: "The modern suspense world is composed of cases, secrets, identity relationships and traceable clues. The location layout, key props, scars and timelines must be stable, and information hiding cannot sacrifice the readability of the screen.",
        palette: "Charcoal gray, cold cement, old wood, dirty yellow live lights and a small amount of dangerous accent colors",
        wardrobe: "Create versions of professional clothing, uniforms, casual clothes and key personal belongings by identity and timeline",
        environment: "Old residential buildings, office spaces, streets, warehouses, underground spaces and suburban facilities remain in the same urban area",
        motion: "Observation, following, blocking and reaction shots serve to reveal clues and avoid treating shaking as suspense",
        forbidden: "Darkness becomes unreadable, sea of neon lights, excessive smoke, plasma curiosity, villain facial makeup and clue asset deformation",
    },
    {
        id: "science-fiction",
        label: "future science fiction",
        description: "Technical rules, social structures and functional spaces jointly support future narratives.",
        prompt: "The future world must first determine the technological level, energy, transportation, communication and social organization rules; scientific and technological assets have understandable functions, interfaces and usage restrictions, and spectacles must reflect the scale of civilization rather than randomly stacking luminous objects.",
        palette: "Deep space black, cool gray, silver white, cabin white and single camp or energy accent color",
        wardrobe: "Work clothes, uniforms, aerospace or protective equipment are modularly designed according to function and camp",
        environment: "Ships, space stations, future cities, experimental facilities and living spaces follow a logic of structure, maintenance and lighting",
        motion: "Motion reflects equipment weight, inertia, space constraints and technical feedback",
        forbidden: "Non-functioning HUD, random neon lights, realistic brands, technical rule drift, equipment interface changes and no scale reference",
    },
    {
        id: "pastoral",
        label: "natural countryside",
        description: "Region, season, life, labor and natural environment all participate in the narrative.",
        prompt: "The natural rural world is based on clear regions, seasons, family relationships and daily labor; plants, weather, residences, tools and markets are not decorations, but real environments that continue to participate in the changes in characters' actions and relationships.",
        palette: "Leaf green, moss green, earth color, old wood, sky color, off-white and seasonal character point colors",
        wardrobe: "Cotton and linen, knitting, old denim, work clothes, rain gear and handmade crops retain wrinkles and traces of use",
        environment: "There is regional evidence in village houses, forest cabins, farms, river banks, vegetable gardens, markets and small town edges.",
        motion: "Wind, rain, plants, animals and small life movements form natural rhythms",
        forbidden: "Commercial B&B advertising feel, alternative European and American countryside, random seasonal changes, no traces of life and excessive aerial photography",
    },
];

export const projectStyleTones: Array<StyleOption<ProjectStyleToneId>> = [
    {
        id: "epic",
        label: "grand narrative",
        description: "Use scale, order and the fate of characters to create an epic feel, without relying on darkness and special effects throughout the whole process.",
        prompt: "The narrative temperament is solemn, broad, and has the weight of history and destiny; the grand scene is responsible for establishing the relationship between space and power, the character shots are responsible for undertaking choices and costs, and the priority between spectacle and performance is kept clear.",
        palette: "High-brightness space levels, stable camp colors and a small amount of highlight colors, retaining details in dark areas",
        motion: "Establish a restrained and measured shot, a clear start and end to the climactic movement, and a pause in the characters' reactions.",
        forbidden: "The entire film is low-light, endless slow-motion, aerial photography in every shot, special effects covering the characters, only scale and no emotional focus.",
    },
    {
        id: "dark",
        label: "Dark and strange",
        description: "The unknown, taboo and psychological pressure form a dark temperament while keeping the message readable.",
        prompt: "The narrative temperament is dangerous, restrained, and has a sense of unknown; fear comes from space, rules, and character reactions, and does not rely on blood plasma, all-black scenes, or continuous screaming.",
        palette: "Low-key but readable warm and cold divisions, dangerous colors are only used for taboos, hostility or clues",
        motion: "More observation, blocking, slow reveals and reaction pauses, bursts of movement only for key breaks",
        forbidden: "Darkness becomes unreadable, bloody curiosity, cheap red and black filters, full-screen smoke, unsourced flash and continuous lens shake",
    },
    {
        id: "light-comedy",
        label: "light comedy",
        description: "The macro situation contrasts with the characters' serious reactions, and the picture is bright but not childish.",
        prompt: "The narrative temperament is relaxed, smart, and humane; the laughter relies on character relationships, reactions, pauses, and situational contrasts, allowing the grand world to carry small-person humor, and does not equate comedy with exaggerated grimaces.",
        palette: "Clear and bright mid- and high-brightness colors keep characters and backgrounds steadily separated, and dangerous scenes avoid becoming scary and blackened.",
        motion: "Actions have clear preparation, placement and comedic pauses, and reaction shots and serious performances take precedence over dazzling stunts.",
        forbidden: "The spooky tone, children's show candy colors, all the characters making faces, fast cuts and laughs drowned out by special effects",
    },
    {
        id: "romantic",
        label: "Beautiful and romantic",
        description: "Use character distance, light and environmental details to express relationship changes and avoid filtering the sugary feeling.",
        prompt: "The narrative quality is delicate, implicit, and full of relationship tension; romance comes from sight, distance, touch, environmental changes, and unspoken emotions, and does not rely on random petals and continuous soft focus.",
        palette: "Natural skin color, soft warm and cool relationship and restrained emotional coloring",
        motion: "The camera is close to the characters and details, the movement is slow and emotionally motivated, and breathing and pauses are retained.",
        forbidden: "Soft focus throughout, overexposed skin tones, random petals, MV style empty shots, performance-free slow motion and filter drift",
    },
    {
        id: "healing",
        label: "Warmth heals",
        description: "Warmth is created through life actions, environmental touch, and relationship repair, rather than generalized soft light.",
        prompt: "The narrative temperament is warm, relaxed and concrete; healing comes from visible care, labor, companionship and relationship changes, and environmental materials and natural sounds participate in emotional expression.",
        palette: "Natural medium brightness, warm but not too yellow, retaining the true layers of wood, cloth, plants and skin color",
        motion: "Observe small movements, breathing, eyes and environmental responses, the rhythm is relaxed but not empty",
        forbidden: "Cream filter throughout the film, excessive warm yellow, natural empty shots without plot, advertising-style sophistication and characters always smiling",
    },
];

export const projectStyleMedia: Array<StyleOption<ProjectStyleMediumId> & { characters: ProjectStyleCharacterId[] }> = [
    {
        id: "live-action",
        label: "Real shots",
        description: "Real actors, believable optics, docility and physical environment.",
        prompt: "Using live-action film and television shooting media: real character proportions, natural skin and hair, credible lens optics and on-site light sources, clothing, architecture, props and special effects maintain realistic material responses.",
        motion: "Actions follow true center of gravity, inertia, weight of clothing, and physical camera movement",
        forbidden: "Animated characters, game CG, plastic skin, excessive skin grinding, fake studio shots and materials without physical basis",
        characters: ["realistic", "semi-real"],
    },
    {
        id: "3d-anime",
        label: "3D animation",
        description: "High-quality three-dimensional animation, oriental animation modeling and cinematic scenes.",
        prompt: "Use high-quality 3D animation media: crisp 3D volumes, unified PBR or stylized PBR materials, controlled subsurface scattering, stable topology, and cinematic lighting; maintain the design sense of animated characters without slipping into the uncanny valley of live-action or cheap game cutscenes.",
        motion: "The animation has clear key postures, preparatory movements, following, force and pauses, and the special effects and character movements share the same space and lighting.",
        forbidden: "Cheap mobile game CG, reflective plastic figures, stiff standby movements, real skin with pores, inconsistent character and background rendering systems",
        characters: ["semi-real", "anime"],
    },
    {
        id: "3d-cartoon",
        label: "3D cartoon",
        description: "Stylized proportions, clear silhouettes, soft materials and readable expressions.",
        prompt: "Employing the medium of stylized 3D cartoon animation: clean geometry, crisp silhouettes, semi-matte materials, soft subsurface scattering, and readable expressions; scenes and characters use the same system of rounded corners, roughness, and detail density.",
        motion: "Character movements use moderate squeeze, stretch, follow, ease in and out, and clear pauses. The exaggeration is based on a stable skeleton and joint structure.",
        forbidden: "Plastic dolls, all characters have the same face, oversized glass eyes, stiff T Pose, joint molding and realistic assets mixed in",
        characters: ["stylized"],
    },
    {
        id: "2d-guoman",
        label: "Chinese comics 2D",
        description: "Stable line drawing, cel characters and oriental painting system.",
        prompt: "The 2D animation medium of Chinese comics is adopted: stable line drawing with varying thickness, two to three levels of cel shading, clear character silhouettes and oriental painting layers; the whole project maintains the two-dimensional painting language.",
        motion: "Using clear key poses and limited but accurate two-dimensional movements, mouth shapes, hair, clothing and special effects follow a unified inter-frame rhythm.",
        forbidden: "Three-dimensional plastic texture, real-life photos, line width drift, character face-turning distortion, background and character drawing methods are inconsistent",
        characters: ["semi-real", "anime", "stylized"],
    },
    {
        id: "ink",
        label: "Ink animation",
        description: "Rice paper, ink scale, brushstrokes and white space form a recognizable oriental narrative.",
        prompt: "Chinese ink animation medium is used: rice paper fiber, dry and wet brushstrokes, flying white, accumulated ink, broken ink and limited fine brush strokes; white space, ink levels and fixed point colors jointly shape the space and character identity.",
        motion: "Outline goes first, strokes follow, and ink growth and dissipation follow unified rules, and the character structure remains identifiable despite changes.",
        forbidden: "Random splashes of ink, disappearance of characters’ facial features, Western-style watercolors, full-screen dirty gray, cheap paper grain filters and random text stamps",
        characters: ["semi-real", "stylized"],
    },
];

export const projectStyleCharacters: Array<StyleOption<ProjectStyleCharacterId>> = [
    {
        id: "realistic",
        label: "realistic characters",
        description: "Real bones, age, skin and body proportions.",
        prompt: "The character adopts real East Asian bones, natural age and real body proportions, and establishes differences through face shape, facial features, hairstyle, body shape, posture and traces of life; retaining natural skin and micro-expressions.",
        forbidden: "Internet celebrities have the same face, excessive skin polishing, juvenile big eyes, age drift, European and American default faces and exaggerated anime proportions",
    },
    {
        id: "semi-real",
        label: "Semi-realistic human simulation",
        description: "Oriental bones are balanced with idealized shapes, retaining a believable structure.",
        prompt: "The character adopts a semi-realistic oriental shape: the skeleton, muscle and joint structure are believable, the facial features are moderately idealized but age and identity differences are retained; the hair, skin and clothing details obey the chosen medium and do not enter the uncanny valley.",
        forbidden: "Real scan stiffness, unified idol face, excessive realism at pore level, false eyelash template and body proportion drift",
    },
    {
        id: "anime",
        label: "anime characters",
        description: "Slender proportions, clear facial features and stable character silhouette.",
        prompt: "The character adopts an oriental animation style: about 7 to 8 heads and body, with facial features, hair strands, eye shapes and clothing structure highly identifiable; exaggeration focuses on design language and expression without destroying the stability of body structure and identity.",
        forbidden: "Young and big head, oversized glass eyes, random hair color, all characters have the same face shape, facial features drift when changing faces",
    },
    {
        id: "stylized",
        label: "stylized cartoon",
        description: "Exaggerated proportions and readable expressions serve comedy and lighthearted storytelling.",
        prompt: "Characters adopt uniform stylized cartoon proportions: about 5 to 6 heads and bodies for adults and 3.5 to 4.5 heads and bodies for children. The heads and hands can be moderately exaggerated; significant differences are established through eye, nose and mouth proportions, hairstyle, body shape and silhouette.",
        forbidden: "All characters have the same face, random changes in head and body, oversized glass eyes, incorrect joint structure, plastic toy feel and stiff expressions",
    },
];

export const defaultProjectStyleSelection: ProjectStyleSelection = {
    world: "xianxia",
    tone: "epic",
    medium: "3d-anime",
    character: "semi-real",
};

const STYLE_SCOPE = "[Boundaries of use] This specification locks in the project-level theme world, narrative temperament, visual media, character modeling, asset materials and image baselines. The plot action, composition, scenery, camera position, camera movement, light source position and weather of a single shot are created by storyboards in accordance with this specification, and project-level descriptions may not be mechanically copied.";

export function compatibleProjectStyleCharacters(mediumId: ProjectStyleMediumId) {
    const allowed = projectStyleMedia.find((item) => item.id === mediumId)?.characters || [];
    return projectStyleCharacters.filter((item) => allowed.includes(item.id));
}

export function compileCanvasStylePreset(selection: ProjectStyleSelection): CanvasStylePreset {
    const world = requiredOption(projectStyleWorlds, selection.world);
    const tone = requiredOption(projectStyleTones, selection.tone);
    const medium = requiredOption(projectStyleMedia, selection.medium);
    const compatibleCharacters = compatibleProjectStyleCharacters(selection.medium);
    const character = compatibleCharacters.find((item) => item.id === selection.character) || compatibleCharacters[0];
    const resolvedSelection = { ...selection, character: character.id };
    const title = `${world.label} · ${tone.label} · ${medium.label}`;
    const preset = {
        id: styleSelectionId(resolvedSelection),
        title,
        category: `${world.label} / ${medium.label}`,
        description: `${world.description}${tone.description}${medium.description}`,
        tags: [world.label, tone.label, medium.label, character.label],
        imageUrl: stylePreviewImage(resolvedSelection),
        selection: resolvedSelection,
        prompt: [
            `[Style combination] Theme world:${world.label}; Narrative temperament:${tone.label};Visual media:${medium.label};Character modeling:${character.label}. The following four items must be true at the same time, and subsequent characters, scenes, storyboards, and videos must not replace any of the dimensions without authorization.`,
            `[Project positioning] Oriented to "${world.label}"Theme${tone.label}${medium.label}The project uses unified world rules, character assets and visual media to support continuous narrative; project specifications only define long-term stable art baselines and do not replace single-shot director design.`,
            `[Theme Worldview]${world.prompt}`,
            `[narrative temperament]${tone.prompt}`,
            `【Visual media】${medium.prompt} The finished film maintains high-definition readable subject outlines, stable textures, and controlled highlights; high-definition does not mean over-sharpening, smoothing, or sourceless bloom.`,
            `【Character Design System】${character.prompt}`,
            `[Project color and light and shadow] The basic color comes from${world.palette}; This project uses${tone.palette}. Colors are allocated according to character, camp, location and narrative function to ensure stable brightness and hue separation between characters and the environment.`,
            `[Costumes, Materials and Scenes]${world.wardrobe}；${world.environment}. All materials and detail densities follow "${medium.label}"Media, not mixed with other rendering systems.`,
            `[Image and dynamic baseline]${tone.motion}；${medium.motion}；${world.motion}. Storyboarding must first determine the narrative intention of the shot, and then choose the scene and shot.`,
            "[Asset Consistency] Characters have fixed face shapes, facial features proportions, hairstyles, heads and bodies, clothing, props, and camp colors; main scenes have fixed space layouts, building modules, materials, and lighting baselines; clothing changes, damage, upgrades, and time changes must form a clear asset version.",
            `[Global disable]${world.forbidden}；${tone.forbidden}；${medium.forbidden}；${character.forbidden}。`,
            STYLE_SCOPE,
        ].join("\n"),
    } satisfies CanvasStylePreset;
    return { ...preset, profile: createBuiltinStyleProfile(preset) };
}

function createBuiltinStyleProfile(preset: Omit<CanvasStylePreset, "profile">): StyleProfileSnapshot {
    return {
        schemaVersion: 1,
        presetId: preset.id,
        title: preset.title,
        description: preset.description,
        tags: [...preset.tags],
        prompt: preset.prompt,
        selection: preset.selection ? { ...preset.selection } : undefined,
        assets: [],
        executionPolicy: "compatible-fallback",
        source: "builtin",
        revision: 1,
    };
}

export function parseCanvasStyleSelection(id?: string): ProjectStyleSelection | null {
    if (!id?.startsWith("v2-")) return null;
    const parts = id.slice(3).split("--");
    if (parts.length !== 4) return null;
    const selection = { world: parts[0], tone: parts[1], medium: parts[2], character: parts[3] } as ProjectStyleSelection;
    if (!projectStyleWorlds.some((item) => item.id === selection.world)
        || !projectStyleTones.some((item) => item.id === selection.tone)
        || !projectStyleMedia.some((item) => item.id === selection.medium)
        || !projectStyleCharacters.some((item) => item.id === selection.character)) return null;
    return selection;
}

export function customCanvasStylePreset(id?: string) {
    const selection = parseCanvasStyleSelection(id);
    return selection ? compileCanvasStylePreset(selection) : undefined;
}

const recommendedSelections: ProjectStyleSelection[] = [
    { world: "xianxia", tone: "epic", medium: "3d-anime", character: "semi-real" },
    { world: "xianxia", tone: "dark", medium: "3d-anime", character: "semi-real" },
    { world: "xianxia", tone: "light-comedy", medium: "3d-cartoon", character: "stylized" },
    { world: "xianxia", tone: "epic", medium: "live-action", character: "realistic" },
    { world: "urban", tone: "light-comedy", medium: "live-action", character: "realistic" },
    { world: "suspense", tone: "dark", medium: "live-action", character: "realistic" },
    { world: "pastoral", tone: "healing", medium: "3d-cartoon", character: "stylized" },
    { world: "historical", tone: "romantic", medium: "2d-guoman", character: "semi-real" },
];

export const recommendedCanvasStylePresets = recommendedSelections.map(compileCanvasStylePreset);

function styleSelectionId(selection: ProjectStyleSelection) {
    return `v2-${selection.world}--${selection.tone}--${selection.medium}--${selection.character}`;
}

function stylePreviewImage(selection: ProjectStyleSelection) {
    if (selection.world === "xianxia") {
        if (selection.medium === "live-action") return "/short-drama-styles/period-live-action.jpg";
        if (selection.medium === "3d-cartoon") return "/short-drama-styles/three-d-cartoon.jpg";
        if (selection.medium === "2d-guoman") return "/short-drama-styles/chinese-2d.jpg";
        if (selection.medium === "ink") return "/short-drama-styles/ink-narrative.jpg";
        return "/short-drama-styles/fantasy-3d.jpg";
    }
    if (selection.world === "suspense") return "/short-drama-styles/suspense-noir.jpg";
    if (selection.world === "science-fiction") return "/short-drama-styles/future-tech.jpg";
    if (selection.world === "pastoral") return "/short-drama-styles/nature-healing.jpg";
    if (selection.world === "historical") return selection.medium === "2d-guoman" ? "/short-drama-styles/chinese-2d.jpg" : "/short-drama-styles/period-live-action.jpg";
    return selection.medium === "3d-cartoon" ? "/short-drama-styles/three-d-cartoon.jpg" : "/short-drama-styles/urban-live-action.jpg";
}

function requiredOption<T extends string>(options: Array<StyleOption<T>>, id: T) {
    const option = options.find((item) => item.id === id);
    if (!option) throw new Error(`Unknown project style options:${id}`);
    return option;
}
