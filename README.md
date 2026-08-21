<p align="center">
  <img src="docs/logo.png" alt="DocCloak Logo" width="150">
</p>

<h1 align="center">DocCloak</h1>

<p align="center"><strong>Use AI without leaking client data.</strong></p>

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

DocCloak is an open-source document anonymizer that strips personally identifiable information (PII) before you share documents with AI services - and restores the original names in the AI's response.

Everything runs in your browser. No server, no API calls, no data leaves your machine.

![DocCloak Demo](docs/redact.gif)

## Who Is This For?

- **Lawyers & legal teams** - redact client names from contracts before asking AI to review clauses
- **Consultants** - anonymize company data in reports before generating AI summaries
- **Healthcare professionals** - strip patient identifiers from notes before using AI for research
- **HR departments** - remove employee PII from documents before AI-assisted policy drafting
- **Anyone** who uses AI tools but handles sensitive data they can't afford to leak

## How It Works

1. **Paste** your document or **upload** a `.doc`/`.docx` file or an image (`.png`, `.jpg`) - image text is extracted locally with OCR
2. **Redact** - DocCloak detects names, emails, phone numbers, addresses, and other PII using a local ML model + regex patterns
3. **Copy** the anonymized text and paste it into any AI service (ChatGPT, Claude, Gemini, etc.) - or **download** the redacted document
4. **Restore** - paste the AI's response back into DocCloak to replace placeholders with the original names

The AI never sees the real data. You get the full power of AI assistance without the privacy risk.

## Features

- **Runs locally** - ML models run in-browser via ONNX Runtime WebAssembly. Verify: open DevTools → Network tab → zero requests during anonymization
- **Typed placeholders** - replacements like `[PERSON_1]`, `[EMAIL_1]`, `[DATE_2]` tell the AI what kind of thing was redacted, so its answers stay coherent (pronouns, date reasoning, formatting) and the protected text stays readable
- **14 entity types** - persons, emails, phones, SSNs, credit cards, dates, currencies, IP addresses, IBANs, addresses, companies, secrets, API keys, and custom labels
- **Secrets and credential detection** - API keys (AWS, GitHub, Slack, OpenAI, Anthropic, Google), private key blocks, JWTs, connection strings, and high-entropy tokens are caught before they reach the AI
- **Document support** - upload `.doc` and `.docx` files, redact PII, and download the protected file with all formatting preserved
- **Image support (OCR)** - upload or paste an image or screenshot (`.png`, `.jpg`, `.webp`, `.bmp`, `.gif`); text is extracted locally with Tesseract WebAssembly, run through the same PII detection, and you can download a redacted copy of the image with the sensitive words blacked out
- **Multiple detection models** - choose between GLiNER PII Edge (~65 MB, multi-language, custom labels) and BardS.ai EU PII (~279 MB, 24 EU languages, 35 entity types). Switch models from settings without reloading. Phones and other low-memory devices default to the lightweight GLiNER model
- **Consent-first setup** - nothing downloads until you accept the one-time setup; the model recommended for your device is preselected, and later visits load straight from the browser cache
- **Resilient model downloads** - interrupted downloads resume where they left off (HTTP Range), transient network errors are retried with backoff, and a Try again button appears if the download ultimately fails
- **Verified model downloads** - model files are checked against pinned SHA-256 hashes and tokenizers are pinned to exact upstream revisions, so a tampered or corrupted download is rejected instead of loaded
- **Hybrid detection** - ML model + 175+ regex rules for structured patterns across 19 regions (AT, BE, CH, CN, DE, DK, ES, FI, FR, GB, IE, IT, JP, NL, NO, PL, PT, SE, US)
- **Entity propagation** - when a name or company is detected once, DocCloak automatically finds all other occurrences throughout the document, and different mentions of the same person ("John Smith", "John", "Smith") share one placeholder
- **Round-trip de-anonymization** - paste the AI's response back in and DocCloak restores the original names automatically
- **Forgiving restore** - if the AI reformats a placeholder (`**[PERSON_1]**`, `[person_1]`, `PERSON_1`), restore still recognizes it; anything ambiguous is left untouched rather than guessed at
- **Editable labels** - rename any placeholder (e.g., `[PERSON_3]` → `[CLIENT_NAME]`) for clearer AI prompts
- **Custom detection labels** - add your own entity types (e.g., `medical condition`, `job title`) to detect domain-specific information
- **Manual tagging** - select any text and assign an entity type for things the model missed
- **Configurable sensitivity** - adjust the confidence threshold to control the precision/recall trade-off
- **8 European languages** - English, Polish, German, French, Spanish, Portuguese, Swedish, Norwegian
- **Replacement styles** - labeled placeholders (`[PERSON_1]`, reversible) or blanked out (`________`, permanent)

## Getting Started

```bash
# Clone the repository
git clone https://github.com/WLojek/doccloak.git
cd doccloak

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

The output in `dist/` is a static SPA that can be deployed to any static hosting provider (Vercel, Cloudflare Pages, Netlify, etc.) or served locally.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 |
| Language | TypeScript 5.8 |
| Build | Vite 6 |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix primitives) |
| PII Engine | [@doccloak/core](https://www.npmjs.com/package/@doccloak/core) (Apache-2.0, [source](https://github.com/WLojek/DocCloak.Core)) |
| ML Runtime | ONNX Runtime WebAssembly |
| NER Models | [GLiNER PII Edge v1.0](https://huggingface.co/knowledgator/gliner-pii-edge-v1.0) (~65 MB) / [BardS.ai EU PII](https://huggingface.co/bardsai/eu-pii-anonimization-multilang) (~279 MB) |
| Tokenizers | [@huggingface/transformers](https://huggingface.co/docs/transformers.js) v3 (loaded from HuggingFace Hub) |
| Testing | Vitest |

## Ecosystem

DocCloak is a family of tools built around one shared engine:

| Repository | What it is | License |
|------------|------------|---------|
| [DocCloak](https://github.com/WLojek/DocCloak) (this repo) | The web app - UI, worker wiring, hosting | AGPL-3.0 |
| [DocCloak.Core](https://github.com/WLojek/DocCloak.Core) | The PII detection and anonymization engine, published to npm as [@doccloak/core](https://www.npmjs.com/package/@doccloak/core) | Apache-2.0 |

The engine (ML providers, regex rules, pipeline, DOCX/OCR handling) was extracted from this
repository into DocCloak.Core so that other tools can embed it. The web app consumes it as a
regular npm dependency; its behavior is unchanged by the split. If you want to build your own
anonymization tool, depend on `@doccloak/core` directly - the permissive Apache-2.0 license
applies to the engine, while this web app remains AGPL-3.0.

## Why It's Safe

DocCloak doesn't ask you to trust a server, a company, or a privacy policy. It's built so you don't have to trust anyone.

- **Your data never leaves the browser.** There is no backend. No API. No server to get hacked. The ML model and all regex rules run entirely in your browser using WebAssembly. You can verify this yourself: open DevTools → Network tab → paste a document → zero requests.
- **Nothing sensitive is stored.** All entity mappings live in memory only. Close the tab and everything is gone. Only your model preference is saved to localStorage.
- **No tracking, no analytics, no telemetry.** DocCloak doesn't know who you are, what you paste, or how often you use it.
- **Minimal external requests.** The only external network activity is loading the ML model and tokenizer from HuggingFace on first use - and only after you accept the one-time setup; nothing downloads without asking. The OCR engine and its language data are served from the app's own origin (no third-party CDN), fetched only when you first use image OCR. No Google Fonts, no third-party scripts, no telemetry. No data you paste or upload ever leaves your browser - OCR runs entirely locally.
- **Verified downloads.** Model files are verified against SHA-256 hashes pinned in the engine, and tokenizers are pinned to exact upstream revisions. If a download does not match, it is discarded and never loaded.
- **Open source and auditable.** Every line of code is public: the web app in this repository (AGPL-3.0) and the detection engine in [DocCloak.Core](https://github.com/WLojek/DocCloak.Core) (Apache-2.0). The AGPL-3.0 license guarantees the app stays open - even if someone else hosts it, they must publish their source code too.
- **Works offline after first load.** Once the model is cached, you can disconnect from the internet and DocCloak keeps working - anonymization runs entirely in WebAssembly.

### Model caching and offline use

After a model is downloaded for the first time, DocCloak stores it in the browser's [Cache Storage](https://developer.mozilla.org/en-US/docs/Web/API/Cache) under the `doccloak-models` cache. On subsequent visits the model loads from local storage instead of re-downloading from HuggingFace, so you can use DocCloak fully offline.

Caching is **best-effort**. If your browser refuses to cache the model - for example because the per-origin storage quota is exceeded, you're using an Incognito/Private window with restricted quota, or the model file is larger than the browser allows for a single Cache entry - DocCloak still loads the model into memory and works normally for the current session. The next visit will simply re-download it instead of using the cache.

The BardS.ai EU PII model (~279 MB) is most likely to hit quota limits, especially in Incognito mode. GLiNER PII Edge (~65 MB) caches reliably almost everywhere. To force a re-download (e.g. after a model update), open DevTools → Application → Cache Storage → delete the `doccloak-models` cache.

The regex rule packs that power structured-pattern detection also live in DocCloak.Core (`rules/*.json`) and are shared unchanged with the DocCloak command-line tool.

## Scripts

```bash
npm run dev        # Start dev server
npm run build      # Type-check + production build
npm run preview    # Preview production build
npm run lint       # Run ESLint
npm test           # Run tests
npm run test:watch # Run tests in watch mode
```

## Contributing

Contributions are welcome! UI, translations, and app-level fixes belong in this repository. Detection logic (regex rules for new regions, ML providers, pipeline improvements) now lives in [DocCloak.Core](https://github.com/WLojek/DocCloak.Core) - contribute engine changes there.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and ensure tests pass (`npm test`)
4. Submit a pull request

## License

The web app (this repository) is licensed under [AGPL-3.0](LICENSE).

The detection engine it depends on, [@doccloak/core](https://github.com/WLojek/DocCloak.Core), is licensed separately under Apache-2.0.
