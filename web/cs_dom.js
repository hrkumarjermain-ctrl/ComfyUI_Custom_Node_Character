// Character Architect Studio — tiny DOM builder.
// Text is always inserted as text nodes, never as HTML, so option values and
// node titles coming from a workflow file cannot inject markup or scripts.

export function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
        if (value == null || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === "value" || key === "checked" || key === "disabled" || key === "selected") el[key] = value;
        else el.setAttribute(key, value === true ? "" : String(value));
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children) {
        if (child == null || child === false || child === true) continue;
        if (Array.isArray(child)) append(el, child);
        else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function isEditable(target) {
    const tag = target?.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target?.isContentEditable;
}

// Replaces an element's children using the same rules as h().
export function fill(el, ...children) {
    el.replaceChildren();
    append(el, children);
    return el;
}
