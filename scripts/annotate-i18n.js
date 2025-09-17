// /scripts/annotate-i18n.js
// Läs README i svaret för vad skriptet gör.
// Kör: node ./scripts/annotate-i18n.js [--dry] [--no-backup]

import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

const ROOT = process.cwd();
const DIST_DIR = path.resolve(ROOT, "dist");
const REG_PATH = path.resolve(ROOT, "i18n/.i18n-key-registry.json");

const DRY = process.argv.includes("--dry");
const NO_BACKUP = process.argv.includes("--no-backup");

const TRANSLATABLE_ATTRS = ["placeholder", "title", "aria-label", "value", "data-wait"];
const TAGS_TO_SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "IMG", "SOURCE"]);
const TEXT_MINLEN = 1;

function readRegistry() {
  if (!fs.existsSync(path.dirname(REG_PATH))) fs.mkdirSync(path.dirname(REG_PATH), { recursive: true });
  if (!fs.existsSync(REG_PATH)) return { version: 1, items: {} };
  return JSON.parse(fs.readFileSync(REG_PATH, "utf8"));
}
function writeRegistry(reg) { fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2), "utf8"); }

function slugify(s, max = 24) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, max) || "text";
}
function nearestNamespace(el) {
  let cur = el;
  while (cur && cur.tagName) {
    if (cur.id) return cur.id;
    const classes = (cur.className || "").toString();
    if (/(^| )(nav|header|footer|section|hero|tabs|accordion|form|cmp|container|card)( |$)/i.test(classes)) {
      const token = classes.match(/(nav|header|footer|section|hero|tabs|accordion|form|cmp|container|card)/i)?.[1]?.toLowerCase();
      if (token) return token;
    }
    if (["HEADER", "NAV", "FOOTER", "SECTION"].includes(cur.tagName)) return cur.tagName.toLowerCase();
    cur = cur.parentElement;
  }
  return "page";
}
function roleFor(el) {
  const tag = el.tagName.toLowerCase();
  const cls = (el.className || "").toString().toLowerCase();
  if (/heading_h([1-6])/.test(cls)) return `h${RegExp.$1}`;
  if (/paragraph_(x{0,2}large|small)/.test(cls)) return "paragraph";
  if (tag.startsWith("h") && /^\d$/.test(tag[1])) return tag;
  if (tag === "a" && /button|text-button/.test(cls)) return "button";
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "label") return "label";
  if (tag === "input" && el.type === "submit") return "submit";
  if (tag === "option") return "option";
  if (tag === "div" && /subheading|eyebrow|button_label/.test(cls)) {
    if (/subheading/.test(cls)) return "subheading";
    if (/eyebrow/.test(cls)) return "eyebrow";
    if (/button_label/.test(cls)) return "buttonLabel";
  }
  return tag;
}
function indexAmongSiblings(el, sameRole) {
  let i = 1; let p = el.parentElement?.firstElementChild;
  while (p) { if (sameRole(p)) i++; if (p === el) break; p = p.nextElementSibling; }
  return i;
}
function textOf(el) { return (el.textContent || "").replace(/\s+/g, " ").trim(); }
function isLeafTextElement(el) {
  if (TAGS_TO_SKIP.has(el.tagName)) return false;
  const txt = textOf(el); if (!txt || txt.length < TEXT_MINLEN) return false;
  for (const child of el.children || []) if (textOf(child)) return false;
  return true;
}
function meaningfulAttr(el, name) {
  if (!el.hasAttribute(name)) return null;
  const trimmed = (el.getAttribute(name) || "").trim();
  if (!trimmed) return null;
  if (/^mailto:|^https?:|^\+?\d[\d\s-]+$/.test(trimmed)) return null;
  return trimmed;
}
function isTranslatableOption(el) { return el.tagName === "OPTION" && textOf(el); }
function domFingerprint(el) {
  const parts = []; let cur = el;
  while (cur && cur.tagName && parts.length < 12) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) seg += `#${cur.id}`;
    else { let n = 1, sib = cur; while ((sib = sib.previousElementSibling)) if (sib.tagName === cur.tagName) n++; seg += `:nth-${n}`; }
    parts.unshift(seg); cur = cur.parentElement;
  }
  return parts.join(">");
}
function ensureKey(reg, fileRel, el, baseText, suffix = "") {
  const fp = domFingerprint(el) + (suffix ? `@${suffix}` : "");
  const bucket = (reg.items[fileRel] ||= {});
  if (bucket[fp]) return bucket[fp];
  const ns = nearestNamespace(el);
  const role = roleFor(el);
  const sameRole = (node) => roleFor(node) === role && nearestNamespace(node) === ns;
  const idx = indexAmongSiblings(el, sameRole);
  const hint = slugify(baseText, 24);
  const key = `${ns}.${role}.${idx}.${hint}`.replace(/\.+/g, ".");
  bucket[fp] = key;
  return key;
}
function annotateFile(absPath, reg) {
  const html = fs.readFileSync(absPath, "utf8");
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  let changed = false;

  const walker = doc.createTreeWalker(doc.body || doc, dom.window.NodeFilter.SHOW_ELEMENT);
  const textTargets = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!(el instanceof dom.window.HTMLElement)) continue;
    if (el.hasAttribute("data-i18n")) continue;
    if (isLeafTextElement(el)) textTargets.push(el);
  }
  textTargets.forEach((el) => {
    const txt = textOf(el);
    const key = ensureKey(reg, rel(absPath), el, txt);
    el.setAttribute("data-i18n", key);
    changed = true;
  });

  const attrTargets = doc.querySelectorAll("input,textarea,select,button,[title],[aria-label]");
  attrTargets.forEach((el) => {
    const pairs = [];
    for (const attr of TRANSLATABLE_ATTRS) {
      const v = meaningfulAttr(el, attr);
      if (!v) continue;
      pairs.push([attr, ensureKey(reg, rel(absPath), el, v, `attr.${attr}`)]);
    }
    if (el.tagName === "SELECT") {
      el.querySelectorAll("option").forEach((opt) => {
        if (!isTranslatableOption(opt) || opt.hasAttribute("data-i18n")) return;
        const k = ensureKey(reg, rel(absPath), opt, textOf(opt));
        opt.setAttribute("data-i18n", k);
        changed = true;
      });
    }
    if (!pairs.length) return;
    const existing = el.getAttribute("data-i18n-attr");
    const existingMap = new Map();
    if (existing) existing.split(";").forEach((pair) => {
      const [a, k] = pair.split(":").map((s) => s?.trim()).filter(Boolean);
      if (a && k) existingMap.set(a, k);
    });
    let wroteAny = false;
    for (const [attr, key] of pairs) {
      if (!existingMap.has(attr)) { existingMap.set(attr, key); wroteAny = true; }
    }
    if (wroteAny) {
      const spec = Array.from(existingMap.entries()).map(([a, k]) => `${a}:${k}`).join("; ");
      el.setAttribute("data-i18n-attr", spec);
      changed = true;
    }
  });

  const headTitle = doc.querySelector("head > title");
  if (headTitle && !headTitle.hasAttribute("data-i18n")) {
    const base = textOf(headTitle);
    if (base) {
      const key = ensureKey(reg, rel(absPath), headTitle, base);
      headTitle.setAttribute("data-i18n", key);
      changed = true;
    }
  }

  if (!changed) return false;
  if (!DRY && !NO_BACKUP) {
    const bak = absPath + ".bak";
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, html, "utf8");
  }
  if (!DRY) {
    const out = "<!DOCTYPE html>\n" + dom.serialize();
    fs.writeFileSync(absPath, out, "utf8");
  }
  return true;
}
function rel(p) { return path.relative(ROOT, p).replace(/\\/g, "/"); }

function main() {
  if (!fs.existsSync(DIST_DIR)) { console.error("❌ Hittar inte /dist"); process.exit(1); }
  const reg = readRegistry();
  const queue = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name.toLowerCase().endsWith(".html")) queue.push(p);
    }
  })(DIST_DIR);
  const filtered = queue.filter(p => !/\/payments(\/|\\)/i.test(p));

  let changedCount = 0;
  for (const abs of filtered) {
    const did = annotateFile(abs, reg);
    console.log(`${did ? "✏️  Annotated" : "—  No changes"}: ${rel(abs)}`);
    if (did) changedCount++;
  }
  writeRegistry(reg);
  console.log(`\n✅ Klar. Ändrade filer: ${changedCount}/${filtered.length}. Registry: ${rel(REG_PATH)}`);
}
main();
