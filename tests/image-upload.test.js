import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const extensionFile = path => readFile(new URL(`../extension/${path}`, import.meta.url), "utf8");

test("image upload is limited to NodeImage and uses its API key header", async () => {
  const source = await extensionFile("content/nodeseek-max.js");
  assert.match(source, /https:\/\/api\.nodeimage\.com\/api\/upload/);
  assert.match(source, /'X-API-Key': APP\.api\.key/);
  assert.match(source, /response\.status === 200/);
  assert.match(source, /HTTP \$\{status\}: \$\{message\}/);
  assert.match(source, /formData\.append\('image', file\)/);
  assert.doesNotMatch(source, /createImageBitmap|prepareUploadFile|nodeimage-\$\{Date\.now\(\)\}/);
  assert.match(source, /querySelectorAll\('script, style'\)/);
  assert.doesNotMatch(source, /new Error\(String\(error\)\)/);
  assert.doesNotMatch(source, /externalImageUpload|image_upload\.active|Chevereto|LskyPro|EasyImages|Telegraph/);
});

test("service worker removes the extension Origin only for NodeImage API requests", async () => {
  const [manifest, source] = await Promise.all([
    extensionFile("manifest.json").then(JSON.parse),
    extensionFile("background/service-worker.js")
  ]);
  assert.ok(manifest.permissions.includes("declarativeNetRequestWithHostAccess"));
  assert.match(source, /header: "origin", operation: "remove"/);
  assert.match(source, /requestDomains: \["api\.nodeimage\.com"\]/);
  assert.match(source, /initiatorDomains: \[chrome\.runtime\.id\]/);
});

test("options page exposes a local NodeImage API key setting", async () => {
  const [html, source] = await Promise.all([
    extensionFile("options/options.html"),
    extensionFile("options/options.js")
  ]);
  assert.match(html, /id="nodeimage-api-key" type="password"/);
  assert.match(html, /https:\/\/api\.nodeimage\.com\/api\/upload/);
  assert.match(source, /image_upload\.api_key/);
  assert.match(source, /image_upload\.api_key_cleared/);
  assert.match(source, /\["active", "url", "token", "headers"\]/);
});

test("a manually cleared NodeImage key is not restored during forum startup", async () => {
  const source = await extensionFile("content/nodeseek-max.js");
  assert.match(source, /ctx\.store\.get\("image_upload\.api_key_cleared", false\)/);
  assert.match(source, /if \(ctx\.store\.get\("image_upload\.api_key_cleared", false\)\) return false/);
  assert.match(source, /ctx\.store\.set\("image_upload\.api_key_cleared", false\)/);
});
