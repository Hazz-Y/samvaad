# Samvaad — image generation prompt pack

Generate these 6 images with Gemini (Nano Banana), ChatGPT, or any image tool.
**Use ONE chat session for all six** and generate the character sheet first —
then say "same characters, same style" in every later prompt (or attach the
character sheet image as reference). That is what keeps them consistent.

Save each file into `frontend/assets/` with the EXACT filename. Refresh the
page — they replace the built-in doodles automatically. No code changes needed.

## Style block (paste at the start of EVERY prompt)

> Hand-drawn doodle illustration, loose confident ink lines, minimal flat
> color. Warm cream background (#FAF3E8), charcoal outlines, exactly two
> accent colors: teal (#14B8A6) and amber (#F59E0B). Friendly, optimistic,
> slightly imperfect sketchbook style. No text unless specified. No logos.
> Clean composition with generous whitespace, 4px rounded-corner framing.

## Character sheet (generate FIRST, keep as reference — not used on the site)

> [style block] Character sheet, two recurring characters side by side with
> three poses each (front, speaking/signing, happy).
> CHARACTER 1 — "Ravi": young Indian man, teal beanie cap, simple charcoal
> stick-ish body, round head, dot eyes, expressive open mouth when speaking.
> CHARACTER 2 — "Asha": young Indian woman, short amber/yellow bob haircut,
> small earring, expressive hands (she is deaf and signs), gentle smile.
> Label nothing. Same proportions for both.

## 1. `hero.png` (1600×1200, landscape 4:3)

> [style block] Same two characters as the character sheet. LEFT: Ravi
> speaking, three teal sound arcs leaving his mouth, a dashed teal arrow
> curving to a caption card at top-center that reads "नमस्ते! theek ho?" in
> charcoal handwriting. RIGHT: Asha smiling, one hand raised mid-sign with
> small amber motion dashes, a dashed amber arrow curving down to a small
> open laptop that emits amber sound arcs and a music note. The two arrows
> suggest one continuous loop between the two people. A few tiny plus-sign
> sparkles in the background.

## 2. `story.png` (1600×1000, landscape 16:10)

> [style block] Same two characters. A busy Indian pharmacy counter scene:
> Ravi as a rushed pharmacist behind the counter (small medical cross on his
> apron), speaking fast — many overlapping teal speech squiggles — while his
> head turns sideways toward stock shelves. In front of the counter stands
> Asha looking confused, a small charcoal question mark above her head. On
> the counter between them sits an open laptop showing three teal caption
> lines, with a dashed amber line from Asha's eyes to the laptop screen.
> A ceiling fan squiggle at the top suggests noise.

## 3. `step1.png` (800×600)

> [style block] Just Ravi's head and shoulders, speaking naturally into a
> simple doodle microphone on a stand, three teal sound arcs. Nothing else.

## 4. `step2.png` (800×600)

> [style block] Just Asha reading a large caption card that says "नमस्ते!" in
> bold charcoal handwriting with one teal and one amber underline; her eyes
> on the card, dashed teal line from card to her eyes. Nothing else.

## 5. `step3.png` (800×600)

> [style block] Two hands only: one amber-accented finger tapping a small
> grid of two rounded phrase buttons, and beside it a raised hand making a
> sign with amber motion dashes around the fingers. Nothing else.

## 6. `step4.png` (800×600)

> [style block] A small open doodle laptop with a happy face on screen,
> emitting three large amber sound arcs and one music note. One tiny plus
> sparkle. Nothing else.

## PART 2 — 16 hand-sign cards (for the Sign studio vocab grid)

Save each into `frontend/assets/signs/` with the EXACT filename. Each vocab
card picks up its image automatically. Generate all 16 in the SAME session
as before (same style). These drawings must match the described finger
positions precisely — they teach the user the exact gesture the camera
detects.

**Shared prompt template** (replace the HAND DESCRIPTION each time):

> [style block] One single doodle hand, large and centered, with an amber
> sleeve cuff at the wrist. HAND DESCRIPTION. A few small amber accent
> dashes around the hand. Nothing else, no text, no face.

| File | HAND DESCRIPTION |
|---|---|
| `hello.png` | Open palm facing the viewer, all five fingers extended and spread apart |
| `wait.png` | Closed fist, knuckles facing the viewer, all fingers curled in with the thumb wrapped across |
| `yes.png` | Thumbs-up: fist with only the thumb extended, pointing straight up |
| `no.png` | Thumbs-down: fist with only the thumb extended, pointing straight down |
| `question.png` | Only the index finger extended, pointing straight up; all other fingers and thumb curled |
| `good.png` | Victory / V sign: index and middle fingers extended upward and clearly SPREAD APART in a V; ring, pinky and thumb folded |
| `repeat.png` | Index and middle fingers extended upward PRESSED TOGETHER side by side (not spread); ring, pinky and thumb folded |
| `thanks.png` | I-love-you sign: thumb, index finger and pinky extended; middle and ring fingers folded down |
| `okay.png` | OK sign: thumb and index fingertip touching in a circle; middle, ring and pinky extended upward |
| `price.png` | L-shape: thumb and index finger extended at a right angle to each other; middle, ring and pinky folded |
| `help.png` | Thumb, index and middle fingers all extended and spread; ring and pinky folded down |
| `call.png` | Shaka / call-me sign: thumb and pinky extended outward; index, middle and ring folded; slight tilt like holding a phone |
| `urgent.png` | Rock sign: index and pinky extended upward; thumb folded across the curled middle and ring fingers |
| `second.png` | Only the pinky finger extended upward; all other fingers and thumb curled into the palm |
| `water.png` | Index, middle and ring fingers extended upward together; thumb and pinky folded |
| `slow.png` | Four fingers (index, middle, ring, pinky) extended upward; thumb folded across the palm |

## Checklist after generating

- [ ] All 6 files in `frontend/assets/` with exact names (lowercase, .png)
- [ ] All share the cream background — they sit inside rounded cards, so the
      cream reads as intentional in BOTH light and dark themes
- [ ] Characters look like the same two people in every image
- [ ] Hard refresh the page (Ctrl+Shift+R) — images replace doodles instantly
