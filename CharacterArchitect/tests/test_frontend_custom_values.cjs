const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendPath = path.join(__dirname, "..", "web", "character_architect_v17.js");
let source = fs.readFileSync(frontendPath, "utf8");
source = source.replace(
    'import { app } from "../../scripts/app.js";',
    `let registeredExtension;
const app = {
    registerExtension(extension) { registeredExtension = extension; },
    graph: { setDirtyCanvas() {} },
};`,
);
source += `
return { registeredExtension, CANONICAL_WIDGET_ORDER, GROUPS, storeCustomValues, restoreCustomValues };`;

const frontend = new Function(source)();

// Shown in the Custom inputs section of the node.
const customInputs = frontend.GROUPS.find((group) => group.id === "custom_inputs");
assert.ok(customInputs.keys.includes("custom_values"));

// Not part of the positional layout, so historical workflows restore unchanged.
assert.equal(frontend.CANONICAL_WIDGET_ORDER.includes("custom_values"), false);

function makeNode(customValue) {
    return {
        properties: {},
        widgets: [
            ...frontend.CANONICAL_WIDGET_ORDER.map((name) => ({ name, value: "None" })),
            { name: "custom_values", value: customValue },
        ],
    };
}

// Saving puts the text in the node properties.
const saved = makeNode("origin_age=24 to 26 years old\nbody_type=1.80 m tall");
const data = { properties: { cpf_group_locks: { body: true } } };
frontend.storeCustomValues(saved, data);
assert.equal(data.properties.cpf_custom_values, "origin_age=24 to 26 years old\nbody_type=1.80 m tall");
assert.deepEqual(data.properties.cpf_group_locks, { body: true });

// Loading restores it; a workflow without the property leaves the default alone.
const loaded = makeNode("");
frontend.restoreCustomValues(loaded, data);
assert.equal(loaded.widgets.at(-1).value, "origin_age=24 to 26 years old\nbody_type=1.80 m tall");
const older = makeNode("");
frontend.restoreCustomValues(older, { properties: {} });
assert.equal(older.widgets.at(-1).value, "");

// The serialize hook keeps widgets_values canonical and adds the property.
function NodeType() {}
NodeType.prototype.serialize = function () {
    return { properties: { ...this.properties }, widgets_values: this.widgets.map((widget) => widget.value) };
};
frontend.registeredExtension.beforeRegisterNodeDef(NodeType, { name: "CharacterPromptFactory" });
const node = Object.assign(new NodeType(), makeNode("hair_color=copper"));
const serialized = node.serialize();
assert.equal(serialized.widgets_values.length, frontend.CANONICAL_WIDGET_ORDER.length);
assert.equal(serialized.properties.cpf_custom_values, "hair_color=copper");

console.log("custom values frontend: ok");
