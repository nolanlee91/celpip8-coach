// Word lookup without an API key, for terms that are not in the curated vocabulary library:
// an English definition from Wiktionary, and a Vietnamese meaning from MyMemory (free, anonymous,
// ~5,000 characters a day). Only the looked-up term or its definition is sent. Results are cached
// for the life of the process, so looking a word up again costs nothing.

const UA = "celpip8-coach/1.0 (personal CELPIP study app)";
const cache = new Map<string, DictionaryResult | null>();

export interface DictionaryResult { term: string; vi: string; definition: string; partOfSpeech: string; source: "dictionary" }

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** First real English sense; an inflection ("present participle of resurface") is followed to its lemma once. */
async function wiktionary(term: string, depth = 0): Promise<{ definition: string; partOfSpeech: string } | null> {
  let data: Record<string, { partOfSpeech: string; definitions: { definition: string }[] }[]>;
  try {
    data = (await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term.replace(/ /g, "_"))}`)) as typeof data;
  } catch {
    return null;
  }
  for (const entry of data.en ?? []) {
    for (const d of entry.definitions ?? []) {
      const text = stripHtml(d.definition);
      if (!text) continue;
      const lemma = /\b(?:participle|plural|past tense|simple past|third-person singular|comparative|superlative)\b.*\bof\s+([A-Za-z][\w'-]*(?: [\w'-]+)?)\s*\.?$/i.exec(text)?.[1];
      if (lemma && depth === 0 && lemma.toLowerCase() !== term.toLowerCase()) {
        const base = await wiktionary(lemma, 1);
        if (base) return { definition: `${text}: ${base.definition}`, partOfSpeech: entry.partOfSpeech };
      }
      return { definition: text, partOfSpeech: entry.partOfSpeech };
    }
  }
  return null;
}

async function myMemory(text: string): Promise<string | null> {
  try {
    const data = (await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=en|vi`)) as { responseData?: { translatedText?: string }; quotaFinished?: boolean };
    const vi = data.responseData?.translatedText?.trim();
    return vi && !data.quotaFinished ? vi : null;
  } catch {
    return null;
  }
}

/**
 * Meaning of a word or short phrase. The Vietnamese comes from translating the term itself, or, when the
 * translator hands the English back unchanged (a regional word like "parkade"), from translating its definition.
 */
export async function lookupDictionary(term: string): Promise<DictionaryResult | null> {
  const key = term.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;
  const [def, viTerm] = await Promise.all([wiktionary(key), myMemory(key)]);
  let vi = viTerm && viTerm.toLowerCase() !== key ? viTerm : "";
  if (!vi && def) vi = (await myMemory(def.definition)) ?? "";
  const result: DictionaryResult | null = def || vi
    ? { term: term.trim(), vi, definition: def?.definition ?? "", partOfSpeech: def?.partOfSpeech ?? "", source: "dictionary" }
    : null;
  // Do not cache a total miss: it may be a network blip.
  if (result) cache.set(key, result);
  return result;
}
