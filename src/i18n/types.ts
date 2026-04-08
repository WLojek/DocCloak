import type { EntityType } from '../core/types.ts';

export interface Translations {
  header: {
    ready: string;
    notReady: string;
    error: string;
    offline: string;
    edition: string;
  };
  settings: {
    detectionSensitivity: string;
    fewerMatches: string;
    moreMatches: string;
    sensitivityExplanation: string;
    confidenceThreshold: (value: string) => string;
    replacementStyle: string;
    labeledPlaceholders: string;
    labeledDescription: string;
    blankedOut: string;
    blankedDescription: string;
    customLabels: string;
    customLabelsDescription: string;
    customLabelsPlaceholder: string;
    addLabel: string;
    noCustomLabels: string;
    detectionModel: string;
    models: {
      gliner: { label: string; description: string };
      bardsai: { label: string; description: string };
    };
    acceleration: string;
    accelAuto: string;
    accelAutoDesc: string;
    accelWebGPU: string;
    accelWebGPUDesc: string;
    accelCPU: string;
    accelCPUDesc: string;
    accelReloadNote: string;
    regexRules: string;
    regexRulesDescription: string;
    regexRegion: string;
    regexRegions: Record<string, string>;
  };
  howItWorks: {
    title: string;
    step1Label: string;
    step1Text: string;
    step2Label: string;
    step2Text: string;
    step3Label: string;
    step3Text: string;
  };
  step1: {
    title: string;
    description: string;
  };
  textInput: {
    title: string;
    clear: string;
    placeholder: string;
    wordCount: (count: number) => string;
    selectToTag: string;
    uploadDocx: string;
    uploadDocxSub: string;
    pasteText: string;
    pasteTextSub: string;
    loadedFile: (name: string) => string;
    unsupportedFormat: string;
    removeFile: string;
    dropzoneTitle: string;
    dropzoneOr: string;
    dropzoneHint: string;
    dragging: string;
    readyToRedact: string;
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
    downloaded: string;
    exportFailed: string;
    downloadDocxAction: string;
    nextStepHint: string;
  };
  redactButton: {
    redact: string;
    redacting: string;
    shortcutHint: string;
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
    undo: string;
  };
  loading: {
    settingUp: string;
    preparingEngine: string;
    initializing: string;
    oneTimeSetup: string;
    oneTimeSetupWithSize: (size: string) => string;
    largeModelWarning: string;
    progress: (downloaded: string, total: string, percent: number) => string;
  };
  anonymizing: {
    title: string;
    description: string;
  };
  landing: {
    hero: {
      titleBefore: string;
      titleEm: string;
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
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  translations: Translations;
}
