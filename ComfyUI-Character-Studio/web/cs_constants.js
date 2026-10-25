// Character Architect Studio — static schema.
// Section layout and random/reset rules mirror the Character Architect node
// frontend (schema v31 / public v5.1.1) so the Studio and the node behave the same.

export const CPF_CLASS = "CharacterPromptFactory";

// Lock groups exactly as the node frontend stores them in
// node.properties.cpf_group_locks. Locks are shared with the canvas node.
export const LOCK_GROUPS = {
    composition: {
        label: "Media / camera / composition",
        keys: ["composition_archetype", "portrait_style", "enforce_portrait_framing", "capture_style", "pose", "pose_mood", "setting", "scene_scenario", "camera_direction", "head_direction", "eye_focus", "camera_angle", "shot_composition", "lens_style", "lighting_style", "optical_effect"],
    },
    body: {
        label: "Body",
        keys: ["body_archetype", "origin_age", "origin_ethnicity", "body_type", "body_physique", "body_feminine_curves", "bust", "butt_shape", "thigh_shape", "body_detail_1", "body_detail_2", "body_detail_3", "body_hair", "skin_finish"],
    },
    face: {
        label: "Face",
        keys: ["expression", "mouth_expression", "eye_expression", "face_shape", "jawline", "chin_shape", "eye_shape", "eye_color", "eyelashes", "eyebrows", "nose_shape", "lip_shape", "facial_hair"],
    },
    hair: {
        label: "Hair",
        keys: ["hair_color", "hair_texture", "hair_style", "hair_cut", "hair_length", "bangs_style"],
    },
    tattoos_makeup: {
        label: "Tattoos / make-up",
        keys: ["tattoo_style", "makeup_eye", "makeup_lips", "nail_style", "makeup_complexion"],
    },
    clothes_shoes: {
        label: "Clothes, sleepwear, cosplay and shoes",
        keys: ["clothing_archetype", "neckline", "neckwear", "top_type", "sleeve_length", "top_color", "bottom_type", "bottom_length", "bottom_color", "lingerie_type", "lingerie_color", "sleepwear_type", "sleepwear_color", "cosplay_type", "cosplay_color", "cosplay_franchise_western", "cosplay_franchise_asian", "hosiery", "hosiery_color", "dress_type", "dress_color", "outerwear", "outerwear_color", "outerwear_wearing_style", "belt", "belt_color", "footwear", "footwear_color"],
    },
    accessories: {
        label: "Accessories",
        keys: ["accessories_jewelry", "accessories_necklace", "accessories_earrings", "accessories_bracelet", "accessories_rings", "head_accessory", "accessories_glasses", "armwear", "accessories_bag", "accessories_scarf"],
    },
    custom_inputs: {
        label: "Custom inputs / wildcards",
        keys: ["face_hair_text_override", "setting_text_override", "pose_text_override", "custom_color_overrides", "wildcard_subject", "wildcard_clothing", "wildcard_pose", "wildcard_setting", "wildcard_photography"],
    },
    override_inspection: {
        label: "Override and inspection",
        keys: ["override_field", "inspect_property"],
    },
};

export const KEY_TO_LOCK_GROUP = new Map(
    Object.entries(LOCK_GROUPS).flatMap(([id, group]) => group.keys.map((key) => [key, id])),
);

// Studio navigation. Several sections can share one lock group.
export const SECTIONS = [
    {
        id: "subject", label: "Subject", lock: null,
        keys: ["media_type", "gender", "content_rating", "species_mode", "origin_age", "origin_ethnicity", "ethnicity_guidance", "enhance_realism"],
        hint: "Pivots for the whole character. The lock next to Media, Gender and Rating protects that field from global Random / Reset.",
    },
    {
        id: "body", label: "Body", lock: "body",
        keys: ["body_archetype", "body_type", "body_physique", "body_feminine_curves", "bust", "butt_shape", "thigh_shape", "body_detail_1", "body_detail_2", "body_detail_3", "body_hair", "skin_finish"],
        hint: "The archetype leads fields left on Random; manual and Forced Random values stay authoritative.",
    },
    {
        id: "face", label: "Face", lock: "face",
        keys: ["expression", "mouth_expression", "eye_expression", "face_shape", "jawline", "chin_shape", "eye_shape", "eye_color", "eyelashes", "eyebrows", "nose_shape", "lip_shape", "facial_hair"],
        hint: "Ethnicity Guidance can constrain compatible Random traits; explicit picks always win.",
    },
    {
        id: "hair", label: "Hair", lock: "hair",
        keys: ["hair_color", "hair_texture", "hair_style", "hair_cut", "hair_length", "bangs_style"],
        hint: "Colour, texture, style, cut, length and bangs combine freely.",
    },
    {
        id: "makeup", label: "Make-up & Ink", lock: "tattoos_makeup",
        keys: ["makeup_eye", "makeup_lips", "makeup_complexion", "nail_style", "tattoo_style"],
        hint: "Random nails are removed automatically when full gloves are detected.",
    },
    {
        id: "outfit", label: "Outfit", lock: "clothes_shoes", divider: true,
        keys: ["clothing_archetype", "top_type", "sleeve_length", "top_color", "neckline", "neckwear", "bottom_type", "bottom_length", "bottom_color", "dress_type", "dress_color", "outerwear", "outerwear_color", "outerwear_wearing_style", "hosiery", "hosiery_color", "belt", "belt_color", "footwear", "footwear_color"],
        hint: "Main garment families are mutually exclusive for ordinary Random. Shares its lock with Sets & Cosplay.",
    },
    {
        id: "sets", label: "Sets & Cosplay", lock: "clothes_shoes",
        keys: ["lingerie_type", "lingerie_color", "sleepwear_type", "sleepwear_color", "cosplay_type", "cosplay_color", "cosplay_franchise_western", "cosplay_franchise_asian"],
        hint: "Alternative garment families. Shares its lock with Outfit.",
    },
    {
        id: "accessories", label: "Accessories", lock: "accessories",
        keys: ["accessories_jewelry", "accessories_necklace", "accessories_earrings", "accessories_bracelet", "accessories_rings", "head_accessory", "accessories_glasses", "armwear", "accessories_bag", "accessories_scarf", "scarf_color"],
        hint: "Head accessories, glasses, armwear, bags and scarves are protected from the global Random button.",
    },
    {
        id: "scene", label: "Scene & Pose", lock: "composition", divider: true,
        keys: ["composition_archetype", "portrait_style", "enforce_portrait_framing", "capture_style", "pose", "pose_mood", "setting", "scene_scenario"],
        hint: "Composition Archetype coordinates framing, pose and camera. Scene scenario is a rare exclusive branch. Shares its lock with Camera & Light.",
    },
    {
        id: "camera", label: "Camera & Light", lock: "composition",
        keys: ["camera_direction", "head_direction", "eye_focus", "camera_angle", "shot_composition", "lens_style", "lighting_style", "optical_effect"],
        hint: "Camera framing and light. Shares its lock with Scene & Pose.",
    },
    {
        id: "text", label: "Text & Wildcards", lock: "custom_inputs", divider: true, pipelineText: true,
        keys: ["free_prompt_position", "free_prompt", "custom_values", "face_hair_text_override", "setting_text_override", "pose_text_override", "custom_color_overrides", "wildcard_subject", "wildcard_clothing", "wildcard_pose", "wildcard_setting", "wildcard_photography"],
        hint: "Free prompt, your custom field values (one field=value per line), structured overrides and wildcard lines, plus the plain prompt fields of the surrounding pipeline.",
    },
    {
        id: "inspect", label: "Override & Inspect", lock: "override_inspection",
        keys: ["override_field", "inspect_property"],
        hint: "A connected Override text replaces the selected field after every other rule. Inspect exposes one resolved value.",
    },
];

export const ARCHETYPE_KEYS = new Set(["composition_archetype", "body_archetype", "clothing_archetype"]);

// Pivot fields and the boolean widget that locks each one.
export const PIVOT_LOCKS = new Map([
    ["media_type", "lock_media_type"],
    ["gender", "lock_gender"],
    ["content_rating", "lock_content_rating"],
]);

// Widgets the Studio never shows as character fields.
export const HIDDEN_CHARACTER_KEYS = new Set([
    "seed", "control_after_generate", "control_after_generate#1",
    "lock_media_type", "lock_gender", "lock_content_rating",
    "cleavage_depth", "cleavage_type",
]);

// Same protection rules as the node frontend's SET ALL RANDOM / RESET buttons.
export const RANDOM_PROTECTED_KEYS = new Set([
    "cleavage_depth", "cleavage_type",
    "body_hair", "facial_hair", "skin_finish", "makeup_complexion",
    "head_accessory", "accessories_glasses", "armwear", "accessories_bag", "accessories_scarf",
    "outerwear", "outerwear_color", "outerwear_wearing_style",
    "free_prompt_position", "clothing_archetype", "scene_scenario", "optical_effect", "enforce_portrait_framing",
    "override_field", "inspect_property",
]);
export const GLOBAL_PIVOT_KEYS = new Set(["ethnicity_guidance", "enhance_realism"]);
export const SET_RANDOM_SKIP_KEYS = new Set(["free_prompt", "seed", "control_after_generate", "override_field", "inspect_property"]);

export const SPECIAL_VALUES = new Set(["None", "Random", "Forced Random", "Female Random", "Male Random"]);

export const BODY_GENDER_PROFILE_WIDGETS = new Set([
    "body_archetype", "body_type", "body_physique", "body_feminine_curves",
    "bust", "butt_shape", "thigh_shape", "body_detail_1", "body_detail_2", "body_detail_3",
]);
export const CLOTHING_GENDER_PROFILE_WIDGETS = new Set([
    "clothing_archetype", "top_type", "bottom_type", "lingerie_type", "sleepwear_type",
    "cosplay_type", "cosplay_franchise_western", "cosplay_franchise_asian",
    "dress_type", "outerwear", "belt", "footwear", "neckwear",
]);
const MALE_GENDERS = ["man", "male", "transgender man", "androgynous femboy"];
const FEMALE_GENDERS = ["woman", "female", "transgender woman", "androgynous tomboy"];

export const FIELD_LABELS = {
    media_type: "Media", gender: "Gender", content_rating: "Rating", species_mode: "Species",
    origin_age: "Age", origin_ethnicity: "Origin", ethnicity_guidance: "Ethnicity guidance",
    enhance_realism: "Enhance realism",
    body_archetype: "Body archetype", body_type: "Height", body_physique: "Physique",
    body_feminine_curves: "Silhouette", bust: "Chest", butt_shape: "Glutes", thigh_shape: "Thighs",
    body_detail_1: "Body detail 1", body_detail_2: "Body detail 2", body_detail_3: "Body detail 3",
    body_hair: "Body hair", skin_finish: "Skin finish",
    expression: "Expression", mouth_expression: "Mouth", eye_expression: "Gaze",
    face_shape: "Face shape", jawline: "Jawline", chin_shape: "Chin", eye_shape: "Eye shape",
    eye_color: "Eye colour", eyelashes: "Lashes", eyebrows: "Brows", nose_shape: "Nose",
    lip_shape: "Lips", facial_hair: "Facial hair",
    hair_color: "Colour", hair_texture: "Texture", hair_style: "Style", hair_cut: "Cut",
    hair_length: "Length", bangs_style: "Bangs",
    makeup_eye: "Eye make-up", makeup_lips: "Lip make-up", makeup_complexion: "Complexion",
    nail_style: "Nails", tattoo_style: "Tattoos",
    clothing_archetype: "Clothing archetype", neckline: "Neckline", neckwear: "Neckwear",
    top_type: "Top", sleeve_length: "Sleeves", top_color: "Top colour",
    bottom_type: "Bottom", bottom_length: "Bottom length", bottom_color: "Bottom colour",
    dress_type: "Dress", dress_color: "Dress colour", outerwear: "Outerwear",
    outerwear_color: "Outerwear colour", outerwear_wearing_style: "Outerwear worn",
    hosiery: "Hosiery", hosiery_color: "Hosiery colour", belt: "Belt", belt_color: "Belt colour",
    footwear: "Footwear", footwear_color: "Footwear colour",
    lingerie_type: "Lingerie", lingerie_color: "Lingerie colour", sleepwear_type: "Sleepwear",
    sleepwear_color: "Sleepwear colour", cosplay_type: "Cosplay", cosplay_color: "Cosplay colour",
    cosplay_franchise_western: "Western franchise", cosplay_franchise_asian: "Asian franchise",
    accessories_jewelry: "Jewellery", accessories_necklace: "Necklace", accessories_earrings: "Earrings",
    accessories_bracelet: "Bracelet", accessories_rings: "Rings", head_accessory: "Head",
    accessories_glasses: "Glasses", armwear: "Armwear", accessories_bag: "Bag",
    accessories_scarf: "Scarf", scarf_color: "Scarf colour",
    composition_archetype: "Composition archetype", portrait_style: "Framing",
    enforce_portrait_framing: "Enforce framing", capture_style: "Capture", pose: "Pose",
    pose_mood: "Pose mood", setting: "Setting", scene_scenario: "Scenario",
    camera_direction: "Camera direction", head_direction: "Head direction", eye_focus: "Eye focus",
    camera_angle: "Camera angle", shot_composition: "Shot", lens_style: "Lens",
    lighting_style: "Lighting", optical_effect: "Optics",
    free_prompt_position: "Free prompt position", free_prompt: "Free prompt",
    face_hair_text_override: "Face / hair override", setting_text_override: "Setting override",
    pose_text_override: "Pose override", custom_color_overrides: "Colour overrides", custom_values: "Custom values",
    wildcard_subject: "Wildcard · subject", wildcard_clothing: "Wildcard · clothing",
    wildcard_pose: "Wildcard · pose", wildcard_setting: "Wildcard · setting",
    wildcard_photography: "Wildcard · photography",
    override_field: "Override field", inspect_property: "Inspect property",
};

// Fields outside Character Architect's category list that still accept custom text.
export const CUSTOM_VALUE_EXTRA_FIELDS = ["eye_focus", "mouth_expression"];

// Example text shown in the custom-value box.
export const CUSTOM_VALUE_EXAMPLES = {
    origin_age: "24 to 26 years old",
    origin_ethnicity: "Ethiopian Amhara",
    body_type: "1.80 m tall",
    body_physique: "lean swimmer's build",
    hair_color: "copper with blonde balayage",
    hair_length: "hair just past the shoulder blades",
    eye_color: "grey-green",
    expression: "a faint, knowing smile",
    setting: "a rain-soaked Tokyo side street at night",
    pose: "leaning on a railing, one foot crossed over the other",
};

// Pipeline widgets surfaced at the top of Settings.
export const ESSENTIAL_WIDGETS = new Map([
    ["unet_name", "Diffusion model"],
    ["ckpt_name", "Checkpoint"],
    ["clip_name", "Text encoder"],
    ["clip_name1", "Text encoder 1"],
    ["clip_name2", "Text encoder 2"],
    ["clip_name3", "Text encoder 3"],
    ["vae_name", "VAE"],
    ["aspect_ratio", "Aspect ratio"],
    ["megapixels", "Megapixels"],
    ["width", "Width"],
    ["height", "Height"],
]);

// Settings groups, matched against the node class in this order.
export const PIPELINE_ROLES = [
    { id: "output", label: "Outputs", test: /^(SaveImage|PreviewImage|PreviewAny)$|ShowText|Display/i },
    { id: "seeds", label: "Seeds", test: /seed/i },
    { id: "models", label: "Models & LoRAs", test: /Loader|Lora|Enhancer|ModelSampling|unet|gguf/i },
    { id: "sampling", label: "Sampling", test: /Sampler|Scheduler|Sigmas|Guider|Noise/i },
    { id: "latent", label: "Resolution & Latent", test: /Resolution|Latent/i },
    { id: "prompt", label: "Prompt & Conditioning", test: /TextEncode|Conditioning|positive|negative|String|Prompt|Text/i },
    { id: "vae", label: "Encode / Decode", test: /VAEDecode|VAEEncode/i },
    { id: "post", label: "Upscale & Post", test: /Upscale|Sharpen|Filter|Color|Colour|Blur|Grain|LAB|Adjust|Image/i },
    { id: "other", label: "Other", test: /.*/ },
];

export const NODE_MODES = [
    { mode: 0, label: "Active" },
    { mode: 4, label: "Bypass" },
    { mode: 2, label: "Mute" },
];

const COLOR_WORDS = {
    burgundy: "#6b1f2e", cream: "#efe6cf", camel: "#c09a63", blush: "#e8b4b8", charcoal: "#3b3d40",
    champagne: "#f7e7ce", emerald: "#2e8b57", mustard: "#d4a017", nude: "#e3bc9a", wine: "#722f37",
    rust: "#b7410e", sage: "#9caf88", mint: "#98e8b8", mauve: "#b784a7", taupe: "#8b8589",
    denim: "#3b5b92", cobalt: "#0047ab", lilac: "#c8a2c8", pastel: "#f4c2c2", leopard: "#c19a6b",
    metallic: "#b8b8b8", rose: "#e8909c", copper: "#b87333", bronze: "#cd7f32",
    ruby: "#9b111e", sapphire: "#0f52ba", jade: "#00a86b", forest: "#228b22", sky: "#87ceeb",
    blonde: "#e6c98f", platinum: "#e5e4e2", auburn: "#a52a2a", chestnut: "#954535", espresso: "#4b3621",
    hazel: "#8e7618", amber: "#ffbf00",
};

export function colorSwatch(value) {
    if (typeof value !== "string") return null;
    const words = canonicalChoice(value).toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
    for (let index = words.length - 1; index >= 0; index -= 1) {
        const word = words[index];
        if (COLOR_WORDS[word]) return COLOR_WORDS[word];
        if (globalThis.CSS?.supports?.("color", word)) return word;
    }
    return null;
}

export function genderTag(value) {
    return /^\((female|unisex|male)\)\s+/i.exec(String(value))?.[1]?.toLowerCase() ?? null;
}

export function canonicalChoice(value) {
    return typeof value === "string" ? value.replace(/^\((?:female|unisex|male)\)\s+/i, "") : value;
}

// Port of the node frontend's genderAwareVisibleValues: hides options that do
// not fit the chosen gender. The current value is always kept by the caller.
export function genderAwareValues(widgetName, values, genderValue) {
    if (!Array.isArray(values)) return values;
    const gender = canonicalChoice(genderValue);
    const tagged = (value) => genderTag(value) ?? undefined;
    if (BODY_GENDER_PROFILE_WIDGETS.has(widgetName)) {
        if (widgetName === "body_archetype") {
            if (MALE_GENDERS.includes(gender)) {
                const filtered = values.filter((value) => tagged(value) === "male");
                return filtered.length ? filtered : values;
            }
            if (FEMALE_GENDERS.includes(gender)) return values.filter((value) => tagged(value) !== "male");
        }
        if (MALE_GENDERS.includes(gender)) return values.filter((value) => ["male", "unisex", undefined].includes(tagged(value)));
        if (FEMALE_GENDERS.includes(gender)) return values.filter((value) => ["female", "unisex", undefined].includes(tagged(value)));
    }
    if (CLOTHING_GENDER_PROFILE_WIDGETS.has(widgetName)) {
        if (["androgynous femboy", "androgynous tomboy"].includes(gender)) return values;
        if (widgetName === "clothing_archetype" && ["man", "male", "transgender man"].includes(gender)) {
            const filtered = values.filter((value) => tagged(value) === "male");
            return filtered.length ? filtered : values;
        }
        if (["man", "male", "transgender man"].includes(gender)) return values.filter((value) => ["male", "unisex", undefined].includes(tagged(value)));
        if (["woman", "female", "transgender woman"].includes(gender)) return values.filter((value) => ["female", "unisex", undefined].includes(tagged(value)));
    }
    return values;
}

export function humanize(name) {
    const text = String(name ?? "").replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
    return text ? text[0].toUpperCase() + text.slice(1) : "";
}

// Phase 2: nodes titled "Turnaround · …" form the turnaround stage.
export const TURNAROUND_ROLE = { id: "turnaround", label: "Turnaround (phase 2)" };

// Engine settings surfaced in the Turnaround view, by widget name.
export const TURNAROUND_SETTINGS = new Map([
    ["denoise", "Change amount"],
    ["megapixels", "Working size (MP)"],
    ["resolution", "Reference size"],
    ["steps", "Steps"],
    ["unet_name", "Model"],
    ["clip_name", "Text encoder"],
    ["vae_name", "VAE"],
]);
