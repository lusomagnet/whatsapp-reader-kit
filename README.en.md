# whatsapp-reader-kit (EN)

A **read-only** CLI that turns a **WhatsApp Web** conversation into a structured corpus —
`messages.jsonl`, `chat.md`, downloaded media and voice-note transcripts — for an AI agent to query.
Ships a **Claude Code skill**. Node + Python (Python only needed for transcription).

> ## ⚠️ Read this before installing
>
> - **Automating WhatsApp breaks its Terms of Service, and enforcement lands on your phone number** —
>   most likely also your 2FA and banking channel. The risk is yours. Use it only with **your own**
>   account, at human pace.
> - **Not affiliated with WhatsApp or Meta.** It uses `@wppconnect/wa-js`, a reverse-engineered
>   WhatsApp Web library.
> - **The session directory is a credential**, equivalent to a linked device. It lives in
>   `~/.whatsapp-reader/session` and must never enter a repository, a shared backup or a screenshot.
> - **The corpus contains third parties' personal data.** Whoever extracts it is the data controller
>   under GDPR. The people in those chats consented to nothing.
> - **`--transcribe` creates new personal data**: it turns other people's voice into indexable text.
> - **The QR that `login` prints is a live credential.** Never share, pipe or screen-share it.

## What "read-only" means here

No command in this CLI sends, reacts, deletes or marks as read. To be precise, though:

- Opening WhatsApp Web **sets your account online**, and your contacts see it. Native-export ingest
  (`ingest`) has no such effect — prefer it when it fits.
- The injected library **does expose** write functions. This kit never calls them, but read-only is a
  **convention of this CLI**, not an engine-level barrier.

## Install

```bash
git clone https://github.com/elchamoluso/whatsapp-reader-kit.git && cd whatsapp-reader-kit
bash install.sh          # npm deps + optional venv + skill + PATH link
whatsapp-reader login    # human step: scan the QR from your phone (once)
whatsapp-reader status
```

Requires **Node ≥ 18**, a system **Chromium**, and Python 3 with `venv` only for `--transcribe`.

## Usage

```bash
whatsapp-reader status
whatsapp-reader chats --limit 20
whatsapp-reader extract --chat "Name or JID" --limit 50            # → ~/.whatsapp-reader/corpus
whatsapp-reader extract --chat "Name or JID" --all --media --transcribe
whatsapp-reader ingest /path/to/_chat.txt --media --transcribe     # native phone export
```

The corpus defaults to `~/.whatsapp-reader/corpus`, deliberately **outside** any git tree, so a
`git add -A` cannot pick it up. `status` hides your own WhatsApp id (it is your phone number) unless
you pass `--show-id`.

## Security trade-offs

The browser launches with `--no-sandbox` and `--disable-setuid-sandbox`, and calls
`setBypassCSP(true)` to inject the library. That is a workaround for containerized environments where
Chromium's sandbox will not start, and it **lowers the browser's defenses**. Remove them in
`src/browser.js` if your system does not need them.

## Credits

By [Jesús Manuel Ferreira Andara](https://github.com/elchamoluso). Uses
[`@wppconnect/wa-js`](https://github.com/wppconnect-team/wa-js) (Apache-2.0) and
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) (MIT). MIT licensed.
