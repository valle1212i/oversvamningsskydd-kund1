// /scripts/translate-i18n.js
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LOCALES = (process.env.I18N_LOCALES || "en,da,no").split(",").map(s => s.trim());
const CHUNK_SIZE = parseInt(process.env.I18N_CHUNK_SIZE || "50", 10);
const CONCURRENCY = parseInt(process.env.I18N_CONCURRENCY || "6", 10);
const MODEL = process.env.I18N_MODEL || "gpt-4o-mini";
const TEMPERATURE = parseFloat(process.env.I18N_TEMPERATURE || "0.2");
const FORCE_ALL = process.argv.includes("--force");

const masterPath = path.resolve("./i18n/strings.sv.json");
const glossaryPath = path.resolve("./i18n/glossary.json");

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8"); }
function chunk(arr, size) { const out=[]; for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
async function withRetry(fn,{tries=3,baseDelay=500}={}){let e;for(let i=0;i<tries;i++){try{return await fn()}catch(err){e=err;const d=baseDelay*Math.pow(2,i)+Math.floor(Math.random()*250);if(i<tries-1) await sleep(d);}}throw e;}
const stableObject = (o)=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a.localeCompare(b)));

function buildGlossaryForLocale(glossary, locale) {
  const lock = {}; for (const [sv, map] of Object.entries(glossary || {})) if (map && map[locale]) lock[sv]=map[locale]; return lock;
}
function buildPrompt({ locale, pairs, glossaryMap }) {
  const glossaryList = Object.entries(glossaryMap).map(([sv, tgt]) => ({ sv, tgt }));
  const tsv = pairs.map(({ key, sv }) => `${key}\t${sv}`).join("\n");
  return [
    { role: "system", content:
      "Du är en i18n-översättningsmotor. Returnera ENDAST giltig JSON (objekt: key -> translated string). " +
      "Översätt från svenska till målspråk. Ändra ALDRIG termer i glossary. Bevara HTML och variabler (t.ex. {name}, %s, {{var}})." },
    { role: "user", content:
`Målspråk: ${locale}

Glossary (låsta termer):
${JSON.stringify(glossaryList, null, 2)}

Innehåll (TSV: key<TAB>svensk text):
${tsv}

Instruktioner:
- Returnera exakt ett JSON-objekt: { "key": "översättning", ... }
- Inga kommentarer eller extra fält.
- Bevara variabler och inline-HTML.
- Använd glossary-värden exakt där svensk text matchar.`}
  ];
}
async function translateBatch({ locale, batch, glossaryMap }) {
  const res = await withRetry(() => client.chat.completions.create({
    model: MODEL, temperature: TEMPERATURE, response_format: { type: "json_object" }, messages: buildPrompt({ locale, pairs: batch, glossaryMap })
  }), { tries:4, baseDelay:800 });
  const raw = res?.choices?.[0]?.message?.content || "{}";
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new Error("Kunde inte parsa JSON från modellen"); }
  const missing = batch.filter(({ key }) => !(key in parsed)).map(({ key }) => key);
  if (missing.length) {
    console.warn("⚠️ Saknade översättningar:", missing);
  }  
  for (const { key, sv } of batch) if (glossaryMap[sv]) parsed[key] = glossaryMap[sv];
  return parsed;
}
async function mapWithConcurrency(items, limit, fn) {
  const ret = new Array(items.length); let i=0, running=0; let resolveAll; const done = new Promise(res=>resolveAll=res);
  async function runNext(){ if(i>=items.length&&running===0){resolveAll();return;}
    while(running<limit && i<items.length){ const idx=i++; running++;
      fn(items[idx], idx).then(v=>{ret[idx]=v;}).catch(e=>{throw e;}).finally(()=>{running--; runNext();});
    }}
  runNext(); await done; return ret;
}
async function main() {
  if (!fs.existsSync(masterPath)) { console.error("❌ Hittar inte i18n/strings.sv.json. Kör först: npm run i18n:extract"); process.exit(1); }
  const master = readJSON(masterPath);
  const glossary = fs.existsSync(glossaryPath) ? readJSON(glossaryPath) : {};
  const masterKeys = Object.keys(master);
  const snapshotPath = path.resolve("./i18n/.sv-source-snapshot.json");
  const prevSnap = fs.existsSync(snapshotPath) ? readJSON(snapshotPath) : {};

  for (const locale of LOCALES) {
    const outPath = path.resolve(`./i18n/strings.${locale}.json`);
    const existing = fs.existsSync(outPath) ? readJSON(outPath) : {};
    const glossaryMap = buildGlossaryForLocale(glossary, locale);

    const changedKeys = FORCE_ALL ? masterKeys : masterKeys.filter(k => master[k] !== prevSnap[k]);
    const missingKeys = masterKeys.filter(k => !existing[k]);
    const toDoSet = new Set([...changedKeys, ...missingKeys]);
    const finalList = Array.from(toDoSet).map(k => ({ key:k, sv:master[k] })).filter(({sv}) => sv && sv.trim());

    if (finalList.length === 0) {
      writeJSON(snapshotPath, master);
      writeJSON(outPath, stableObject(existing));
      console.log(`✅ ${locale}: Inga ändringar.`);
      continue;
    }

    const batches = chunk(finalList, CHUNK_SIZE);
    console.log(`🌐 ${locale}: Översätter ${finalList.length} nycklar i ${batches.length} batchar...`);
    const results = await mapWithConcurrency(batches, CONCURRENCY, (batch) => translateBatch({ locale, batch, glossaryMap }));
    const mergedNew = Object.assign({}, ...results);

    for (const [sv, tgt] of Object.entries(glossaryMap)) for (const [k, svText] of Object.entries(master)) if (svText === sv) mergedNew[k] = tgt;

    const finalDict = stableObject({ ...existing, ...mergedNew });
    writeJSON(outPath, finalDict);
    writeJSON(snapshotPath, master);
    console.log(`✅ ${locale}: Skrev ${Object.keys(mergedNew).length} översättningar → ${outPath}`);
  }
}
main().catch(err => { console.error("❌ Översättningen misslyckades:", err?.message || err); process.exit(1); });
