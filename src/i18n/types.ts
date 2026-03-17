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
  };
  textOutput: {
    title: string;
    copy: string;
    copied: string;
    placeholder: string;
    emptyStateHint: string;
  };
  redactButton: {
    redact: string;
    redacting: string;
    shortcutHint: string;
  };
  entityTable: {
    title: (count: number) => string;
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
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  translations: Translations;
}
