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
- **Document support** - upload `.doc` and `.docx` files, redact PII, and download the protected file with formatting preserved. The exported file also has its metadata scrubbed; see [What DocCloak changes in your file](#what-doccloak-changes-in-your-file) and [Known limits](#known-limits)
- **Image support (OCR)** - upload or paste an image or screenshot (`.png`, `.jpg`, `.webp`, `.bmp`, `.gif`); text is extracted locally with Tesseract WebAssembly, run through the same PII detection, and you can download a redacted copy of the image with the sensitive words blacked out
- **Multiple detection models** - choose between GLiNER PII Small (~83 MB, multi-language, custom labels), GLiNER PII Base (~197 MB, often better for English and dates, custom labels) and BardS.ai EU PII (~279 MB, best multilingual accuracy, 24+ EU languages, 35 entity types). Switch models from settings without reloading. Phones and other low-memory devices default to the lightweight GLiNER model
- **Consent-first setup** - nothing downloads until you accept the one-time setup. The model recommended for your device is preselected; if you pick a different model before accepting, the prompt names that model and its size, and still nothing is downloaded until you press Accept. Later visits load straight from the browser cache
- **Resilient model downloads** - interrupted downloads resume where they left off (HTTP Range), transient network errors are retried with backoff, and a Try again button appears if the download ultimately fails
- **Verified model downloads** - the model file and both tokenizer files of every model are fetched from a pinned upstream commit and checked against pinned SHA-256 hashes and byte sizes, so a tampered or corrupted download is rejected instead of loaded
- **Works offline after first load** - a Service Worker keeps the app shell (about 2.5 MB) in the browser; the ONNX runtime and the OCR files are cached the first time they are used and the model lives in the `doccloak-models` cache, so a fresh visit without a network connection still opens the app and loads the model. See [Storage and offline use](#storage-and-offline-use)
- **Hybrid detection** - ML model + 175+ regex rules for structured patterns across 19 regions (AT, BE, CH, CN, DE, DK, ES, FI, FR, GB, IE, IT, JP, NL, NO, PL, PT, SE, US)
- **Entity propagation** - when a name or company is detected once, DocCloak automatically finds all other occurrences throughout the document, and different mentions of the same person ("John Smith", "John", "Smith") share one placeholder
- **Round-trip de-anonymization** - paste the AI's response back in and DocCloak restores the original names automatically
- **Forgiving restore** - if the AI reformats a placeholder (`**[PERSON_1]**`, `[person_1]`, `PERSON_1`), restore still recognizes it; anything ambiguous is left untouched rather than guessed at
- **Editable labels** - rename any placeholder (e.g., `[PERSON_3]` → `[CLIENT_NAME]`) for clearer AI prompts
- **Custom detection labels** - add your own entity types (e.g., `medical condition`, `job title`) to detect domain-specific information
- **Manual tagging** - select any text and assign an entity type for things the model missed
- **Custom dictionary** - add words or phrases that must always be redacted (project codenames, company names); every occurrence in the text is caught, with optional case-sensitive matching, and the list persists in your browser
- **Ignore list** - the dictionary's opposite: words or phrases that are never anonymized even when a model detects them (your own company name, a city that is public knowledge). An ignored word is carved out of any detection that covers it, so with "Smith" listed, "John Smith" becomes "[PERSON_1] Smith" and the first name stays protected; whole-word matching, optional case sensitivity, persisted in your browser
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
| NER Models | [GLiNER PII Small v1.0](https://huggingface.co/knowledgator/gliner-pii-small-v1.0) (~83 MB) / [GLiNER PII Base v1.0](https://huggingface.co/knowledgator/gliner-pii-base-v1.0) (~197 MB) / [BardS.ai EU PII](https://huggingface.co/bardsai/eu-pii-anonimization-multilang) (~279 MB) |
| Tokenizers | [@huggingface/transformers](https://huggingface.co/docs/transformers.js) v4 tokenizer classes; the tokenizer files themselves are downloaded and verified by `@doccloak/core` from the same pinned commit as the model |
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
- **Your documents are never stored.** Document text, detected entities and placeholder mappings live in memory only. Close the tab and they are gone. What does persist is listed, key by key, in [Storage and offline use](#storage-and-offline-use): your settings (model choice, download consent, interface language, regex options), the lists you fill in yourself (custom detection labels, dictionary, ignore list) in localStorage, and the downloaded model, runtime and OCR files in the browser's caches. The dictionary and the ignore list are words you typed, often names and company names, so treat them as data: remove entries in Settings, or clear the site data in your browser to wipe everything at once. Nothing in these stores is ever sent anywhere.
- **No tracking, no analytics, no telemetry.** DocCloak doesn't know who you are, what you paste, or how often you use it.
- **Minimal external requests.** The only external network activity is the one-time download of the model file and its two tokenizer files (`tokenizer.json`, `tokenizer_config.json`) from `huggingface.co`, each from an immutable `resolve/<commit>/` URL - and only after you accept the one-time setup; nothing downloads without asking. Choosing a model before accepting only changes which model the prompt offers. The OCR engine and its language data are served from the app's own origin (no third-party CDN), fetched only when you first use image OCR. No Google Fonts, no third-party scripts, no telemetry. No data you paste or upload ever leaves your browser - OCR runs entirely locally.
- **Verified downloads.** The model file and both tokenizer files of each model are pinned to an exact upstream commit and verified against SHA-256 hashes and byte sizes pinned in the engine ([documentation/model-provenance.md](../documentation/model-provenance.md) lists every value). If a download does not match, it is discarded and never loaded. A verified file is stored with a small marker (`sha256:size`); a cached file whose size no longer matches its marker is re-hashed instead of trusted.
- **Open source and auditable.** Every line of code is public: the web app in this repository (AGPL-3.0) and the detection engine in [DocCloak.Core](https://github.com/WLojek/DocCloak.Core) (Apache-2.0). The AGPL-3.0 license guarantees the app stays open - even if someone else hosts it, they must publish their source code too.
- **Works offline after first load.** A Service Worker precaches the app shell on your first visit, the runtime and OCR files are cached when first used, and the model is cached after its one-time download. From then on you can open DocCloak without a network connection: the page, the model and anonymization all come from your device. Details and the exact cache names are in the next section.

### Storage and offline use

Everything DocCloak keeps on your device, and how to remove it:

| Where | Name | What it holds | How to clear |
|-------|------|---------------|--------------|
| localStorage | `doccloak-model-consented`, `doccloak-active-provider`, `doccloak-regex-enabled`, `doccloak-regex-region`, `doccloak-lang` | Download consent, chosen model, regex options, interface language | Settings, or browser site data |
| localStorage | `doccloak-custom-labels`, `doccloak-dictionary`, `doccloak-ignore-list` | Custom detection labels, dictionary words, ignore-list words: text you typed yourself, often names or company names | Remove entries in Settings, or clear the site data in your browser |
| Cache Storage | `doccloak-models` | The model file, `tokenizer.json` and `tokenizer_config.json` of every model you have loaded, plus one small verification marker per file (`sha256:size`) | DevTools → Application → Cache Storage → delete the cache; the next visit re-downloads and re-verifies |
| Cache Storage | `doccloak-shell-<build>`, `doccloak-runtime-<build>` | Service Worker caches: the app shell (`index.html` and the hashed `/assets/*` files, about 2.5 MB, stored on first visit) and the runtime files stored on first use (ONNX Runtime WASM, Tesseract worker, core and language data) | Replaced automatically when a new build activates; browser site data removes them |
| IndexedDB | `keyval-store` | Tesseract.js language data (`*.traineddata`) after your first OCR | Browser site data |

There is no `transformers-cache`: since web 0.13.0 the tokenizer files go through the same verified download path as the model and land in `doccloak-models`; the old unverified bucket left by earlier versions is deleted once on first start. Document content, detected entities and placeholder mappings are never written to any of these stores.

**Offline.** The Service Worker is registered in production builds only. It precaches only the app shell (about 2.5 MB) and never downloads the 25 MB ONNX runtime or the 29 MB OCR files up front: those are cached the first time you use detection or OCR. Model and tokenizer requests to `huggingface.co`, Range requests and anything that is not a plain GET bypass the worker entirely, so the `doccloak-models` cache and resumable downloads are untouched. Navigation is network-first: when you are online, a new build is picked up on the next visit and a toast asks you to refresh; when you are offline, the cached shell is served. After one online visit with the model downloaded (and one OCR run, if you use images), a fresh visit without a network connection opens the app and loads the model.

**Caching is best-effort.** If your browser refuses to cache the model - for example because the per-origin storage quota is exceeded, you're using an Incognito/Private window with restricted quota, or the model file is larger than the browser allows for a single Cache entry - DocCloak still loads the model into memory and works normally for the current session. The next visit will simply re-download it instead of using the cache. The BardS.ai EU PII model (~279 MB) is most likely to hit quota limits, especially in Incognito mode. GLiNER PII Small (~83 MB) caches reliably almost everywhere.

The regex rule packs that power structured-pattern detection also live in DocCloak.Core (`rules/*.json`) and are shared unchanged with the DocCloak command-line tool.

## What DocCloak changes in your file

For an uploaded `.docx`, the downloaded file contains the placeholder text wherever detected entities were, in every text-bearing part of the package: body, headers and footers, footnotes and endnotes, comments, text boxes, charts, diagrams (SmartArt), custom XML data, the glossary (building blocks) and the attributes that carry text (field instructions, alternative text of images, bookmark names, numbering text). A bookmark whose name contained an entity is renamed and every reference to it is updated. On top of that, the engine scrubs the package whether or not anything was detected:

- **Removed:** revision number and version, revision identifiers (`w:rsid*`), the page-preview thumbnail, the attached template, mail-merge settings, document variables (`w:docVars`), hyperlink tooltips, content-control tags without a data binding, and the external data links of charts (the chart keeps its cached data).
- **Blanked:** author, last modified by, title, subject, description, keywords, category, content status and identifier (`docProps/core.xml`); company, manager, hyperlink base, template and every heading, sheet or defined-name title in the document statistics (`docProps/app.xml`); custom property values (names kept); the comment-author registry (`word/people.xml`); author and initials on comments and tracked changes.
- **Normalised:** creation, modification and last-printed dates to `2000-01-01T00:00:00Z`; dates on comments, insertions, deletions and formatting-change records to `2000-01-01T00:00:00Z` (the only change you can see: comment and revision dates in the downloaded file); page, word, character, line and paragraph counts and total editing time to 0; every ZIP entry dated `1980-01-01` with entry and archive comments removed, so the file no longer reveals which parts were touched; `mailto:` link targets replaced by `mailto:redacted@example.invalid`.
- **Every known value scrubbed everywhere:** after the text replacements, every value from the session (with its variants and name tokens of four or more characters) is removed from every XML, relationship and VML part of the package, including parts the reader does not extract text from. A part that cannot be parsed is reported as a warning.

For a legacy `.doc`, the text is replaced through the piece table, the property sets and string tables (authors, reviewers, comment owners, bookmarks, save history, autosave path) are space-filled, and every remaining byte occurrence of each original value is overwritten with spaces of the same length in the `WordDocument`, `Table` and `Data` streams, without moving any structure.

## Known limits

- **Images inside documents are not OCR-scanned.** Text in a picture embedded in a `.docx` or `.doc` stays as it is. Upload the image on its own to redact it with OCR.
- **Embedded objects, macros, inserted HTML fragments and external data connections cannot be anonymised.** When a `.docx` contains an embedded workbook or other OLE object, a VBA project, an `altChunk` HTML fragment, a data connection or printer settings, DocCloak lists them and asks you before exporting: Continue exports the file with those parts unchanged (the rest of the file is redacted and the known values are still scrubbed from every XML part), Cancel stops the export. A `.doc` with an `ObjectPool` (embedded objects) or `Macros` storage gets the same question, and those storages are copied unchanged.
- **Fast-saved and encrypted `.doc` files are refused.** A `.doc` saved incrementally keeps deleted text outside the visible document, where no detector can see it, so DocCloak refuses it with the remedy: open it in Word and use Save As, or save it as `.docx`. Encrypted or obfuscated `.doc` files are refused too; remove the password first.
- **Sheet names are not renamed.** Spreadsheet support lives in the engine, not in the web app; a sheet name that contains an entity is reported, not changed.
- **Unrecognised formats are refused, not passed through.** A document whose main part uses a namespace the reader does not know, or a package that cannot be parsed, is refused with a message rather than exported with a false "redacted" label. Packages over 200 MB unpacked are refused as too large.
- **No detector catches everything.** Every detection is shown for review so you can add what the model missed (manual tagging, dictionary) before anything leaves your screen.

## Surrogate mode (engine only)

The web app offers two replacement styles: labeled placeholders (`[PERSON_1]`, exactly reversible) and blanked out (`________`, permanent). The engine, `@doccloak/core`, also has a surrogate mode that swaps each value for a realistic stand-in. It is not yet exposed in the web app's settings; if you use it through the engine, know what surrogates deliberately preserve so the AI's answer stays coherent:

- **Names** keep the number of words and the guessed gender and locale of the original.
- **Phone numbers** keep their formatting and the international prefix (`+CC`, `00CC` or a leading trunk `0`); every subscriber digit is replaced.
- **Dates** keep their format and are shifted by a constant number of days (1 to 30, forward or backward) for the whole session, so the spacing between dates is preserved. This means one known date in the text reveals the shift for all the others.
- **IBANs** keep the country code and the letter positions, with a valid checksum.
- **Emails** keep the shape of the address (separators, digit count) with a fabricated domain.

Placeholder mode is the exact one: it reveals only the entity type, and restore is lossless. Surrogate restore matches by value and is best-effort.

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
