const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendPath = path.join(__dirname, "..", "web", "character_architect_v17.js");
let source = fs.readFileSync(frontendPath, "utf8");
source = source.replace(
    'import { app } from "../../scripts/app.js";',
    "const app = { registerExtension() {} };",
);
source += `
return {
    CANONICAL_WIDGET_ORDER,
    V500_CANONICAL_WIDGET_ORDER,
    V450_CANONICAL_WIDGET_ORDER,
    V440_CANONICAL_WIDGET_ORDER,
    V430_CANONICAL_WIDGET_ORDER,
    V420_CANONICAL_WIDGET_ORDER,
    V410_CANONICAL_WIDGET_ORDER,
    V400_CANONICAL_WIDGET_ORDER,
    restoreOrderForValues,
    normalizeRestoredValue,
    GROUPS,
    CUSTOM_WIDGET_LABELS,
};`;

const frontend = new Function(source)();
const active = frontend.CANONICAL_WIDGET_ORDER;
const v500 = frontend.V500_CANONICAL_WIDGET_ORDER;
const v450 = frontend.V450_CANONICAL_WIDGET_ORDER;
const v440 = frontend.V440_CANONICAL_WIDGET_ORDER;
const v430 = frontend.V430_CANONICAL_WIDGET_ORDER;
const v420 = frontend.V420_CANONICAL_WIDGET_ORDER;
const v410 = frontend.V410_CANONICAL_WIDGET_ORDER;
const v400 = frontend.V400_CANONICAL_WIDGET_ORDER;

assert.equal(active.length, v500.length + 1);
assert.equal(v500.length, v450.length + 2);
assert.equal(v450.length, v440.length + 1);
assert.equal(v440.length, v430.length + 1);
assert.equal(v430.length, v420.length + 1);
assert.equal(v420.length, v410.length + 2);
assert.equal(v410.length, v400.length + 10);
assert.equal(active[active.indexOf("gender") + 1], "content_rating");
assert.equal(active[active.indexOf("lock_gender") + 1], "lock_content_rating");
assert.equal(active[active.indexOf("species_mode") + 1], "enforce_portrait_framing");
assert.equal(active[active.indexOf("portrait_style") - 1], "composition_archetype");
assert.equal(active.at(-1), "face_hair_text_override");
assert.equal(active[active.indexOf("top_type") + 1], "sleeve_length");

assert.strictEqual(frontend.restoreOrderForValues(new Array(active.length)), active);
assert.deepEqual(frontend.restoreOrderForValues(new Array(v500.length)), v500);
assert.deepEqual(frontend.restoreOrderForValues(new Array(v450.length)), v450);
assert.deepEqual(frontend.restoreOrderForValues(new Array(v440.length)), v440);
assert.strictEqual(frontend.restoreOrderForValues(new Array(v430.length)), v430);
assert.strictEqual(frontend.restoreOrderForValues(new Array(v420.length)), v420);
assert.strictEqual(frontend.restoreOrderForValues(new Array(v410.length)), v410);
assert.strictEqual(frontend.restoreOrderForValues(new Array(v400.length)), v400);

const ratingWidget = {
    name: "content_rating",
    options: { values: ["None", "Random", "Forced Random", "normal", "glamour/sexy/explicit"] },
};
for (const legacyValue of ["glamour", "sexy", "explicit", "glamour / sexy / explicit"]) {
    assert.equal(
        frontend.normalizeRestoredValue(ratingWidget, legacyValue),
        "glamour/sexy/explicit",
    );
}

const composition = frontend.GROUPS.find((group) => group.id === "composition");
assert.ok(composition);
assert.ok(!composition.keys.includes("media_type"));
assert.ok(!composition.keys.includes("lock_media_type"));
assert.equal(composition.keys[0], "composition_archetype");
assert.equal(composition.keys[1], "portrait_style");
assert.equal(composition.keys[2], "enforce_portrait_framing");

for (const [key, label] of frontend.CUSTOM_WIDGET_LABELS) {
    assert.equal(label, key);
}

assert.match(source, /Math\.random\(\) >= 0\.10/);
assert.match(source, /setWidgetValue\(widgetMap\(node\)\.get\("scene_scenario"\), "Random"\)/);

console.log("Frontend v4.4 migration, layout, and scenario checks passed");
