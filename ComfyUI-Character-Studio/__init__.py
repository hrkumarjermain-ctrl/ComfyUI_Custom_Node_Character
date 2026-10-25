"""Character Architect Studio for ComfyUI.

A full-screen, button-driven interface for the Character Architect
(CharacterPromptFactory) node and the pipeline around it. Everything lives in
the frontend extension under ./web; this pack adds no backend nodes, so it
never shadows the Character Architect node itself.
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
