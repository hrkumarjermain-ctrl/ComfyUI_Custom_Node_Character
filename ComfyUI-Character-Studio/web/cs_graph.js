// Character Architect Studio — graph helpers (no DOM, no app imports).
import { CPF_CLASS } from "./cs_constants.js";

export function nodeClass(node) {
    return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

export function isCharacterNode(node) {
    return nodeClass(node) === CPF_CLASS;
}

export function graphNodes(graph) {
    return graph?._nodes ?? graph?.nodes ?? [];
}

export function getLink(graph, linkId) {
    const links = graph?.links;
    if (!links || linkId == null) return null;
    return typeof links.get === "function" ? links.get(linkId) : links[linkId];
}

export function getNodeById(graph, id) {
    if (!graph || id == null) return null;
    return graph.getNodeById?.(id) ?? graphNodes(graph).find((node) => String(node.id) === String(id)) ?? null;
}

// First CharacterPromptFactory inside a graph, searching nested subgraphs.
export function findCharacterNode(graph, depth = 0) {
    if (!graph || depth > 8) return null;
    const nodes = graphNodes(graph);
    const direct = nodes.find(isCharacterNode);
    if (direct) return direct;
    for (const node of nodes) {
        if (node?.subgraph) {
            const nested = findCharacterNode(node.subgraph, depth + 1);
            if (nested) return nested;
        }
    }
    return null;
}

export function containsCharacterNode(node) {
    return isCharacterNode(node) || (!!node?.subgraph && !!findCharacterNode(node.subgraph));
}

// Nodes in the root graph that can host the Studio: Character Architect
// nodes and subgraph nodes that contain one.
export function findStudioTargets(rootGraph) {
    return graphNodes(rootGraph).filter(containsCharacterNode);
}

// Chain of subgraph nodes from the root graph down to the subgraph that is
// `targetGraph`. Empty when targetGraph is the root.
export function findHostChain(rootGraph, targetGraph, depth = 0) {
    if (!rootGraph || rootGraph === targetGraph || depth > 8) return [];
    for (const node of graphNodes(rootGraph)) {
        if (!node?.subgraph) continue;
        if (node.subgraph === targetGraph) return [node];
        const nested = findHostChain(node.subgraph, targetGraph, depth + 1);
        if (nested.length) return [node, ...nested];
    }
    return [];
}

function linkedNeighbours(node, direction) {
    const graph = node.graph;
    const result = [];
    if (direction !== "down") {
        for (const input of node.inputs ?? []) {
            const link = getLink(graph, input?.link);
            const origin = link ? getNodeById(graph, link.origin_id) : null;
            if (origin) result.push(origin);
        }
    }
    if (direction !== "up") {
        for (const output of node.outputs ?? []) {
            for (const linkId of output?.links ?? []) {
                const link = getLink(graph, linkId);
                const target = link ? getNodeById(graph, link.target_id) : null;
                if (target) result.push(target);
            }
        }
    }
    return result;
}

export function connectedComponent(start, direction = "both") {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
        const node = queue.shift();
        for (const next of linkedNeighbours(node, direction)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
            }
        }
    }
    return [...seen];
}

// Execution order (upstream first); ties keep graph order.
export function topoSort(nodes) {
    const set = new Set(nodes);
    const indegree = new Map(nodes.map((node) => [node, 0]));
    for (const node of nodes) {
        for (const next of linkedNeighbours(node, "down")) {
            if (set.has(next)) indegree.set(next, indegree.get(next) + 1);
        }
    }
    const ready = nodes.filter((node) => indegree.get(node) === 0);
    const ordered = [];
    while (ready.length) {
        const node = ready.shift();
        ordered.push(node);
        for (const next of linkedNeighbours(node, "down")) {
            if (!set.has(next)) continue;
            indegree.set(next, indegree.get(next) - 1);
            if (indegree.get(next) === 0) ready.push(next);
        }
    }
    for (const node of nodes) if (!ordered.includes(node)) ordered.push(node);
    return ordered;
}

export function inputForWidget(node, widgetName) {
    return (node.inputs ?? []).find((input) => input?.widget?.name === widgetName || (input?.name === widgetName && input?.widget));
}

export function isWidgetLinked(node, widget) {
    if (widget?.type === "converted-widget") return true;
    const input = inputForWidget(node, widget?.name);
    return input?.link != null;
}

// Node feeding a named input (or widget input), if any.
export function upstreamOf(node, inputName) {
    const input = (node.inputs ?? []).find((slot) => slot?.name === inputName || slot?.widget?.name === inputName);
    const link = getLink(node.graph, input?.link);
    return link ? getNodeById(node.graph, link.origin_id) : null;
}

export function downstreamInputNames(node) {
    const names = [];
    for (const output of node.outputs ?? []) {
        for (const linkId of output?.links ?? []) {
            const link = getLink(node.graph, linkId);
            const target = link ? getNodeById(node.graph, link.target_id) : null;
            const slot = target?.inputs?.[link.target_slot];
            if (slot?.name) names.push(slot.name);
        }
    }
    return names;
}

// Everything the Studio needs to know about where a Character Architect node lives.
export function resolveScope(rootGraph, target) {
    let cpf = null;
    if (isCharacterNode(target)) cpf = target;
    else if (target?.subgraph) cpf = findCharacterNode(target.subgraph);
    if (!cpf) {
        const first = findStudioTargets(rootGraph)[0];
        cpf = first ? (isCharacterNode(first) ? first : findCharacterNode(first.subgraph)) : null;
    }
    if (!cpf) return null;

    const graph = cpf.graph;
    const inRoot = graph === rootGraph;
    let hostChain = [];
    if (!inRoot) {
        if (target?.subgraph && target.graph === rootGraph) {
            hostChain = target.subgraph === graph ? [target] : [target, ...findHostChain(target.subgraph, graph)];
        } else {
            hostChain = findHostChain(rootGraph, graph);
        }
    }
    const hostPath = hostChain.map((node) => String(node.id));
    const candidates = inRoot ? connectedComponent(cpf) : [...graphNodes(graph)];

    // Phase 2 lives in the same graph: every node titled "Turnaround …" and
    // everything that only exists downstream of those nodes.
    const turnaround = new Set();
    for (const node of graphNodes(graph)) {
        if (isTurnaroundNode(node)) connectedComponent(node, "down").forEach((item) => turnaround.add(item));
    }

    // Execution ids as reported by the server: "<host>:<host>:<node>".
    const watch = new Map();
    for (const node of [...candidates, ...turnaround]) watch.set([...hostPath, String(node.id)].join(":"), node);
    // Display and save nodes wired to the subgraph outputs live in the parent graphs.
    hostChain.forEach((host, index) => {
        const parentPath = hostPath.slice(0, index);
        for (const node of connectedComponent(host, "down")) {
            if (node === host) continue;
            watch.set([...parentPath, String(node.id)].join(":"), node);
            if (isTurnaroundNode(node)) turnaround.add(node);
        }
    });

    return {
        cpf,
        graph,
        inRoot,
        host: hostChain[0] ?? null,
        hostChain,
        hostPath,
        nodes: topoSort(candidates.filter((node) => !turnaround.has(node))),
        turnaroundNodes: topoSort([...turnaround]),
        isTurnaround: (node) => turnaround.has(node),
        watch,
        execIdOf(node) {
            for (const [id, candidate] of watch) if (candidate === node) return id;
            return null;
        },
    };
}

export function isTurnaroundNode(node) {
    return /^Turnaround\b/i.test(String(node?.title ?? ""));
}

export function isOutputNode(node) {
    const data = node?.constructor?.nodeData;
    if (data && "output_node" in data) return !!data.output_node;
    return /^(SaveImage|PreviewImage|PreviewAny)$|ShowText|Save.*Image/i.test(nodeClass(node));
}
