# Character Architect Studio for ComfyUI

A full-screen, button-driven character creator for the **Character Architect** node
(`CharacterPromptFactory`) and the pipeline around it.

The Studio adds **no backend nodes**. It is a frontend extension that reads and writes
the real widgets of your installed Character Architect node and of every node in its
pipeline. That means:

- every option list comes live from your node, so new options appear automatically;
- the canvas, the subgraph and the Studio always show the same values;
- you can still edit anything granularly on the canvas or inside the subgraph.

## Requirements

- A recent ComfyUI with subgraph support (2025 or later).
- The Character Architect node pack installed (this repo does **not** contain it).
- For the bundled Krea2 workflow: the custom node packs it uses (ComfyUI Manager's
  *Install Missing Custom Nodes* finds them).

## Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/hrkumarjermain-ctrl/ComfyUI_Custom_Node_Character.git
```

Restart ComfyUI and reload the browser tab.

## Opening the Studio

Any of these opens it for the matching Character Architect node:

- the **🎭 Open Character Studio** button on the Character Architect node, or on a
  subgraph node that contains one;
- right-click either node → **🎭 Open Character Studio**;
- the **Character Studio** tab in the left sidebar;
- the menu **Extensions → Character Architect → Open Character Studio**
  (the command can also be bound to a key in ComfyUI's keybinding settings).

Inside the Studio: **Ctrl+Enter** queues, **Ctrl+Z** undoes the last Studio change,
**Esc** closes, **Ctrl+S** still saves the workflow.

## What is inside

**Character view** — every input of the node as clickable chips, grouped as Subject,
Body, Face, Hair, Make-up & Ink, Outfit, Sets & Cosplay, Accessories, Scene & Pose,
Camera & Light, Text & Wildcards and Override & Inspect. Any input the Studio does not
know yet appears under **Other**.

- `None`, `Random` and `Forced Random` are dashed chips; long option lists get a filter
  box and a *Show all* toggle.
- Options tagged `(female)`, `(male)`, `(unisex)` are filtered by the selected gender,
  the same way the node does it. *Show all genders* turns that off.
- **All random / All none / Defaults** per section, and **All random / Reset all** for
  the whole character. These follow the node's own rules: section **Lock**s and the
  Media / Gender / Rating pivot locks (🔒) are shared with the node on the canvas.
- Archetype fields (composition, body, clothing) are highlighted at the top of their
  section.

**⚙ Settings view** — the pipeline:

- *Essentials*: diffusion model, text encoder, VAE, aspect ratio / megapixels, the LoRA
  stack (on/off, file, strength, add slot) and an Active / Bypass / Mute switch for
  every sampling, decode and post pass.
- One card per node, grouped as Outputs, Seeds, Models & LoRAs, Sampling, Resolution &
  Latent, Prompt & Conditioning, Encode / Decode, Upscale & Post, with all of its
  widgets editable.
- **⇲** on any card (or *Open subgraph* in the header) closes the Studio and takes you
  to that node on the canvas, inside the subgraph if needed.

**Header** — character seed and image seed with Fixed / +1 / Random, batch count,
Queue, Stop and a progress bar.

- *Character seed* resolves every field left on Random: keep it **Fixed** to keep the
  same character.
- *Image seed* is the noise of the first sampler: change it to re-shoot that character.

**Results panel** — live sampler preview, the final image, every intermediate stage, the
resolved prompt from the Show Text nodes, this session's history (with **Use these
settings** to restore exactly what produced an image), and a **character library**.

## Packing the pipeline into one node

With the pipeline on the root canvas, click **▣ Pack as subgraph** (Settings view or
sidebar). This uses ComfyUI's own *Convert to Subgraph*: every pipeline node goes
inside a node called **Character Architect Studio**, while the final *Save Image* and
*Show Text* nodes stay outside and become its outputs. Wire those outputs (image,
prompt) into any other workflow — scenery, video, and so on.

## Character library

**Save character** stores the settings and seeds that produced the image you are
looking at, its resolved prompt and a link to the image file. Characters are kept in
ComfyUI's user folder (`user/<user>/character_architect/characters.json`) through
ComfyUI's own user-data API, so they are available in every workflow. **Load** puts a
character back on the node and sets both seeds to Fixed.

## Security notes

- The Studio only builds the page with text nodes, never HTML strings, so option values
  and node titles from a downloaded workflow cannot inject scripts.
- Saved characters are validated against the node's own option lists before they are
  applied.
- No new server endpoints are added. The library goes through ComfyUI's user-data API;
  if you run ComfyUI with `--listen` on a network, anyone who can reach it can read and
  change that data, as with the rest of ComfyUI.

## Repository layout

```
__init__.py                     registers ./web, adds no nodes
web/character_studio.js         entry: buttons, menus, sidebar tab, commands
web/cs_studio.js                the Studio overlay
web/cs_graph.js                 graph helpers (scope, links, subgraphs)
web/cs_constants.js             section layout and the node's random / lock rules
web/cs_dom.js                   small DOM builder
web/character_studio.css        styles
Character Architect UI design/  original design mock and the Krea2 workflow
character_architect_v17.text    reference copy of the node's own frontend
```

## Roadmap

1. **Base (this version)** — build and render the character.
2. **Evolve** — take a saved character and produce front / side / back angles for a
   consistent character sheet, ready to drop into other scenes or video.
