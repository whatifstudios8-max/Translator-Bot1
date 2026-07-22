# Telegram Translation Bot (100% Free Stack)

Translates any word/phrase: English -> any language, any language -> English.
Also accepts voice notes -> transcribes them, then runs the same translation logic.
No paid API, no Docker, no self-hosting — everything runs on free tiers or locally in plain JS.

## The stack
- **Translation**: [MyMemory API](https://mymemory.translated.net/doc/spec.php) — free, no signup, no API key.
- **Language detection**: done locally in the code (no external calls) using Unicode script ranges (instant, 100% reliable for non-Latin scripts like Bengali/Arabic/Chinese/Russian/etc, even for a single word) plus a small statistical library for longer Latin-script phrases.
- **Voice transcription**: [Hugging Face's free Inference API](https://huggingface.co/inference-api) running Whisper — the actual transcription runs on Hugging Face's servers, not your PC. You only need a free account.

## How it works
- Send a word/phrase in **English** -> bot shows quick-pick buttons for the target language.
- Send a word/phrase in **another language** -> bot detects it and translates to English.
- Send a **voice note** -> bot transcribes it, shows the transcript, then applies the same rule.
- Shortcut: `es: hello` translates directly to Spanish (swap `es` for any ISO 639-1 code) — this also lets you force the correct source language if auto-detection guesses wrong (see limitation below).

## Setup

1. **Get a Telegram bot token**
   - Message [@BotFather](https://t.me/BotFather) on Telegram -> `/newbot` -> follow prompts -> copy the token.

2. **Get a free Hugging Face access token** (for voice transcription)
   - Create a free account at https://huggingface.co/join (no credit card).
   - Go to https://huggingface.co/settings/tokens -> New token -> role "Read" is enough.
   - Free tier is rate-limited but sufficient for personal/small-scale use.

3. **(Optional) Add your email for MyMemory**
   - Not required, but including an email in requests raises the free daily quota from ~5,000 to ~50,000 words/day. No signup needed — just an email string.

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in `BOT_TOKEN`, `HF_API_TOKEN`, and optionally `MYMEMORY_EMAIL`.

6. **Run it**
   ```bash
   npm start
   ```

## Known limitation: short Latin-script text
Language detection is instant and reliable for non-Latin scripts (Bengali, Arabic, Hindi, Chinese, Japanese, Korean, Russian, Greek) even for a single word, because script alone identifies them.

For Latin-script text (Spanish, French, German, etc.), a single word or very short phrase is genuinely ambiguous for any free/offline detector — "chat" is a real word in both English and French, for example. The bot handles this by:
- Using statistical detection for phrases of 3+ words (fairly accurate).
- Defaulting to "assume English" for 1-2 Latin-script words.

If a short foreign phrase gets misread as English, just use the shortcut format to force it, e.g. `en: bonjour` won't help since the source is wrong — instead just tap through the language picker, or if you know the source, phrasing it as a longer sentence gets it detected correctly.

## Notes
- The first voice note after the bot starts (or after idle time) may take ~20 seconds while Hugging Face "wakes up" the model — the bot message tells the user this. Subsequent requests are fast.
- If Hugging Face's free tier ever feels too rate-limited for your volume, the same code structure can swap in a different transcription API with minimal changes to `transcribeVoice()`.
- If you want translation history, saved user preferences (e.g. "always translate to Bengali"), or multi-word batch translation, those are straightforward additions — just ask.
