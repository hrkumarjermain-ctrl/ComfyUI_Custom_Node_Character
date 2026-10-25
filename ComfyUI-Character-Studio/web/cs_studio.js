// Character Architect Studio — full-screen character creator over a
// Character Architect (CharacterPromptFactory) node and its pipeline.
// The Studio never stores its own copy of the options: every chip reads and
// writes the real node widgets, so the canvas, the subgraph and the Studio
// always show the same state.
import {
    ARCHETYPE_KEYS, ESSENTIAL_WIDGETS, FIELD_LABELS, GLOBAL_PIVOT_KEYS, HIDDEN_CHARACTER_KEYS,
    KEY_TO_LOCK_GROUP, LOCK_GROUPS, NODE_MODES, PIPELINE_ROLES, PIVOT_LOCKS, RANDOM_PROTECTED_KEYS,
    CUSTOM_VALUE_EXAMPLES, CUSTOM_VALUE_EXTRA_FIELDS, SECTIONS, SET_RANDOM_SKIP_KEYS, SPECIAL_VALUES, TURNAROUND_ROLE,
    TURNAROUND_SETTINGS, canonicalChoice, colorSwatch, genderAwareValues,
    genderTag, humanize,
} from "./cs_constants.js";
import {
    connectedComponent, findCharacterNode, findHostChain, findStudioTargets, getLink, getNodeById, graphNodes, isCharacterNode,
    isOutputNode, isWidgetLinked, nodeClass, resolveScope, upstreamOf,
} from "./cs_graph.js";
import { fill, h, isEditable } from "./cs_dom.js";

const LIBRARY_FILE = "character_architect/characters.json";
const SEED_MAX = 1125899906842624;
const CHIP_PREVIEW = 18;
const LIST_PREVIEW = 6;
const HISTORY_LIMIT = 40;
const STUDIO_TITLE = "Character Architect Studio";
const STUDIO_VERSION = "0.3.1";
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
    if (!widget?.name) return "skip";
    // Another frontend may hide the Character Architect widgets to draw its own
    // UI; they are still the node's real inputs, so the Studio keeps them.
    if ((widget.hidden || widget.options?.hidden) && !isCharacterNode(node)) return "skip";
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

// A node whose type is not installed is loaded as a plain placeholder with no
// definition: its widgets are "UNKNOWN_n" text boxes holding the saved values.
function isPlaceholderNode(node) {
    return !!node && !node.constructor?.nodeData;
}

function nodeTitle(node) {
    return node?.title || nodeClass(node) || `Node ${node?.id}`;
}

// Character Architect "custom_values": one "field=value" per line, parsed the
// same way as the node (later lines win, "#" lines and unknown text are kept).
function customKey(raw) {
    return String(raw).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseCustomValues(text) {
    const values = new Map();
    for (const line of String(text ?? "").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const index = trimmed.indexOf("=");
        const field = customKey(trimmed.slice(0, index));
        const value = trimmed.slice(index + 1).trim().replace(/^,+|,+$/g, "").trim();
        if (!value) continue;
        values.delete(field);
        values.set(field, value);
    }
    return values;
}

// Sets (or, with an empty value, removes) the lines of the given fields,
// keeping every other line exactly as written.
function updateCustomValues(text, changes) {
    const lines = String(text ?? "").split(/\r?\n/).filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith("#") || !trimmed.includes("=")) return true;
        return !changes.has(customKey(trimmed.slice(0, trimmed.indexOf("="))));
    });
    for (const [field, value] of changes) {
        const clean = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
        if (clean) lines.push(`${field}=${clean}`);
    }
    return lines.join("\n");
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

// "sub/dir/name.png [output]" <-> { filename, subfolder, type }: the annotated
// form LoadImage accepts for files outside the input folder.
function parseAnnotated(value) {
    let name = String(value ?? "").trim();
    if (!name) return null;
    let type = "input";
    const match = / \[(output|input|temp)\]$/.exec(name);
    if (match) {
        type = match[1];
        name = name.slice(0, match.index);
    }
    const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
    return { filename: name.slice(slash + 1), subfolder: slash >= 0 ? name.slice(0, slash) : "", type };
}

// Image refs end up as LoadImage paths: allow plain names inside ComfyUI's
// output / input / temp folders only, so a tampered characters.json cannot
// point the server at other files.
function isSafeRef(ref) {
    if (!ref || typeof ref.filename !== "string" || !ref.filename || /[\\/]/.test(ref.filename) || /^\.\.?$/.test(ref.filename)) return false;
    const subfolder = String(ref.subfolder ?? "");
    if (/^([\\/]|[A-Za-z]:)/.test(subfolder) || subfolder.split(/[\\/]/).includes("..")) return false;
    return ["output", "input", "temp"].includes(ref.type ?? "output");
}

function annotate(ref) {
    return `${ref.subfolder ? `${ref.subfolder}/` : ""}${ref.filename} [${ref.type ?? "output"}]`;
}

// Angle list text: one "Label: prompt" per line, "#" in front disables a line.
function parseAngles(text) {
    return String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
        const enabled = !line.startsWith("#");
        const body = enabled ? line : line.replace(/^#+\s*/, "");
        const match = /^([^:,]{1,32}):\s*(.*)$/.exec(body);
        return { enabled, label: (match ? match[1] : `Angle ${index + 1}`).trim(), prompt: (match ? match[2] : body).trim() };
    });
}

function serializeAngles(angles) {
    return angles.map((angle) => `${angle.enabled ? "" : "# "}${angle.label || "Angle"}: ${angle.prompt}`).join("\n");
}

// The Character Architect output alone, without the scene text appended to it.
function turnaroundRole(node) {
    return nodeTitle(node).replace(/^Turnaround\s*[·:-]?\s*/i, "").trim();
}

function characterText(texts) {
    const list = (texts ?? []).filter((text) => text?.text);
    const direct = list.find((text) => text.fromCharacter);
    if (direct) return direct.text;
    const sorted = [...list].sort((a, b) => a.text.length - b.text.length);
    return (sorted.find((text) => list.some((other) => other !== text && other.text.startsWith(text.text.trim()))) ?? sorted[0])?.text ?? "";
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
        this.sheets = new Map();
        this.batchRunning = false;
        this.editingCustom = null;
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
        const turnaroundView = this.view === "turnaround";
        const turnaroundSeed = turnaroundView ? this.turnaround()?.seedControl : null;
        const character = turnaroundView ? null : this.seedControl("character");
        let image = turnaroundView ? null : this.seedControl("image");
        if (image && character && image.widget === character.widget) image = null;
        fill(this.els.header,
            h("div", { class: "cas-brand", title: this.scopeLabel() },
                h("span", { class: "cas-title" }, "Character Architect"),
            ),
            h("div", { class: "cas-tabs" },
                this.tabButton("character", "1 · Character"),
                this.tabButton("turnaround", "2 · Turnaround"),
                this.tabButton("settings", "⚙ Settings"),
            ),
            h("div", { class: "cas-spacer" }),
            character && this.renderSeed(image ? "Character seed" : "Seed", character,
                "Seed fed to Character Architect. It resolves every field left on Random, so keep it fixed to keep the same character."),
            image && this.renderSeed("Image seed", image,
                "Noise seed of the first sampler. Change it to re-shoot the same character."),
            turnaroundSeed && this.renderSeed("Turnaround seed", turnaroundSeed,
                "One seed for every angle of a run, so they match. It advances once after each run if set to +1 or Random."),
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
                if (view === "turnaround") this.normalizeEngines();
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
        if (this.view === "turnaround") {
            const enabled = this.angleList(this.turnaround()).filter((angle) => angle.enabled).length;
            return h("div", { class: "cas-run" },
                this.run.running && h("button", {
                    class: "cas-btn cas-stop", title: "Interrupt the running generation",
                    onclick: () => this.interrupt(),
                }, "Stop"),
                h("button", {
                    class: "cas-btn cas-primary", disabled: this.batchRunning || !enabled,
                    title: "Queue one turnaround run per enabled angle (Ctrl+Enter)",
                    onclick: () => this.runTurnaround(),
                }, this.batchRunning ? "Queueing…" : `Generate ${enabled} angle${enabled === 1 ? "" : "s"}`),
            );
        }
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
                class: "cas-btn cas-primary", title: "Queue the character pipeline (Ctrl+Enter)",
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
        if (this.view === "turnaround") return this.renderTurnaroundNav();
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
        const custom = this.customValues();
        for (const widget of this.sectionWidgets(section)) {
            const kind = widgetKind(this.scope.cpf, widget);
            if (kind === "combo" && custom.has(widget.name)) {
                set += 1;
            } else if (kind === "combo") {
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
            [...PIPELINE_ROLES, TURNAROUND_ROLE].filter((role) => counts.get(role.id)).map((role) => item(role.id, role.label, counts.get(role.id))),
            h("div", { class: "cas-nav-divider" }),
            item("all", "All nodes", nodes.length),
            h("div", { class: "cas-nav-divider" }),
            item("diagnostics", "ⓘ Diagnostics", 0),
        );
    }

    // ------------------------------------------------------------ main panel

    renderMain(resetScroll = false) {
        if (!this.root || !this.scope) return;
        const top = this.els.main.scrollTop;
        if (this.view === "settings") this.renderPipelineMain();
        else if (this.view === "turnaround") this.renderTurnaroundMain();
        else this.renderCharacterMain();
        this.els.main.scrollTop = resetScroll ? 0 : top;
    }

    afterCharacterChange() {
        this.renderMain();
        this.renderNav();
        this.renderHeader();
    }

    renderCharacterMain() {
        if (isPlaceholderNode(this.scope.cpf)) {
            fill(this.els.main,
                h("div", { class: "cas-main-head" }, h("span", { class: "cas-main-title" }, "Character Architect is not installed")),
                h("div", { class: "cas-notice" },
                    h("p", {}, "ComfyUI loaded this Character Architect node as a missing-node placeholder: no installed node pack provides “CharacterPromptFactory”. A placeholder only keeps the saved values, not the option lists, so there is nothing to choose from."),
                    h("p", {}, "Install or repair the Character Architect node pack in ComfyUI/custom_nodes, restart ComfyUI, then load the workflow again. If the pack is installed, the ComfyUI start-up log shows why it failed to import."),
                    h("p", {}, "Settings and Turnaround keep working for the rest of the pipeline."),
                ),
            );
            return;
        }
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
            !widgets.length && h("div", { class: "cas-empty" },
                h("p", {}, "Your Character Architect node has none of these inputs under the names the Studio expects."),
                h("button", {
                    class: "cas-btn", title: "Collect the node's input names so they can be mapped",
                    onclick: () => {
                        this.view = "settings";
                        this.pipelineRole = "diagnostics";
                        this.renderAll();
                    },
                }, "ⓘ Open diagnostics"),
            ),
            section.pipelineText && this.renderPipelineTextFields(),
        );
    }

    renderPipelineTextFields() {
        const fields = [];
        for (const node of this.pipelineNodes({ turnaround: false })) {
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

    pipelineNodes({ turnaround = true } = {}) {
        const scope = this.scope;
        const nodes = [...new Set([...scope.nodes, ...scope.watch.values()])];
        return nodes.filter((node) => node !== scope.cpf && (turnaround || !scope.isTurnaround(node)));
    }

    roleOf(node) {
        if (this.scope?.isTurnaround(node)) return TURNAROUND_ROLE;
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

        if (role === "diagnostics") {
            this.renderDiagnostics();
            return;
        }
        let body;
        let title;
        if (role === "essentials") {
            title = "Essentials";
            body = this.renderEssentials(nodes.filter((node) => !this.scope.isTurnaround(node)));
        } else {
            const roleDef = [...PIPELINE_ROLES, TURNAROUND_ROLE].find((item) => item.id === role);
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

    // ------------------------------------------------------------ turnaround (phase 2)

    // The phase-2 nodes, found by their "Turnaround · <role>" titles. Every
    // turnaround Save Image is one engine; the active engine is the one that is not muted.
    turnaround() {
        const nodes = this.scope?.turnaroundNodes ?? [];
        if (!nodes.length) return null;
        const find = (role) => nodes.find((node) => turnaroundRole(node).toLowerCase() === role);
        const widgetOf = (node, name) => (node?.widgets ?? []).find((widget) => widget.name === name) ?? null;
        const reference = find("reference") ?? nodes.find((node) => nodeClass(node) === "LoadImage");
        const character = find("character");
        const angle = find("angle");
        const angleList = find("angle list");
        const seed = find("seed");
        const engines = nodes.filter((node) => isOutputNode(node) && SAVE_NODE.test(nodeClass(node))).map((save) => {
            const label = turnaroundRole(save).replace(/\s*·\s*Save$/i, "").trim() || nodeTitle(save);
            const key = label.split(/\s+/)[0].toLowerCase();
            const own = nodes.filter((node) => node !== save && turnaroundRole(node).toLowerCase().startsWith(key));
            return { save, label, key, nodes: own };
        }).sort((a, b) => Number(a.save.id) - Number(b.save.id) || String(a.save.id).localeCompare(String(b.save.id)));
        return {
            reference, referenceWidget: widgetOf(reference, "image"),
            character, characterWidget: widgetOf(character, "value"),
            angle, angleWidget: widgetOf(angle, "value"),
            angleList, angleListWidget: widgetOf(angleList, "value"),
            seedControl: seed ? this.seedSource(seed, "seed") : null,
            engines,
            active: engines.find((engine) => (engine.save.mode ?? 0) === 0) ?? null,
        };
    }

    angleList(turnaround) {
        if (turnaround?.angleListWidget) return parseAngles(turnaround.angleListWidget.value);
        return turnaround?.angleWidget ? [{ enabled: true, label: "Angle", prompt: String(turnaround.angleWidget.value ?? "") }] : [];
    }

    saveAngleList(turnaround, angles) {
        if (turnaround.angleListWidget) this.setValue(turnaround.angleList, turnaround.angleListWidget, serializeAngles(angles));
        else if (turnaround.angleWidget && angles[0]) this.setValue(turnaround.angle, turnaround.angleWidget, angles[0].prompt);
        this.renderMain();
        this.renderHeader();
    }

    // A freshly loaded workflow has every engine output active: keep only the first.
    normalizeEngines() {
        const turnaround = this.turnaround();
        const active = turnaround?.engines.filter((engine) => (engine.save.mode ?? 0) === 0) ?? [];
        if (active.length <= 1) return;
        for (const engine of active.slice(1)) this.setMode(engine.save, 2);
    }

    setEngine(engine) {
        const turnaround = this.turnaround();
        if (!turnaround) return;
        this.inBatch(() => {
            for (const item of turnaround.engines) this.setMode(item.save, item.save === engine.save ? 0 : 2);
        });
        this.renderAll();
    }

    setReference(ref, description) {
        if (!isSafeRef(ref)) {
            this.toast("error", "Character Studio", "That image reference points outside ComfyUI's output, input or temp folders and was ignored.");
            return false;
        }
        const turnaround = this.turnaround();
        if (!turnaround?.referenceWidget) {
            this.toast("warn", "Character Studio", "This workflow has no “Turnaround · Reference” Load Image node.");
            return false;
        }
        this.inBatch(() => {
            this.setValue(turnaround.reference, turnaround.referenceWidget, annotate(ref));
            if (description && turnaround.characterWidget) this.setValue(turnaround.character, turnaround.characterWidget, description);
        });
        return true;
    }

    useForTurnaround(image, texts) {
        if (!image?.ref) return;
        if (!this.setReference(image.ref, characterText(texts))) return;
        this.normalizeEngines();
        this.view = "turnaround";
        this.selected = null;
        this.renderAll();
    }

    useCharacterForTurnaround(character) {
        if (!character?.image || !this.setReference(character.image, character.description || character.prompt)) return;
        const sheet = this.sheetFor(annotate(character.image));
        for (const entry of character.turnaround ?? []) {
            if (isSafeRef(entry?.image) && typeof entry.angle === "string" && !sheet.has(entry.angle)) {
                sheet.set(entry.angle, { ref: entry.image, url: this.viewUrl(entry.image), engine: entry.engine ?? "", time: 0 });
            }
        }
        this.normalizeEngines();
        this.view = "turnaround";
        this.renderAll();
    }

    sheetFor(key) {
        if (!this.sheets.has(key)) this.sheets.set(key, new Map());
        return this.sheets.get(key);
    }

    latestCharacterRun() {
        return this.history.find((item) => item.phase !== "turnaround") ?? null;
    }

    renderTurnaroundNav() {
        const turnaround = this.turnaround();
        const jump = (anchor, label) => h("button", {
            class: "cas-nav-item",
            onclick: () => this.els.main.querySelector(`[data-anchor="${anchor}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }),
        }, h("span", {}, label));
        fill(this.els.nav,
            h("div", { class: "cas-nav-actions" },
                h("div", { class: "cas-nav-scope", title: this.scopeLabel() }, this.scopeLabel()),
                h("div", { class: "cas-nav-caption" }, turnaround?.active ? `Engine: ${turnaround.active.label}` : "No engine active"),
            ),
            turnaround && [jump("reference", "Reference"), jump("engine", "Engine"), jump("angles", "Angles"), jump("results", "Results")],
        );
    }

    renderTurnaroundMain() {
        const turnaround = this.turnaround();
        if (!turnaround) {
            fill(this.els.main,
                h("div", { class: "cas-main-head" }, h("span", { class: "cas-main-title" }, "Turnaround")),
                h("p", { class: "cas-hint" }, "This workflow has no Turnaround nodes. Load ComfyUI-Character-Studio/workflows/character_architect_krea2.json: it contains the character pipeline and both turnaround engines. Any node titled “Turnaround · …” belongs to this stage."),
            );
            return;
        }
        const angles = this.angleList(turnaround);
        const enabled = angles.filter((angle) => angle.enabled).length;
        const referenceValue = turnaround.referenceWidget?.value ?? "";
        const reference = parseAnnotated(referenceValue);
        const latest = this.latestCharacterRun();
        const shown = this.selected && this.selected.phase !== "turnaround" ? this.selected : null;
        const sheet = this.sheets.get(referenceValue) ?? new Map();
        const library = (this.library ?? []).filter((character) => character.image);
        const anchor = (id, label) => h("div", { class: "cas-subhead", dataset: { anchor: id } }, label);

        const updateAngle = (index, patch) => this.saveAngleList(turnaround, angles.map((angle, i) => (i === index ? { ...angle, ...patch } : angle)));
        const cleanLabel = (value, index) => String(value).replace(/[:,\n]/g, " ").trim() || `Angle ${index + 1}`;

        const engineNote = turnaround.active?.key === "krea2"
            ? "Image-to-image on your phase-1 Krea2 model, LoRAs and Krea2T enhancer. A higher change amount gives more freedom to turn the body, but less likeness."
            : turnaround.active?.key === "qwen"
                ? "Instruction edit with Qwen Image 2.1 Turbo: the reference image itself carries the identity. Needs the Qwen 2.1 model files listed in the README."
                : "";
        const engineFields = [];
        for (const node of turnaround.active?.nodes ?? []) {
            for (const widget of node.widgets ?? []) {
                const isTemplate = widget.name === "value" && nodeClass(node) === "PrimitiveStringMultiline";
                const label = isTemplate ? turnaroundRole(node) : TURNAROUND_SETTINGS.get(widget.name);
                if (!label || isWidgetLinked(node, widget) || widgetKind(node, widget) === "skip") continue;
                engineFields.push(this.renderField(node, widget, { label, note: isTemplate ? "{placeholders} are filled in per run" : turnaroundRole(node) }));
            }
        }

        fill(this.els.main,
            h("div", { class: "cas-main-head" },
                h("span", { class: "cas-main-title" }, "Turnaround"),
                h("span", { class: "cas-main-meta" }, `${enabled} of ${angles.length} angles · ${turnaround.active?.label ?? "no engine"}`),
                h("div", { class: "cas-spacer" }),
                h("button", {
                    class: "cas-btn cas-primary", disabled: this.batchRunning || !enabled,
                    title: "Queue one run per enabled angle (Ctrl+Enter)",
                    onclick: () => this.runTurnaround(),
                }, this.batchRunning ? "Queueing…" : `▶ Generate ${enabled} angle${enabled === 1 ? "" : "s"}`),
            ),
            h("p", { class: "cas-hint" }, "Phase 2 renders the character from several angles: one queued run per angle, all from the same reference image and seed. Only the turnaround nodes run; your character pipeline and its seeds are left as they are."),

            anchor("reference", "Reference"),
            h("div", { class: "cas-ref" },
                h("div", { class: "cas-ref-img" },
                    reference
                        ? h("img", { src: this.viewUrl(reference), alt: "Reference", onerror: (event) => event.target.classList.add("broken") })
                        : h("span", {}, "No reference yet"),
                ),
                h("div", { class: "cas-ref-side" },
                    h("div", { class: "cas-field-note" }, reference ? `${reference.filename} · ${reference.type}${reference.subfolder ? ` · ${reference.subfolder}` : ""}` : "Pick the character image the angles start from."),
                    latest && h("button", {
                        class: "cas-btn", title: "The final image of your most recent character run",
                        onclick: () => this.useForTurnaround(latest.images[0], latest.texts),
                    }, "Use latest character image"),
                    shown && h("button", {
                        class: "cas-btn", title: "The image currently shown in the right-hand panel",
                        onclick: () => this.useForTurnaround(shown, shown.texts ?? [...this.texts.values()]),
                    }, "Use image shown on the right"),
                    library.length > 0 && h("select", {
                        class: "cas-select",
                        onchange: (event) => this.useCharacterForTurnaround(library.find((character) => character.id === event.target.value)),
                    }, h("option", { value: "" }, "Saved character…"), library.map((character) => h("option", { value: character.id }, character.name))),
                ),
            ),
            turnaround.characterWidget && this.renderField(turnaround.character, turnaround.characterWidget, {
                label: "Character description",
                note: "Krea2 i2i prompt; filled from the reference's resolved prompt",
            }),

            anchor("engine", "Engine"),
            h("div", { class: "cas-chips cas-engines" }, turnaround.engines.map((engine) => h("button", {
                class: `cas-chip${turnaround.active === engine ? " on" : ""}`,
                title: `Use ${engine.label} for this phase (the other engine's output is muted)`,
                onclick: () => this.setEngine(engine),
            }, engine.label))),
            engineNote && h("p", { class: "cas-hint" }, engineNote),
            engineFields,

            anchor("angles", "Angles"),
            h("div", { class: "cas-angles" }, angles.map((angle, index) => h("div", { class: `cas-angle${angle.enabled ? "" : " off"}` },
                h("button", {
                    class: `cas-chip${angle.enabled ? " on" : ""}`, title: "Include this angle in the next run",
                    onclick: () => updateAngle(index, { enabled: !angle.enabled }),
                }, angle.enabled ? "On" : "Off"),
                h("input", {
                    class: "cas-text cas-angle-label", value: angle.label, title: "Label used for the result",
                    onchange: (event) => updateAngle(index, { label: cleanLabel(event.target.value, index) }),
                }),
                h("input", {
                    class: "cas-text", value: angle.prompt, title: "What this angle should show",
                    onchange: (event) => updateAngle(index, { prompt: event.target.value.replace(/\n/g, " ").trim() }),
                }),
                h("button", {
                    class: "cas-icon-btn", title: "Remove this angle",
                    onclick: () => this.saveAngleList(turnaround, angles.filter((_, i) => i !== index)),
                }, "✕"),
            ))),
            turnaround.angleListWidget && h("button", {
                class: "cas-btn cas-add",
                onclick: () => this.saveAngleList(turnaround, [...angles, { enabled: true, label: `Angle ${angles.length + 1}`, prompt: "" }]),
            }, "+ Add angle"),

            anchor("results", "Results for this reference"),
            sheet.size || angles.length
                ? h("div", { class: "cas-sheet" }, [...new Set([...angles.map((angle) => angle.label), ...sheet.keys()])].map((label) => {
                    const entry = sheet.get(label);
                    return h("button", {
                        class: `cas-sheet-item${entry ? "" : " empty"}${this.selected?.url && this.selected.url === entry?.url ? " on" : ""}`,
                        disabled: !entry,
                        onclick: () => {
                            this.selected = { ...entry, title: `${label}${entry.engine ? ` · ${entry.engine}` : ""}`, phase: "turnaround" };
                            this.renderSide();
                            this.renderMain();
                        },
                    },
                    entry ? h("img", { src: entry.url, alt: label, loading: "lazy", onerror: (event) => event.target.classList.add("broken") }) : h("div", { class: "cas-sheet-empty" }, "not generated"),
                    h("span", {}, label, entry?.engine ? ` · ${entry.engine}` : ""));
                }))
                : h("p", { class: "cas-muted" }, "No results yet."),
        );
    }

    // ------------------------------------------------------------ diagnostics

    // A compact report of what the Studio sees on the Character Architect node,
    // to paste into a support conversation. Text values are cut to 40 characters.
    async buildDiagnostics() {
        const cpf = this.scope?.cpf;
        let comfyui = null;
        try {
            const stats = await this.api.getSystemStats?.();
            comfyui = stats?.system?.comfyui_version ?? null;
        } catch {
            comfyui = null;
        }
        const nodeData = cpf?.constructor?.nodeData ?? {};
        const defined = [...Object.keys(nodeData.input?.required ?? {}), ...Object.keys(nodeData.input?.optional ?? {})];
        const known = new Set(SECTIONS.flatMap((section) => section.keys));
        const widgets = (cpf?.widgets ?? []).map((widget) => {
            const value = widget.value;
            const shown = typeof value === "string" ? value.slice(0, 40) : value && typeof value === "object" ? "[object]" : value;
            return [widget.name, widget.type ?? null, widgetKind(cpf, widget), widget.hidden || widget.options?.hidden ? 1 : 0,
                known.has(widget.name) ? 1 : 0, comboValues(widget, cpf).length, shown];
        });
        const lines = [
            `studio ${STUDIO_VERSION} | frontend ${globalThis.__COMFYUI_FRONTEND_VERSION__ ?? "?"} | comfyui ${comfyui ?? "?"}`,
            `node class=${nodeClass(cpf)} title=${JSON.stringify(cpf?.title ?? "")} module=${nodeData.python_module ?? "?"} location=${this.scope?.inRoot ? "canvas" : "subgraph"}`,
            `inputs defined=${defined.length} widgets=${widgets.length} matched=${widgets.filter((row) => row[4]).length} placeholder=${isPlaceholderNode(cpf) ? "yes (node pack not loaded)" : "no"}`,
            `defined input names: ${defined.join(", ")}`,
            "widgets [name, type, kind, hidden, matched, options, value]:",
            ...widgets.map((row) => JSON.stringify(row)),
        ];
        return lines.join("\n");
    }

    async renderDiagnostics() {
        const output = h("textarea", { class: "cas-textarea cas-diagnostics", readonly: true, rows: "18", spellcheck: "false", value: "Collecting…" });
        fill(this.els.main,
            h("div", { class: "cas-main-head" },
                h("span", { class: "cas-main-title" }, "Diagnostics"),
                h("span", { class: "cas-main-meta" }, `Character Studio ${STUDIO_VERSION}`),
                h("div", { class: "cas-spacer" }),
                h("button", {
                    class: "cas-btn cas-primary",
                    onclick: () => navigator.clipboard?.writeText(output.value).then(
                        () => this.toast("success", "Character Studio", "Diagnostics copied. Paste them into the chat."),
                        () => {
                            output.select();
                            this.toast("warn", "Character Studio", "Clipboard blocked: the text is selected, press Ctrl+C.");
                        },
                    ),
                }, "Copy"),
            ),
            h("p", { class: "cas-hint" }, "What the Studio sees on your Character Architect node: its input names, widget types, which node pack registered it, and your ComfyUI version. Text values are cut to 40 characters. Copy it and paste it into the chat."),
            output,
        );
        output.value = await this.buildDiagnostics();
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
            kind === "combo" && !linked && h("div", { class: "cas-field-value" },
                opts.character && this.customValues().has(name) ? `✎ ${this.customValues().get(name)}` : optionLabel(widget.value)),
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
            const custom = opts.character ? this.customValues().get(widget.name) : undefined;
            const option = (value) => this.renderOption(node, widget, value, { asList, swatches, custom });
            fill(zone,
                (specials.length > 0 || opts.character) && h("div", { class: "cas-chips" },
                    specials.map((value) => this.renderOption(node, widget, value, { special: true, custom })),
                    opts.character && this.renderCustomChip(widget, custom, paint),
                ),
                opts.character && this.editingCustom === widget.name && this.renderCustomEditor(widget, custom, paint),
                custom && h("div", { class: "cas-muted" }, "Your text replaces this field in the prompt. Pick an option to go back."),
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

    renderOption(node, widget, value, { special = false, asList = false, swatches = false, custom } = {}) {
        const on = widget.value === value && !custom;
        const tag = genderTag(value);
        const swatch = swatches && !special ? colorSwatch(value) : null;
        return h("button", {
            class: `${asList ? "cas-opt" : "cas-chip"}${on ? " on" : ""}${special ? " special" : ""}${custom ? " overridden" : ""}`,
            title: String(value),
            onclick: () => {
                // Picking a preset ends a custom value for this field.
                this.inBatch(() => {
                    if (custom) this.setCustomValues(new Map([[widget.name, ""]]));
                    this.setValue(node, widget, value);
                });
                this.editingCustom = null;
                this.afterChange(node);
            },
        },
        swatch && h("span", { class: "cas-swatch", style: { background: swatch } }),
        h("span", { class: "cas-opt-text" }, optionLabel(value)),
        tag && h("span", { class: `cas-tag cas-tag-${tag}` }, tag === "female" ? "F" : tag === "male" ? "M" : "U"),
        );
    }

    // ------------------------------------------------------------ custom values

    customValuesWidget() {
        return this.cpfWidget("custom_values");
    }

    customValues() {
        return parseCustomValues(this.customValuesWidget()?.value);
    }

    // Fields Character Architect accepts in custom_values: its category list
    // (the Override field options) plus a few extra inputs.
    customFieldSet() {
        const override = this.cpfWidget("override_field");
        const fields = new Set(comboValues(override, this.scope.cpf).filter((value) => value !== "None"));
        CUSTOM_VALUE_EXTRA_FIELDS.forEach((field) => fields.add(field));
        return fields;
    }

    setCustomValues(changes) {
        const widget = this.customValuesWidget();
        if (!widget || !changes.size) return false;
        return this.setValue(this.scope.cpf, widget, updateCustomValues(widget.value, changes));
    }

    renderCustomChip(widget, custom, repaint) {
        if (!this.customValuesWidget()) {
            return h("button", {
                class: "cas-chip special", disabled: true,
                title: "Custom values need the Character Architect version with the custom_values input (see the README).",
            }, "✎ Custom");
        }
        if (!this.customFieldSet().has(widget.name)) return null;
        const edit = () => {
            this.editingCustom = widget.name;
            repaint();
            this.root?.querySelector(".cas-custom-input")?.focus();
        };
        if (!custom) {
            return h("button", { class: "cas-chip special cas-custom", title: "Type your own value for this field", onclick: edit }, "✎ Custom…");
        }
        return h("span", { class: "cas-custom-on" },
            h("button", { class: "cas-chip on cas-custom", title: "Your own value. Click to edit.", onclick: edit },
                h("span", { class: "cas-opt-text" }, `✎ ${custom}`)),
            h("button", {
                class: "cas-icon-btn", title: "Remove the custom value",
                onclick: () => {
                    this.setCustomValues(new Map([[widget.name, ""]]));
                    this.afterCharacterChange();
                },
            }, "✕"),
        );
    }

    renderCustomEditor(widget, custom, repaint) {
        let done = false;
        const finish = (save, value) => {
            if (done) return;
            done = true;
            this.editingCustom = null;
            if (save && value.trim() !== (custom ?? "")) {
                this.setCustomValues(new Map([[widget.name, value]]));
                this.afterCharacterChange();
            } else {
                repaint();
            }
        };
        const example = CUSTOM_VALUE_EXAMPLES[widget.name];
        const input = h("input", {
            class: "cas-text cas-custom-input", value: custom ?? "", spellcheck: "true",
            placeholder: example ? `Your own value, e.g. ${example}` : "Your own value for this field",
            onkeydown: (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    finish(true, event.target.value);
                } else if (event.key === "Escape") {
                    // Cancel the edit without closing the Studio.
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false, "");
                }
            },
            onblur: (event) => finish(true, event.target.value),
        });
        return h("div", { class: "cas-custom-row" },
            input,
            h("span", { class: "cas-muted" }, "Enter to apply · Esc to cancel · empty removes it"),
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
            const tracker = this.app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
            (tracker?.captureCanvasState ?? tracker?.checkState)?.call(tracker);
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
        const custom = this.customValues();
        const cleared = new Map();
        this.inBatch(() => {
            for (const widget of cpf.widgets ?? []) {
                const name = widget?.name;
                if (!name || widgetKind(cpf, widget) !== "combo") continue;
                if (RANDOM_PROTECTED_KEYS.has(name) || SET_RANDOM_SKIP_KEYS.has(name) || name.startsWith("lock_")) continue;
                if (keySet && !keySet.has(name)) continue;
                if (!keySet && (locked.has(name) || GLOBAL_PIVOT_KEYS.has(name) || this.isPivotLocked(name))) continue;
                if (comboValues(widget, cpf).includes("Random")) {
                    this.setValue(cpf, widget, "Random");
                    if (custom.has(name)) cleared.set(name, "");
                }
            }
            this.setCustomValues(cleared);
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
        const custom = this.customValues();
        const cleared = new Map();
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
                if (custom.has(name)) cleared.set(name, "");
            }
            this.setCustomValues(cleared);
        });
        this.afterCharacterChange();
    }

    resetToDefaults(node, keys) {
        const custom = node === this.scope.cpf ? this.customValues() : new Map();
        this.inBatch(() => {
            for (const name of keys) {
                const widget = (node.widgets ?? []).find((item) => item.name === name);
                const value = defaultValue(node, name);
                if (widget && value !== undefined && !isWidgetLinked(node, widget)) this.setValue(node, widget, value);
            }
            this.setCustomValues(new Map(keys.filter((name) => custom.has(name)).map((name) => [name, ""])));
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
                // Enter each subgraph level from the root so ComfyUI's breadcrumb matches.
                if (canvas.graph !== this.app.graph) canvas.setGraph(this.app.graph);
                for (const host of findHostChain(this.app.graph, graph)) canvas.openSubgraph(host.subgraph, host);
            }
            canvas.deselectAll?.();
            canvas.selectNode?.(node, false);
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

    // Header button and Ctrl+Enter run whatever the current view is about.
    queue() {
        return this.view === "turnaround" ? this.runTurnaround() : this.queuePhase("character", { count: this.batchCount });
    }

    // Output nodes of one phase, so a run never re-renders the other phase.
    phaseTargets(phase) {
        const scope = this.scope;
        const nodes = phase === "turnaround"
            ? [this.turnaround()?.active?.save].filter(Boolean)
            : this.pipelineNodes({ turnaround: false });
        return nodes
            .filter((node) => isOutputNode(node) && (node.mode ?? 0) === 0)
            .map((node) => scope.execIdOf(node))
            .filter(Boolean);
    }

    // ComfyUI advances every seed after any queue, even a partial one. Hold
    // the given nodes' seeds on "fixed" while queueing and restore them after.
    holdSeedControls(nodes) {
        const held = [];
        for (const node of nodes) {
            for (const widget of node.widgets ?? []) {
                if (!String(widget?.name).startsWith("control_after_generate") || widget.value === "fixed") continue;
                held.push([widget, widget.value]);
                widget.value = "fixed";
            }
        }
        return () => held.forEach(([widget, value]) => { widget.value = value; });
    }

    async queuePhase(phase, { count = 1, meta = {} } = {}) {
        if (!this.scope) return false;
        const app = this.app;
        const api = this.api;
        const scope = this.scope;
        this.run.error = null;
        this.nodeErrors = null;
        this.flushGraphChanged();
        const targets = this.phaseTargets(phase);
        if (!targets.length) {
            this.run.error = phase === "turnaround"
                ? "No turnaround engine is active. Pick one under Engine."
                : "The character pipeline has no active Save Image or Preview node to run.";
            this.renderSide();
            return false;
        }
        const release = this.holdSeedControls(phase === "turnaround" ? [...scope.nodes, ...scope.turnaroundNodes] : scope.turnaroundNodes);
        // app.queuePrompt does not return prompt ids; capture them (and the
        // exact inputs that were submitted) while this one call is in flight.
        const hadOwn = Object.prototype.hasOwnProperty.call(api, "queuePrompt");
        const original = api.queuePrompt;
        const studio = this;
        api.queuePrompt = async function (number, data, ...rest) {
            const response = await original.call(this, number, data, ...rest);
            try {
                if (response?.prompt_id) {
                    studio.ourPrompts.set(response.prompt_id, {
                        ...meta,
                        phase,
                        snapshot: phase === "character" ? studio.snapshotFromPrompt(data?.output) : null,
                    });
                }
            } catch (error) {
                console.warn("[Character Studio] could not snapshot queued prompt", error);
            }
            return response;
        };
        let queued = false;
        try {
            queued = (await app.queuePrompt(0, Math.max(1, Math.min(99, Number(count) || 1)), targets)) !== false;
        } catch (error) {
            this.run.error = String(error?.message ?? error);
        } finally {
            if (hadOwn) api.queuePrompt = original;
            else delete api.queuePrompt;
            release();
        }
        const errors = app.lastNodeErrors;
        if (errors && Object.keys(errors).length) {
            this.nodeErrors = errors;
            queued = false;
        }
        this.renderHeader();
        this.renderSide();
        return queued && !this.run.error;
    }

    // One queued prompt per enabled angle, all from the same reference and seed.
    async runTurnaround() {
        const turnaround = this.turnaround();
        const fail = (message) => {
            this.run.error = message;
            this.renderSide();
            this.renderMain();
            return false;
        };
        if (!turnaround) return fail("This workflow has no Turnaround nodes. Load ComfyUI-Character-Studio/workflows/character_architect_krea2.json.");
        if (!turnaround.active) return fail("No turnaround engine is active. Pick one under Engine.");
        if (!turnaround.angleWidget) return fail("The workflow is missing its “Turnaround · Angle” node.");
        const reference = turnaround.referenceWidget?.value;
        if (!parseAnnotated(reference)) return fail("Pick a reference image first.");
        const angles = this.angleList(turnaround).filter((angle) => angle.enabled);
        if (!angles.length) return fail("Enable at least one angle.");

        const previous = turnaround.angleWidget.value;
        this.batchRunning = true;
        this.renderHeader();
        try {
            for (const angle of angles) {
                this.setValue(turnaround.angle, turnaround.angleWidget, angle.prompt, { record: false });
                const ok = await this.queuePhase("turnaround", {
                    meta: { angle: angle.label, engine: turnaround.active.label, reference },
                });
                if (!ok) break;
            }
        } finally {
            this.setValue(turnaround.angle, turnaround.angleWidget, previous, { record: false });
            this.batchRunning = false;
        }
        // The seed was held during the batch so every angle shares it; advance it once now.
        this.applySeedControlOnce(turnaround.seedControl);
        this.renderAll();
        return true;
    }

    applySeedControlOnce(control) {
        if (!control?.control) return;
        const mode = control.control.value;
        const current = Number(control.widget.value) || 0;
        let next;
        if (mode === "randomize") next = randomSeed();
        else if (mode === "increment" || mode === "increment-wrap") next = current + 1;
        else if (mode === "decrement") next = current - 1;
        if (next === undefined) return;
        const options = control.widget.options ?? {};
        next = Math.min(options.max ?? SEED_MAX, Math.max(options.min ?? 0, next));
        this.setValue(control.node, control.widget, next, { record: false });
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
        const info = this.ourPrompts.get(promptId) ?? null;
        if (info?.phase !== "turnaround") {
            for (const stage of this.stages.values()) stage.stale = true;
            for (const text of this.texts.values()) text.stale = true;
        }
        this.current = { promptId, info, snapshot: info?.snapshot ?? null, images: [], startedAt: Date.now() };
        this.selected = null;
        if (this.run.live) URL.revokeObjectURL(this.run.live);
        this.run = { running: true, value: 0, max: 0, label: "", live: null, error: null };
        this.renderHeader();
        this.renderSideSoon();
    }

    touch(promptId) {
        const id = promptId ?? this.activePromptId;
        if (this.current && !this.current.promptId && id) {
            this.current.promptId = id;
            this.current.info ??= this.ourPrompts.get(id) ?? null;
        }
        if (!this.current || !this.isCurrentPrompt(id)) this.startRun(id);
    }

    // Unknown ids on either side count as a match: some events carry no prompt id.
    isCurrentPrompt(promptId) {
        return !!this.current && (!promptId || !this.current.promptId || promptId === this.current.promptId);
    }

    runLabel(node) {
        const angle = this.current?.info?.angle;
        return angle ? `${angle} · ${nodeTitle(node)}` : nodeTitle(node);
    }

    onExecuting(detail) {
        const id = detail && typeof detail === "object" ? detail.display_node ?? detail.node : detail;
        if (id == null || !this.scope) return;
        const node = this.scope.watch.get(String(id));
        if (!node) return;
        this.touch(detail?.prompt_id);
        this.run.label = this.runLabel(node);
        this.run.value = 0;
        this.run.max = 0;
        this.renderProgress();
    }

    onProgress(detail) {
        if (!this.scope || !this.isCurrentPrompt(detail?.prompt_id)) return;
        const node = detail?.node != null ? this.scope.watch.get(String(detail.node)) : null;
        if (node) this.run.label = this.runLabel(node);
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
        const turnaround = this.scope.isTurnaround(node);
        if (Array.isArray(output.images) && output.images.length) {
            const images = output.images.filter((image) => image?.filename).map((image) => {
                const ref = { filename: image.filename, subfolder: image.subfolder ?? "", type: image.type ?? "output" };
                return { ref, url: this.viewUrl(ref) };
            });
            if (turnaround) {
                const info = this.ourPrompts.get(detail?.prompt_id) ?? this.current?.info ?? {};
                const angle = info.angle ?? "Angle";
                const key = info.reference ?? this.turnaround()?.referenceWidget?.value ?? "";
                if (images.length) this.sheetFor(key).set(angle, { ...images[0], engine: info.engine ?? "", time: Date.now() });
                this.current?.images.push(...images.map((image) => ({ ...image, title: `${angle}${info.engine ? ` · ${info.engine}` : ""}`, final: true })));
                if (this.view === "turnaround") this.renderMain();
            } else {
                const final = SAVE_NODE.test(nodeClass(node));
                this.stages.set(execId, { title: nodeTitle(node), images, stale: false, final, order });
                this.current?.images.push(...images.map((image) => ({ ...image, title: nodeTitle(node), final })));
            }
        }
        const text = output.text ?? output.string;
        if (!turnaround && Array.isArray(text) && text.length) {
            this.texts.set(execId, {
                title: nodeTitle(node), text: text.map(String).join("\n"), stale: false, order,
                fromCharacter: this.readsCharacterNode(node),
            });
        }
        this.renderSideSoon();
    }

    // True when a display node is wired straight to the Character Architect output.
    readsCharacterNode(node) {
        const input = (node.inputs ?? []).find((slot) => slot?.link != null);
        const link = input ? getLink(node.graph, input.link) : null;
        return !!link && getNodeById(node.graph, link.origin_id) === this.scope.cpf;
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
            const turnaround = current.info?.phase === "turnaround";
            this.history.unshift({
                id: newId(),
                time: Date.now(),
                phase: turnaround ? "turnaround" : "character",
                images,
                texts: turnaround ? [] : [...this.texts.values()].filter((text) => !text.stale).map(({ title, text, fromCharacter }) => ({ title, text, fromCharacter })),
                snapshot: current.snapshot,
            });
            this.history.length = Math.min(this.history.length, HISTORY_LIMIT);
        }
        this.ourPrompts.delete(current.promptId);
        this.renderHeader();
        this.renderSide();
        if (this.view === "turnaround") this.renderMain();
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
        if (this.view === "turnaround") {
            const sheet = this.sheets.get(this.turnaround()?.referenceWidget?.value ?? "");
            const [angle, entry] = [...(sheet ?? new Map())].sort((a, b) => b[1].time - a[1].time)[0] ?? [];
            if (entry) return { ...entry, title: `${angle}${entry.engine ? ` · ${entry.engine}` : ""}`, phase: "turnaround" };
        }
        return this.latestStageImage();
    }

    // The image a saved character points at: never a turnaround angle.
    characterImage() {
        if (this.selected && this.selected.phase !== "turnaround") return this.selected;
        return this.latestStageImage();
    }

    latestStageImage() {
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
            image && !live && image.ref && image.phase !== "turnaround" && this.scope.turnaroundNodes.length > 0 && h("button", {
                class: "cas-btn cas-wide",
                title: "Make this image the turnaround reference and open the Turnaround stage",
                onclick: () => this.useForTurnaround(image, this.selected?.texts ?? [...this.texts.values()]),
            }, "→ Use for turnaround"),

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
                        this.selected = { ...first, title: `${first.title} · ${formatTime(item.time)}`, snapshot: item.snapshot, historyId: item.id, texts: item.texts, phase: item.phase };
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
        const image = this.characterImage();
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
                            h("span", { class: "cas-muted" }, formatTime(character.created),
                                character.turnaround?.length ? ` · ${character.turnaround.length} angles` : ""),
                        ),
                        h("button", { class: "cas-btn", title: "Load these settings and seeds onto the node", onclick: () => this.loadCharacter(character) }, "Load"),
                        character.image && this.scope.turnaroundNodes.length > 0 && h("button", {
                            class: "cas-icon-btn", title: "Use this character as the turnaround reference",
                            onclick: () => this.useCharacterForTurnaround(character),
                        }, "→"),
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
                    character && typeof character.name === "string" && character.values && typeof character.values === "object")
                    .map((character) => ({ ...character, image: isSafeRef(character.image) ? character.image : null }));
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
        const image = this.characterImage();
        const selected = this.selected?.phase !== "turnaround" ? this.selected : null;
        const snapshot = selected?.snapshot ?? this.history.find((item) => item.snapshot)?.snapshot ?? this.liveSnapshot();
        const texts = selected?.texts ?? [...this.texts.values()].filter((text) => !text.stale);
        const sheet = image?.ref ? this.sheets.get(annotate(image.ref)) : null;
        const entry = {
            id: existing?.id ?? newId(),
            name,
            created: new Date().toISOString(),
            values: snapshot.values,
            seeds: snapshot.seeds,
            prompt: texts.map((text) => text.text).join("\n\n"),
            description: characterText(texts),
            image: image?.ref ?? null,
            turnaround: [...(sheet ?? new Map())].map(([angle, item]) => ({ angle, engine: item.engine ?? "", image: item.ref })),
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
