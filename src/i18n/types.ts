import type { EntityType } from '@doccloak/core';

export interface Translations {
  header: {
    ready: string;
    notReady: string;
    setupRequired: string;
    error: string;
    language: string;
    settings: string;
    skipToTool: string;
  };
  settings: {
    detectionSensitivity: string;
    fewerMatches: string;
    moreMatches: string;
    sensitivityExplanation: string;
    replacementStyle: string;
    labeledPlaceholders: string;
    labeledDescription: string;
    blankedOut: string;
    blankedDescription: string;
    customLabels: string;
    customLabelsDescription: string;
    customLabelsPlaceholder: string;
    addLabel: string;
    detectionModel: string;
    models: {
      gliner: { label: string; description: string };
      'gliner-base': { label: string; description: string };
      bardsai: { label: string; description: string };
    };
    regexRules: string;
    regexRulesDescription: string;
    regexRegion: string;
    /** Settings popover, under the regex toggle: where the language is picked (T228). */
    regexRegionHint: string;
    regexRegions: Record<string, string>;
  };
  dictionary: {
    title: string;
    description: string;
    placeholder: string;
    add: string;
    caseSensitive: string;
    removeWord: string;
    matchesCase: string;
  };
  // Mirror of the dictionary: listed words are never anonymized. Shares the
  // dictionary's control labels; only these three strings differ.
  ignoreList: {
    title: string;
    description: string;
    placeholder: string;
  };
  textInput: {
    title: string;
    clear: string;
    placeholder: string;
    wordCount: (count: number) => string;
    selectToTag: string;
    uploadDocx: string;
    uploadDocxSub: string;
    unsupportedFormat: string;
    removeFile: string;
    dropzoneOr: string;
    dragging: string;
    readyToRedact: string;
    ocrNoText: string;
    ocrExtracted: string;
    removeRedaction: string;
  };
  textOutput: {
    title: string;
    copy: string;
    copied: string;
    placeholder: string;
    emptyStateHint: string;
    emptyStateStep1: string;
    emptyStateStep2: string;
    emptyStateStep3: string;
    emptyStateTip: string;
    downloadDocx: string;
    /** T216: the PDF export keeps its text layer, so the button names the format. */
    downloadPdf: string;
    noDetections: string;
    downloadImage: string;
    downloaded: string;
    exportFailed: string;
    nextStepHint: string;
  };
  redactButton: {
    redact: string;
    redacting: string;
    detectionFailedTitle: string;
    detectionFailedBody: string;
  };
  entityTable: {
    title: (count: number) => string;
    subtitle: string;
    type: string;
    label: string;
    originalValue: string;
    confidence: string;
    include: string;
    clickToRename: string;
    includeEntity: string;
    excludeEntity: string;
    markAs: string;
  };
  entityLabels: Record<EntityType, string>;
  step2: {
    title: string;
    description: string;
    example: string;
  };
  deAnonymize: {
    pasteLabel: string;
    restoredLabel: string;
    restoreButton: string;
    inputPlaceholder: string;
    outputPlaceholder: string;
    copy: string;
    copied: string;
  };
  footer: {
    offlineMessage: string;
    verifyText: string;
    verifyTooltip: string;
  };
  toast: {
    copiedToClipboard: string;
    cleared: string;
    redactionRemoved: string;
    undo: string;
    newVersion: string;
    reload: string;
  };
  loading: {
    setupTitle: string;
    setupBody: (size: string) => string;
    setupAction: string;
    preparingEngine: string;
    downloadingModel: string;
    initializing: string;
    oneTimeSetup: string;
    oneTimeSetupWithSize: (size: string) => string;
    largeModelWarning: string;
    progress: (downloaded: string, total: string, percent: number) => string;
    failedTitle: string;
    failedBody: string;
    retry: string;
  };
  anonymizing: {
    title: string;
    description: string;
    // T222: remaining-time estimate and cancel on the overlay
    remaining: (time: string) => string;
    hours: (n: number) => string;
    minutes: (n: number) => string;
    seconds: (n: number) => string;
    cancel: string;
  };
  ocr: {
    processingTitle: string;
    processingDescription: string;
  };
  landing: {
    hero: {
      titleBefore: string;
      titleEm: string;
      /** Constant text between the censor-bar word and the rotating noun, e.g. "the ". May be empty. */
      titleAfterPrefix: string;
      /** PII nouns cycled in the headline; the first entry is the resting/default word. */
      titleRotating: string[];
      /** Constant text after the rotating noun, including punctuation, e.g. " inside them." or "." */
      titleAfter: string;
      subtitle: string;
      subtitleEmphasis: string;
      ctaTry: string;
      ctaSeeHow: string;
      trustBrowser: string;
      trustOpenSource: string;
      trustNoTracking: string;
    };
    audience: {
      eyebrow: string;
      heading: string;
      lawyersTitle: string;
      lawyersBody: string;
      consultantsTitle: string;
      consultantsBody: string;
      healthcareTitle: string;
      healthcareBody: string;
      hrTitle: string;
      hrBody: string;
    };
    howItWorks: {
      eyebrow: string;
      heading: string;
      step1Title: string;
      step1Body: string;
      step2Title: string;
      step2Body: string;
      step3Title: string;
      step3Body: string;
      step4Title: string;
      step4Body: string;
    };
    faq: {
      eyebrow: string;
      heading: string;
      q1: string;
      a1: string;
      q2: string;
      a2: string;
      q3: string;
      a3: string;
      q4: string;
      a4: string;
      q5: string;
      a5: string;
      q6: string;
      a6: string;
    };
  };
  // T188: consent card copy when a model is preselected before the download consent
  consent: {
    /** "Download {model} ({size} MB)?" */
    forModel: (model: string, sizeMB: number) => string;
    body: string;
  };
  // T188: detection watchdog (no progress for 20 s -> worker restarted)
  detect: {
    timeout: string;
    // T222: toast after the user cancelled a run
    cancelled: string;
  };
  // T177/T178: UnsupportedDocumentError codes mapped to a message with a one-line remedy
  fileErrors: {
    'unrecognized-namespace': string;
    'invalid-package': string;
    'too-large': (limit: string) => string;
    // T216 (PDF): Core's PDF caps (bytes and pages), quoted without the docx 'unpacked' wording
    'pdf-too-large': (limit: string) => string;
    // T221 (PDF): a damaged or non-PDF file (the docx wording talks about Word and .docx)
    'pdf-invalid': string;
    'fast-saved': string;
    encrypted: string;
    'unredactable-parts': string;
    'empty-document': string;
    // T216 (PDF): post-write verification found a trace of an original value; nothing is shipped
    'verify-failed': string;
    // T216 (PDF): the bytes no longer produce the analysed text (re-upload)
    'stale-extraction': string;
  };
  // T177 founder decision: informed-consent export for parts DocCloak cannot redact
  unredactable: {
    title: string;
    body: string;
    continue: string;
    cancel: string;
    continued: string;
    warningsTitle: string;
    kinds: {
      'embedded-object': string;
      macros: string;
      'html-chunk': string;
      'external-data': string;
      'printer-settings': string;
      // T216 (PDF): image-only page, and text no decoder can read
      'scanned-page': string;
      'undecodable-text': string;
      unknown: (part: string) => string;
    };
  };
  // T216: PDF export report (parts the writer drops, pages it rasterized)
  pdf: {
    removedTitle: string;
    removedBody: string;
    removed: {
      annotations: string;
      'form-fields': string;
      outlines: string;
      attachments: string;
      javascript: string;
      metadata: string;
      'structure-tree': string;
      'page-labels': string;
      'named-destinations': string;
      'optional-content': string;
      signatures: string;
    };
    /** `pages` is the 1-based list ("3, 7"), `count` its length (for plural forms). */
    rasterizedPages: (pages: string, count: number) => string;
  };
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  translations: Translations;
}
