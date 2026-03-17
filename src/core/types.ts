export type EntityType =
  | 'PERSON'
  | 'EMAIL'
  | 'PHONE'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'DATE'
  | 'CURRENCY'
  | 'IP_ADDRESS'
  | 'IBAN'
  | 'ADDRESS'
  | 'COMPANY'
  | 'OTHER';

export interface DetectedEntity {
  type: EntityType;
  value: string;
  start: number;
  end: number;
  confidence: number;
  detector: string;
}

export type ProgressCallback = (downloaded: number, total: number) => void;

/**
 * Interface for detection providers.
 * Implement this to add a new model/detection backend.
 * The engine only depends on this interface — swap providers without changing anything else.
 */
export interface DetectionProvider {
  /** Human-readable name for this provider */
  readonly name: string;

  /** Initialize/download the model. Called once on app load. */
  load(): Promise<void>;

  /** Whether the provider is ready to detect */
  isLoaded(): boolean;

  /** Whether the provider is currently loading */
  isLoading(): boolean;

  /** Register a callback for download progress updates */
  onProgress(callback: ProgressCallback): void;

  /** Run detection on the given text */
  detect(text: string): Promise<DetectedEntity[]>;

  /** Set detection confidence threshold */
  setThreshold(value: number): void;

  /** Get current detection confidence threshold */
  getThreshold(): number;
}

export interface ReplacementEntry {
  original: string;
  replacement: string;
  entityType: EntityType;
}


export const ENTITY_COLORS: Record<EntityType, string> = {
  PERSON: '#7B2FF7',
  EMAIL: '#2563EB',
  PHONE: '#0D9488',
  SSN: '#B45309',
  CREDIT_CARD: '#CA8A04',
  DATE: '#6D28D9',
  CURRENCY: '#EA580C',
  IP_ADDRESS: '#0284C7',
  IBAN: '#A16207',
  ADDRESS: '#DC2626',
  COMPANY: '#DB2777',
  OTHER: '#6B7280',
};

export const ENTITY_LABELS: Record<EntityType, string> = {
  PERSON: 'Name',
  EMAIL: 'Email',
  PHONE: 'Phone',
  SSN: 'SSN',
  CREDIT_CARD: 'Credit Card',
  DATE: 'Date',
  CURRENCY: 'Currency',
  IP_ADDRESS: 'IP Address',
  IBAN: 'IBAN',
  ADDRESS: 'Address',
  COMPANY: 'Company',
  OTHER: 'Other',
};
