import type { EntityType } from '@doccloak/core';

/**
 * A detection model in the settings picker (T249): the short line under its name, and the full
 * description behind "More". Strengths and weaknesses come from the model test kit (69 documents,
 * 10 languages, regex rules on).
 */
export interface ModelCopy {
  label: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  bestFor: string;
}

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
      gliner: ModelCopy;
      'gliner-base': ModelCopy;
      bardsai: ModelCopy;
      'bardsai-v2': ModelCopy;
      'bardsai-v3': ModelCopy;
      'gliner2-pii': ModelCopy;
      'gliner2-pii-yethdev': ModelCopy;
      'openai-pf': ModelCopy;
    };
    /** Under a model that runs only on WebGPU, where the browser lacks it. */
    modelNeedsWebGpu: string;
    /** Download size next to a model's name ("279 MB"). */
    modelSize: (sizeMB: number) => string;
    /** The toggle that opens and closes a model's full description (T249). */
    modelMore: string;
    modelLess: string;
    /** Headings of the full description. */
    modelStrengths: string;
    modelWeaknesses: string;
    modelBestFor: string;
    /** Under the full description: what the strengths and weaknesses were measured on. */
    modelTestNote: string;
    /** Whether the model's files are already in this browser's model cache (T250). */
    modelSaved: string;
    modelNotSaved: string;
    /** Removes a saved model that is not the selected one; the label names the model for screen readers. */
    modelRemove: string;
    modelRemoveLabel: (model: string) => string;
    /** Toasts after a removal; `size` is modelSize of the model. */
    modelRemoved: (model: string, size: string) => string;
    modelRemoveFailed: string;
    /** Under the model list: all models stay while accuracy testing continues; feedback is welcome. */
    modelsTestingNote: string;
    /** Link to the GitHub feedback form, under the list and (prefilled) under each model's full description. */
    modelsFeedback: string;
    modelFeedback: string;
    /** Settings: clear the service worker's files and reload, models kept (T251, WLojek/DocCloak#2). */
    offlineDataTitle: string;
    offlineDataDescription: string;
    offlineDataClear: string;
    /** Asked before clearing: the reload drops what is on the page. */
    offlineDataConfirm: string;
    offlineDataConfirmYes: string;
    offlineDataCancel: string;
    /** Shown while the browser is offline, when the button is disabled. */
    offlineDataNeedsNetwork: string;
    /** Settings: pages of a scanned PDF read with OCR at a time (T253, Core issue #4). */
    ocrWorkersTitle: string;
    /** The default choice, with the number it means on this device. */
    ocrWorkersAuto: (workers: number) => string;
    ocrWorkersHint: string;
    regexRules: string;
    regexRulesDescription: string;
    regexRegion: string;
    /** Settings popover, under the regex toggle: where the language is picked (T228). */
    regexRegionHint: string;
    regexRegions: Record<string, string>;
    /** T263: the same setting, reachable without a document. */
    neverTitle: string;
    neverDescription: string;
    /** Switch for the reminder to save the replacement table (it can be turned off in the reminder itself). */
    reminderTitle: string;
    reminderDescription: string;
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
    /** After a value was marked by hand: the same text stands in `count` more places. */
    alsoElsewhere: (count: number) => string;
    redactThemToo: string;
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
    /**
     * Under the result: how many different values were replaced, and in how many places.
     * Not the list's count (entityTable.title), which is every place found, redacted or not.
     */
    replacedSummary: (values: number, places: number) => string;
    /** Next to the download: the replacement table as a file (T261). */
    saveTable: string;
    tableSaved: string;
    /** The line at the result: every place found is replaced. */
    reviewAll: (count: number) => string;
    /** The line at the result when places were left readable. */
    reviewKept: (found: number, replaced: number, kept: number) => string;
    reviewLink: string;
    showKeptLink: string;
    /** Under the result, in place of "safe to share", when places were left readable. */
    keptHint: (kept: number) => string;
    /** Added to the line at the result when every readable place is of a type set to never be redacted. */
    keptBySetting: (types: string) => string;
    /** Toasts after a download or a copy that takes readable places with it. */
    downloadedKept: (kept: number) => string;
    copiedKept: (kept: number) => string;
    /** Next to the download in the file bar: how many places stay readable, and the way to them. */
    filebarKept: (kept: number) => string;
    /** One-time toast when the result changes after it was copied or downloaded. */
    changedAfterTaken: string;
    /** In the result panel when a pasted text was checked and nothing was found. */
    noDetectionsText: string;
  };
  redactButton: {
    redact: string;
    redacting: string;
    detectionFailedTitle: string;
    detectionFailedBody: string;
  };
  entityTable: {
    /** Heading of the list: every place where sensitive data was found (one row each). */
    title: (count: number) => string;
    subtitle: string;
    type: string;
    label: string;
    originalValue: string;
    confidence: string;
    include: string;
    clickToRename: string;
    markAs: string;
    /** WLojek/DocCloak#4: filter by type and text, then act on everything shown. */
    filterLabel: string;
    allTypes: string;
    /** Chip that lists only the items that are not redacted. */
    keptChip: string;
    filterPlaceholder: string;
    clearFilter: string;
    showing: (shown: number, total: number) => string;
    /** Lasting summary next to the count line. */
    status: (redacted: number, kept: number) => string;
    dontRedactThese: (count: number) => string;
    redactThese: (count: number) => string;
    /** Shown instead of the two buttons while no filter is on. */
    bulkHint: string;
    noMatches: string;
    keptToast: (count: number) => string;
    redactedToast: (count: number) => string;
    /** A re-run on the same text kept what the user chose (T261). */
    choicesKeptToast: string;
    /** The xN button of a value that stands in several places (T262). */
    places: (count: number) => string;
    /** T263: types that are never anonymized, also in the next documents. */
    neverOffer: (type: string) => string;
    neverNote: string;
    neverRemove: (type: string) => string;
    /** Toast after a type was put on the never-redact list: what it did here (`count` places) and how long it holds. */
    neverOnToast: (type: string, count: number) => string;
    /** Toast after a type was taken off the list; `count` places of it are still readable in the open document. */
    neverOffToast: (type: string, count: number) => string;
    redactThemNow: string;
    /** Next to a value redacted in some of its places only. */
    partly: (redacted: number, total: number) => string;
    /** Button of a value that stands in one place: opens that place with the words around it. */
    showPlace: string;
    /** Toast when a rename is refused because another value holds that label. */
    labelTaken: (label: string, value: string) => string;
    /** Filter chip for the places the detector was least sure about. */
    lowChip: string;
    /** What the "Certainty" number means, under the list's subtitle. */
    certaintyHelp: string;
    /** Button next to a renamed label: back to the numbered one. */
    resetLabel: string;
    /** Toast when a text holds more values than labels can be kept stable for. */
    labelsNotStable: string;
    /** Refusal of a hand label that has the shape of the numbered labels DocCloak issues. */
    labelOwnShape: (label: string) => string;
    /** Refusal of a hand label without a letter or digit, or with brackets inside. */
    labelInvalid: string;
    /** After a re-run on the same text: places that were redacted and are not found any more. */
    droppedToast: (count: number) => string;
    keepRedacted: string;
    /** Refusal of a hand label that the document itself holds as bracketed text ("[Client]" in a template). */
    labelInText: (label: string) => string;
    /** Refusal of a rename whose derived label (surname, first name) once stood for another value. */
    labelDerivedTaken: (label: string, derived: string, value: string) => string;
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
    /** WLojek/DocCloak#3: names back into a docx, the replacement table as a file. */
    docxTitle: string;
    docxBody: string;
    docxButton: string;
    docxWorking: string;
    /** Both routes: in how many places an original was put back (0 = none found in pasted text). */
    restoredCount: (count: number) => string;
    /** Appended when nothing that looks like a label stayed. */
    allClear: string;
    docxDownloaded: (file: string) => string;
    docxDownloadAgain: string;
    docxNothing: (file: string) => string;
    /** Labels that stayed in the result, then why and what to do. */
    leftover: (count: number) => string;
    leftoverHelp: string;
    andMore: (count: number) => string;
    showAll: string;
    /** A label left in the result that this tab issued earlier: what it stood for and why it is not restored. */
    staleLabel: (label: string, original: string) => string;
    /** The same for a label of another document or an earlier version of the text: the value is not named. */
    staleElsewhere: (label: string) => string;
    /** A label whose value is in the table, written in a form restore does not read. */
    unreadLabel: (label: string, original: string) => string;
    /** A label that stood for one value earlier in this tab and stands for another now: not restored. */
    staleTwo: (label: string, now: string) => string;
    /** In the report when the document's own table did the restoring: one pair of it, to tell whose it is. */
    usedDocumentTable: (label: string, value: string) => string;
    /** In place of the quiet table line when the document's protected text never left the page in this tab. */
    notTakenOut: string;
    /** A label-like token left in a reply that the document itself holds as text. */
    inTextOnly: (label: string) => string;
    /** A label of the table that the document also holds as text: not restored. */
    inTextAndLabel: (label: string) => string;
    /** When a table from a file restored labels that also stand for values of the open document. */
    fileOverDocument: string;
    /** Heading of the list of other bracketed text that remains (not known to be a label). */
    otherBrackets: string;
    /** In the report when a table loaded from a file did the restoring. */
    usedFileTable: (file: string) => string;
    /** Toast after copying a restored text that still holds labels. */
    copiedWithLabels: (count: number) => string;
    docxOnlyDocx: string;
    docxFailed: string;
    /** Accessible name of the strip that says which table restores. */
    tableTitle: string;
    tableCurrent: (count: number) => string;
    tableFromFile: (file: string, count: number) => string;
    /** Introduces one real pair of the table. */
    tableExample: string;
    tableBody: string;
    tableSaveHint: string;
    tableFromFileNote: string;
    tableFromFileNoteAlone: string;
    tableImport: string;
    tableUseCurrent: string;
    tableRemove: string;
    tableInvalid: string;
    /** A new redaction put a loaded table away. */
    tableDroppedToast: string;
    loadEarlier: string;
  };
  /** T261: the protected result left the page, its replacement table exists only in this tab. */
  tableReminder: {
    title: string;
    body: string;
    dismiss: string;
    never: string;
    /** Toast after "Don't remind me again": where it can be switched back on. */
    offToast: string;
    /** Question before "Clear" or removing the file throws away a table that was never saved. */
    clearConfirm: string;
  };
  /** T265: spreadsheets. */
  xlsx: {
    /** Heading of the notice shown for a loaded workbook. */
    title: string;
    /** What is checked, with the count of date cells and of long numbers read as identifiers. */
    checked: (dates: number, identifiers: number) => string;
    sheetNames: string;
    /** Number cells that are not checked and stay readable. */
    notChecked: (count: number) => string;
    /** At the result of a workbook with number cells that were not checked (in place of "safe to share"). */
    resultWarning: (count: number) => string;
    /** Opens the list of the unchecked cells (sheet, address, value). */
    showCells: string;
    /** Toast after downloading a workbook that keeps unchecked number cells readable. */
    downloadedUnchecked: (count: number) => string;
    formulasNote: string;
    invalid: string;
    sheetsRenamed: (names: string, count: number) => string;
  };
  footer: {
    offlineMessage: string;
    verifyText: string;
    verifyTooltip: string;
  };
  toast: {
    copiedToClipboard: string;
    /** Accessible name of the button that closes a toast. */
    dismiss: string;
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
    /** The chosen model runs only on WebGPU and the browser has none (T242). */
    webGpuTitle: string;
    webGpuBody: string;
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
    /** T239: reading the pages of a PDF: how far ("page 3 of 16"). */
    pdfPages: (done: number, total: number) => string;
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
    // T236 (PDF): no text at all because the PDF is a scan without OCR; the remedy names OCR and image upload
    'pdf-scan-no-text': string;
    /** T239: every page is a picture and DocCloak's own OCR found no text on any of them. */
    'pdf-scan-ocr-nothing': string;
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
    // T236: scan pages with an OCR text layer, on load (what will happen) and after export (what happened)
    scanPagesFound: (pages: string, count: number) => string;
    scanPages: (pages: string, count: number) => string;
    // T238: scan pages whose picture holds text the OCR layer does not have (cannot be redacted)
    ocrMissing: (pages: string, count: number) => string;
    // T238: such text read by DocCloak's own OCR (its values are covered like the rest)
    ocrRead: (pages: string, count: number) => string;
    // T239: pages without any text layer, read whole by DocCloak's own OCR
    ocrWholePage: (pages: string, count: number) => string;
    // T239: text pages with an image showing text, read by DocCloak's own OCR
    ocrInImages: (pages: string, count: number) => string;
    // T239: text pages with an image showing text DocCloak could not read
    imagesTextUnread: (pages: string, count: number) => string;
  };
  /**
   * Notes Core writes as English sentences, in the interface language (coreNotes.ts). `pages` is
   * the 1-based list ("3, 7"), `count` its length; placeholders and part paths are shown as they are.
   */
  coreNotes: {
    /** A page reference on the card's list of parts ("page 2", "pages 2-17"). */
    page: (pages: string, count: number) => string;
    imagesNotScanned: (pages: string, count: number) => string;
    pageMetadataRemoved: (pages: string, count: number) => string;
    placeholderUnshowable: (placeholder: string) => string;
    placeholderTooWide: (placeholder: string, page: string) => string;
    placeholderFallbackFont: (count: number) => string;
    fontMapRemoved: (font: string) => string;
    /** A DOCX part that is not well-formed XML, kept as it is without the value check. */
    partNotXml: (part: string) => string;
    /** A DOCX header or footer that is not well-formed XML, whose text was not read. */
    partSkipped: (part: string) => string;
    /** Notes with no translation, counted here and logged in full to the console. */
    other: (count: number) => string;
  };
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  translations: Translations;
}
