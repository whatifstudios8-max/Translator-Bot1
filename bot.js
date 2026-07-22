// require('dotenv').config();  // Comment this out for Railway deploymentconst { Telegraf, Markup } = require('telegraf');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const FormData = require('form-data');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

// And don't call bot.launch() if BOT_TOKEN is empty
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN not set');
  process.exit(1);
}const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Only check if they're empty right before using them

const OPENAI_HEADERS = {
  Authorization: `Bearer ${OPENAI_API_KEY}`,
  'Content-Type': 'application/json',
};

// Cheap, fast model — plenty accurate for word/phrase translation and
// single-language detection. Swap to 'gpt-4o' if you want higher quality
// on longer or more nuanced text.
const TEXT_MODEL = 'gpt-4o-mini';

const bot = new Telegraf(BOT_TOKEN);

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

async function chatCompletion(messages) {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    { model: TEXT_MODEL, messages, temperature: 0 },
    { headers: OPENAI_HEADERS }
  );
  return res.data.choices[0].message.content.trim();
}

// Returns an ISO 639-1 code (e.g. 'en', 'es', 'bn') for the language the
// text is written in.
async function detectLanguage(text) {
  const code = await chatCompletion([
    {
      role: 'system',
      content:
        'Identify the language of the text the user sends. ' +
        'Reply with ONLY the ISO 639-1 two-letter language code (e.g. "en", "es", "bn"). ' +
        'No punctuation, no explanation, nothing else.',
    },
    { role: 'user', content: text },
  ]);
  return code.toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
}

// Translates `text` into the language identified by ISO code `target`.
// `source` is optional context (not required for GPT, but improves accuracy
// when known).
async function translateText(text, target, source) {
  const sourceNote = source ? ` (the source text is in "${source}")` : '';
  const translated = await chatCompletion([
    {
      role: 'system',
      content:
        `Translate the user's text into the language with ISO 639-1 code "${target}"${sourceNote}. ` +
        'Reply with ONLY the translation — no quotes, no explanation, no original text.',
    },
    { role: 'user', content: text },
  ]);
  return { text: translated };
}

// Downloads a Telegram voice note and sends it to OpenAI Whisper for
// transcription. Whisper auto-detects the spoken language, so no per-user
// language setting is needed. Returns { text, language }.
async function transcribeVoice(fileUrl) {
  const audioRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });

  const form = new FormData();
  form.append('file', Buffer.from(audioRes.data), {
    filename: 'voice.oga',
    contentType: 'audio/ogg',
  });
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const res = await axios.post(
    'https://api.openai.com/v1/audio/transcriptions',
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      maxBodyLength: Infinity,
    }
  );

  return { text: res.data.text.trim(), language: res.data.language };
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

  const detected = await detectLanguage(input);

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
    const statusMsg = await ctx.reply('Transcribing...');
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
