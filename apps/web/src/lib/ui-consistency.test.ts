// Keeps the interface consistent: every form control and popup comes from the shared components, so the heights, text sizes,
// radius and behaviour on a phone are decided in ONE place. Run with: npm run test:unit (from the repo root).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const files: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "generated" || e.name === "node_modules") continue;
      walk(p);
    } else if (e.name.endsWith(".tsx")) files.push(p);
  }
})(SRC);
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, "/");
const isUi = (f: string) => rel(f).startsWith("components/ui/");
const read = (f: string) => fs.readFileSync(f, "utf8");

const problems: string[] = [];
for (const f of files) {
  const text = read(f);
  const name = rel(f);
  // 1. the browser's own confirm / alert / prompt boxes look different everywhere and are blocked in some phone browsers: use useConfirm() or a toast
  if (/\bwindow\.(confirm|alert|prompt)\(/.test(text)) problems.push(`${name}: uses a browser popup (window.confirm/alert/prompt). Use useConfirm() or toast.`);
  // 2. dropdowns come from NativeSelect (or the Select component), never a bare <select> with its own classes
  if (!isUi(f) && /<select\b/.test(text)) problems.push(`${name}: a bare <select>. Use NativeSelect.`);
  // 3. a bare text input or textarea with its own styling: use Input / Textarea (hidden, file, checkbox, radio and colour inputs are fine)
  if (!isUi(f)) {
    for (const m of text.matchAll(/<input\b([^>]*?)\/?>/g)) {
      const attrs = m[1];
      const type = /type="([a-z-]+)"/.exec(attrs)?.[1] ?? "text";
      if (["hidden", "file", "checkbox", "radio", "color"].includes(type)) continue;
      problems.push(`${name}: a bare <input type="${type}">. Use Input.`);
    }
    if (/<textarea\b/.test(text)) problems.push(`${name}: a bare <textarea>. Use Textarea.`);
  }
  // 4. one-off heights on the shared controls fight the scale (44px on a phone, 40px on larger screens)
  if (!isUi(f)) {
    for (const m of text.matchAll(/<(Button|Input|NativeSelect|SelectTrigger|Textarea)\b[^>]*?className="([^"]*)"/g)) {
      if (/(?<![\w-])h-(6|7|8|9|10|11)(?![\w.-])/.test(m[2]) || /(?<![\w-])size-(6|7|8|9)(?![\w.-])/.test(m[2])) problems.push(`${name}: <${m[1]}> with its own height (${m[2]}). Use the size prop.`);
    }
  }
}
assert.deepEqual(problems, [], `\n${problems.join("\n")}\n`);

// The scale itself: the shared components keep a phone-sized height and 16px text, and step down on larger screens.
const ui = (n: string) => read(path.join(SRC, "components/ui", n));
const has = (file: string, ...parts: string[]) => {
  const text = ui(file);
  for (const part of parts) assert.ok(text.includes(part), `${file} should contain ${part}`);
};
has("input.tsx", "h-11", "md:h-10", "text-base", "md:text-sm"); // 44px on a phone, 40px above, 16px text on a phone
has("native-select.tsx", "h-11", "md:h-10", "text-base", "md:text-sm");
has("select.tsx", "data-[size=default]:h-11", "md:data-[size=default]:h-10", "text-base md:text-sm");
has("textarea.tsx", "text-base", "md:text-sm", "rounded-xl");
has("button.tsx", '"h-11 gap-2 rounded-xl', "md:h-10"); // buttons line up with inputs
has("dialog.tsx", "max-h-[calc(100dvh-2rem)]", "overflow-y-auto"); // a popup never grows taller than the screen

console.log("ui consistency: all checks passed");
