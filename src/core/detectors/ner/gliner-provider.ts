import type { DetectedEntity, EntityType, DetectionProvider, ProgressCallback } from '../../types.ts';
import { AutoTokenizer, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';

// ── Model config ──────────────────────────────────────────
const DEFAULT_MODEL_URL = 'https://huggingface.co/knowledgator/gliner-pii-edge-v1.0/resolve/main/onnx/model_quint8.onnx';
const DEFAULT_TOKENIZER_HF = 'knowledgator/gliner-pii-edge-v1.0';
const DEFAULT_MODEL_NAME = 'GLiNER PII Edge';
const WASM_PATH = import.meta.env.BASE_URL;
const CUSTOM_LABELS_STORAGE_KEY = 'doccloak-custom-labels';

const CLS_TOKEN_ID = 50281;
const SEP_TOKEN_ID = 50282;
const ENT_TOKEN_ID = 50368;
const SEP_PROMPT_TOKEN_ID = 50369; // <<SEP>> (prompt separator, not [SEP])
const DEFAULT_THRESHOLD = 0.35;
const MAX_WORDS_PER_CHUNK = 150;
const CHUNK_OVERLAP = 40;

const DEFAULT_PII_LABELS = [
  'person name',
  'calendar date',
  'email address', 'phone number', 'ip address',
  'street address', 'city', 'zip code',
  'bank account number', 'credit card number', 'iban',
  'social security number', 'tax id', 'national id number',
  'passport number', 'driver license number',
  'money amount',
  'company name',
];

// ── Label → EntityType mapping ────────────────────────────
function mapLabelToEntityType(label: string): EntityType {
  const l = label.toLowerCase();
  if (l === 'person name') return 'PERSON';
  if (l === 'email address') return 'EMAIL';
  if (l === 'phone number') return 'PHONE';
  if (['social security number', 'national id number', 'tax id', 'passport number', 'driver license number'].includes(l)) return 'SSN';
  if (l === 'credit card number') return 'CREDIT_CARD';
  if (l === 'calendar date') return 'DATE';
  if (l === 'money amount') return 'CURRENCY';
  if (l === 'ip address') return 'IP_ADDRESS';
  if (['iban', 'bank account number'].includes(l)) return 'IBAN';
  if (['street address', 'city', 'zip code'].includes(l)) return 'ADDRESS';
  if (l === 'company name') return 'COMPANY';
  return 'OTHER';
}

// ── Word splitter ─────────────────────────────────────────
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*|\S/gu;

function splitWords(text: string): { words: string[]; starts: number[]; ends: number[] } {
  const words: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let match: RegExpExecArray | null;
  WORD_PATTERN.lastIndex = 0;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    words.push(match[0]);
    starts.push(match.index);
    ends.push(WORD_PATTERN.lastIndex);
  }
  return { words, starts, ends };
}

// ── Sigmoid ───────────────────────────────────────────────
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ── Greedy non-overlapping span selection ─────────────────
type RawSpan = [string, number, number, string, number]; // [text, start, end, label, score]

function greedySelect(spans: RawSpan[]): RawSpan[] {
  const sorted = spans.slice().sort((a, b) => b[4] - a[4]);
  const selected: RawSpan[] = [];
  for (const span of sorted) {
    const overlaps = selected.some(s => span[1] < s[2] && span[2] > s[1]);
    if (!overlaps) selected.push(span);
  }
  return selected.sort((a, b) => a[1] - b[1]);
}

// ── Provider ──────────────────────────────────────────────
export class GlinerProvider implements DetectionProvider {
  private _name = DEFAULT_MODEL_NAME;
  get name(): string { return this._name; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tokenizer: any = null;
  private session: ort.InferenceSession | null = null;
  private loading = false;
  private loadError: Error | null = null;
  private loadCallbacks: Array<() => void> = [];
  private progressCallback: ProgressCallback | null = null;
  private threshold = DEFAULT_THRESHOLD;
  private customLabels: string[] = [];

  isLoaded(): boolean {
    return this.session !== null && this.tokenizer !== null;
  }

  isLoading(): boolean {
    return this.loading;
  }

  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  setThreshold(value: number): void {
    this.threshold = Math.max(0.05, Math.min(0.95, value));
  }

  getThreshold(): number {
    return this.threshold;
  }

  /**
   * Get the combined list of all active labels (built-in + custom).
   */
  private getActiveLabels(): string[] {
    return [...DEFAULT_PII_LABELS, ...this.customLabels];
  }

  /**
   * Get user-defined custom labels.
   */
  getCustomLabels(): string[] {
    return [...this.customLabels];
  }

  /**
   * Set custom labels and persist to localStorage.
   */
  setCustomLabels(labels: string[]): void {
    this.customLabels = labels.filter((l) => l.trim().length > 0);
    try {
      localStorage.setItem(CUSTOM_LABELS_STORAGE_KEY, JSON.stringify(this.customLabels));
    } catch { /* localStorage unavailable in Web Worker */ }
  }

  /**
   * Restore custom labels from localStorage on startup.
   */
  restoreCustomLabels(): void {
    try {
      const saved = localStorage.getItem(CUSTOM_LABELS_STORAGE_KEY);
      if (saved) {
        this.customLabels = JSON.parse(saved);
      }
    } catch { /* localStorage unavailable in Web Worker — labels are passed via message */ }
  }

  async load(): Promise<void> {
    if (this.isLoaded()) return;
    if (this.loadError) throw this.loadError;
    if (this.loading) {
      return new Promise<void>((resolve) => {
        this.loadCallbacks.push(resolve);
      });
    }

    this.loading = true;
    try {
      ort.env.wasm.wasmPaths = WASM_PATH;
      // Force single-threaded WASM. ORT's multi-threaded path hangs silently
      // in some cross-origin-isolated browser contexts when spawning pthread
      // workers (model downloads but session.create never resolves).
      ort.env.wasm.numThreads = 1;

      // Configure @huggingface/transformers — load tokenizers from HF
      env.allowLocalModels = false;
      env.allowRemoteModels = true;

      // Load tokenizer and model in parallel (skip tokenizer if already loaded from a prior session)
      const tasks: Promise<unknown>[] = [this.fetchModelWithProgress(DEFAULT_MODEL_URL)];
      if (!this.tokenizer) {
        tasks.push(
          AutoTokenizer.from_pretrained(DEFAULT_TOKENIZER_HF).then((t: unknown) => {
            this.tokenizer = t;
          }),
        );
      }
      const [blobUrl] = await Promise.all(tasks) as [string];

      this.session = await ort.InferenceSession.create(blobUrl, {
        executionProviders: ['wasm'],
      });

      // Revoke blob URL — ONNX Runtime has already read the data into WASM heap
      URL.revokeObjectURL(blobUrl);

      console.info(`[DocCloak] Model loaded: ${this._name} | inputs: [${this.session.inputNames.join(', ')}] | outputs: [${this.session.outputNames.join(', ')}]`);

      this.loadCallbacks.forEach((cb) => cb());
      this.loadCallbacks.length = 0;
    } catch (err) {
      this.session = null;
      this.loadError = err instanceof Error ? err : new Error(String(err));
      this.loading = false;
      throw this.loadError;
    }
  }

  release(): void {
    if (this.session) {
      this.session.release();
      this.session = null;
    }
    this.loading = false;
    this.loadError = null;
  }

  async detect(text: string, onProgress?: (progress: number) => void): Promise<DetectedEntity[]> {
    if (!this.isLoaded()) await this.load();
    if (!this.session || !this.tokenizer) return [];

    const { words, starts, ends } = splitWords(text);
    if (words.length === 0) return [];

    // Build prompt tokens once (shared across all chunks)
    const activeLabels = this.getActiveLabels();
    const promptTokens = this.buildPromptTokens(activeLabels);

    const chunkSize = MAX_WORDS_PER_CHUNK;
    const overlap = CHUNK_OVERLAP;

    // Split into chunks if text is too long
    const allSpans: RawSpan[] = [];
    onProgress?.(0);

    if (words.length <= chunkSize) {
      // Single chunk — no splitting needed
      const spans = await this.inferChunk(words, starts, ends, text, promptTokens, activeLabels);
      allSpans.push(...spans);
      onProgress?.(1);
    } else {
      // Count total chunks
      let totalChunks = 0;
      for (let cs = 0; cs < words.length; cs += chunkSize - overlap) {
        totalChunks++;
        if (Math.min(cs + chunkSize, words.length) >= words.length) break;
      }

      // Multiple overlapping chunks
      let chunksDone = 0;
      for (let chunkStart = 0; chunkStart < words.length; chunkStart += chunkSize - overlap) {
        const chunkEnd = Math.min(chunkStart + chunkSize, words.length);
        const chunkWords = words.slice(chunkStart, chunkEnd);
        const chunkStarts = starts.slice(chunkStart, chunkEnd);
        const chunkEnds = ends.slice(chunkStart, chunkEnd);

        const spans = await this.inferChunk(chunkWords, chunkStarts, chunkEnds, text, promptTokens, activeLabels);
        allSpans.push(...spans);

        chunksDone++;
        onProgress?.(chunksDone / totalChunks);
        await new Promise((r) => setTimeout(r, 0));

        if (chunkEnd >= words.length) break;
      }
    }

    // Greedy non-overlapping selection across all chunks
    const selected = greedySelect(allSpans);

    return selected
      .filter(([spanText]) => spanText.trim().length >= 2)
      .map(([spanText, start, end, label, score]) => ({
        type: mapLabelToEntityType(label),
        value: spanText,
        start,
        end,
        confidence: score,
        detector: `gliner:${label}`,
      }));
  }

  private buildPromptTokens(labels: string[]): number[] {
    const tokens: number[] = [];
    for (const label of labels) {
      tokens.push(ENT_TOKEN_ID);
      for (const part of label.split(' ')) {
        const subTokens: number[] = this.tokenizer.encode(part).slice(1, -1);
        tokens.push(...subTokens);
      }
    }
    tokens.push(SEP_PROMPT_TOKEN_ID);
    return tokens;
  }

  private async inferChunk(
    words: string[],
    charStarts: number[],
    charEnds: number[],
    fullText: string,
    promptTokens: number[],
    labels: string[],
  ): Promise<RawSpan[]> {
    if (!this.session) return [];

    // Build token sequence: [CLS] + prompt + text words + [SEP]
    const inputIds: number[] = [CLS_TOKEN_ID, ...promptTokens];
    const attentionMask: number[] = new Array(inputIds.length).fill(1);
    const wordsMask: number[] = new Array(inputIds.length).fill(0);

    let wordCounter = 1;
    for (const word of words) {
      const subTokens: number[] = this.tokenizer.encode(word).slice(1, -1);
      for (let j = 0; j < subTokens.length; j++) {
        inputIds.push(subTokens[j]);
        attentionMask.push(1);
        wordsMask.push(j === 0 ? wordCounter : 0);
      }
      wordCounter++;
    }

    inputIds.push(SEP_TOKEN_ID);
    attentionMask.push(1);
    wordsMask.push(0);

    const seqLen = inputIds.length;
    const textLength = words.length;
    const numEntities = labels.length;

    const idToClass: Record<number, string> = {};
    labels.forEach((label, i) => { idToClass[i + 1] = label; });

    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, seqLen]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, seqLen]),
      words_mask: new ort.Tensor('int64', BigInt64Array.from(wordsMask.map(BigInt)), [1, seqLen]),
      text_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(textLength)]), [1, 1]),
    };

    const results = await this.session.run(feeds);

    const outputName = this.session.outputNames[0] || 'logits';
    const logits = results[outputName].data as Float32Array;

    // Token-based: logits shape [1, num_words, num_entities, 3] (start/end/inside)
    const rawSpans: RawSpan[] = [];
    const selectedStarts: Array<[number, number]> = [];
    const selectedEnds: Array<[number, number]> = [];
    const insideScores: number[][] = Array.from({ length: textLength }, () => Array(numEntities).fill(0));

    for (let token = 0; token < textLength; token++) {
      for (let entity = 0; entity < numEntities; entity++) {
        const base = (token * numEntities + entity) * 3;
        const startProb = sigmoid(logits[base]);
        const endProb = sigmoid(logits[base + 1]);
        const insideProb = sigmoid(logits[base + 2]);

        if (startProb >= this.threshold) selectedStarts.push([token, entity]);
        if (endProb >= this.threshold) selectedEnds.push([token, entity]);
        insideScores[token][entity] = insideProb;
      }
    }

    for (const [startTok, startCls] of selectedStarts) {
      for (const [endTok, endCls] of selectedEnds) {
        if (endTok < startTok || startCls !== endCls) continue;

        const inside = insideScores.slice(startTok, endTok + 1).map(s => s[startCls]);
        if (inside.some(s => s < this.threshold)) continue;

        const score = inside.reduce((a, b) => a + b, 0) / inside.length;
        const charStart = charStarts[startTok];
        const charEnd = charEnds[endTok];
        const spanText = fullText.slice(charStart, charEnd);
        rawSpans.push([spanText, charStart, charEnd, idToClass[startCls + 1], score]);
      }
    }

    return rawSpans;
  }

  private async fetchModelWithProgress(url: string = DEFAULT_MODEL_URL): Promise<string> {
    let cache: Cache | null = null;
    try {
      cache = await caches.open('doccloak-models');
    } catch {
      // Cache API unavailable. Proceed without caching.
    }

    if (cache) {
      try {
        const cached = await cache.match(url);
        if (cached) {
          const blob = await cached.blob();
          this.progressCallback?.(blob.size, blob.size);
          return URL.createObjectURL(blob);
        }
      } catch {
        // Cache lookup failed — fall through to network.
      }
    }

    // Download from network
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      await tryCachePut(cache, url, blob);
      return URL.createObjectURL(blob);
    }

    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.length;
      this.progressCallback?.(downloaded, total);
    }

    const blob = new Blob(chunks);
    await tryCachePut(cache, url, blob);
    return URL.createObjectURL(blob);
  }
}

/**
 * Best-effort cache.put — large models often exceed per-origin quota,
 * which surfaces as "Failed to execute 'put' on 'Cache': Unexpected internal error".
 * Caching is an optimisation, not a correctness requirement, so swallow failures.
 */
async function tryCachePut(cache: Cache | null, url: string, blob: Blob): Promise<void> {
  if (!cache) return;
  try {
    await cache.put(url, new Response(blob));
  } catch (err) {
    console.warn('[DocCloak] Model cache put failed (model still loaded in memory):', err);
  }
}
