# Telegram Translation Bot (OpenAI-only)

Translates any word/phrase: English → any language, any language → English.
Also accepts voice notes — transcribes them, then runs the same translation logic.
Uses only OpenAI (GPT for translation/detection, Whisper for speech-to-text) — no Google Cloud needed.

## How it works
- Send a word/phrase in **English** → bot shows quick-pick buttons for the target language.
- Send a word/phrase in **any other language** → bot auto-detects it and translates to English.
- Send a **voice note** → bot transcribes it (any spoken language, auto-detected), shows the transcript, then applies the same rule: English gets a language picker, anything else gets auto-translated to English.
- Shortcut: `es: hello` translates directly to Spanish (swap `es` for any [ISO 639-1 code](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes)).

## Setup

1. **Get a Telegram bot token**
   - Message [@BotFather](https://t.me/BotFather) on Telegram -> `/newbot` -> follow prompts -> copy the token.

2. **Get an OpenAI API key**
   - Go to https://platform.openai.com/api-keys -> Create new secret key.
   - This one key covers both translation (`gpt-4o-mini` chat completions) and voice transcription (Whisper).
   - Approximate costs: `gpt-4o-mini` is a fraction of a cent per translation; Whisper is $0.006/minute of audio.

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Fill in `BOT_TOKEN` and `OPENAI_API_KEY` in `.env`.

5. **Run it**
   ```bash
   npm start
   ```

## Deploying (so it stays online 24/7)
Since you're already comfortable with Docker, the simplest path:
```bash
docker run -d --name translate-bot --env-file .env -v $(pwd):/app -w /app node:20 npm start
```
Or drop this into your existing n8n/Docker VPS setup alongside your other bot.

## Customizing the language picker
Edit the `COMMON_LANGS` array at the top of `bot.js` to change which languages show up as buttons when the input is English.

## Customizing translation quality
`TEXT_MODEL` near the top of `bot.js` is set to `gpt-4o-mini` (fast, cheap, accurate enough for words/phrases). Change it to `gpt-4o` if you want stronger handling of longer or more nuanced text -- costs more per call but still cheap for this use case.

## Notes
- Language detection and translation both go through OpenAI chat completions -- no separate translation API.
- Voice notes are sent to Whisper as-is (Telegram's OGG/Opus format is supported directly -- no conversion step needed).
- Whisper handles files up to 25MB, which comfortably covers normal voice notes (even several minutes of speech).
- If you want translation history, saved user preferences (e.g. "always translate to Bengali"), or multi-word batch translation, those are straightforward additions -- just ask.
