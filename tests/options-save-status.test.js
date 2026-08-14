import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const optionsFile = path => readFile(new URL(`../extension/options/${path}`, import.meta.url), "utf8");

test("options page uses a transient top-right toast for automatic saves", async () => {
  const [html, css, source] = await Promise.all([
    optionsFile("options.html"),
    optionsFile("options.css"),
    optionsFile("options.js")
  ]);
  assert.doesNotMatch(html, /id="save-status"/);
  assert.match(html, /id="toast"[^>]*aria-live="polite"/);
  assert.match(css, /\.toast \{[^}]*top: 92px;[^}]*right: 24px;/);
  assert.match(css, /transition: opacity \.28s ease, transform \.34s/);
  assert.match(source, /getBoundingClientRect\(\)\.bottom/);
  assert.doesNotMatch(css, /\.save-indicator/);
  assert.match(source, /if \(sequence === saveSequence\) toast\("设置已保存"\)/);
  assert.match(source, /toast\("设置保存失败", true\)/);
});
