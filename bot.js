require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const LanguageDetect = require('languagedetect');

const BOT_TOKEN = process.env.BOT_TOKEN;
const HF_API_TOKEN = process.env.HF_API_TOKEN;
const MYMEMORY_EMAIL = process.env.MYMEMORY_EMAIL; // optional, raises free daily quota

if (!BOT_TOKEN || !HF_API_TOKEN) {
  console.error('Missing BOT_TOKEN or HF_API_TOKEN in .env');
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
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ru', label: 'Russian' },
];

// In-memory store: pending English text waiting for a target language pick.
// Keyed by chat id. Fine for a single-instance bot; swap for Redis/DB if you
// scale to multiple workers.
const pending = new Map();

// Maps a handful of full language names (as returned by the `languagedetect`
// library) to ISO 639-1 codes, for the Latin-script phrase-detection path.
const NAME_TO_CODE = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt',
  italian: 'it', dutch: 'nl', swedish: 'sv', turkish: 'tr', vietnamese: 'vi',
  indonesian: 'id', polish: 'pl', romanian: 'ro',
};

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

// Transcribes via Hugging Face's free Inference API running Whisper.
// The model may need to "warm up" on first use (returns 503 with an
// estimated_time) — this retries a few times while it loads.
async function transcribeVoice(fileUrl, retries = 4) {
  const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await axios.post(
        'https://api-inference.huggingface.co/models/openai/whisper-large-v3',
        Buffer.from(audioRes.data),
        {
          headers: {
            Authorization: `Bearer ${HF_API_TOKEN}`,
            'Content-Type': 'audio/ogg',
          },
        }
      );
      return { text: (res.data.text || '').trim() };
    } catch (err) {
      const status = err.response?.status;
      const waitSec = err.response?.data?.estimated_time || 5;
      if (status === 503 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }
      throw err;
    }
  }
  return { text: '' };
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
    "Send me any word or phrase — typed or as a voice note.\n\n" +
      "• If it's in English, I'll ask which language to translate it into.\n" +
      "• If it's in another language, I'll translate it straight to English.\n" +
      "• Voice notes get transcribed first, then handled the same way.\n\n" +
      "Shortcut: type `es: hello` to translate directly to Spanish (use any language code).",
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
    return ctx.reply(`${prefix}Translate to which language?`, buildLangKeyboard());
  }

  const result = await translateText(input, 'en', detected);
  return ctx.reply(`${prefix}${result.text}`);
}

bot.on('text', async (ctx) => {
  const input = ctx.message.text.trim();
  if (input.startsWith('/')) return; // ignore other commands

  try {
    await handleIncomingText(ctx, input);
  } catch (err) {
    console.error(err.response?.data || err.message);
    return ctx.reply('Sorry, translation failed. Please try again.');
  }
});

bot.on('voice', async (ctx) => {
  try {
    const statusMsg = await ctx.reply('Transcribing... (first request may take ~20s while the model warms up)');
    const fileUrl = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const { text } = await transcribeVoice(fileUrl.href || fileUrl);

    await ctx.telegram
      .deleteMessage(ctx.chat.id, statusMsg.message_id)
      .catch(() => {});

    if (!text) {
      return ctx.reply("Couldn't make out any speech in that voice note.");
    }

    // Always show the transcript, then the same detect/translate flow
    // (language picker or auto-translate to English) runs on top of it.
    await handleIncomingText(ctx, text, `📝 "${text}"\n\n`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    return ctx.reply('Sorry, I couldn\'t process that voice note. Please try again.');
  }
});

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
