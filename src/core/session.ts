import type { EntityType, DetectedEntity, ReplacementEntry } from './types.ts';

export type ReplacementMode = 'labeled' | 'blanked';

export class AnonymizationSession {
  private forwardMap = new Map<string, string>();
  private reverseMap = new Map<string, string>();
  private entityTypeMap = new Map<string, EntityType>();
  private counter = 0;
  private mode: ReplacementMode = 'labeled';

  setMode(mode: ReplacementMode): void {
    this.mode = mode;
  }

  getMode(): ReplacementMode {
    return this.mode;
  }

  anonymize(original: string, entityType: EntityType): string {
    if (this.forwardMap.has(original)) {
      return this.forwardMap.get(original)!;
    }
    this.counter++;
    const placeholder = this.mode === 'blanked'
      ? '________'
      : `<<REDACTED_${this.counter}>>`;
    this.forwardMap.set(original, placeholder);
    this.reverseMap.set(placeholder, original);
    this.entityTypeMap.set(original, entityType);
    return placeholder;
  }

  deanonymize(text: string): string {
    let result = text;
    // Sort by placeholder length (longest first) to avoid partial replacements
    const entries = [...this.reverseMap.entries()].sort(
      (a, b) => b[0].length - a[0].length
    );
    for (const [placeholder, original] of entries) {
      result = result.replaceAll(placeholder, original);
    }
    return result;
  }

  anonymizeText(text: string, entities: DetectedEntity[]): string {
    // Sort entities by position (end to start) to preserve indices during replacement
    const sorted = [...entities].sort((a, b) => b.start - a.start);
    let result = text;
    for (const entity of sorted) {
      const placeholder = this.anonymize(entity.value, entity.type);
      result = result.slice(0, entity.start) + placeholder + result.slice(entity.end);
    }
    return result;
  }

  getEntries(): ReplacementEntry[] {
    return [...this.forwardMap.entries()].map(([original, replacement]) => {
      const entityType = this.entityTypeMap.get(original) ?? 'OTHER' as EntityType;
      return { original, replacement, entityType };
    });
  }

  getForward(original: string): string | undefined {
    return this.forwardMap.get(original);
  }

  renameLabel(original: string, newLabel: string): void {
    const oldLabel = this.forwardMap.get(original);
    if (!oldLabel) return;
    this.forwardMap.set(original, newLabel);
    this.reverseMap.delete(oldLabel);
    this.reverseMap.set(newLabel, original);
  }

  clear(): void {
    this.forwardMap.clear();
    this.reverseMap.clear();
    this.entityTypeMap.clear();
    this.counter = 0;
  }
}
