# Telegram Translation Bot (Free, Text-Only for Now)

Translates any word/phrase: English -> any language, any language -> English.
Voice note support is deferred for now (Hugging Face signup was giving trouble) — this version is text-only and needs no account signups beyond Telegram itself.

## The stack
- **Translation**: [MyMemory API](https://mymemory.translated.net/doc/spec.php) — free, no signup, no API key.
- **Language detection**: done locally in the code (no external calls) using Unicode script ranges (instant, 100% reliable for non-Latin scripts like Bengali/Arabic/Chinese/Russian/etc, even for a single word) plus a small statistical library for longer Latin-script phrases.

## How it works
- Send a word/phrase in **English** -> bot shows quick-pick buttons for the target language.
- Send a word/phrase in **another language** -> bot detects it and translates to English.
- Shortcut: `es: hello` translates directly to Spanish (swap `es` for any ISO 639-1 code) — this also lets you force the correct source language if auto-detection guesses wrong (see limitation below).

## Setup

1. **Get a Telegram bot token**
   - Message [@BotFather](https://t.me/BotFather) on Telegram -> `/newbot` -> follow prompts -> copy the token.

2. **(Optional) Add your email for MyMemory**
   - Not required, but including an email in requests raises the free daily quota from ~5,000 to ~50,000 words/day. No signup needed — just an email string.

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in `BOT_TOKEN` and optionally `MYMEMORY_EMAIL`.

5. **Run it**
   ```bash
   npm start
   ```

## Known limitation: short Latin-script text
Language detection is instant and reliable for non-Latin scripts (Bengali, Arabic, Hindi, Chinese, Japanese, Korean, Russian, Greek) even for a single word, because script alone identifies them.

For Latin-script text (Spanish, French, German, etc.), a single word or very short phrase is genuinely ambiguous for any free/offline detector — "chat" is a real word in both English and French, for example. The bot handles this by:
- Using statistical detection for phrases of 3+ words (fairly accurate).
- Defaulting to "assume English" for 1-2 Latin-script words.

If a short foreign phrase gets misread as English, tap through the language picker, or type a longer phrase so detection has more to work with.

## Adding voice notes back later
When you're ready, voice transcription slots back in easily — either via a working Hugging Face account (free Whisper Inference API) or an alternative like AssemblyAI's free tier. The code is structured so it's just one new `bot.on('voice', ...)` handler that transcribes and passes the text into the existing `handleIncomingText()` function — no changes needed to the translation logic itself.

## Notes
- If you want translation history, saved user preferences (e.g. "always translate to Bengali"), or multi-word batch translation, those are straightforward additions — just ask.
