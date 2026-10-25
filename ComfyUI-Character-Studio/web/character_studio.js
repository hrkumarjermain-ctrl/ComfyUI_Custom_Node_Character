// Character Architect Studio — ComfyUI extension entry point.
// Adds an "Open Character Studio" button to Character Architect nodes and to
// subgraph nodes that contain one, plus a sidebar tab, menu entries and commands.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { CharacterStudio } from "./cs_studio.js";
import { containsCharacterNode, findCharacterNode, findStudioTargets, graphNodes, isCharacterNode } from "./cs_graph.js";
import { fill, h } from "./cs_dom.js";

const LAUNCHER_LABEL = "🎭 Open Character Studio";
const OPEN_COMMAND = "CharacterArchitect.Studio.Open";
const PACK_COMMAND = "CharacterArchitect.Studio.PackSubgraph";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = new URL("./character_studio.css", import.meta.url).href;
document.head.append(stylesheet);

const studio = new CharacterStudio(app, api);
studio.onHostCreated = (node) => ensureLauncher(node);

function ensureLauncher(node) {
    if (!node || typeof node.addWidget !== "function" || !containsCharacterNode(node)) return;
    if (!(node.widgets ?? []).some((widget) => widget?.__casLauncher)) {
        const widget = node.addWidget("button", LAUNCHER_LABEL, null, () => studio.open(node), { serialize: false });
        if (widget) {
            widget.__casLauncher = true;
            widget.serialize = false;
            widget.label = LAUNCHER_LABEL;
        }
    }
    if (!node.__casMenu) {
        node.__casMenu = true;
        const original = node.getExtraMenuOptions;
        node.getExtraMenuOptions = function (canvas, options) {
            const result = original?.apply(this, arguments);
            if (containsCharacterNode(this)) {
                options?.push?.(null, { content: LAUNCHER_LABEL, callback: () => studio.open(this) });
            }
            return result;
        };
    }
}

let scanTimer = null;
function scheduleLauncherScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        const graphs = new Set([app.graph, app.canvas?.graph].filter(Boolean));
        for (const graph of graphs) for (const node of graphNodes(graph)) ensureLauncher(node);
    }, 400);
}

function describeTarget(node) {
    if (isCharacterNode(node)) return node.constructor?.nodeData ? "Character Architect node" : "Character Architect node · not installed";
    const inner = findCharacterNode(node.subgraph);
    return inner?.graph === node.subgraph ? "subgraph" : "nested subgraph";
}

function renderSidebar(container) {
    const paint = () => {
        const targets = findStudioTargets(app.graph);
        fill(container, h("div", { class: "cas-sidebar" },
            h("div", { class: "cas-sidebar-head" },
                h("span", { class: "cas-sidebar-title" }, "Character Studio"),
                h("button", { class: "cas-sidebar-btn", title: "Rescan the workflow", onclick: paint }, "↻"),
            ),
            targets.length
                ? targets.map((node) => h("div", { class: "cas-sidebar-item" },
                    h("div", { class: "cas-sidebar-name" }, node.title || "Character Architect"),
                    h("div", { class: "cas-sidebar-meta" }, `#${node.id} · ${describeTarget(node)}`),
                    h("div", { class: "cas-sidebar-actions" },
                        h("button", { class: "cas-sidebar-btn primary", onclick: () => studio.open(node) }, "Open Studio"),
                        isCharacterNode(node) && h("button", {
                            class: "cas-sidebar-btn",
                            title: "Pack this pipeline into one subgraph node",
                            onclick: async () => {
                                await studio.packIntoSubgraph(node);
                                paint();
                            },
                        }, "Pack as subgraph"),
                    ),
                ))
                : h("p", { class: "cas-sidebar-empty" },
                    "No Character Architect node in this workflow yet. Load your Character Architect workflow or add the node, then open the Studio from here, from the node's button, or from its right-click menu."),
        ));
    };
    paint();
}

app.registerExtension({
    name: "CharacterArchitect.Studio",

    commands: [
        {
            id: OPEN_COMMAND,
            label: "Open Character Studio",
            icon: "pi pi-user-edit",
            function: () => studio.open(),
        },
        {
            id: PACK_COMMAND,
            label: "Pack Character Architect pipeline into a subgraph",
            icon: "pi pi-box",
            function: () => studio.packIntoSubgraph(),
        },
    ],

    menuCommands: [
        { path: ["Extensions", "Character Architect"], commands: [OPEN_COMMAND, PACK_COMMAND] },
    ],

    async setup() {
        studio.attachEvents();
        api.addEventListener("graphChanged", scheduleLauncherScan);
        try {
            const tab = {
                id: "character-architect-studio",
                icon: "pi pi-user-edit",
                title: "Character Studio",
                tooltip: "Character Architect Studio",
                type: "custom",
                render: renderSidebar,
            };
            const manager = app.extensionManager;
            if (manager?.sidebarTab?.registerSidebarTab) manager.sidebarTab.registerSidebarTab(tab);
            else manager?.registerSidebarTab?.(tab);
        } catch (error) {
            console.warn("[Character Studio] sidebar tab unavailable", error);
        }
        scheduleLauncherScan();
    },

    nodeCreated(node) {
        // Character Architect rebuilds its widget list right after creation;
        // add the button after that pass.
        setTimeout(() => ensureLauncher(node), 0);
    },

    loadedGraphNode(node) {
        setTimeout(() => ensureLauncher(node), 0);
    },

    afterConfigureGraph() {
        scheduleLauncherScan();
    },
});
