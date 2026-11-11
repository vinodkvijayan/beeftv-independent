import type { CreationMode } from "./creation-types";

export type CreationInspiration = { title: string; description: string; image: string; mode: CreationMode; prompt: string; featured?: boolean; source?: string };

export const creationFeaturedWorks: CreationInspiration[] = [
    {
        title: "Neon on a rainy night·movie-like opening",
        description: "Widescreen compositions, ambient reflections and slow-moving shots",
        image: "/short-drama-styles/cyberpunk-neon.jpg",
        mode: "video",
        prompt: "At a city street entrance on a rainy night, neon lights are reflected on the wet road. The protagonist holds an umbrella and walks through the crowd. The camera slowly advances from a long shot to a close-up of the profile, film light and shadow, 16:9",
        featured: true,
    },
    {
        title: "Hong Kong style rooftop reunion",
        description: "Retro colors and restrained character emotions",
        image: "/short-drama-styles/retro-hong-kong.jpg",
        mode: "video",
        prompt: "Hong Kong style rooftop in the 1990s, backlit at dusk, two old friends who have not seen each other for many years look at each other across the clothesline, the wind blows the clothes corners, the camera is slightly held and slowly approaches",
    },
    {
        title: "Suspense chase in dark alley",
        description: "High-contrast film noir and intense rhythm",
        image: "/short-drama-styles/suspense-noir.jpg",
        mode: "video",
        prompt: "In the style of a black and white suspense movie, the detective chases a mysterious man in a narrow dark alley. The street lights create strong light and dark. The camera follows the camera from a low position and the rhythm gradually accelerates.",
    },
    {
        title: "Oriental fantasy character setting",
        description: "Character concept drawings and delicate material expressions",
        image: "/short-drama-styles/fantasy-3d.jpg",
        mode: "image",
        prompt: "The character setting of a young female swordsman in an oriental fantasy world, with silver hair accessories, layered light armor and red cloak, mountain fog background, delicate materials, movie-level concept design",
    },
    {
        title: "Warm indoor dialogue",
        description: "Life-like scenes and soft narrative atmosphere",
        image: "/welcome/wing-it/barn.webp",
        mode: "text",
        prompt: "Please help me write a mother-daughter dialogue scene that takes place in a living room with warm lighting: the daughter is preparing to leave her hometown, and the mother is calm on the surface but has been sorting out old things, using actions and subtext to advance the emotion.",
    },
    { title: "last letter in the forest", description: "Fairy tale narrative · Building conflict from character wishes", image: "/short-drama-styles/storybook-fantasy.jpg", mode: "text", source: "Storyteller", prompt: "As a storyteller, write a forest fairy tale about persistence for parent-child audiences. The protagonist is a little fox who delivers letters for animals. It must deliver a letter without an address before the first snowfall. First give the character's wishes and obstacles, then design three progressive events, and finally use a visible action to complete the emotional transition. Avoid preaching." },
    { title: "Stranger on the last bus", description: "Short play screenwriter · Let the dialogue hide the true purpose", image: "/short-drama-styles/urban-live-action.jpg", mode: "text", source: "Screenwriter", prompt: "As a screenwriter, design a three-minute short play that takes place on the last bus. Both strangers claim to have lost a notebook, but only one tells the truth. First define the characters' motivations, scene constraints, and the information they conceal, and then write the action, dialogue, and twist ending. The whole play is limited to two characters and one scene, making it suitable for low-cost real-life shooting." },
    { title: "The memory repairman of the future city", description: "Science Fiction Outline · World Rules and Character Costs", image: "/short-drama-styles/future-tech.jpg", mode: "text", source: "Novelist", prompt: "As a novelist, I would like to conceive a futuristic urban short story about a memory repairman. City residents can delete painful memories, but the protagonist discovers that each time they delete, a color is lost. Establishing three world rules, the protagonist's core flaw, five twists, and a costly ending. Deliver the story outline first, rather than writing a long story directly." },
    { title: "Write farewell as a rain", description: "Poetic narration · Less explanation, more sensory details", image: "/short-drama-styles/nature-healing.jpg", mode: "text", source: "Poet", prompt: "As a poet, I wrote four sets of Chinese narrations for an image of leaving home in the rain, each set not exceeding forty characters. Use smell, touch, sound and light to express farewell respectively. Do not directly use emotional words such as sadness, reluctance or missing. Use plain, readable language and give each group a pause." },
    { title: "A summer story with a bottle of drink", description: "Advertising planning · Crowds, propositions and three lenses", image: "/short-drama-styles/real-life.jpg", mode: "text", source: "Advertiser", prompt: "As an advertising planner, design a fifteen-second spot for a sugar-free sparkling drink targeting young commuters. Define the target group, the core scene and a communication proposition, and then provide the images, duration, sound effects and subtitles of the three shots. Don’t make up nutritional or efficacy data, tell the story with a refreshing after-get off work sip." },
    { title: "The visual language of an independent coffee shop", description: "Brand Creativity · Let color matching and tone of voice say the same thing", image: "/short-drama-styles/retro-hong-kong.jpg", mode: "text", source: "Creative Branding Strategist", prompt: "As a brand strategist, come up with three visual directions for a quiet independent coffee shop in the neighborhood. The brand values ​​slow pace, neighborliness and craftsmanship. Each direction includes color, photography atmosphere, text tone, three social content themes and differentiation reasons. Don’t imitate the logos of existing chain brands." },
    { title: "Conduct a shot diagnosis on the script", description: "Creative review · Propose revisions from narrative to sound", image: "/short-drama-styles/black-white-noir.jpg", mode: "text", source: "Film Critic", prompt: "Please review the script or storyboard I provide below from the perspective of a film critic, and provide feedback from the five dimensions of narrative, characters, composition, camerawork and sound. Each comment quotes the footage I provided and gives a modification that would work for actual filming. If you haven't received the materials yet, ask me for them first, and don't pretend to have seen the video." },
    { title: "Textual research on the street scenes of the old city", description: "Historical Scenes · Distinguish between historical fact, speculation and fiction", image: "/short-drama-styles/period-live-action.jpg", mode: "text", source: "Historian", prompt: "As a historical researcher, I assisted me in designing film and television scenes of urban street scenes in the early Republic of China. First ask about the specific year, place and class of people, and then make a textual research list of clothing, transportation, signboards, architecture and daily language. Clearly distinguish between historical facts with sources, reasonable speculations and dramatic fictions, and do not fabricate documents." },
    { title: "Walking Alone on the Moon", description: "Long shot to close-up · The loneliness of space exploration", image: "/short-drama-styles/space-opera.jpg", mode: "video", prompt: "In the wasteland on the back of the moon, the astronaut walked alone to an abandoned antenna. The camera slowly advances from an extreme long shot, low-angle sunlight casts a long shadow on the moon dust, the steps are heavy, the helmet reflects the starlight, the cold colors are suppressed, the composition of a wide-screen movie, without subtitles." },
    { title: "Handmade planet breakfast", description: "Stop motion animation · Soft materials and small movements", image: "/short-drama-styles/clay-stop-motion.jpg", mode: "video", prompt: "Clay stop-motion animation style, a little astronaut is frying a star-shaped egg in a circular kitchen, and the egg jumps gently. Hand-made fingerprint texture, warm cream color, soft side light, fixed mid-range, short and continuous movements, cute but not exaggerated." },
    { title: "A boat between mountains and rivers", description: "Ink white space·lateral lens shift and light fog", image: "/short-drama-styles/ink-narrative.jpg", mode: "video", prompt: "Chinese ink animation, a small boat slowly passes through the distant mountains, the mist is white, and the people on the boat raise their hands to touch the falling petals. The camera moves smoothly and horizontally, the ink color is naturally smudged, and there is a small amount of vermilion embellishment. The picture is quiet and the action rhythm is slow." },
    { title: "Glass greenhouse after rain", description: "Healing scene·Foreground water drops and backlight", image: "/short-drama-styles/nature-healing.jpg", mode: "video", prompt: "In the glass greenhouse after the early morning rain, the camera slowly pushes towards the blooming white flowers through the leaves with water droplets hanging on them. The sunlight enters from the side and behind, with shallow depth of field, real plant textures, thin water vapor in the air, tranquility and nature, without people or words." },
    { title: "Urban girl role change", description: "Character concept · Unify clothing and body proportions", image: "/short-drama-styles/chinese-2d.jpg", mode: "image", prompt: "Original 2D animation urban girl character setting, short hair, loose work jacket and canvas bag, three views from the front, side and back, clothing details and height proportions are consistent, clean line drawing with flat shading, warm gray background, no text added, no imitation of existing anime characters." },
    { title: "The upside-down room in a dream", description: "Surreal concept · Gravity reversal and soft light", image: "/short-drama-styles/surreal-dream.jpg", mode: "image", prompt: "Concept image of a surreal movie scene, an upside-down bedroom floating in a sea of clouds, with a bed and desk suspended from the ceiling and a door leading to a light pink sky. Low saturation cream and mist blue, soft diffuse reflection, precise perspective, delicate material, no figures, no text." },
    { title: "Dusk at the seaside hotel", description: "Real shooting scenes · Use props to leave traces of characters", image: "/short-drama-styles/urban-live-action.jpg", mode: "image", prompt: "Concept map of a movie set in an old hotel room in a coastal town. Outside the window is the sea at dusk, the wind is blowing the off-white curtains, and there are two cups of unfinished tea and an open book on the table. Warm orange and light blue contrast, natural film grain, eye-level medium wide angle, no characters or readable text." },
    { title: "Bright comic cover", description: "Plane composition · Large color blocks and dramatic perspective", image: "/short-drama-styles/comic-pop.jpg", mode: "image", prompt: "Original comic cover illustration, a city messenger on a bicycle leaping over puddles after rain, dramatic low-angle perspective, large color blocks of cyan blue, coral red and warm yellow, half-tone dots, clear black outline, simple background, leaving space for the top title but no text is generated." },
    { title: "The bakery’s secret helper", description: "Three-dimensional characters · Soft textures and friendly expressions", image: "/short-drama-styles/three-d-cartoon.jpg", mode: "image", prompt: "Original three-dimensional animated character concept drawing, a little raccoon wearing a flour apron stands in front of the baking table, with flour on the tip of his nose and holding freshly baked bread in his hand. Soft hair, warm side light, natural and lovely proportions, orange brown and cream white color scheme, slightly blurred background." },
];

export const inspirationSource = {
    repository: "https://github.com/f/awesome-chatgpt-prompts",
    revision: "f78a1c5136fa080155d928e0d7e2b4a41ddef03e",
    license: "CC0-1.0",
    notice: "Eight text templates were adapted from translations of public domain prompt words; the rest were written for this project. The cover reuse project has a schematic diagram, which does not represent the actual generated results.",
};
