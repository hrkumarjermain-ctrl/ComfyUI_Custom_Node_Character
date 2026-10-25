const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendPath = path.join(__dirname, "..", "web", "character_architect_v17.js");
let source = fs.readFileSync(frontendPath, "utf8");
source = source.replace(
    'import { app } from "../../scripts/app.js";',
    "const app = { registerExtension() {}, graph: { setDirtyCanvas() {} } };",
);
source += `
return {
    CANONICAL_WIDGET_ORDER,
    V500_CANONICAL_WIDGET_ORDER,
    V450_CANONICAL_WIDGET_ORDER,
    V440_CANONICAL_WIDGET_ORDER,
    V430_CANONICAL_WIDGET_ORDER,
    restoreOrderForValues,
    GROUPS,
    COMPOSITION_ARCHETYPE_CONTROL_KEYS,
    prepareCompositionArchetypeOnce,
    applySceneScenarioExclusivityOnce,
};`;

const frontend = new Function(source)();
assert.equal(frontend.CANONICAL_WIDGET_ORDER.length, frontend.V500_CANONICAL_WIDGET_ORDER.length + 1);
assert.equal(frontend.V500_CANONICAL_WIDGET_ORDER.length, frontend.V450_CANONICAL_WIDGET_ORDER.length + 2);
assert.equal(frontend.V450_CANONICAL_WIDGET_ORDER.length, frontend.V440_CANONICAL_WIDGET_ORDER.length + 1);
assert.equal(frontend.V440_CANONICAL_WIDGET_ORDER.length, frontend.V430_CANONICAL_WIDGET_ORDER.length + 1);
assert.equal(
    frontend.CANONICAL_WIDGET_ORDER[frontend.CANONICAL_WIDGET_ORDER.indexOf("portrait_style") - 1],
    "composition_archetype",
);
assert.deepEqual(
    frontend.restoreOrderForValues(new Array(frontend.V440_CANONICAL_WIDGET_ORDER.length)),
    frontend.V440_CANONICAL_WIDGET_ORDER,
);
assert.strictEqual(
    frontend.restoreOrderForValues(new Array(frontend.V430_CANONICAL_WIDGET_ORDER.length)),
    frontend.V430_CANONICAL_WIDGET_ORDER,
);

const compositionGroup = frontend.GROUPS.find((group) => group.id === "composition");
assert.equal(compositionGroup.keys[0], "composition_archetype");
const customInputsGroup = frontend.GROUPS.find((group) => group.id === "custom_inputs");
assert.equal(customInputsGroup.keys[0], "face_hair_text_override");
assert.match(source, /emphasizeArchetypeWidget\(byName\.get\("composition_archetype"\)\)/);
assert.match(source, /"COMPOSITION ARCHETYPE"/);

function widget(name, value, values = ["None", "Random", "Forced Random", "manual"]) {
    return { name, value, options: { values } };
}

const widgets = new Map();
widgets.set("composition_archetype", widget("composition_archetype", "Direct Headshot", ["None", "Random", "Forced Random", "Direct Headshot"]));
widgets.set("scene_scenario", widget("scene_scenario", "None", ["None", "Random", "Forced Random", "scenario"]));
for (const key of frontend.COMPOSITION_ARCHETYPE_CONTROL_KEYS) {
    widgets.set(key, widget(key, "manual"));
}
frontend.prepareCompositionArchetypeOnce(widgets, () => true);
for (const key of frontend.COMPOSITION_ARCHETYPE_CONTROL_KEYS) {
    assert.equal(widgets.get(key).value, "Random");
}

widgets.get("composition_archetype").value = "Direct Headshot";
widgets.get("scene_scenario").value = "scenario";
widgets.get("pose").value = "manual";
widgets.set("setting", widget("setting", "manual"));
frontend.applySceneScenarioExclusivityOnce(widgets, false, false);
assert.equal(widgets.get("composition_archetype").value, "None");
assert.equal(widgets.get("pose").value, "None");
assert.equal(widgets.get("setting").value, "None");

console.log("Frontend v4.4 Composition Archetype checks passed");
