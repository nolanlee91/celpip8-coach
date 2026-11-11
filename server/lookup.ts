// Word lookup without an API key, for terms that are not in the curated vocabulary library:
// English senses from Wiktionary, a Vietnamese meaning from MyMemory (free, anonymous, ~5,000 characters
// a day), and the pronunciation from the CMU Pronouncing Dictionary (bundled, offline). Only the looked-up
// term, a definition or the sentence the learner asks to translate is sent out. Results are cached for the
// life of the process, so looking a word up again costs nothing.

import { dictionary as cmu } from "cmu-pronouncing-dictionary";

const UA = "celpip8-coach/1.0 (personal CELPIP study app)";

export interface Sense { partOfSpeech: string; definition: string }
export interface WordPart { term: string; ipa: string; vi: string; definition: string }
export interface DictionaryResult {
  term: string; ipa: string; vi: string; definition: string; partOfSpeech: string;
  /** Vietnamese of the chosen English sense, when it differs from vi: a check on a word-for-word translation. */
  viDefinition: string;
  senses: Sense[]; parts?: WordPart[]; source: "dictionary";
}

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// ---------- Pronunciation (CMU ARPAbet → IPA in the notation learners know from Cambridge/Oxford) ----------

const VOWEL: Record<string, string> = {
  AA: "ɑː", AE: "æ", AO: "ɔː", AW: "aʊ", AY: "aɪ", EH: "e", EY: "eɪ", IH: "ɪ", IY: "iː", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "uː",
};
const CONS: Record<string, string> = {
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p",
  R: "r", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};
// Consonant pairs that can start an English syllable, so a stress mark goes before both ("ˈpleɪ", not "pˈleɪ").
const ONSET = new Set(["pl", "pr", "bl", "br", "tr", "dr", "kl", "kr", "ɡl", "ɡr", "fl", "fr", "θr", "ʃr", "sp", "st", "sk", "sm", "sn", "sl", "sw", "tw", "kw", "dw", "pj", "bj", "kj", "fj", "mj", "hj", "vj"]);

function arpabetToIpa(arpa: string): string {
  const out: string[] = [];
  for (const p of arpa.split(" ")) {
    const m = /^([A-Z]+)([012])?$/.exec(p);
    if (!m) continue;
    const [, ph, stress] = m;
    if (stress === undefined) { out.push(CONS[ph] ?? ""); continue; }
    // Unstressed: AH is schwa, ER is ɚ, and IY is a short i ("density" /ˈdensəti/).
    const v = ph === "AH" ? (stress === "0" ? "ə" : "ʌ") : ph === "ER" ? (stress === "0" ? "ɚ" : "ɝː") : ph === "IY" && stress === "0" ? "i" : VOWEL[ph] ?? "";
    if (stress === "1" || stress === "2") {
      const mark = stress === "1" ? "ˈ" : "ˌ";
      // Put the mark before the syllable's onset: one consonant, or two that can start a syllable.
      let at = out.length;
      const isCons = (s: string | undefined) => s !== undefined && Object.values(CONS).includes(s);
      if (isCons(out[at - 1])) {
        at--;
        if (isCons(out[at - 1]) && ONSET.has(out[at - 1] + out[at])) at--;
      }
      // No mark on the only vowel of a one-syllable word.
      out.splice(at, 0, mark);
    }
    out.push(v);
  }
  const s = out.join("");
  const syllables = (arpa.match(/[012]/g) ?? []).length;
  return syllables <= 1 ? s.replace(/[ˈˌ]/g, "") : s;
}

// The bundled dictionary is American: Canadian words that CELPIP uses and it lacks, written by hand.
const CANADIAN: Record<string, string> = {
  parkade: "pɑːrˈkeɪd", toque: "tuːk", tuque: "tuːk", eavestrough: "ˈiːvzˌtrɔːf", loonie: "ˈluːni", toonie: "ˈtuːni",
  poutine: "puːˈtiːn", serviette: "ˌsɝːviˈet", garburator: "ˈɡɑːrbjəˌreɪtɚ", timbits: "ˈtɪmbɪts", deke: "diːk",
  practicum: "ˈpræktɪkəm", notarize: "ˈnoʊtəˌraɪz", physiotherapy: "ˌfɪzioʊˈθerəpi", physio: "ˈfɪzioʊ",
  liaise: "liˈeɪz", onboarding: "ˈɑːnˌbɔːrdɪŋ", washroom: "ˈwɑːʃˌruːm", skytrain: "ˈskaɪˌtreɪn",
};

/** Canadian/British spellings the American dictionary knows under its own spelling (cheque → check). */
function americanSpellings(w: string): string[] {
  return [
    w.replace(/cheque/, "check"), w.replace(/chequ/, "check"), w.replace(/our(s|ed|ing|able|ite|ites|hood)?$/, "or$1"), w.replace(/tre(s)?$/, "ter$1"),
    w.replace(/ll(ing|ed|or|ors)$/, "l$1"), w.replace(/^instal(ment|ments)$/, "install$1"), w.replace(/ogue$/, "og"),
    w.replace(/ise(s|d)?$/, "ize$1"), w.replace(/isation(s)?$/, "ization$1"), w.replace(/yse(s|d)?$/, "yze$1"),
  ].filter((x) => x !== w);
}

const known = (w: string) => cmu[w] ?? americanSpellings(w).map((x) => cmu[x]).find(Boolean);

/** IPA of one word: the dictionary, its American spelling, or a compound of two known words (soundproof). */
function wordIpa(w: string): string {
  const direct = known(w);
  if (direct) return arpabetToIpa(direct);
  // Compound: the first part keeps its stress, the second gets secondary stress, and each part keeps its
  // own syllables ("ˈbækˌɔːrdɚd", not "ˈbæˌkɔːrdɚd").
  for (let i = w.length - 3; i >= 3; i--) {
    const a = cmu[w.slice(0, i)], b = known(w.slice(i));
    if (!a || !b) continue;
    const first = arpabetToIpa(a), second = arpabetToIpa(b.replace(/1/g, "2"));
    return (/[ˈˌ]/.test(first) ? first : `ˈ${first}`) + (/[ˈˌ]/.test(second) ? second : `ˌ${second}`);
  }
  return "";
}

/** IPA of a word or phrase, "" when any word is missing. */
export function ipaOf(term: string): string {
  const words = term.toLowerCase().replace(/[’]/g, "'").split(/[\s-]+/).filter(Boolean);
  if (!words.length) return "";
  const parts: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/[^a-z']/g, "");
    if (CANADIAN[w]) { parts.push(CANADIAN[w]); continue; }
    const ipa = wordIpa(w);
    if (!ipa) return "";
    parts.push(ipa);
  }
  return `/${parts.join(" ")}/`;
}

/** Wiktionary's IPA for a word the bundled dictionary lacks (regional words such as "parkade"). */
async function wiktionaryIpa(term: string): Promise<string> {
  try {
    const data = (await getJson(`https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(term.replace(/ /g, "_"))}&prop=wikitext&format=json&formatversion=2`)) as { parse?: { wikitext?: string } };
    const english = (data.parse?.wikitext ?? "").split(/\n==(?!=)/).find((s) => s.startsWith("English==")) ?? "";
    return /\{\{IPA\|en\|(\/[^|}]+\/)/.exec(english)?.[1] ?? "";
  } catch {
    return "";
  }
}

// ---------- Meanings ----------

/** English senses; an inflection ("present participle of resurface") is followed to its lemma once. */
async function wiktionary(term: string, depth = 0): Promise<Sense[] | null> {
  let data: Record<string, { partOfSpeech: string; definitions: { definition: string }[] }[]>;
  try {
    data = (await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term.replace(/ /g, "_"))}`)) as typeof data;
  } catch {
    return null;
  }
  const senses: Sense[] = [];
  for (const entry of data.en ?? []) {
    for (const d of entry.definitions ?? []) {
      const text = stripHtml(d.definition);
      // Skip empty senses and pointers such as "Used other than figuratively or idiomatically: see fill, out."
      if (!text || senses.length >= 6 || /^used other than figuratively|^see\s/i.test(text)) continue;
      const lemma = /\b(?:participle|plural|past tense|simple past|third-person singular|comparative|superlative)\b.*\bof\s+([A-Za-z][\w'-]*(?: [\w'-]+)?)\s*\.?$/i.exec(text)?.[1];
      if (lemma && depth === 0 && lemma.toLowerCase() !== term.toLowerCase()) {
        const base = await wiktionary(lemma, 1);
        if (base?.length) { senses.push(...base.slice(0, 3).map((b) => ({ partOfSpeech: entry.partOfSpeech, definition: `${text}: ${b.definition}` }))); continue; }
      }
      senses.push({ partOfSpeech: entry.partOfSpeech, definition: text });
    }
  }
  return senses.length ? senses : null;
}

const translations = new Map<string, string>();

/** English → Vietnamese with MyMemory; null when it fails or the daily quota is used up. */
export async function translate(text: string): Promise<string | null> {
  const q = text.trim().slice(0, 450);
  if (!q) return null;
  if (translations.has(q)) return translations.get(q)!;
  try {
    const data = (await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|vi`)) as { responseData?: { translatedText?: string }; quotaFinished?: boolean };
    const vi = data.responseData?.translatedText?.trim();
    if (!vi || data.quotaFinished || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(vi)) return null;
    translations.set(q, vi);
    return vi;
  } catch {
    return null;
  }
}

const STOP = new Set("a an the of to in on at for by with from and or but is are was were be been as it its this that these those your our my their his her".split(" "));
const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);

/** Senses that share words with the sentence come first (a "due date" for a bill is about payment, not birth). */
function rankByContext(senses: Sense[], context: string, term: string): Sense[] {
  // The term itself is in the sentence and often in a definition too; it says nothing about which sense fits.
  const own = new Set(term.split(/\W+/).map(stem));
  const ctx = new Set(context.split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase())).map(stem).filter((w) => !own.has(w)));
  if (!ctx.size) return senses;
  const score = (s: Sense) => s.definition.split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w.toLowerCase()) && ctx.has(stem(w))).length;
  return senses.map((s, i) => ({ s, i, n: score(s) })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.s);
}

const raw = new Map<string, { senses: Sense[] | null; viTerm: string }>();

async function rawLookup(key: string) {
  if (raw.has(key)) return raw.get(key)!;
  const [senses, vi] = await Promise.all([wiktionary(key), translate(key)]);
  const r = { senses, viTerm: vi && vi.toLowerCase() !== key ? vi : "" };
  if (senses || r.viTerm) raw.set(key, r); // do not cache a total miss: it may be a network blip
  return r;
}

/** One word of a phrase, for the word-by-word breakdown. */
async function wordPart(word: string): Promise<WordPart> {
  const { senses, viTerm } = await rawLookup(word.toLowerCase());
  const definition = senses?.[0]?.definition ?? "";
  const vi = viTerm || (definition ? (await translate(definition)) ?? "" : "");
  return { term: word, ipa: ipaOf(word) || (await wiktionaryIpa(word.toLowerCase())), vi, definition };
}

/**
 * Meaning of a word or short phrase in the sentence it came from.
 * - The Vietnamese is the translation of the term; when the sentence points to a less common sense, or the
 *   translator hands the English back (a regional word like "parkade"), it is the translation of that sense.
 * - A phrase that is not a dictionary entry ("parkade resurfacing") also gets a word-by-word breakdown,
 *   because a translator that does not know one word leaves it in English.
 */
export async function lookupDictionary(term: string, context = ""): Promise<DictionaryResult | null> {
  const key = term.trim().toLowerCase();
  if (!key) return null;
  const words = key.split(/\s+/);
  const { senses: found, viTerm } = await rawLookup(key);
  const senses = found ? rankByContext(found, context, key).slice(0, 3) : [];
  const top = senses[0];
  const viDef = top ? (await translate(top.definition)) ?? "" : "";
  // The term's own translation follows its most common sense; when the sentence points to another, use that one.
  const reordered = found && top && top !== found[0];
  let vi = (reordered || !viTerm) && viDef ? viDef : viTerm;

  let parts: WordPart[] | undefined;
  if (words.length > 1 && !found) {
    parts = await Promise.all(words.filter((w) => !STOP.has(w)).map(wordPart));
    // The translator left an English word untouched: build the meaning from the parts instead.
    const untranslated = vi && words.some((w) => !STOP.has(w) && new RegExp(`\\b${w}\\b`, "i").test(vi));
    if (untranslated) vi = "";
  }
  if (!senses.length && !vi && !parts?.some((p) => p.vi || p.definition)) return null;

  const ipa = ipaOf(key) || (words.length === 1 ? await wiktionaryIpa(key) : "")
    || (parts?.length === words.length && parts.every((p) => p.ipa) ? `/${parts.map((p) => p.ipa.slice(1, -1)).join(" ")}/` : "");
  return {
    term: term.trim(), ipa, vi, viDefinition: viDef && viDef !== vi ? viDef : "", definition: top?.definition ?? "", partOfSpeech: top?.partOfSpeech ?? "",
    senses, parts, source: "dictionary",
  };
}
