/**
 * BardS.ai EU PII Anonymization Provider
 *
 * XLM-RoBERTa-base fine-tuned for EU PII detection (multilingual).
 * 35 entity types, 277M parameters, quantized ONNX (~279 MB).
 * Runs in-browser via ONNX Runtime WebAssembly.
 */

import * as ort from 'onnxruntime-web';
import { AutoTokenizer, env } from '@huggingface/transformers';
import type { DetectedEntity, DetectionProvider, EntityType, ProgressCallback } from '../../types.ts';

// ── Model config ──────────────────────────────────────────
const MODEL_URL = 'https://huggingface.co/bardsai/eu-pii-anonimization/resolve/main/onnx/model_quantized.onnx';
const TOKENIZER_HF = 'bardsai/eu-pii-anonimization';
const MODEL_NAME = 'BardS.ai EU PII';
const WASM_PATH = import.meta.env.BASE_URL;
const DEFAULT_THRESHOLD = 0.5;
const MAX_SEQ_LENGTH = 512;
const CHUNK_OVERLAP = 30;

/** id2label — 35 entity types from bardsai config.json */
const ID2LABEL: Record<number, string> = {
  0: 'O',
  1: 'B-ACCOUNT_IDENTIFIER', 2: 'B-AUTH_SECRET', 3: 'B-BANK_ACCOUNT_IDENTIFIER',
  4: 'B-BIOMETRIC_DATA', 5: 'B-CONTACT_HANDLE', 6: 'B-COOKIE_IDENTIFIER',
  7: 'B-CRIMINAL_OFFENCE_DATA', 8: 'B-DATE_OF_BIRTH', 9: 'B-DEVICE_IDENTIFIER',
  10: 'B-DOCUMENT_REFERENCE', 11: 'B-EMAIL_ADDRESS', 12: 'B-ETHNIC_ORIGIN',
  13: 'B-FINANCIAL_AMOUNT', 14: 'B-GENETIC_DATA', 15: 'B-GEO_LOCATION',
  16: 'B-HEALTH_DATA', 17: 'B-INCOME_COMPENSATION', 18: 'B-IP_ADDRESS',
  19: 'B-LOCATION', 20: 'B-ORGANIZATION_IDENTIFIER', 21: 'B-ORGANIZATION_NAME',
  22: 'B-PAYMENT_CARD', 23: 'B-PAYMENT_CARD_SECURITY', 24: 'B-PERSON_ALIAS',
  25: 'B-PERSON_ATTRIBUTE', 26: 'B-PERSON_IDENTIFIER', 27: 'B-PERSON_NAME',
  28: 'B-PERSON_ROLE_OR_TITLE', 29: 'B-PHONE_NUMBER', 30: 'B-POLITICAL_OPINION',
  31: 'B-POSTAL_ADDRESS', 32: 'B-RELIGION_OR_BELIEF', 33: 'B-SEXUAL_ORIENTATION',
  34: 'B-TRADE_UNION_MEMBERSHIP', 35: 'B-VEHICLE_IDENTIFIER',
  36: 'I-ACCOUNT_IDENTIFIER', 37: 'I-AUTH_SECRET', 38: 'I-BANK_ACCOUNT_IDENTIFIER',
  39: 'I-BIOMETRIC_DATA', 40: 'I-CONTACT_HANDLE', 41: 'I-COOKIE_IDENTIFIER',
  42: 'I-CRIMINAL_OFFENCE_DATA', 43: 'I-DATE_OF_BIRTH', 44: 'I-DEVICE_IDENTIFIER',
  45: 'I-DOCUMENT_REFERENCE', 46: 'I-EMAIL_ADDRESS', 47: 'I-ETHNIC_ORIGIN',
  48: 'I-FINANCIAL_AMOUNT', 49: 'I-GENETIC_DATA', 50: 'I-GEO_LOCATION',
  51: 'I-HEALTH_DATA', 52: 'I-INCOME_COMPENSATION', 53: 'I-IP_ADDRESS',
  54: 'I-LOCATION', 55: 'I-ORGANIZATION_IDENTIFIER', 56: 'I-ORGANIZATION_NAME',
  57: 'I-PAYMENT_CARD', 58: 'I-PAYMENT_CARD_SECURITY', 59: 'I-PERSON_ALIAS',
  60: 'I-PERSON_ATTRIBUTE', 61: 'I-PERSON_IDENTIFIER', 62: 'I-PERSON_NAME',
  63: 'I-PERSON_ROLE_OR_TITLE', 64: 'I-PHONE_NUMBER', 65: 'I-POLITICAL_OPINION',
  66: 'I-POSTAL_ADDRESS', 67: 'I-RELIGION_OR_BELIEF', 68: 'I-SEXUAL_ORIENTATION',
  69: 'I-TRADE_UNION_MEMBERSHIP', 70: 'I-VEHICLE_IDENTIFIER',
};

/** Map bardsai entity labels → DocCloak EntityType */
const LABEL_TO_ENTITY_TYPE: Record<string, EntityType> = {
  PERSON_NAME: 'PERSON',
  PERSON_ALIAS: 'PERSON',
  EMAIL_ADDRESS: 'EMAIL',
  CONTACT_HANDLE: 'EMAIL',
  PHONE_NUMBER: 'PHONE',
  PERSON_IDENTIFIER: 'SSN',
  DATE_OF_BIRTH: 'DATE',
  PAYMENT_CARD: 'CREDIT_CARD',
  PAYMENT_CARD_SECURITY: 'CREDIT_CARD',
  IP_ADDRESS: 'IP_ADDRESS',
  BANK_ACCOUNT_IDENTIFIER: 'IBAN',
  ACCOUNT_IDENTIFIER: 'IBAN',
  POSTAL_ADDRESS: 'ADDRESS',
  LOCATION: 'ADDRESS',
  GEO_LOCATION: 'ADDRESS',
  ORGANIZATION_NAME: 'COMPANY',
  ORGANIZATION_IDENTIFIER: 'COMPANY',
  FINANCIAL_AMOUNT: 'OTHER',
  INCOME_COMPENSATION: 'OTHER',
  VEHICLE_IDENTIFIER: 'OTHER',
  DOCUMENT_REFERENCE: 'OTHER',
  PERSON_ROLE_OR_TITLE: 'OTHER',
  PERSON_ATTRIBUTE: 'OTHER',
  AUTH_SECRET: 'OTHER',
  COOKIE_IDENTIFIER: 'OTHER',
  DEVICE_IDENTIFIER: 'OTHER',
  BIOMETRIC_DATA: 'OTHER',
  GENETIC_DATA: 'OTHER',
  HEALTH_DATA: 'OTHER',
  CRIMINAL_OFFENCE_DATA: 'OTHER',
  ETHNIC_ORIGIN: 'OTHER',
  POLITICAL_OPINION: 'OTHER',
  RELIGION_OR_BELIEF: 'OTHER',
  SEXUAL_ORIENTATION: 'OTHER',
  TRADE_UNION_MEMBERSHIP: 'OTHER',
};

/** Extract the bare entity name from a BIO tag like "B-PERSON_NAME" → "PERSON_NAME" */
function bioToEntity(tag: string): string | null {
  if (tag === 'O' || !tag.includes('-')) return null;
  return tag.split('-').slice(1).join('-');
}

export class BardsaiProvider implements DetectionProvider {
  private _name = MODEL_NAME;
  get name(): string { return this._name; }

  private tokenizer: any = null;
  private session: ort.InferenceSession | null = null;
  private loading = false;
  private loadError: Error | null = null;
  private loadCallbacks: Array<() => void> = [];
  private progressCallback: ProgressCallback | null = null;
  private threshold = DEFAULT_THRESHOLD;

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

      // Configure @huggingface/transformers — load tokenizer from HF
      env.allowLocalModels = false;
      env.allowRemoteModels = true;

      // Load tokenizer and model in parallel (skip tokenizer if already loaded from a prior session)
      const tasks: Promise<unknown>[] = [this.fetchModelWithProgress(MODEL_URL)];
      if (!this.tokenizer) {
        tasks.push(
          AutoTokenizer.from_pretrained(TOKENIZER_HF).then((t: unknown) => {
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
    if (!text.trim()) return [];

    // Split into words with character offsets
    const words: { word: string; start: number; end: number }[] = [];
    const wordRegex = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(text)) !== null) {
      words.push({ word: match[0], start: match.index, end: match.index + match[0].length });
    }

    if (words.length === 0) return [];

    // Tokenize full text once to count subtokens per word via ▁ prefix
    onProgress?.(0);
    const fullEncoded = await this.tokenizer(words.map((w) => w.word).join(' '), {
      add_special_tokens: false,
    });
    const tokenIds = Array.from(fullEncoded.input_ids.data as BigInt64Array);
    const tokenStrings: string[] = this.tokenizer.model.convert_ids_to_tokens(tokenIds.map(Number));

    // Count subtokens per word: ▁ prefix marks word boundaries (SentencePiece)
    const subtokenCounts: number[] = [];
    let currentCount = 0;
    for (const tok of tokenStrings) {
      if (tok.startsWith('\u2581') && currentCount > 0) {
        subtokenCounts.push(currentCount);
        currentCount = 1;
      } else {
        currentCount++;
      }
    }
    if (currentCount > 0) subtokenCounts.push(currentCount);

    // Pad if mismatch (rare edge case)
    while (subtokenCounts.length < words.length) subtokenCounts.push(1);
    onProgress?.(0.1);

    // Count total chunks for progress tracking
    const maxSubtokens = MAX_SEQ_LENGTH - 2;
    const overlapWords = CHUNK_OVERLAP;

    // Pre-count chunks
    let totalChunks = 0;
    {
      let ci = 0;
      while (ci < words.length) {
        let sum = 0, ce = ci;
        while (ce < words.length && sum + subtokenCounts[ce] <= maxSubtokens) { sum += subtokenCounts[ce]; ce++; }
        if (ce === ci) ce = ci + 1;
        totalChunks++;
        const next = Math.max(ci + 1, ce - overlapWords);
        if (ce >= words.length) break;
        ci = next;
      }
    }

    // Process chunks with progress
    const allEntities: DetectedEntity[] = [];
    let i = 0;
    let chunksDone = 0;

    onProgress?.(0.1); // tokenization done

    while (i < words.length) {
      let subtokenSum = 0;
      let end = i;
      while (end < words.length && subtokenSum + subtokenCounts[end] <= maxSubtokens) {
        subtokenSum += subtokenCounts[end];
        end++;
      }
      if (end === i) end = i + 1;

      const chunkWords = words.slice(i, end);
      const chunkEntities = await this.inferChunk(chunkWords, text);
      allEntities.push(...chunkEntities);

      chunksDone++;
      onProgress?.(0.1 + 0.9 * (chunksDone / totalChunks)); // inference = 10-100%
      await new Promise((r) => setTimeout(r, 0));

      const nextStart = Math.max(i + 1, end - overlapWords);
      i = nextStart;
      if (end >= words.length) break;
    }

    return this.deduplicateSpans(allEntities);
  }

  private async inferChunk(
    words: { word: string; start: number; end: number }[],
    fullText: string,
  ): Promise<DetectedEntity[]> {
    const chunkText = words.map((w) => w.word).join(' ');
    const encoded = await this.tokenizer(chunkText, {
      return_tensors: 'np',
      truncation: true,
      max_length: MAX_SEQ_LENGTH,
      padding: true,
    });

    const inputIds = encoded.input_ids.data as BigInt64Array;
    const attentionMask = encoded.attention_mask.data as BigInt64Array;
    const seqLen = encoded.input_ids.dims[1];

    // Build word→subtoken alignment via ▁ prefix (no per-word tokenization needed)
    const chunkTokenIds = Array.from(inputIds);
    const chunkTokenStrings: string[] = this.tokenizer.model.convert_ids_to_tokens(
      chunkTokenIds.map(Number),
    );
    const wordSubtokenStart: number[] = [];
    // Skip <s> at position 0; first real token at position 1
    for (let t = 1; t < seqLen - 1; t++) {
      const tok = chunkTokenStrings[t];
      if (!tok || tok === '</s>') break;
      if (tok.startsWith('\u2581')) {
        wordSubtokenStart.push(t);
      }
    }

    // XLM-RoBERTa: only input_ids + attention_mask (no token_type_ids)
    const feeds: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
      attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
    };

    const results = await this.session!.run(feeds);
    const logits = results.logits.data as Float32Array;
    const numLabels = results.logits.dims[2];

    // Per-subtoken predictions: argmax + softmax confidence
    const predictions: { labelIdx: number; confidence: number }[] = [];
    for (let t = 0; t < seqLen; t++) {
      const offset = t * numLabels;
      let maxIdx = 0;
      let maxVal = logits[offset];
      for (let l = 1; l < numLabels; l++) {
        if (logits[offset + l] > maxVal) {
          maxVal = logits[offset + l];
          maxIdx = l;
        }
      }
      let sumExp = 0;
      for (let l = 0; l < numLabels; l++) {
        sumExp += Math.exp(logits[offset + l] - maxVal);
      }
      predictions.push({ labelIdx: maxIdx, confidence: 1 / sumExp });
    }

    // Aggregate subtoken predictions to word level (first subtoken wins)
    const entities: DetectedEntity[] = [];
    let currentEntity: {
      entityName: string;
      entityType: EntityType;
      startWord: number;
      endWord: number;
      confidence: number;
      tokenCount: number;
    } | null = null;

    for (let wi = 0; wi < words.length; wi++) {
      const stIdx = wordSubtokenStart[wi];
      if (stIdx === undefined || stIdx >= seqLen - 1) break;

      const pred = predictions[stIdx];
      const label = ID2LABEL[pred.labelIdx] || 'O';
      const entityName = bioToEntity(label);
      const isB = label.startsWith('B-');
      const isI = label.startsWith('I-');

      if (isB) {
        if (currentEntity) {
          this.emitEntity(currentEntity, words, fullText, entities);
        }
        currentEntity = {
          entityName: entityName!,
          entityType: LABEL_TO_ENTITY_TYPE[entityName!] || 'OTHER',
          startWord: wi,
          endWord: wi,
          confidence: pred.confidence,
          tokenCount: 1,
        };
      } else if (isI && currentEntity && entityName === currentEntity.entityName) {
        currentEntity.endWord = wi;
        currentEntity.confidence += pred.confidence;
        currentEntity.tokenCount += 1;
      } else {
        if (currentEntity) {
          this.emitEntity(currentEntity, words, fullText, entities);
          currentEntity = null;
        }
      }
    }

    if (currentEntity) {
      this.emitEntity(currentEntity, words, fullText, entities);
    }

    return entities;
  }

  private emitEntity(
    entity: {
      entityName: string;
      entityType: EntityType;
      startWord: number;
      endWord: number;
      confidence: number;
      tokenCount: number;
    },
    words: { word: string; start: number; end: number }[],
    fullText: string,
    entities: DetectedEntity[],
  ): void {
    const avgConfidence = entity.confidence / entity.tokenCount;
    if (avgConfidence < this.threshold) return;

    const charStart = words[entity.startWord].start;
    const charEnd = words[entity.endWord].end;

    entities.push({
      type: entity.entityType,
      value: fullText.slice(charStart, charEnd),
      start: charStart,
      end: charEnd,
      confidence: avgConfidence,
      detector: `bardsai:${entity.entityName}`,
    });
  }

  private deduplicateSpans(entities: DetectedEntity[]): DetectedEntity[] {
    const sorted = [...entities].sort((a, b) => b.confidence - a.confidence);
    const result: DetectedEntity[] = [];
    for (const e of sorted) {
      const overlaps = result.some(
        (existing) => e.start < existing.end && e.end > existing.start,
      );
      if (!overlaps) result.push(e);
    }
    return result;
  }

  private async fetchModelWithProgress(url: string): Promise<string> {
    const cache = await caches.open('doccloak-models');

    const cached = await cache.match(url);
    if (cached) {
      const blob = await cached.blob();
      this.progressCallback?.(blob.size, blob.size);
      return URL.createObjectURL(blob);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      await cache.put(url, new Response(blob));
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
    await cache.put(url, new Response(blob));
    return URL.createObjectURL(blob);
  }
}
