// /scripts/extract-strings.js
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

const distDir = path.resolve("./dist");
const outFile = path.resolve("./i18n/strings.sv.json");

function parseAttrMap(spec) {
  const map = {};
  if (!spec) return map;
  spec.split(";").forEach(pair => {
    const [attr, key] = pair.split(":").map(s => s?.trim()).filter(Boolean);
    if (attr && key) map[attr] = key;
  });
  return map;
}

function extractFromFile(filePath, acc) {
  const html = fs.readFileSync(filePath, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  doc.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const val = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (key && val) acc[key] = val;
  });

  doc.querySelectorAll("[data-i18n-attr]").forEach(el => {
    const pairs = parseAttrMap(el.getAttribute("data-i18n-attr"));
    for (const [attr, key] of Object.entries(pairs)) {
      const val = (el.getAttribute(attr) || "").trim();
      if (key && val) acc[key] = val;
    }
  });

  doc.querySelectorAll("option[data-i18n]").forEach(opt => {
    const key = opt.getAttribute("data-i18n");
    const val = (opt.textContent || "").replace(/\s+/g, " ").trim();
    if (key && val) acc[key] = val;
  });
}

function main() {
  const all = {};
  const files = [];

  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name.endsWith(".html") && !/\/payments(\/|\\)/i.test(p)) files.push(p);
    }
  }
  walk(distDir);

  files.forEach(f => extractFromFile(f, all));
  const sorted = Object.fromEntries(Object.entries(all).sort(([a],[b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(sorted, null, 2), "utf8");
  console.log(`✅ Extracted ${Object.keys(sorted).length} keys → ${outFile}`);
}
main();
