require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const LanguageDetect = require('languagedetect');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL; // optional, raises free daily quota

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const lngDetector = new LanguageDetect();

// Common target languages shown as quick-pick buttons when input is English.
// Add/remove entries here to change the picker options.
const COMMON_LANGS = [
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ru', label: 'Russian' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'id', label: 'Indonesian' },
];

// In-memory store: pending English text waiting for a target language pick.
// Keyed by chat id. Fine for a single-instance bot; swap for Redis/DB if you
// scale to multiple workers.
const pending = new Map();

// Maps language names (typed by the user, or returned by the `languagedetect`
// library) to ISO 639-1 codes. Used both for Latin-script phrase detection
// and for letting the user type any target language by name, not just the
// 10 quick-pick buttons.
const NAME_TO_CODE = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt',
  italian: 'it', dutch: 'nl', swedish: 'sv', turkish: 'tr', vietnamese: 'vi',
  indonesian: 'id', polish: 'pl', romanian: 'ro', arabic: 'ar', hindi: 'hi',
  bengali: 'bn', chinese: 'zh', mandarin: 'zh', japanese: 'ja', korean: 'ko',
  russian: 'ru', greek: 'el', hebrew: 'he', urdu: 'ur', filipino: 'tl',
  tagalog: 'tl', malay: 'ms', swahili: 'sw', ukrainian: 'uk', czech: 'cs',
  hungarian: 'hu', finnish: 'fi', danish: 'da', norwegian: 'no', croatian: 'hr',
  serbian: 'sr', bulgarian: 'bg', slovak: 'sk', persian: 'fa', farsi: 'fa',
  punjabi: 'pa', tamil: 'ta', telugu: 'te', marathi: 'mr', gujarati: 'gu',
  kannada: 'kn', malayalam: 'ml', nepali: 'ne', sinhala: 'si', burmese: 'my',
  khmer: 'km', lao: 'lo', mongolian: 'mn', kazakh: 'kk', uzbek: 'uz',
  azerbaijani: 'az', georgian: 'ka', armenian: 'hy', amharic: 'am', somali: 'so',
  zulu: 'zu', afrikaans: 'af', icelandic: 'is', lithuanian: 'lt', latvian: 'lv',
  estonian: 'et', albanian: 'sq', macedonian: 'mk', slovenian: 'sl',
  catalan: 'ca', basque: 'eu', galician: 'gl', welsh: 'cy', irish: 'ga', thai: 'th',
};

// Resolves free-typed target-language input (e.g. "vietnamese" or "vi") to
// an ISO 639-1 code, or null if it doesn't match anything recognizable.
function resolveLanguageInput(input) {
  const clean = input.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(clean)) return clean;
  return NAME_TO_CODE[clean] || null;
}

// Unicode script ranges that reliably identify a non-Latin-script language,
// even for a single word (statistical detectors need whole sentences to be
// accurate, but script alone is enough here — this is free, instant, and
// runs locally with zero API calls).
const SCRIPT_RANGES = [
  { code: 'bn', re: /[\u0980-\u09FF]/ },   // Bengali
  { code: 'hi', re: /[\u0900-\u097F]/ },   // Devanagari (Hindi)
  { code: 'ar', re: /[\u0600-\u06FF]/ },   // Arabic
  { code: 'ja', re: /[\u3040-\u30FF]/ },   // Hiragana/Katakana (check before CJK)
  { code: 'ko', re: /[\uAC00-\uD7A3]/ },   // Hangul
  { code: 'zh', re: /[\u4E00-\u9FFF]/ },   // CJK Unified Ideographs
  { code: 'ru', re: /[\u0400-\u04FF]/ },   // Cyrillic
  { code: 'el', re: /[\u0370-\u03FF]/ },   // Greek
];

// Best-effort, zero-cost language detection:
// 1. Non-Latin script -> identified reliably by character range alone.
// 2. Latin script, 3+ words -> statistical detection (reasonably accurate
//    on full phrases, unreliable on single words).
// 3. Latin script, 1-2 words -> assume English (documented limitation —
//    use the "xx: word" shortcut to force a different source/target).
function detectLanguage(text) {
  for (const { code, re } of SCRIPT_RANGES) {
    if (re.test(text)) return code;
  }

  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount >= 3) {
    const guesses = lngDetector.detect(text, 1);
    if (guesses.length) {
      const code = NAME_TO_CODE[guesses[0][0]];
      if (code) return code;
    }
  }

  return 'en';
}

// Translates via MyMemory's free API (no key required).
async function translateText(text, target, source = 'en') {
  const params = { q: text, langpair: `${source}|${target}` };
  if (MYMEMORY_EMAIL) params.de = MYMEMORY_EMAIL;

  const res = await axios.get('https://api.mymemory.translated.net/get', { params });
  const translated = res.data?.responseData?.translatedText;

  if (!translated || res.data?.responseStatus !== 200) {
    throw new Error('MyMemory translation failed: ' + JSON.stringify(res.data));
  }
  return { text: translated };
}

function buildLangKeyboard() {
  const buttons = COMMON_LANGS.map((l) =>
    Markup.button.callback(l.label, `lang:${l.code}`)
  );
  // 2 buttons per row
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return Markup.inlineKeyboard(rows);
}

bot.start((ctx) =>
  ctx.reply(
    "Send me any word or phrase.\n\n" +
      "• If it's in English, I'll ask which language to translate it into — tap a button, or just type any language name (e.g. \"Thai\") or code (e.g. \"th\").\n" +
      "• If it's in another language, I'll translate it straight to English.\n\n" +
      "Shortcut: type `th: hello` to translate directly to Thai (use any language code).",
    { parse_mode: 'Markdown' }
  )
);

// Shortcut format: "<langcode>: <text>"  e.g. "fr: good morning"
const SHORTCUT_RE = /^([a-zA-Z-]{2,5}):\s*(.+)$/;

// Core routing logic shared by typed messages and voice transcripts:
// - "es: text" shortcut -> translate straight to that language
// - detected English -> show a language picker so the user can translate it
// - detected non-English -> translate to English automatically
// `prefix` is prepended to the reply (used to show the transcript first).
async function handleIncomingText(ctx, input, prefix = '') {
  const shortcutMatch = input.match(SHORTCUT_RE);
  if (shortcutMatch) {
    const [, target, text] = shortcutMatch;
    const result = await translateText(text, target.toLowerCase());
    return ctx.reply(`${prefix}${result.text}`);
  }

  const detected = detectLanguage(input);

  if (detected === 'en') {
    pending.set(ctx.chat.id, input);
    return ctx.reply(
      `${prefix}Translate to which language? Tap below, or just type a language name (e.g. "Thai") or code (e.g. "th").`,
      buildLangKeyboard()
    );
  }

  const result = await translateText(input, 'en', detected);
  return ctx.reply(`${prefix}${result.text}`);
}

bot.on('text', async (ctx) => {
  const input = ctx.message.text.trim();
  if (input.startsWith('/')) return; // ignore other commands

  try {
    // If we're waiting on a target language for a previous English message,
    // and this message resolves to a language (name or code), complete that
    // translation instead of treating this as a brand new message. This is
    // what lets someone type "Vietnamese" even though it's not one of the
    // quick-pick buttons.
    if (pending.has(ctx.chat.id)) {
      const target = resolveLanguageInput(input);
      if (target) {
        const original = pending.get(ctx.chat.id);
        pending.delete(ctx.chat.id);
        const result = await translateText(original, target, 'en');
        return ctx.reply(`${original} → ${result.text}`);
      }
    }

    await handleIncomingText(ctx, input);
  } catch (err) {
    console.error(err.response?.data || err.message);
    return ctx.reply('Sorry, translation failed. Please try again.');
  }
});

// Voice note support (transcription) is deferred for now — see README.
// When added back, it slots in here as a `bot.on('voice', ...)` handler
// that transcribes the note and passes the text into handleIncomingText().

bot.action(/lang:(.+)/, async (ctx) => {
  const target = ctx.match[1];
  const text = pending.get(ctx.chat.id);
  await ctx.answerCbQuery();

  if (!text) {
    return ctx.reply('That request expired — send the word again.');
  }

  try {
    const result = await translateText(text, target, 'en');
    pending.delete(ctx.chat.id);
    return ctx.editMessageText(`${text} → ${result.text}`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    return ctx.reply('Sorry, translation failed. Please try again.');
  }
});

bot.launch();
console.log('Translation bot running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
