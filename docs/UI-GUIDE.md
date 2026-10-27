# Interface guide: one scale for every screen size

The website and the phone app follow one set of rules, so a screen feels the same wherever it is opened. The rules live in the shared components; a screen should not override them.

## Website (`apps/web/src/components/ui`)
| Control | Phone (below 768px) | Larger screens |
|---|---|---|
| Text input, `NativeSelect`, `Select`, date field | **44px** high, **16px** text (smaller text makes iPhones zoom in on tap) | 40px, 14px text |
| Button, default | 44px | 40px (lines up with an input beside it) |
| Button `sm` | 40px | 32px |
| Button `xs` | 36px | 28px |
| Icon buttons | 44 / 40 / 36px | 40 / 32 / 28px |
| Tabs | 44px | 36px |
| Text area | min 80px, same border, radius and padding as an input | same |

- Same look for every field: 12px radius, border, soft focus ring, hover border, disabled and error states, dark mode.
- **Dropdowns:** `NativeSelect` (the phone's own picker, best on touch screens) styled exactly like an input, or the `Select` component. Never a bare `<select>`.
- **Plain checkboxes and radios** get the brand colour and a comfortable size; any bare text field is forced to 16px on a phone as a safety net (`globals.css`).
- **Popups:** `Dialog` never grows taller than the screen (it scrolls inside), has a stronger backdrop, bigger title and a touch-sized close button; on a phone its buttons stack with the main action on top. `Sheet` (bottom) is capped at 88% of the screen and respects the phone's bottom safe area.
- **Confirmations:** one in-app popup for the whole app: `const ask = useConfirm(); if (!(await ask({ title, description, confirmLabel, variant }))) return;`. The browser's own `confirm()` box is not used anywhere (it looks different in every browser and is blocked in some phone browsers).
- **Header on a phone:** the company switcher shrinks to an icon, the project picker takes the space that is left, nothing overlaps.

## Phone app (`apps/mobile/src/components/ui.tsx`)
- Every field (`Field`): 48pt high, 16pt text, same border and radius; multi-line fields 96pt and top-aligned; a screen can add to the look but never loses it (an earlier version dropped the border when a screen passed its own style).
- Buttons 48pt; choice chips (`Chips`) 44pt; list cards are whole-card buttons.
- Keyboard: forms lift above the keyboard on both iOS and Android.
- The full-screen photo viewer respects the notch and the bottom safe area.

## Kept honest by tests
`apps/web/src/lib/ui-consistency.test.ts` (part of `npm run test:unit`) fails if anyone adds a browser `confirm`/`alert`/`prompt`, a bare `<select>`, `<input>` or `<textarea>`, or a one-off height on a shared control, and checks that the shared components keep the scale above.

## What was checked
All main pages (about 30) were measured at 375px (phone), 768px (tablet) and 1280px (desktop) in the browser: no page scrolls sideways, every text field is at least 44px high with 16px text on a phone, buttons are thumb-sized. The in-app confirmation popup was checked at phone size.
**Not checked:** the phone app's screens on a real device or simulator (layout, keyboard and notch behaviour). It type-checks and bundles for Android.
