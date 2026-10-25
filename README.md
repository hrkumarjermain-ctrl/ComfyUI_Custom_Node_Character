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
- For the Qwen 2.1 turnaround engine only: a ComfyUI version with Qwen Image 2.1 support
  and its model files (see below).

## The workflow

`ComfyUI-Character-Studio/workflows/character_architect_krea2.json` (API format; drag it
onto the ComfyUI canvas to load it). It holds both phases.

**Phase 1 · Character (Krea2):** base sampler → chain resample → upscale → detail pass →
post-processing.

- The base pass uses the full character + scene prompt (it previously encoded only the
  empty scene box).
- Character prompt and scene text are joined with a space.
- LoRA slots 2 and 3 are disabled placeholders.

**Phase 2 · Turnaround:** every node titled `Turnaround · …`. A reference image (Load
Image), the character description, the current angle, the angle list and a seed are
shared by two engines:

- **Krea2 i2i**: image-to-image on the phase-1 Krea2 model, LoRAs and Krea2T enhancer.
  The reference is scaled to ~1 MP and re-rendered at change amount (denoise) 0.75 with
  the prompt `{angle}. {character}`.
- **Qwen 2.1 edit**: Qwen Image 2.1 Turbo with the settings of ComfyUI's official
  template (8-step schedule, euler, cfg 1). The reference image carries the identity;
  the instruction asks for the same person from the given angle. Model files from
  [Comfy-Org/Qwen-Image-2.1](https://huggingface.co/Comfy-Org/Qwen-Image-2.1):
  `diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors`,
  `text_encoders/qwen3vl_8b_int8_convrot.safetensors`,
  `vae/qwen_image_2.1_vae_bf16.safetensors`.

The active engine is the one whose `Save` node is not muted. The Studio keeps exactly one
active.

The Studio itself is model-agnostic: it drives whatever loaders, samplers and LoRAs the
pipeline contains, so a different model pipeline works without changes to the Studio.

## Install

Everything ComfyUI needs is in the **`ComfyUI-Character-Studio`** folder. Copy that one
folder into `ComfyUI/custom_nodes/`, so you end up with
`ComfyUI/custom_nodes/ComfyUI-Character-Studio/__init__.py`. Then restart ComfyUI and
reload the browser tab.

From a terminal (macOS / Linux):

```bash
git clone https://github.com/hrkumarjermain-ctrl/ComfyUI_Custom_Node_Character.git
cp -r ComfyUI_Custom_Node_Character/ComfyUI-Character-Studio /path/to/ComfyUI/custom_nodes/
```

To update later, replace that folder with the new one. Do not copy the whole repository
into `custom_nodes`: only the `ComfyUI-Character-Studio` folder is a node pack.

Check it loaded: the browser console (F12) shows no `[Character Studio]` errors, the left
sidebar has a **Character Studio** tab, and the Character Architect node has a
**🎭 Open Character Studio** button.

## Opening the Studio

Any of these opens it for the matching Character Architect node:

- the **🎭 Open Character Studio** button on the Character Architect node, or on a
  subgraph node that contains one;
- right-click either node → **🎭 Open Character Studio**;
- the **Character Studio** tab in the left sidebar;
- the menu **Extensions → Character Architect → Open Character Studio**
  (the command can also be bound to a key in ComfyUI's keybinding settings).

Inside the Studio: **Ctrl+Enter** queues the current phase, **Ctrl+Z** undoes the last
Studio change, **Esc** closes, **Ctrl+S** still saves the workflow.

The Studio queues each phase on its own, using ComfyUI's partial execution, so a
character run never renders turnarounds and a turnaround run never re-renders the
character. While one phase runs, the other phase's seeds are held. Queueing from the
canvas runs everything that is active; until a turnaround reference is set, ComfyUI
reports the turnaround output as invalid and still runs the character.

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

**2 · Turnaround view** — phase 2:

- **Reference**: *Use latest character image*, *Use image shown on the right*, or a saved
  character. The character description is filled from that image's resolved prompt
  (the Character Architect part only) and stays editable.
- **Engine**: switch between **Krea2 i2i** and **Qwen 2.1 edit**, with each engine's key
  settings (change amount, working size, steps, prompt template or instruction, model
  files, reference size).
- **Angles**: a list of `Label: prompt` lines (Front, Three-quarter, Side, Back, Face by
  default). Turn angles on/off, edit, add or remove them. **Generate N angles** queues
  one run per enabled angle, all with the same reference and seed.
- **Results**: the latest image per angle for the current reference.

The list is stored in the `Turnaround · Angle list` node (a `#` in front of a line
disables it), so it travels with the workflow.

**Custom values** — every option field (ethnicity, age, height, hair colour, pose, …)
has a **✎ Custom…** chip. Type your own value, e.g. `24 to 26 years old`, `1.80 m tall`
or `Ethiopian Amhara`, and press Enter. Your text replaces that field in the prompt
exactly as written, after every random, guidance and compatibility rule. Picking a
preset again, or ✕, removes it; section *All random / All none / Defaults* clear the
custom values of the fields they change. The values live in Character Architect's
`custom_values` input as `field=value` lines, so they are saved with the workflow, with
saved characters and in each run's settings. This needs a Character Architect version
with the `custom_values` input; with an older version the chips are shown disabled.
With a custom ethnicity, Ethnicity guidance has no anchor for that text, so the
custom text is used as written.

**⚙ Settings view** — the pipeline:

- *Essentials*: diffusion model, text encoder, VAE, aspect ratio / megapixels, the LoRA
  stack (on/off, file, strength, add slot) and an Active / Bypass / Mute switch for
  every sampling, decode and post pass.
- One card per node, grouped as Outputs, Seeds, Models & LoRAs, Sampling, Resolution &
  Latent, Prompt & Conditioning, Encode / Decode, Upscale & Post and Turnaround, with
  all of its widgets editable.
- **⇲** on any card (or *Open subgraph* in the header) closes the Studio and takes you
  to that node on the canvas, inside the subgraph if needed.

**Header** — the current phase's seeds with Fixed / +1 / Random, Queue (or Generate
angles), Stop and a progress bar.

- *Character seed* resolves every field left on Random: keep it **Fixed** to keep the
  same character.
- *Image seed* is the noise of the first sampler: change it to re-shoot that character.
- *Turnaround seed* is shared by every angle of a run, so the angles match, and advances
  once per run.

**Results panel** — live sampler preview, the final image, every intermediate stage, the
resolved prompt from the Show Text nodes, this session's history (with **Use these
settings** to restore exactly what produced an image, and **→ Use for turnaround**), and
a **character library**.

## Packing the pipeline into one node

With the pipeline on the root canvas, click **▣ Pack as subgraph** (Settings view or
sidebar). This uses ComfyUI's own *Convert to Subgraph*: every pipeline node goes
inside a node called **Character Architect Studio**, while the final *Save Image* and
*Show Text* nodes (including both turnaround Save nodes) stay outside and become its
outputs. Wire those outputs (character image, angles, prompt) into any other workflow —
scenery, video, and so on.

## Character library

**Save character** stores the settings and seeds that produced the image you are
looking at, its resolved prompt, a link to the image file, and the turnaround angles
generated from that image. Characters are kept in
ComfyUI's user folder (`user/<user>/character_architect/characters.json`) through
ComfyUI's own user-data API, so they are available in every workflow. **Load** puts a
character back on the node and sets both seeds to Fixed; **→** makes it the turnaround
reference.

## Troubleshooting

- **"Character Architect is not installed"** in the Character view, or fields named
  `UNKNOWN_1`, `UNKNOWN_2`, … in *ⓘ Diagnostics*: ComfyUI has no node pack providing
  `CharacterPromptFactory`, so it loaded the node as a missing-node placeholder. Install
  or repair the Character Architect node pack, restart ComfyUI and load the workflow
  again. The start-up log lists packs that failed to import.
- **Sections are empty for another reason**: open **⚙ Settings → ⓘ Diagnostics**, copy
  the report and share it.

## Security notes

- The Studio only builds the page with text nodes, never HTML strings, so option values
  and node titles from a downloaded workflow cannot inject scripts.
- Saved characters are validated against the node's own option lists before they are
  applied.
- Image references are limited to plain file names inside ComfyUI's output, input and
  temp folders, so a tampered `characters.json` cannot make Load Image read other files.
- Everything runs locally, including Qwen 2.1: no images are sent to an external service.
- No new server endpoints are added. The library goes through ComfyUI's user-data API;
  if you run ComfyUI with `--listen` on a network, anyone who can reach it can read and
  change that data, as with the rest of ComfyUI.

## Repository layout

```
ComfyUI-Character-Studio/            ← the folder that goes into ComfyUI/custom_nodes
  __init__.py                        registers ./web, adds no nodes
  web/character_studio.js            entry: buttons, menus, sidebar tab, commands
  web/cs_studio.js                   the Studio overlay
  web/cs_graph.js                    graph helpers (scope, links, subgraphs)
  web/cs_constants.js                section layout and the node's random / lock rules
  web/cs_dom.js                      small DOM builder
  web/character_studio.css           styles
  workflows/                         the Krea2 workflow with both phases
Character Architect UI design/       original design mock (not needed in ComfyUI)
character_architect_v17.text         reference copy of the node's own frontend (not needed in ComfyUI)
```

## Roadmap

1. **Character** — build and render the character. ✅
2. **Turnaround** — front / side / back angles from the character image, with Krea2 i2i
   or Qwen 2.1 edit. ✅
3. **Qwen 2.1 for phase 1** — a Qwen Image 2.1 character pipeline as an alternative to
   Krea2.
