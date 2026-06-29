"""One-off image generator for VIRTUE app icon + store cover banner.

Run with:  cd /app/backend && python generate_store_assets.py

Outputs:
  /app/frontend/public/virtue-icon-1024.png    (PWA / store app icon)
  /app/frontend/public/virtue-cover-store.png  (store-page cover banner)

Uses the Emergent universal key + Gemini Nano Banana via emergentintegrations.
Safe to re-run; overwrites the same paths.
"""
import asyncio
import os
import base64
import uuid

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage

load_dotenv()

API_KEY = os.environ["EMERGENT_LLM_KEY"]
MODEL = "gemini-3.1-flash-image-preview"

ICON_PROMPT = (
    "App icon for VIRTUE — a comic-book inspired 3D first-person shooter. "
    "Square 1024x1024 design. Bold Marvel-style halftone background in red and yellow, "
    "thick black POW-style outlined comic frame border, dramatic comic burst rays radiating "
    "from the center. Centerpiece: a stylized golden bullet crossed with a comic-book "
    "lightning bolt, encircled by a black-outlined comic shield. Above the shield, the word "
    "'VIRTUE' in chunky display lettering with red and yellow letters, heavy 3D drop shadow. "
    "Cel-shaded, no gradients, high contrast, app-icon safe (no fine details that would "
    "disappear at small sizes), clean negative space at the corners for square crop / "
    "rounded-square masks. Centered composition, fully square. No real text other than the "
    "VIRTUE wordmark. Pop-art ink finish."
)

COVER_PROMPT = (
    "Wide store-page cover banner for VIRTUE — a comic-book inspired 3D first-person shooter. "
    "Aspect ratio 1024x500 (cinematic landscape). Comic-book aesthetic with bold POW! BOOM! "
    "comic onomatopoeia bursts in red, yellow, and black scattered across the background. "
    "Halftone dot patterns. On the LEFT side: enormous chunky display title 'VIRTUE' in red "
    "and yellow 3D block letters with thick black outlines and heavy drop shadow, plus a "
    "smaller tagline 'FREE-FOR-ALL · TEAM DEATHMATCH · RANKED LADDER' in clean white "
    "uppercase below it. On the RIGHT side: a stylized comic-book hero in dynamic action "
    "pose holding a futuristic energy rifle, motion lines streaking from the gun barrel, "
    "cel-shaded with hard ink outlines like Marvel Rivals. Background composed of red "
    "speed lines and yellow comic burst rays converging behind the character. The whole "
    "scene framed by a thick black POW-style comic-panel border. Cinematic, high-contrast, "
    "no photoreal elements, no real-world logos."
)


async def gen_one(prompt: str, out_path: str, label: str) -> None:
    chat = LlmChat(
        api_key=API_KEY,
        session_id=f"virtue-asset-{uuid.uuid4().hex[:8]}",
        system_message="You are an expert comic-book / video-game key-art illustrator.",
    )
    chat.with_model("gemini", MODEL).with_params(modalities=["image", "text"])
    text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
    if text:
        print(f"[{label}] text response: {text[:80]!r}...")
    if not images:
        raise RuntimeError(f"No image returned for {label}")
    img = images[0]
    image_bytes = base64.b64decode(img["data"])
    with open(out_path, "wb") as f:
        f.write(image_bytes)
    size_kb = len(image_bytes) // 1024
    print(f"[{label}] wrote {out_path}  ({size_kb} KB, mime={img['mime_type']})")


async def main():
    public = "/app/frontend/public"
    await gen_one(ICON_PROMPT,  f"{public}/virtue-icon-1024.png",   "ICON")
    await gen_one(COVER_PROMPT, f"{public}/virtue-cover-store.png", "COVER")
    print("\nDone. Files written to /app/frontend/public/")


if __name__ == "__main__":
    asyncio.run(main())
