// Character Architect Studio — full-screen character creator over a
// Character Architect (CharacterPromptFactory) node and its pipeline.
// The Studio never stores its own copy of the options: every chip reads and
// writes the real node widgets, so the canvas, the subgraph and the Studio
// always show the same state.
import {
    ARCHETYPE_KEYS, ESSENTIAL_WIDGETS, FIELD_LABELS, GLOBAL_PIVOT_KEYS, HIDDEN_CHARACTER_KEYS,
    KEY_TO_LOCK_GROUP, LOCK_GROUPS, NODE_MODES, PIPELINE_ROLES, PIVOT_LOCKS, RANDOM_PROTECTED_KEYS,
    SECTIONS, SET_RANDOM_SKIP_KEYS, SPECIAL_VALUES, canonicalChoice, colorSwatch, genderAwareValues,
    genderTag, humanize,
} from "./cs_constants.js";
import {
    connectedComponent, findCharacterNode, findStudioTargets, getLink, getNodeById, graphNodes, isCharacterNode,
    isWidgetLinked, nodeClass, resolveScope, upstreamOf,
} from "./cs_graph.js";
import { fill, h, isEditable } from "./cs_dom.js";

const LIBRARY_FILE = "character_architect/characters.json";
const SEED_MAX = 1125899906842624;
const CHIP_PREVIEW = 18;
const LIST_PREVIEW = 6;
const HISTORY_LIMIT = 40;
const STUDIO_TITLE = "Character Architect Studio";
const TEXT_TYPES = new Set(["text", "customtext", "textarea", "string", "STRING"]);
const NUMBER_TYPES = new Set(["number", "slider", "INT", "FLOAT"]);
const TOGGLE_TYPES = new Set(["toggle", "boolean", "BOOLEAN"]);
const COMBO_TYPES = new Set(["combo", "COMBO"]);
const DISPLAY_NODE = /ShowText|PreviewAny|Display/i;
const SAVE_NODE = /^SaveImage$|Save.*Image|Image.*Save/i;
const CONTROL_LABELS = { fixed: "Fixed", increment: "+1", decrement: "−1", randomize: "Random" };
const GUARDED_EVENTS = ["keydown", "keyup", "keypress", "paste", "copy", "cut"];
const PROMPT_WIDGET = /text|prompt|positive|negative/i;
const PROMPT_NODE = /TextEncode|positive|negative|Prompt/i;

// ---------------------------------------------------------------- widgets

function comboValues(widget, node) {
    let values = widget?.options?.values;
    if (typeof values === "function") {
        try { values = values(widget, node); } catch { values = []; }
    }
    return Array.isArray(values) ? values : [];
}

function widgetKind(node, widget) {
    if (!widget?.name || widget.hidden || widget.options?.hidden) return "skip";
    const type = widget.type;
    if (type === "button" || type === "cpf-section" || String(widget.name).startsWith("cpf_section_") || widget.__casLauncher) return "skip";
    if (DISPLAY_NODE.test(nodeClass(node))) return "skip";
    const value = widget.value;
    if (value && typeof value === "object" && "lora" in value) return "lora";
    if (type === "converted-widget") return "linked";
    if (COMBO_TYPES.has(type) || (!type && Array.isArray(widget.options?.values))) return "combo";
    if (TOGGLE_TYPES.has(type)) return "toggle";
    if (NUMBER_TYPES.has(type)) return "number";
    if (TEXT_TYPES.has(type)) return "text";
    if (!type) {
        if (typeof value === "boolean") return "toggle";
        if (typeof value === "number") return "number";
        if (typeof value === "string") return "text";
    }
    return "skip";
}

function nodeDefInput(node, name) {
    const def = node?.constructor?.nodeData ?? globalThis.LiteGraph?.registered_node_types?.[nodeClass(node)]?.nodeData;
    return def?.input?.required?.[name] ?? def?.input?.optional?.[name] ?? null;
}

function defaultValue(node, name) {
    const spec = nodeDefInput(node, name);
    if (!Array.isArray(spec)) return undefined;
    const [type, options] = spec;
    if (Array.isArray(type)) return options?.default ?? type[0];
    if (type === "COMBO") return options?.default ?? options?.options?.[0];
    return options?.default;
}

function tooltipFor(node, name) {
    const spec = nodeDefInput(node, name);
    return Array.isArray(spec) ? spec[1]?.tooltip ?? null : null;
}

function numberStep(widget) {
    const options = widget.options ?? {};
    const step = options.step2 ?? (options.step != null ? options.step / 10 : 1);
    return step > 0 ? step : 1;
}

function isIntWidget(widget) {
    const options = widget.options ?? {};
    return options.precision === 0 || (options.precision == null && options.round === 1);
}

function decimalsOf(number) {
    const text = String(number);
    return text.includes(".") ? text.split(".")[1].length : 0;
}

function isMultilineText(widget) {
    return widget.type === "customtext" || widget.type === "textarea" || !!widget.options?.multiline;
}

function nodeTitle(node) {
    return node?.title || nodeClass(node) || `Node ${node?.id}`;
}

function optionLabel(value) {
    return value === "" ? "(empty)" : canonicalChoice(String(value ?? ""));
}

function isConcrete(value) {
    return value !== undefined && value !== null && value !== "" && value !== false && !SPECIAL_VALUES.has(value);
}

function randomSeed() {
    return Math.floor(Math.random() * SEED_MAX);
}

function formatTime(time) {
    try {
        return new Date(time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
        return "";
    }
}

function newId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------- studio

export class CharacterStudio {
    constructor(app, api) {
        this.app = app;
        this.api = api;
        this.root = null;
        this.els = {};
        this.scope = null;
        this.view = "character";
        this.section = "subject";
        this.pipelineRole = "essentials";
        this.pipelineSearch = "";
        this.showAllGenders = false;
        this.expanded = new Set();
        this.filters = new Map();
        this.undoStack = [];
        this.batch = null;
        this.batchCount = 1;
        this.run = { running: false, value: 0, max: 0, label: "", live: null, error: null };
        this.nodeErrors = null;
        this.current = null;
        this.activePromptId = null;
        this.ourPrompts = new Map();
        this.stages = new Map();
        this.texts = new Map();
        this.selected = null;
        this.history = [];
        this.library = null;
        this.libraryError = null;
        this.saveName = "";
        this.eventsAttached = false;
        this.graphChangedTimer = null;
        this.sideTimer = null;
        this.searchTimer = null;
    }

    // ------------------------------------------------------------ lifecycle

    open(target) {
        const scope = resolveScope(this.app.graph, target ?? this.selectedTarget());
        if (!scope) {
            this.toast("warn", "Character Studio", "Add a Character Architect node, or a subgraph that contains one, to this workflow first.");
            return;
        }
        if (this.scope?.cpf !== scope.cpf) {
            this.stages.clear();
            this.texts.clear();
            this.selected = null;
            this.undoStack = [];
        }
        this.scope = scope;
        this.attachEvents();
        if (!this.root) this.build();
        this.renderAll();
        if (!this.library) this.loadLibrary();
    }

    close() {
        this.flushGraphChanged();
        for (const type of GUARDED_EVENTS) window.removeEventListener(type, this.onGlobalEvent, true);
        this.root?.remove();
        this.root = null;
        this.els = {};
    }

    get isOpen() {
        return !!this.root;
    }

    selectedTarget() {
        const canvas = this.app.canvas;
        const selected = canvas?.selectedItems
            ? [...canvas.selectedItems]
            : Object.values(canvas?.selected_nodes ?? {});
        return selected.find((node) => isCharacterNode(node) || (node?.subgraph && findCharacterNode(node.subgraph))) ?? null;
    }

    refreshScope() {
        if (!this.scope) return;
        const target = this.scope.host ?? this.scope.cpf;
        const next = resolveScope(this.app.graph, target);
        if (next && next.cpf === this.scope.cpf) this.scope = next;
    }

    build() {
        this.els = {
            header: h("header", { class: "cas-head" }),
            progress: h("div", { class: "cas-progress" }),
            nav: h("nav", { class: "cas-nav" }),
            main: h("main", { class: "cas-main" }),
            side: h("aside", { class: "cas-side" }),
        };
        this.root = h("div", { class: "cas-root", role: "dialog", "aria-modal": "true", "aria-label": STUDIO_TITLE, tabindex: "-1" },
            this.els.header,
            this.els.progress,
            h("div", { class: "cas-body" }, this.els.nav, this.els.main, this.els.side),
        );
        // Keep ComfyUI's global shortcuts (Delete, Ctrl+C/V on nodes, …) away
        // from what is typed or clicked inside the Studio.
        for (const type of GUARDED_EVENTS) {
            this.root.addEventListener(type, (event) => this.onRootEvent(type, event));
        }
        // When a re-render removes the focused button, focus falls back to the
        // page body and keys would reach the canvas hidden behind the Studio.
        this.onGlobalEvent = (event) => {
            const target = event.target;
            if (!this.root || (target instanceof Node && this.root.contains(target))) return;
            if (target !== document.body && target !== document.documentElement && target !== document && target !== window) return;
            this.onRootEvent(event.type, event);
        };
        for (const type of GUARDED_EVENTS) window.addEventListener(type, this.onGlobalEvent, true);
        document.body.append(this.root);
        this.root.focus({ preventScroll: true });
    }

    onRootEvent(type, event) {
        if (type === "keydown") {
            const mod = event.ctrlKey || event.metaKey;
            if (event.key === "Escape") {
                event.preventDefault();
                if (isEditable(event.target)) event.target.blur();
                else this.close();
            } else if (mod && event.key === "Enter") {
                event.preventDefault();
                event.target?.blur?.();
                this.queue();
            } else if (mod && !event.shiftKey && event.key.toLowerCase() === "z" && !isEditable(event.target)) {
                event.preventDefault();
                this.undo();
            } else if (mod && event.key.toLowerCase() === "s") {
                // Let ComfyUI save the workflow as usual.
                this.flushGraphChanged();
                return;
            }
        }
        event.stopPropagation();
    }

    toast(severity, summary, detail) {
        const toast = this.app.extensionManager?.toast;
        if (toast?.add) toast.add({ severity, summary, detail, life: 5000 });
        else console.log(`[Character Studio] ${summary}: ${detail}`);
    }

    // ------------------------------------------------------------ rendering

    renderAll() {
        if (!this.root) return;
        this.renderHeader();
        this.renderNav();
        this.renderMain(true);
        this.renderSide();
    }

    renderHeader() {
        if (!this.root || !this.scope) return;
        const scope = this.scope;
        const character = this.seedControl("character");
        let image = this.seedControl("image");
        if (image && character && image.widget === character.widget) image = null;
        fill(this.els.header,
            h("div", { class: "cas-brand", title: this.scopeLabel() },
                h("span", { class: "cas-title" }, "Character Architect"),
            ),
            h("div", { class: "cas-tabs" },
                this.tabButton("character", "Character"),
                this.tabButton("settings", "⚙ Settings"),
            ),
            h("div", { class: "cas-spacer" }),
            character && this.renderSeed(image ? "Character seed" : "Seed", character,
                "Seed fed to Character Architect. It resolves every field left on Random, so keep it fixed to keep the same character."),
            image && this.renderSeed("Image seed", image,
                "Noise seed of the first sampler. Change it to re-shoot the same character."),
            h("button", {
                class: "cas-btn cas-undo", disabled: !this.undoStack.length, title: "Undo the last Studio change (Ctrl+Z)",
                onclick: () => this.undo(),
            }, "↶"),
            h("button", {
                class: "cas-btn", title: scope.inRoot ? "Close the Studio and show this node on the canvas" : "Close the Studio and open the subgraph on the canvas",
                onclick: () => this.locate(scope.cpf),
            }, scope.inRoot ? "Show in graph" : "Open subgraph"),
            this.renderQueueControls(),
            h("button", { class: "cas-btn cas-close", title: "Close (Esc)", onclick: () => this.close() }, "✕"),
        );
        this.renderProgress();
    }

    scopeLabel() {
        const scope = this.scope;
        if (!scope) return "";
        return scope.inRoot ? `${nodeTitle(scope.cpf)} · on canvas` : `${nodeTitle(scope.host) || scope.graph?.name || "subgraph"} · subgraph`;
    }

    tabButton(view, label) {
        return h("button", {
            class: `cas-tab${this.view === view ? " on" : ""}`,
            onclick: () => {
                this.view = view;
                this.refreshScope();
                this.renderAll();
            },
        }, label);
    }

    renderSeed(label, control, tip) {
        const modes = control.control ? comboValues(control.control, control.node) : [];
        return h("div", { class: "cas-seed", title: tip },
            h("span", { class: "cas-seed-label" }, label),
            h("input", {
                class: "cas-seed-input", value: String(control.widget.value ?? ""), spellcheck: "false",
                onchange: (event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    if (Number.isFinite(parsed)) this.setNumber(control.node, control.widget, parsed);
                    this.renderHeader();
                },
            }),
            h("button", {
                class: "cas-icon-btn", title: "New random seed",
                onclick: () => {
                    this.setValue(control.node, control.widget, randomSeed());
                    this.renderHeader();
                },
            }, "🎲"),
            modes.length > 0 && h("div", { class: "cas-seg", title: "What happens to this seed after each queue" },
                modes.filter((mode) => mode !== "decrement" || control.control.value === mode).map((mode) =>
                    h("button", {
                        class: control.control.value === mode ? "on" : "",
                        onclick: () => {
                            this.setValue(control.node, control.control, mode);
                            this.renderHeader();
                        },
                    }, CONTROL_LABELS[mode] ?? mode)),
            ),
        );
    }

    renderQueueControls() {
        return h("div", { class: "cas-run" },
            this.run.running && h("button", {
                class: "cas-btn cas-stop", title: "Interrupt the running generation",
                onclick: () => this.interrupt(),
            }, "Stop"),
            h("input", {
                class: "cas-batch", type: "number", min: "1", max: "99", value: String(this.batchCount),
                title: "How many generations to queue",
                onchange: (event) => {
                    this.batchCount = Math.max(1, Math.min(99, Number.parseInt(event.target.value, 10) || 1));
                },
            }),
            h("button", {
                class: "cas-btn cas-primary", title: "Queue the workflow (Ctrl+Enter)",
                onclick: () => this.queue(),
            }, this.run.running ? "Queue more" : "Queue"),
        );
    }

    renderProgress() {
        const el = this.els.progress;
        if (!el) return;
        if (!this.run.running) {
            fill(el);
            el.classList.remove("on");
            return;
        }
        el.classList.add("on");
        const pct = this.run.max ? Math.round((this.run.value / this.run.max) * 100) : 0;
        fill(el,
            h("div", { class: "cas-progress-bar", style: { width: `${pct}%` } }),
            h("span", { class: "cas-progress-label" },
                this.run.label ? `${this.run.label}${this.run.max ? ` · ${this.run.value}/${this.run.max}` : ""}` : "Running…"),
        );
    }

    // ------------------------------------------------------------ navigation

    renderNav() {
        if (!this.root || !this.scope) return;
        if (this.view === "settings") return this.renderPipelineNav();
        const items = this.characterSections().map((section) => {
            const { set, random } = this.sectionCounts(section);
            const locked = section.lock && this.isGroupLocked(section.lock);
            return [
                section.divider && h("div", { class: "cas-nav-divider" }),
                h("button", {
                    class: `cas-nav-item${this.section === section.id ? " on" : ""}`,
                    title: `${set} set · ${random} random${locked ? " · locked" : ""}`,
                    onclick: () => {
                        this.section = section.id;
                        this.renderNav();
                        this.renderMain(true);
                    },
                },
                h("span", {}, section.label, locked ? " 🔒" : ""),
                h("span", { class: "cas-badge" }, set ? String(set) : ""),
                ),
            ];
        });
        fill(this.els.nav,
            h("div", { class: "cas-nav-actions" },
                h("div", { class: "cas-nav-scope", title: this.scopeLabel() }, this.scopeLabel()),
                h("div", { class: "cas-nav-caption" }, "Whole character"),
                h("button", {
                    class: "cas-btn", title: "Set every unlocked field to Random (same rules as SET ALL RANDOM on the node)",
                    onclick: () => this.setKeysToRandom(null),
                }, "🎲 All random"),
                h("button", {
                    class: "cas-btn", title: "Reset every unlocked field to None (same rules as RESET TO NONE on the node)",
                    onclick: () => this.resetKeys(null),
                }, "∅ Reset all"),
            ),
            items,
            h("div", { class: "cas-nav-foot" },
                h("label", { class: "cas-check", title: "Show options tagged for every gender, not only the selected one" },
                    h("input", {
                        type: "checkbox", checked: this.showAllGenders,
                        onchange: (event) => {
                            this.showAllGenders = event.target.checked;
                            this.renderMain();
                        },
                    }),
                    "Show all genders"),
            ),
        );
    }

    characterSections() {
        const sections = [...SECTIONS];
        const known = new Set(SECTIONS.flatMap((section) => section.keys));
        const extra = (this.scope?.cpf.widgets ?? [])
            .filter((widget) => !known.has(widget.name) && !HIDDEN_CHARACTER_KEYS.has(widget.name) && widgetKind(this.scope.cpf, widget) !== "skip")
            .map((widget) => widget.name);
        if (extra.length) sections.push({ id: "other", label: "Other", lock: null, keys: extra, hint: "Inputs of your Character Architect node that the Studio has no dedicated place for yet." });
        return sections;
    }

    currentSection() {
        const sections = this.characterSections();
        return sections.find((section) => section.id === this.section) ?? sections[0];
    }

    sectionWidgets(section) {
        const cpf = this.scope.cpf;
        return section.keys
            .map((key) => this.cpfWidget(key))
            .filter((widget) => widget && !HIDDEN_CHARACTER_KEYS.has(widget.name) && widgetKind(cpf, widget) !== "skip");
    }

    sectionCounts(section) {
        let set = 0;
        let random = 0;
        for (const widget of this.sectionWidgets(section)) {
            const kind = widgetKind(this.scope.cpf, widget);
            if (kind === "combo") {
                if (isConcrete(widget.value)) set += 1;
                else if (typeof widget.value === "string" && widget.value.endsWith("Random")) random += 1;
            } else if (kind === "text" && String(widget.value ?? "").trim()) {
                set += 1;
            }
        }
        return { set, random };
    }

    renderPipelineNav() {
        const nodes = this.pipelineNodes();
        const counts = new Map();
        for (const node of nodes) counts.set(this.roleOf(node).id, (counts.get(this.roleOf(node).id) ?? 0) + 1);
        const item = (id, label, count) => h("button", {
            class: `cas-nav-item${this.pipelineRole === id ? " on" : ""}`,
            onclick: () => {
                this.pipelineRole = id;
                this.renderNav();
                this.renderMain(true);
            },
        }, h("span", {}, label), h("span", { class: "cas-badge" }, count ? String(count) : ""));
        fill(this.els.nav,
            h("div", { class: "cas-nav-actions" },
                h("div", { class: "cas-nav-scope", title: this.scopeLabel() }, this.scopeLabel()),
                h("button", {
                    class: "cas-btn", title: "Close the Studio and edit the nodes directly on the canvas",
                    onclick: () => this.locate(this.scope.cpf),
                }, this.scope.inRoot ? "⇲ Show in graph" : "⇲ Open subgraph"),
                this.scope.inRoot && h("button", {
                    class: "cas-btn", title: "Pack this whole pipeline into one subgraph node. Save Image and text display nodes stay outside and become its outputs.",
                    onclick: () => this.packIntoSubgraph(this.scope.cpf),
                }, "▣ Pack as subgraph"),
            ),
            item("essentials", "Essentials", 0),
            h("div", { class: "cas-nav-divider" }),
            PIPELINE_ROLES.filter((role) => counts.get(role.id)).map((role) => item(role.id, role.label, counts.get(role.id))),
            h("div", { class: "cas-nav-divider" }),
            item("all", "All nodes", nodes.length),
        );
    }

    // ------------------------------------------------------------ main panel

    renderMain(resetScroll = false) {
        if (!this.root || !this.scope) return;
        const top = this.els.main.scrollTop;
        if (this.view === "settings") this.renderPipelineMain();
        else this.renderCharacterMain();
        this.els.main.scrollTop = resetScroll ? 0 : top;
    }

    afterCharacterChange() {
        this.renderMain();
        this.renderNav();
        this.renderHeader();
    }

    renderCharacterMain() {
        const section = this.currentSection();
        const widgets = this.sectionWidgets(section);
        const { set, random } = this.sectionCounts(section);
        const cpf = this.scope.cpf;
        const lockId = section.lock;
        const locked = lockId && this.isGroupLocked(lockId);
        const keys = widgets.map((widget) => widget.name);
        const heroes = widgets.filter((widget) => ARCHETYPE_KEYS.has(widget.name));
        const rest = widgets.filter((widget) => !ARCHETYPE_KEYS.has(widget.name));

        fill(this.els.main,
            h("div", { class: "cas-main-head" },
                h("span", { class: "cas-main-title" }, section.label),
                h("span", { class: "cas-main-meta" }, `${set} set · ${random} random`),
                h("div", { class: "cas-spacer" }),
                lockId && h("button", {
                    class: `cas-btn${locked ? " cas-locked" : ""}`,
                    title: `Lock "${LOCK_GROUPS[lockId]?.label}": the global All random / Reset all buttons (here and on the node) skip these fields.`,
                    onclick: () => this.toggleGroupLock(lockId),
                }, locked ? "🔒 Locked" : "🔓 Lock"),
                h("button", { class: "cas-btn", title: "Set this section to Random", onclick: () => this.setKeysToRandom(keys) }, "🎲 All random"),
                h("button", { class: "cas-btn", title: "Set this section to None", onclick: () => this.resetKeys(keys) }, "∅ All none"),
                h("button", { class: "cas-btn", title: "Back to the node's default values", onclick: () => this.resetToDefaults(cpf, keys) }, "Defaults"),
            ),
            section.hint && h("p", { class: "cas-hint" }, section.hint),
            heroes.map((widget) => this.renderField(cpf, widget, { character: true, hero: true })),
            rest.map((widget) => this.renderField(cpf, widget, { character: true })),
            !widgets.length && h("p", { class: "cas-empty" }, "Your Character Architect node has none of these inputs."),
            section.pipelineText && this.renderPipelineTextFields(),
        );
    }

    renderPipelineTextFields() {
        const fields = [];
        for (const node of this.pipelineNodes()) {
            for (const widget of node.widgets ?? []) {
                if (widgetKind(node, widget) !== "text" || isWidgetLinked(node, widget) || !isMultilineText(widget)) continue;
                if (!PROMPT_WIDGET.test(widget.name) && !PROMPT_NODE.test(nodeClass(node))) continue;
                const widgetLabel = humanize(widget.label || widget.name);
                const label = this.feedsInput(node, "negative")
                    ? "Negative prompt"
                    : nodeTitle(node).toLowerCase() === widgetLabel.toLowerCase() ? widgetLabel : `${nodeTitle(node)} · ${widgetLabel}`;
                fields.push(this.renderField(node, widget, { label, note: `#${node.id} · ${nodeClass(node)}` }));
            }
        }
        if (!fields.length) return null;
        return [
            h("div", { class: "cas-subhead" }, "Pipeline prompt fields"),
            h("p", { class: "cas-hint" }, "Plain text inputs elsewhere in the pipeline, e.g. the scene prompt appended after the character."),
            fields,
        ];
    }

    feedsInput(node, inputName) {
        for (const output of node.outputs ?? []) {
            for (const linkId of output?.links ?? []) {
                const link = getLink(node.graph, linkId);
                const target = link ? getNodeById(node.graph, link.target_id) : null;
                if (target?.inputs?.[link.target_slot]?.name === inputName) return true;
            }
        }
        return false;
    }

    pipelineNodes() {
        const scope = this.scope;
        const nodes = [...new Set([...scope.nodes, ...scope.watch.values()])];
        return nodes.filter((node) => node !== scope.cpf);
    }

    roleOf(node) {
        const cls = nodeClass(node);
        return PIPELINE_ROLES.find((role) => role.test.test(cls)) ?? PIPELINE_ROLES[PIPELINE_ROLES.length - 1];
    }

    renderPipelineMain() {
        const role = this.pipelineRole;
        const search = this.pipelineSearch.trim().toLowerCase();
        const matches = (node) => !search
            || nodeTitle(node).toLowerCase().includes(search)
            || nodeClass(node).toLowerCase().includes(search)
            || (node.widgets ?? []).some((widget) => String(widget.name).toLowerCase().includes(search));
        const nodes = this.pipelineNodes().filter(matches);

        const searchInput = h("input", {
            class: "cas-search", placeholder: "Filter nodes or settings…", value: this.pipelineSearch,
            oninput: (event) => {
                this.pipelineSearch = event.target.value;
                clearTimeout(this.searchTimer);
                this.searchTimer = setTimeout(() => {
                    this.renderMain();
                    const input = this.els.main.querySelector(".cas-search");
                    input?.focus();
                    input?.setSelectionRange(input.value.length, input.value.length);
                }, 180);
            },
        });

        let body;
        let title;
        if (role === "essentials") {
            title = "Essentials";
            body = this.renderEssentials(nodes);
        } else {
            const roleDef = PIPELINE_ROLES.find((item) => item.id === role);
            title = role === "all" ? "All nodes" : roleDef?.label ?? "Nodes";
            const shown = role === "all" ? nodes : nodes.filter((node) => this.roleOf(node).id === role);
            body = shown.length
                ? shown.map((node) => this.renderNodeCard(node))
                : h("p", { class: "cas-empty" }, "No matching nodes.");
        }

        fill(this.els.main,
            h("div", { class: "cas-main-head" },
                h("span", { class: "cas-main-title" }, title),
                h("span", { class: "cas-main-meta" }, this.scope.inRoot ? "pipeline on canvas" : `inside ${nodeTitle(this.scope.host)}`),
                h("div", { class: "cas-spacer" }),
                searchInput,
            ),
            h("p", { class: "cas-hint" }, "Every value here is the live widget of a node in the pipeline. Bypass skips a node; Mute removes it and everything that depends on it. Use ⇲ to jump to a node on the canvas for anything not shown."),
            body,
        );
    }

    renderEssentials(nodes) {
        const fields = [];
        for (const node of nodes) {
            for (const widget of node.widgets ?? []) {
                const label = ESSENTIAL_WIDGETS.get(widget.name);
                if (!label || isWidgetLinked(node, widget) || widgetKind(node, widget) === "skip") continue;
                fields.push(this.renderField(node, widget, { label, note: nodeTitle(node) }));
            }
        }
        const loraNodes = nodes.filter((node) => (node.widgets ?? []).some((widget) => widgetKind(node, widget) === "lora"));
        const passes = nodes.filter((node) => ["sampling", "post", "vae"].includes(this.roleOf(node).id));
        return [
            fields.length ? fields : h("p", { class: "cas-empty" }, "No model loaders or resolution nodes found in this pipeline."),
            loraNodes.length > 0 && [
                h("div", { class: "cas-subhead" }, "LoRAs"),
                loraNodes.map((node) => this.renderNodeCard(node, { lorasOnly: true })),
            ],
            passes.length > 0 && [
                h("div", { class: "cas-subhead" }, "Passes"),
                h("div", { class: "cas-passes" }, passes.map((node) => h("div", { class: `cas-pass mode-${node.mode ?? 0}` },
                    h("span", { class: "cas-pass-title", title: `${nodeClass(node)} #${node.id}` }, nodeTitle(node)),
                    this.renderModeSeg(node),
                    h("button", { class: "cas-icon-btn", title: "Show this node on the canvas", onclick: () => this.locate(node) }, "⇲"),
                ))),
            ],
        ];
    }

    renderModeSeg(node) {
        return h("div", { class: "cas-seg" }, NODE_MODES.map(({ mode, label }) => h("button", {
            class: (node.mode ?? 0) === mode ? "on" : "",
            onclick: () => {
                this.setMode(node, mode);
                this.renderMain();
            },
        }, label)));
    }

    renderNodeCard(node, { lorasOnly = false } = {}) {
        const widgets = (node.widgets ?? []).filter((widget) => {
            const kind = widgetKind(node, widget);
            return kind !== "skip" && (!lorasOnly || kind === "lora");
        });
        const canAddLora = typeof node.addNewLoraWidget === "function";
        return h("section", { class: `cas-card mode-${node.mode ?? 0}`, dataset: { nodeId: String(node.id) } },
            h("div", { class: "cas-card-head" },
                h("span", { class: "cas-card-title" }, nodeTitle(node)),
                h("span", { class: "cas-card-meta" }, `#${node.id} · ${nodeClass(node)}`),
                h("div", { class: "cas-spacer" }),
                !lorasOnly && this.renderModeSeg(node),
                h("button", { class: "cas-icon-btn", title: "Show this node on the canvas", onclick: () => this.locate(node) }, "⇲"),
            ),
            widgets.map((widget) => this.renderField(node, widget)),
            !widgets.length && h("p", { class: "cas-empty" }, DISPLAY_NODE.test(nodeClass(node)) ? "Display node — its output appears in the right-hand panel." : "No settings — wiring only."),
            canAddLora && h("button", {
                class: "cas-btn cas-add", title: "Add a LoRA slot to this loader",
                onclick: () => {
                    node.addNewLoraWidget();
                    node.setDirtyCanvas?.(true, true);
                    this.scheduleGraphChanged();
                    this.renderMain();
                },
            }, "+ Add LoRA"),
        );
    }

    // ------------------------------------------------------------ fields

    renderField(node, widget, opts = {}) {
        const kind = widgetKind(node, widget);
        const name = widget.name;
        const label = opts.label ?? (opts.character ? FIELD_LABELS[name] : null) ?? humanize(widget.label || name);
        const def = defaultValue(node, name);
        const changed = def !== undefined && kind !== "lora" && widget.value !== def;
        const linked = kind === "linked" || isWidgetLinked(node, widget);
        const lockGroup = opts.character ? KEY_TO_LOCK_GROUP.get(name) : null;

        const labelCol = h("div", { class: "cas-field-label", title: tooltipFor(node, name) ?? name },
            h("div", { class: "cas-label-line" },
                h("span", { class: "cas-label-text" }, label),
                changed && h("span", { class: "cas-dot", title: `Changed from the default (${def})` }),
                lockGroup && this.isGroupLocked(lockGroup) && h("span", { class: "cas-lockmark", title: "Section locked — global Random / Reset skip this field" }, "🔒"),
                opts.character && PIVOT_LOCKS.has(name) && this.renderPivotLock(name),
            ),
            opts.note && h("div", { class: "cas-field-note" }, opts.note),
            kind === "combo" && !linked && h("div", { class: "cas-field-value" }, optionLabel(widget.value)),
        );

        let control;
        if (linked) control = this.renderLinked(node, widget);
        else if (kind === "combo") control = this.renderCombo(node, widget, opts);
        else if (kind === "toggle") control = this.renderToggle(node, widget, opts);
        else if (kind === "number") control = this.renderNumber(node, widget, opts);
        else if (kind === "text") control = this.renderText(node, widget, opts);
        else if (kind === "lora") control = this.renderLora(node, widget, opts);
        else control = h("span", { class: "cas-muted" }, String(widget.value ?? ""));

        return h("div", { class: `cas-field${opts.hero ? " cas-hero" : ""}` }, labelCol, h("div", { class: "cas-field-control" }, control));
    }

    afterChange(node) {
        if (this.view === "character" && node === this.scope?.cpf) this.afterCharacterChange();
        else {
            this.renderMain();
            this.renderHeader();
        }
    }

    renderPivotLock(name) {
        const lock = this.cpfWidget(PIVOT_LOCKS.get(name));
        if (!lock) return null;
        return h("button", {
            class: `cas-pivot${lock.value ? " on" : ""}`,
            title: lock.value ? "Locked: global Random / Reset will not change this field" : "Unlocked: global Random / Reset can change this field",
            onclick: () => {
                this.setValue(this.scope.cpf, lock, !lock.value);
                this.afterCharacterChange();
            },
        }, lock.value ? "🔒" : "🔓");
    }

    renderLinked(node, widget) {
        const source = upstreamOf(node, widget.name);
        return h("div", { class: "cas-linked" },
            "← linked from ",
            source
                ? h("button", { class: "cas-link-btn", title: "Jump to the node that drives this value", onclick: () => this.reveal(source) }, nodeTitle(source))
                : h("span", {}, "a subgraph input"),
        );
    }

    // Scrolls to a node's card in Settings; falls back to the canvas.
    reveal(node) {
        if (!this.pipelineNodes().includes(node)) {
            this.locate(node);
            return;
        }
        if (this.view !== "settings" || !this.els.main.querySelector(`[data-node-id="${CSS.escape(String(node.id))}"]`)) {
            this.view = "settings";
            this.pipelineRole = "all";
            this.pipelineSearch = "";
            this.renderAll();
        }
        const card = this.els.main.querySelector(`[data-node-id="${CSS.escape(String(node.id))}"]`);
        if (!card) return;
        card.scrollIntoView({ block: "start", behavior: "smooth" });
        card.classList.add("flash");
        setTimeout(() => card.classList.remove("flash"), 1200);
    }

    renderCombo(node, widget, opts) {
        const key = `${node.id}:${widget.name}`;
        const all = comboValues(widget, node);
        const specials = all.filter((value) => SPECIAL_VALUES.has(value));
        const concreteAll = all.filter((value) => !SPECIAL_VALUES.has(value));
        const visible = opts.character && !this.showAllGenders
            ? genderAwareValues(widget.name, concreteAll, this.cpfWidget("gender")?.value)
            : concreteAll;
        const hiddenCount = concreteAll.length - visible.length;
        const swatches = /colou?r/i.test(widget.name);
        const avgLength = visible.reduce((sum, value) => sum + String(value).length, 0) / Math.max(1, visible.length);
        const asList = avgLength > 34;
        const limit = asList ? LIST_PREVIEW : CHIP_PREVIEW;
        const unknownValue = widget.value != null && !all.includes(widget.value);

        const zone = h("div", { class: "cas-combo-zone" });
        const paint = () => {
            const filter = (this.filters.get(key) ?? "").trim().toLowerCase();
            let shown = filter ? visible.filter((value) => String(value).toLowerCase().includes(filter)) : visible;
            const total = shown.length;
            const expanded = this.expanded.has(key) || !!filter;
            if (!expanded) shown = shown.slice(0, limit);
            if (!SPECIAL_VALUES.has(widget.value) && all.includes(widget.value) && !shown.includes(widget.value)) {
                shown = [widget.value, ...shown];
            }
            const option = (value) => this.renderOption(node, widget, value, { asList, swatches });
            fill(zone,
                specials.length > 0 && h("div", { class: "cas-chips" }, specials.map((value) => this.renderOption(node, widget, value, { special: true }))),
                unknownValue && h("div", { class: "cas-warn" }, `Current value "${widget.value}" is not in this node's list.`),
                asList
                    ? h("div", { class: "cas-list" }, shown.map(option))
                    : h("div", { class: "cas-chips" }, shown.map(option)),
                total > limit && !filter && h("button", {
                    class: "cas-more",
                    onclick: () => {
                        if (this.expanded.has(key)) this.expanded.delete(key);
                        else this.expanded.add(key);
                        paint();
                    },
                }, expanded ? "Show less" : `Show all ${total}`),
                filter && !total && h("span", { class: "cas-muted" }, "No option matches."),
            );
        };
        paint();

        const needsFilter = visible.length > limit;
        return [
            zone,
            (needsFilter || hiddenCount > 0) && h("div", { class: "cas-combo-foot" },
                needsFilter && h("input", {
                    class: "cas-filter", placeholder: `Filter ${visible.length} options…`, value: this.filters.get(key) ?? "",
                    oninput: (event) => {
                        this.filters.set(key, event.target.value);
                        paint();
                    },
                }),
                hiddenCount > 0 && h("span", { class: "cas-muted", title: "Use “Show all genders” in the left column to see them" },
                    `${hiddenCount} hidden for the selected gender`),
            ),
        ];
    }

    renderOption(node, widget, value, { special = false, asList = false, swatches = false } = {}) {
        const on = widget.value === value;
        const tag = genderTag(value);
        const swatch = swatches && !special ? colorSwatch(value) : null;
        return h("button", {
            class: `${asList ? "cas-opt" : "cas-chip"}${on ? " on" : ""}${special ? " special" : ""}`,
            title: String(value),
            onclick: () => {
                if (this.setValue(node, widget, value)) this.afterChange(node);
            },
        },
        swatch && h("span", { class: "cas-swatch", style: { background: swatch } }),
        h("span", { class: "cas-opt-text" }, optionLabel(value)),
        tag && h("span", { class: `cas-tag cas-tag-${tag}` }, tag === "female" ? "F" : tag === "male" ? "M" : "U"),
        );
    }

    renderToggle(node, widget) {
        const onLabel = widget.options?.on ?? "On";
        const offLabel = widget.options?.off ?? "Off";
        return h("div", { class: "cas-chips" },
            [[true, onLabel], [false, offLabel]].map(([value, text]) => h("button", {
                class: `cas-chip${!!widget.value === value ? " on" : ""}`,
                onclick: () => {
                    if (this.setValue(node, widget, value)) this.afterChange(node);
                },
            }, text)),
        );
    }

    renderNumber(node, widget) {
        const step = numberStep(widget);
        const nudge = (direction) => {
            this.setNumber(node, widget, Number(widget.value) + direction * step);
            this.afterChange(node);
        };
        const options = widget.options ?? {};
        return h("div", { class: "cas-number" },
            h("div", { class: "cas-stepper" },
                h("button", { onclick: () => nudge(-1), title: `−${step}` }, "−"),
                h("input", {
                    value: String(widget.value ?? ""), spellcheck: "false",
                    onchange: (event) => {
                        this.setNumber(node, widget, event.target.value);
                        this.afterChange(node);
                    },
                }),
                h("button", { onclick: () => nudge(1), title: `+${step}` }, "+"),
            ),
            (options.min != null || options.max != null) && h("span", { class: "cas-muted" },
                `${options.min ?? "−∞"} … ${options.max ?? "∞"}`),
        );
    }

    renderText(node, widget) {
        const multiline = isMultilineText(widget);
        const commit = (event) => {
            if (this.setValue(node, widget, event.target.value)) {
                this.renderNav();
                this.renderHeader();
            }
        };
        return multiline
            ? h("textarea", { class: "cas-textarea", rows: "3", value: String(widget.value ?? ""), spellcheck: "false", onchange: commit })
            : h("input", { class: "cas-text", value: String(widget.value ?? ""), spellcheck: "false", onchange: commit });
    }

    renderLora(node, widget) {
        const value = widget.value ?? {};
        const names = this.loraNames();
        const update = (patch) => {
            if (this.setValue(node, widget, { ...widget.value, ...patch })) this.afterChange(node);
        };
        const strength = Number(value.strength ?? 1);
        return h("div", { class: "cas-lora" },
            h("button", { class: `cas-chip${value.on ? " on" : ""}`, onclick: () => update({ on: !value.on }) }, value.on ? "ON" : "OFF"),
            names.length
                ? h("select", {
                    class: "cas-select",
                    onchange: (event) => update({ lora: event.target.value }),
                }, [...new Set([value.lora, ...names])].filter(Boolean).map((name) =>
                    h("option", { value: name, selected: name === value.lora }, name)))
                : h("input", { class: "cas-text", value: String(value.lora ?? ""), onchange: (event) => update({ lora: event.target.value }) }),
            h("div", { class: "cas-stepper" },
                h("button", { onclick: () => update({ strength: Number((strength - 0.05).toFixed(2)) }) }, "−"),
                h("input", {
                    value: String(strength),
                    onchange: (event) => {
                        const parsed = Number(event.target.value);
                        if (Number.isFinite(parsed)) update({ strength: parsed });
                    },
                }),
                h("button", { onclick: () => update({ strength: Number((strength + 0.05).toFixed(2)) }) }, "+"),
            ),
        );
    }

    loraNames() {
        const types = globalThis.LiteGraph?.registered_node_types ?? {};
        const spec = types.LoraLoader?.nodeData?.input?.required?.lora_name;
        if (!Array.isArray(spec)) return [];
        if (Array.isArray(spec[0])) return spec[0];
        return spec[0] === "COMBO" ? spec[1]?.options ?? [] : [];
    }

    // ------------------------------------------------------------ values & undo

    cpfWidget(name) {
        return (this.scope?.cpf.widgets ?? []).find((widget) => widget?.name === name) ?? null;
    }

    setValue(node, widget, value, { record = true } = {}) {
        const previous = widget.value;
        if (previous === value) return false;
        if (record) this.recordChange({ kind: "widget", node, widget, previous });
        widget.value = value;
        if (typeof value !== "object") widget.callback?.(value, this.app.canvas, node, widget);
        node.onWidgetChanged?.(widget.name, value, previous, widget);
        node.setDirtyCanvas?.(true, true);
        this.scheduleGraphChanged();
        return true;
    }

    setNumber(node, widget, raw) {
        let value = Number(raw);
        if (!Number.isFinite(value)) return false;
        const options = widget.options ?? {};
        if (options.min != null) value = Math.max(options.min, value);
        if (options.max != null) value = Math.min(options.max, value);
        if (isIntWidget(widget)) value = Math.round(value);
        else value = Number(value.toFixed(options.precision ?? Math.max(decimalsOf(numberStep(widget)), 2)));
        return this.setValue(node, widget, value);
    }

    setMode(node, mode) {
        const previous = node.mode ?? 0;
        if (previous === mode) return;
        this.recordChange({ kind: "mode", node, previous });
        if (typeof node.changeMode === "function") node.changeMode(mode);
        else node.mode = mode;
        node.setDirtyCanvas?.(true, true);
        this.scheduleGraphChanged();
    }

    recordChange(change) {
        if (this.batch) {
            this.batch.push(change);
            return;
        }
        this.undoStack.push([change]);
        if (this.undoStack.length > 100) this.undoStack.shift();
    }

    inBatch(fn) {
        this.batch = [];
        try {
            fn();
        } finally {
            const changes = this.batch;
            this.batch = null;
            if (changes.length) {
                this.undoStack.push(changes);
                if (this.undoStack.length > 100) this.undoStack.shift();
            }
        }
    }

    undo() {
        const changes = this.undoStack.pop();
        if (!changes) return;
        for (const change of [...changes].reverse()) {
            if (change.kind === "widget") this.setValue(change.node, change.widget, change.previous, { record: false });
            else if (change.kind === "mode") {
                if (typeof change.node.changeMode === "function") change.node.changeMode(change.previous);
                else change.node.mode = change.previous;
                change.node.setDirtyCanvas?.(true, true);
            } else if (change.kind === "lock") {
                this.lockStore()[change.group] = change.previous;
            }
        }
        this.scheduleGraphChanged();
        this.renderAll();
    }

    scheduleGraphChanged() {
        clearTimeout(this.graphChangedTimer);
        this.graphChangedTimer = setTimeout(() => this.flushGraphChanged(), 250);
    }

    flushGraphChanged() {
        clearTimeout(this.graphChangedTimer);
        this.graphChangedTimer = null;
        try {
            this.app.graph?.setDirtyCanvas?.(true, true);
            this.app.canvas?.setDirty?.(true, true);
            // Marks the workflow as modified and records an undo step in ComfyUI.
            this.app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.checkState?.();
        } catch (error) {
            console.warn("[Character Studio] could not notify the workflow of changes", error);
        }
    }

    // ------------------------------------------------------------ locks & bulk actions
    // Same semantics as the node's own RANDOMIZE / SET ALL RANDOM / RESET TO NONE.

    lockStore() {
        const cpf = this.scope.cpf;
        if (!cpf.properties) cpf.properties = {};
        if (!cpf.properties.cpf_group_locks) cpf.properties.cpf_group_locks = {};
        return cpf.properties.cpf_group_locks;
    }

    isGroupLocked(group) {
        return !!this.lockStore()[group];
    }

    toggleGroupLock(group) {
        const store = this.lockStore();
        this.recordChange({ kind: "lock", group, previous: !!store[group] });
        store[group] = !store[group];
        this.scope.cpf.setDirtyCanvas?.(true, true);
        this.scheduleGraphChanged();
        this.afterCharacterChange();
    }

    lockedKeys() {
        const keys = new Set();
        for (const [id, group] of Object.entries(LOCK_GROUPS)) {
            if (this.isGroupLocked(id)) group.keys.forEach((key) => keys.add(key));
        }
        return keys;
    }

    isPivotLocked(name) {
        const lockName = PIVOT_LOCKS.get(name);
        return !!(lockName && this.cpfWidget(lockName)?.value);
    }

    // keys === null means "whole character" and respects section and pivot locks.
    setKeysToRandom(keys) {
        const cpf = this.scope.cpf;
        const keySet = keys ? new Set(keys) : null;
        const locked = keySet ? new Set() : this.lockedKeys();
        this.inBatch(() => {
            for (const widget of cpf.widgets ?? []) {
                const name = widget?.name;
                if (!name || widgetKind(cpf, widget) !== "combo") continue;
                if (RANDOM_PROTECTED_KEYS.has(name) || SET_RANDOM_SKIP_KEYS.has(name) || name.startsWith("lock_")) continue;
                if (keySet && !keySet.has(name)) continue;
                if (!keySet && (locked.has(name) || GLOBAL_PIVOT_KEYS.has(name) || this.isPivotLocked(name))) continue;
                if (comboValues(widget, cpf).includes("Random")) this.setValue(cpf, widget, "Random");
            }
            // Scene scenario is a rare branch; SET ALL RANDOM deliberately arms it.
            const scenarioInScope = (!keySet || keySet.has("scene_scenario")) && !locked.has("scene_scenario");
            const scenario = this.cpfWidget("scene_scenario");
            if (scenarioInScope && scenario && comboValues(scenario, cpf).includes("Random")) this.setValue(cpf, scenario, "Random");
        });
        this.afterCharacterChange();
    }

    resetKeys(keys) {
        const cpf = this.scope.cpf;
        const keySet = keys ? new Set(keys) : null;
        const locked = keySet ? new Set() : this.lockedKeys();
        this.inBatch(() => {
            for (const widget of cpf.widgets ?? []) {
                const name = widget?.name;
                const kind = widgetKind(cpf, widget);
                if (!name || name.startsWith("lock_") || kind === "skip") continue;
                if (keySet && !keySet.has(name)) continue;
                if (!keySet && (locked.has(name) || GLOBAL_PIVOT_KEYS.has(name) || this.isPivotLocked(name))) continue;
                if (name === "seed" || name.startsWith("control_after_generate")) continue;
                if (name === "free_prompt") this.setValue(cpf, widget, "");
                else if (name === "free_prompt_position") this.setValue(cpf, widget, "After introduction");
                else if (name === "species_mode") this.setValue(cpf, widget, "Human");
                else if (kind === "combo" && comboValues(widget, cpf).includes("None")) this.setValue(cpf, widget, "None");
            }
        });
        this.afterCharacterChange();
    }

    resetToDefaults(node, keys) {
        this.inBatch(() => {
            for (const name of keys) {
                const widget = (node.widgets ?? []).find((item) => item.name === name);
                const value = defaultValue(node, name);
                if (widget && value !== undefined && !isWidgetLinked(node, widget)) this.setValue(node, widget, value);
            }
        });
        this.afterChange(node);
    }

    // ------------------------------------------------------------ seeds

    seedControl(kind) {
        const scope = this.scope;
        if (!scope) return null;
        if (kind === "character") return this.seedSource(scope.cpf, "seed");
        const sampler = scope.nodes.find((node) => node !== scope.cpf && /sampler/i.test(nodeClass(node))
            && [...(node.inputs ?? []), ...(node.widgets ?? [])].some((slot) => slot?.name === "seed" || slot?.name === "noise_seed"));
        if (!sampler) return null;
        const name = [...(sampler.inputs ?? []), ...(sampler.widgets ?? [])].some((slot) => slot?.name === "noise_seed") ? "noise_seed" : "seed";
        return this.seedSource(sampler, name);
    }

    seedSource(node, name) {
        const upstream = upstreamOf(node, name);
        let owner = node;
        let widget;
        if (upstream) {
            owner = upstream;
            widget = (upstream.widgets ?? []).find((item) => /seed/i.test(item.name) && typeof item.value === "number");
        } else {
            widget = (node.widgets ?? []).find((item) => item.name === name);
            if (widget && isWidgetLinked(node, widget)) widget = null;
        }
        if (!widget) return null;
        const control = (owner.widgets ?? []).find((item) => String(item.name).startsWith("control_after_generate"))
            ?? widget.linkedWidgets?.find((item) => String(item.name).startsWith("control_after_generate"))
            ?? null;
        return { node: owner, widget, control };
    }

    // ------------------------------------------------------------ canvas navigation

    locate(node) {
        this.close();
        const canvas = this.app.canvas;
        if (!canvas || !node) return;
        const graph = node.graph;
        try {
            if (canvas.graph !== graph) {
                if (graph === this.app.graph) canvas.setGraph?.(graph);
                else if (typeof canvas.openSubgraph === "function") canvas.openSubgraph(graph);
            }
            if (typeof canvas.deselectAll === "function") canvas.deselectAll();
            if (typeof canvas.select === "function") canvas.select(node);
            else canvas.selectNode?.(node, false);
            if (typeof canvas.centerOnNode === "function") canvas.centerOnNode(node);
            else if (canvas.ds && canvas.canvas) {
                const scale = canvas.ds.scale || 1;
                canvas.ds.offset[0] = -node.pos[0] - node.size[0] / 2 + canvas.canvas.width / (2 * scale);
                canvas.ds.offset[1] = -node.pos[1] - node.size[1] / 2 + canvas.canvas.height / (2 * scale);
            }
            canvas.setDirty?.(true, true);
        } catch (error) {
            console.warn("[Character Studio] could not navigate to node", error);
            this.toast("warn", "Character Studio", `Open "${nodeTitle(node)}" from the canvas manually.`);
        }
    }

    // Packs the pipeline around a root-level Character Architect node into one
    // subgraph using ComfyUI's own "Convert to Subgraph" command. Final Save
    // Image and text display nodes stay outside and become the subgraph outputs.
    async packIntoSubgraph(cpf) {
        const app = this.app;
        const target = cpf ?? findStudioTargets(app.graph).find(isCharacterNode);
        if (!target || target.graph !== app.graph) {
            this.toast("info", "Character Studio", "The Character Architect pipeline is already inside a subgraph.");
            return;
        }
        const component = connectedComponent(target);
        const outside = component.filter((node) => (SAVE_NODE.test(nodeClass(node)) || DISPLAY_NODE.test(nodeClass(node)))
            && !(node.outputs ?? []).some((output) => (output?.links ?? []).length));
        const inside = component.filter((node) => !outside.includes(node));
        const wasOpen = this.isOpen;
        this.close();
        const canvas = app.canvas;
        try {
            if (canvas.graph !== app.graph) canvas.setGraph?.(app.graph);
            canvas.deselectAll?.();
            if (typeof canvas.selectItems === "function") canvas.selectItems(inside);
            else canvas.selectNodes?.(inside);
            await app.extensionManager.command.execute("Comfy.Graph.ConvertToSubgraph");
        } catch (error) {
            console.error("[Character Studio] convert to subgraph failed", error);
            this.toast("error", "Character Studio", "ComfyUI could not convert the pipeline to a subgraph. Update ComfyUI to a version with subgraph support, or select the nodes and use “Convert to Subgraph” manually.");
            return;
        }
        const host = graphNodes(app.graph).find((node) => node.subgraph && findCharacterNode(node.subgraph) === target);
        if (!host) {
            this.toast("warn", "Character Studio", "Conversion finished but the new subgraph node was not found.");
            return;
        }
        host.title = STUDIO_TITLE;
        if (host.subgraph) host.subgraph.name = STUDIO_TITLE;
        this.onHostCreated?.(host);
        app.canvas.setDirty?.(true, true);
        this.flushGraphChanged();
        this.toast("success", "Character Studio", `Pipeline packed into “${STUDIO_TITLE}”. Its outputs can feed any other workflow.`);
        if (wasOpen) this.open(host);
    }

    // ------------------------------------------------------------ queue & events

    async queue() {
        if (!this.scope) return;
        const app = this.app;
        const api = this.api;
        this.run.error = null;
        this.nodeErrors = null;
        this.flushGraphChanged();
        const count = Math.max(1, Math.min(99, Number(this.batchCount) || 1));
        // app.queuePrompt does not return prompt ids; capture them (and the
        // exact inputs that were submitted) while this one call is in flight.
        const hadOwn = Object.prototype.hasOwnProperty.call(api, "queuePrompt");
        const original = api.queuePrompt;
        const studio = this;
        api.queuePrompt = async function (number, data, ...rest) {
            const response = await original.call(this, number, data, ...rest);
            try {
                if (response?.prompt_id) studio.ourPrompts.set(response.prompt_id, studio.snapshotFromPrompt(data?.output));
            } catch (error) {
                console.warn("[Character Studio] could not snapshot queued prompt", error);
            }
            return response;
        };
        try {
            await app.queuePrompt(0, count);
        } catch (error) {
            this.run.error = String(error?.message ?? error);
        } finally {
            if (hadOwn) api.queuePrompt = original;
            else delete api.queuePrompt;
        }
        const errors = app.lastNodeErrors;
        if (errors && Object.keys(errors).length) this.nodeErrors = errors;
        this.renderHeader();
        this.renderSide();
    }

    async interrupt() {
        try {
            await this.api.interrupt?.(this.current?.promptId ?? null);
        } catch (error) {
            this.toast("error", "Character Studio", `Could not interrupt: ${error?.message ?? error}`);
        }
    }

    attachEvents() {
        if (this.eventsAttached) return;
        this.eventsAttached = true;
        const on = (type, handler) => this.api.addEventListener(type, (event) => {
            try {
                handler(event?.detail);
            } catch (error) {
                console.error(`[Character Studio] ${type} handler failed`, error);
            }
        });
        on("execution_start", (detail) => this.onExecutionStart(detail));
        on("executing", (detail) => this.onExecuting(detail));
        on("progress", (detail) => this.onProgress(detail));
        on("executed", (detail) => this.onExecuted(detail));
        on("execution_success", (detail) => this.onExecutionEnd(detail, null));
        on("execution_error", (detail) => this.onExecutionEnd(detail, detail));
        on("execution_interrupted", (detail) => this.onExecutionEnd(detail, { exception_message: "Interrupted" }));
        on("b_preview", (detail) => this.onPreview(detail instanceof Blob ? detail : null, null));
        on("b_preview_with_metadata", (detail) => this.onPreview(detail?.blob ?? null, detail));
    }

    onExecutionStart(detail) {
        this.activePromptId = detail?.prompt_id ?? null;
        if (this.activePromptId && this.ourPrompts.has(this.activePromptId)) this.startRun(this.activePromptId);
    }

    startRun(promptId) {
        for (const stage of this.stages.values()) stage.stale = true;
        for (const text of this.texts.values()) text.stale = true;
        this.current = { promptId, snapshot: this.ourPrompts.get(promptId) ?? null, images: [], startedAt: Date.now() };
        this.selected = null;
        if (this.run.live) URL.revokeObjectURL(this.run.live);
        this.run = { running: true, value: 0, max: 0, label: "", live: null, error: null };
        this.renderHeader();
        this.renderSideSoon();
    }

    touch(promptId) {
        const id = promptId ?? this.activePromptId;
        if (this.current && !this.current.promptId && id) this.current.promptId = id;
        if (!this.current || !this.isCurrentPrompt(id)) this.startRun(id);
    }

    // Unknown ids on either side count as a match: some events carry no prompt id.
    isCurrentPrompt(promptId) {
        return !!this.current && (!promptId || !this.current.promptId || promptId === this.current.promptId);
    }

    onExecuting(detail) {
        const id = detail && typeof detail === "object" ? detail.display_node ?? detail.node : detail;
        if (id == null || !this.scope) return;
        const node = this.scope.watch.get(String(id));
        if (!node) return;
        this.touch(detail?.prompt_id);
        this.run.label = nodeTitle(node);
        this.run.value = 0;
        this.run.max = 0;
        this.renderProgress();
    }

    onProgress(detail) {
        if (!this.scope || !this.isCurrentPrompt(detail?.prompt_id)) return;
        const node = detail?.node != null ? this.scope.watch.get(String(detail.node)) : null;
        if (node) this.run.label = nodeTitle(node);
        this.run.value = detail?.value ?? 0;
        this.run.max = detail?.max ?? 0;
        this.renderProgress();
    }

    onExecuted(detail) {
        if (!this.scope) return;
        const execId = String(detail?.display_node ?? detail?.node ?? "");
        const node = this.scope.watch.get(execId);
        if (!node) return;
        this.touch(detail?.prompt_id);
        const output = detail?.output ?? {};
        const order = [...this.scope.watch.keys()].indexOf(execId);
        if (Array.isArray(output.images) && output.images.length) {
            const images = output.images.filter((image) => image?.filename).map((image) => {
                const ref = { filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" };
                return { ref, url: this.viewUrl(ref) };
            });
            const final = SAVE_NODE.test(nodeClass(node));
            this.stages.set(execId, { title: nodeTitle(node), images, stale: false, final, order });
            this.current?.images.push(...images.map((image) => ({ ...image, title: nodeTitle(node), final })));
        }
        const text = output.text ?? output.string;
        if (Array.isArray(text) && text.length) {
            this.texts.set(execId, { title: nodeTitle(node), text: text.map(String).join("\n"), stale: false, order });
        }
        this.renderSideSoon();
    }

    onExecutionEnd(detail, error) {
        const current = this.current;
        if (!this.isCurrentPrompt(detail?.prompt_id)) return;
        this.current = null;
        if (this.run.live) URL.revokeObjectURL(this.run.live);
        this.run = { running: false, value: 0, max: 0, label: "", live: null, error: null };
        if (error) {
            const where = error.node_type ? ` (${error.node_type}${error.node_id ? ` #${error.node_id}` : ""})` : "";
            this.run.error = `${error.exception_message ?? "Execution failed"}${where}`;
        }
        const finals = current.images.filter((image) => image.final);
        const images = finals.length ? finals : current.images.slice(-1);
        if (images.length) {
            this.history.unshift({
                id: newId(),
                time: Date.now(),
                images,
                texts: [...this.texts.values()].filter((text) => !text.stale).map(({ title, text }) => ({ title, text })),
                snapshot: current.snapshot,
            });
            this.history.length = Math.min(this.history.length, HISTORY_LIMIT);
        }
        this.ourPrompts.delete(current.promptId);
        this.renderHeader();
        this.renderSide();
    }

    onPreview(blob, meta) {
        if (!blob || !this.run.running || !this.isCurrentPrompt(meta?.promptId)) return;
        if (this.run.live) URL.revokeObjectURL(this.run.live);
        this.run.live = URL.createObjectURL(blob);
        if (this.els.previewImg && !this.selected) {
            this.els.previewImg.src = this.run.live;
            this.els.previewCaption?.replaceChildren("Live preview");
        } else {
            this.renderSideSoon();
        }
    }

    viewUrl(ref) {
        const query = `filename=${encodeURIComponent(ref.filename)}&type=${encodeURIComponent(ref.type ?? "output")}&subfolder=${encodeURIComponent(ref.subfolder ?? "")}`;
        return this.api.apiURL(`/view?${query}`);
    }

    // ------------------------------------------------------------ snapshots

    snapshotFromPrompt(output) {
        const scope = this.scope;
        if (!scope || !output) return null;
        const entry = output[scope.execIdOf(scope.cpf)];
        if (!entry) return null;
        const values = {};
        for (const [name, value] of Object.entries(entry.inputs ?? {})) {
            if (!Array.isArray(value) && typeof value !== "object") values[name] = value;
        }
        const seeds = {};
        for (const kind of ["character", "image"]) {
            const control = this.seedControl(kind);
            const value = control ? output[scope.execIdOf(control.node)]?.inputs?.[control.widget.name] : undefined;
            if (typeof value === "number") seeds[kind] = value;
        }
        return { values, seeds, time: Date.now() };
    }

    liveSnapshot() {
        const cpf = this.scope.cpf;
        const values = {};
        for (const widget of cpf.widgets ?? []) {
            const kind = widgetKind(cpf, widget);
            if (!["combo", "toggle", "number", "text"].includes(kind) || isWidgetLinked(cpf, widget)) continue;
            if (widget.name === "seed" || String(widget.name).startsWith("control_after_generate")) continue;
            values[widget.name] = widget.value;
        }
        const seeds = {};
        for (const kind of ["character", "image"]) {
            const control = this.seedControl(kind);
            if (control && typeof control.widget.value === "number") seeds[kind] = control.widget.value;
        }
        return { values, seeds, time: Date.now() };
    }

    applySnapshot(snapshot) {
        const cpf = this.scope.cpf;
        let applied = 0;
        let skipped = 0;
        this.inBatch(() => {
            for (const [name, value] of Object.entries(snapshot?.values ?? {})) {
                if (name === "seed" || name.startsWith("control_after_generate")) continue;
                const widget = this.cpfWidget(name);
                if (!widget || isWidgetLinked(cpf, widget)) {
                    skipped += 1;
                    continue;
                }
                // Values come from a saved file: only accept what the node itself allows.
                const allowed = comboValues(widget, cpf);
                const valid = allowed.length ? allowed.includes(value) : typeof value === typeof widget.value;
                if (!valid) {
                    skipped += 1;
                    continue;
                }
                if (this.setValue(cpf, widget, value)) applied += 1;
            }
            for (const kind of ["character", "image"]) {
                const seed = snapshot?.seeds?.[kind];
                const control = this.seedControl(kind);
                if (!control || typeof seed !== "number") continue;
                this.setValue(control.node, control.widget, seed);
                if (control.control && comboValues(control.control, control.node).includes("fixed")) {
                    this.setValue(control.node, control.control, "fixed");
                }
            }
        });
        this.renderAll();
        return { applied, skipped };
    }

    // ------------------------------------------------------------ side panel

    renderSideSoon() {
        if (this.sideTimer) return;
        this.sideTimer = setTimeout(() => {
            this.sideTimer = null;
            this.renderSide();
        }, 120);
    }

    currentImage() {
        if (this.selected) return this.selected;
        const stages = [...this.stages.values()].sort((a, b) => a.order - b.order);
        const final = [...stages].reverse().find((stage) => stage.final && stage.images.length) ?? stages.at(-1);
        const image = final?.images?.[0];
        return image ? { ...image, title: final.title, stale: final.stale } : null;
    }

    renderSide() {
        if (!this.root || !this.scope) return;
        const el = this.els.side;
        const live = this.run.running && this.run.live && !this.selected;
        const image = this.currentImage();
        const src = live ? this.run.live : image?.url;
        const caption = live ? "Live preview" : image ? `${image.title}${image.stale ? " · previous run" : ""}` : "";

        this.els.previewImg = src ? h("img", { src, alt: caption, onerror: (event) => event.target.classList.add("broken") }) : null;
        this.els.previewCaption = h("div", { class: "cas-preview-caption" }, caption);
        const stages = [...this.stages.entries()].sort((a, b) => a[1].order - b[1].order);
        const texts = this.selected?.texts ?? [...this.texts.values()].sort((a, b) => a.order - b.order);
        const snapshotForSave = this.selected?.snapshot ?? this.history.find((item) => item.snapshot)?.snapshot ?? null;

        fill(el,
            h("div", { class: "cas-preview" },
                this.els.previewImg ?? h("div", { class: "cas-preview-empty" }, "No output yet", h("br"), "Press Queue (Ctrl+Enter)"),
                src && !live && h("button", {
                    class: "cas-preview-open", title: "Open full size in a new tab",
                    onclick: () => window.open(src, "_blank", "noopener"),
                }, "⤢"),
            ),
            this.els.previewCaption,
            this.selected && h("button", {
                class: "cas-link-btn", title: "Back to the latest result",
                onclick: () => {
                    this.selected = null;
                    this.renderSide();
                },
            }, "← latest result"),
            this.selected?.snapshot && h("button", {
                class: "cas-btn cas-wide",
                title: "Put the character settings and seeds that produced this image back on the node",
                onclick: () => {
                    const { applied, skipped } = this.applySnapshot(this.selected.snapshot);
                    this.toast("success", "Character Studio", `Restored ${applied} settings${skipped ? `, skipped ${skipped} unknown` : ""}. Seeds set to Fixed.`);
                },
            }, "Use these settings"),

            stages.length > 0 && h("div", { class: "cas-side-block" },
                h("div", { class: "cas-side-title" }, "Stages"),
                h("div", { class: "cas-stages" }, stages.map(([, stage]) => stage.images.map((item) => h("button", {
                    class: `cas-thumb${stage.stale ? " stale" : ""}${image?.url === item.url ? " on" : ""}`,
                    title: stage.title,
                    onclick: () => {
                        this.selected = { ...item, title: stage.title, stale: stage.stale };
                        this.renderSide();
                    },
                }, h("img", { src: item.url, alt: stage.title, loading: "lazy" }), h("span", {}, stage.title))))),
            ),

            (this.run.error || this.nodeErrors) && this.renderErrors(),

            h("div", { class: "cas-side-block" },
                h("div", { class: "cas-side-title" }, "Prompt"),
                texts.length
                    ? texts.map((text) => h("div", { class: `cas-prompt${text.stale ? " stale" : ""}` },
                        h("div", { class: "cas-prompt-head" },
                            h("span", {}, text.title),
                            h("button", {
                                class: "cas-link-btn",
                                onclick: () => navigator.clipboard?.writeText(text.text).then(
                                    () => this.toast("success", "Character Studio", "Prompt copied."),
                                    () => this.toast("warn", "Character Studio", "Clipboard is not available."),
                                ),
                            }, "Copy"),
                        ),
                        h("pre", {}, text.text),
                    ))
                    : h("p", { class: "cas-muted" }, "The resolved prompt appears here after a run (from the Show Text nodes in the pipeline)."),
            ),

            this.renderSaveBlock(snapshotForSave),
            this.renderLibrary(),
            this.history.length > 0 && h("div", { class: "cas-side-block" },
                h("div", { class: "cas-side-title" }, "This session"),
                h("div", { class: "cas-history" }, this.history.map((item) => h("button", {
                    class: `cas-thumb${this.selected?.historyId === item.id ? " on" : ""}`,
                    title: formatTime(item.time),
                    onclick: () => {
                        const first = item.images[0];
                        this.selected = { ...first, title: `${first.title} · ${formatTime(item.time)}`, snapshot: item.snapshot, historyId: item.id, texts: item.texts };
                        this.renderSide();
                    },
                }, h("img", { src: item.images[0].url, alt: "", loading: "lazy" })))),
            ),
        );
    }

    renderErrors() {
        const lines = [];
        if (this.run.error) lines.push(this.run.error);
        for (const [id, info] of Object.entries(this.nodeErrors ?? {})) {
            for (const error of info?.errors ?? []) {
                lines.push(`${info.class_type ?? "Node"} #${id}: ${error.message}${error.details ? ` — ${error.details}` : ""}`);
            }
        }
        return h("div", { class: "cas-side-block cas-error" },
            h("div", { class: "cas-side-title" }, "Problem"),
            lines.map((line) => h("p", {}, line)),
        );
    }

    renderSaveBlock(snapshot) {
        const image = this.currentImage();
        return h("div", { class: "cas-side-block" },
            h("div", { class: "cas-side-title" }, "Save character"),
            h("div", { class: "cas-save" },
                h("input", {
                    class: "cas-text", placeholder: "Character name", value: this.saveName,
                    oninput: (event) => { this.saveName = event.target.value; },
                    onkeydown: (event) => { if (event.key === "Enter") this.saveCharacter(); },
                }),
                h("button", { class: "cas-btn cas-primary", onclick: () => this.saveCharacter() }, "Save"),
            ),
            h("p", { class: "cas-muted" }, snapshot
                ? "Saves the settings and seeds that produced the image above, its resolved prompt and a link to the image."
                : image
                    ? "Saves the current settings and seeds with the image above."
                    : "Saves the current settings and seeds."),
        );
    }

    renderLibrary() {
        const library = this.library;
        return h("div", { class: "cas-side-block" },
            h("div", { class: "cas-side-title" }, "Characters"),
            this.libraryError && h("p", { class: "cas-warn" }, this.libraryError),
            library == null
                ? h("p", { class: "cas-muted" }, "Loading…")
                : library.length
                    ? h("div", { class: "cas-library" }, library.map((character) => h("div", { class: "cas-char" },
                        character.image
                            ? h("img", { src: this.viewUrl(character.image), alt: "", loading: "lazy", onerror: (event) => event.target.classList.add("broken") })
                            : h("div", { class: "cas-char-noimg" }, "—"),
                        h("div", { class: "cas-char-info" },
                            h("span", { class: "cas-char-name" }, character.name),
                            h("span", { class: "cas-muted" }, formatTime(character.created)),
                        ),
                        h("button", { class: "cas-btn", title: "Load these settings and seeds onto the node", onclick: () => this.loadCharacter(character) }, "Load"),
                        h("button", { class: "cas-icon-btn", title: "Delete", onclick: () => this.deleteCharacter(character) }, "✕"),
                    )))
                    : h("p", { class: "cas-muted" }, "Saved characters live in ComfyUI's user folder and are available in every workflow."),
        );
    }

    // ------------------------------------------------------------ character library

    async loadLibrary() {
        try {
            const response = await this.api.getUserData(LIBRARY_FILE);
            if (response.status === 404) {
                this.library = [];
            } else if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            } else {
                const data = await response.json();
                this.library = (Array.isArray(data?.characters) ? data.characters : []).filter((character) =>
                    character && typeof character.name === "string" && character.values && typeof character.values === "object");
            }
            this.libraryError = null;
        } catch (error) {
            this.library = this.library ?? [];
            this.libraryError = `Could not read saved characters (${error?.message ?? error}).`;
        }
        this.renderSide();
    }

    async persistLibrary() {
        try {
            await this.api.storeUserData(LIBRARY_FILE, { version: 1, characters: this.library }, { overwrite: true, stringify: true, throwOnError: true });
            this.libraryError = null;
            return true;
        } catch (error) {
            this.libraryError = `Could not save characters (${error?.message ?? error}).`;
            this.renderSide();
            return false;
        }
    }

    async saveCharacter() {
        if (!this.scope || this.library == null) return;
        const name = this.saveName.trim() || `Character ${this.library.length + 1}`;
        const existing = this.library.find((character) => character.name === name);
        if (existing && !window.confirm(`Replace the saved character “${name}”?`)) return;
        const snapshot = this.selected?.snapshot ?? this.history.find((item) => item.snapshot)?.snapshot ?? this.liveSnapshot();
        const image = this.currentImage();
        const texts = this.selected?.texts ?? [...this.texts.values()].filter((text) => !text.stale);
        const entry = {
            id: existing?.id ?? newId(),
            name,
            created: new Date().toISOString(),
            values: snapshot.values,
            seeds: snapshot.seeds,
            prompt: texts.map((text) => text.text).join("\n\n"),
            image: image?.ref ?? null,
        };
        this.library = [entry, ...this.library.filter((character) => character !== existing)];
        if (await this.persistLibrary()) {
            this.saveName = "";
            this.toast("success", "Character Studio", `Saved “${name}”.`);
        }
        this.renderSide();
    }

    loadCharacter(character) {
        const { applied, skipped } = this.applySnapshot(character);
        this.toast("success", "Character Studio", `Loaded “${character.name}”: ${applied} settings${skipped ? `, ${skipped} skipped (not on this node)` : ""}. Seeds set to Fixed.`);
    }

    async deleteCharacter(character) {
        if (!window.confirm(`Delete the saved character “${character.name}”? The image file is not deleted.`)) return;
        this.library = this.library.filter((item) => item !== character);
        await this.persistLibrary();
        this.renderSide();
    }
}
