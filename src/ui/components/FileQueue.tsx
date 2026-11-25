/**
 * The files of a set (WLojek/DocCloak#6): a quiet list above the document panels. Each row says
 * where its file is (waiting, being read or analysed, ready, opened, downloaded, in need of a
 * decision, failed) and opens it on the page. There is no "download all": a file is downloaded
 * from its own view, so nobody ships a file they never looked at.
 */
import { useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useFeatureStrings } from '../../i18n/features/index.ts';
import { batchStrings } from '../../i18n/features/batch.ts';
import type { BatchFileStatus, BatchFileView } from '../batch.ts';

interface FileQueueProps {
  files: BatchFileView[];
  /** A detection, the queue or an export is at work: files are not opened or removed now. */
  busy: boolean;
  /** The user stopped the queue and files still wait. */
  paused: boolean;
  /** How many files wait. */
  waiting: number;
  /** The files wait for the model. */
  waitingForModel: boolean;
  /** The most files a set holds. */
  maxFiles: number;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onResume: () => void;
  onClear: () => void;
}

/** The small square in front of a status: the same colours the engine badge and the notices use. */
const STATUS_COLOR: Record<BatchFileStatus, string> = {
  waiting: '#C8C5BC',
  reading: '#B8860B',
  analysing: '#B8860B',
  ready: '#2D6A4F',
  opened: '#111111',
  downloaded: '#111111',
  'needs-decision': '#8A6508',
  failed: '#CC0000',
};

const ANALYSED: ReadonlySet<BatchFileStatus> = new Set<BatchFileStatus>(['ready', 'opened', 'downloaded']);

export function FileQueue({ files, busy, paused, waiting, waitingForModel, maxFiles, onOpen, onRemove, onAddFiles, onResume, onClear }: FileQueueProps) {
  const { t } = useTranslation();
  const text = useFeatureStrings(batchStrings);
  const inputRef = useRef<HTMLInputElement>(null);
  if (files.length === 0) return null;
  const analysed = files.filter((file) => ANALYSED.has(file.status)).length;
  const full = files.length >= maxFiles;

  return (
    <section aria-label={text.title} data-testid="file-queue" className="animate-content-reveal mb-4 border border-[#C8C5BC] bg-[#FFFFFF]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-[#C8C5BC] bg-[#F4F3EE] pl-4 pr-2 md:min-h-11">
        <p className="flex items-baseline gap-3 py-2">
          <span className="font-serif text-sm font-medium text-[#111111]">{text.title}</span>
          {/* Read out when it changes: the queue works while the user is elsewhere. */}
          <span className="label-meta text-[#525252] tabular-nums" role="status" data-testid="file-queue-summary">{text.summary(analysed, files.length)}</span>
        </p>
        <div className="flex items-center gap-1 -ml-2.5 sm:ml-0">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".doc,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif"
            className="hidden"
            data-testid="file-queue-input"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              if (picked.length > 0) onAddFiles(picked);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={full}
            className="pressable inline-flex items-center gap-1.5 px-2.5 min-h-11 md:min-h-8 text-xs font-medium text-[#111111] border border-transparent hover:border-[#C8C5BC] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
            {text.addFiles}
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center px-2.5 min-h-11 md:min-h-8 text-xs text-[#525252] underline underline-offset-2 hover:text-[#111111] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {text.clearSet}
          </button>
        </div>
      </div>

      {paused && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[#C8C5BC] bg-[#F6EFD9] px-4 py-1.5" role="status" data-testid="file-queue-paused">
          <p className="text-xs text-[#111111]">{text.stopped(waiting)}</p>
          <button
            type="button"
            onClick={onResume}
            className="pressable inline-flex items-center px-3 min-h-11 md:min-h-8 text-xs font-semibold border border-[#111111] bg-[#111111] text-[#F9F9F7] hover:bg-[#F9F9F7] hover:text-[#111111] transition-colors cursor-pointer"
          >
            {text.resume}
          </button>
        </div>
      )}
      {waitingForModel && !paused && (
        <p className="border-b border-[#C8C5BC] px-4 py-2 text-xs text-[#525252]" role="status" data-testid="file-queue-model">{text.waitingForModel}</p>
      )}

      {/* A set can hold many files: the list scrolls in itself, the document stays in reach below. */}
      <ol className="max-h-[21rem] md:max-h-[17.5rem] overflow-y-auto divide-y divide-[#E5E5E0]">
        {files.map((file, index) => {
          const hint = file.status === 'failed'
            ? file.reason
            : file.status === 'needs-decision' && !file.open
              ? text.decisionHint(t.redactButton.redact)
              : undefined;
          const row = (
            <>
              <span className="label-meta text-[#707070] tabular-nums w-5 shrink-0 pt-px" aria-hidden="true">{index + 1}</span>
              {/* On a phone the status stands under the name; from a tablet up, at the end of the row. */}
              <span className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1">
                <span className="min-w-0 sm:flex-1">
                  <span className="block truncate text-xs font-medium text-[#111111]">{file.name}</span>
                  {hint && (
                    <span className={`block text-[11px] leading-snug mt-0.5 ${file.status === 'failed' ? 'text-[#CC0000]' : 'text-[#525252]'}`}>{hint}</span>
                  )}
                </span>
                <span className="sm:shrink-0 flex items-center gap-2 label-meta text-[#525252]" data-testid="file-queue-status">
                  <span className="w-2 h-2 shrink-0" style={{ backgroundColor: STATUS_COLOR[file.status] }} aria-hidden="true" />
                  <span>
                    {text.status[file.status]}
                    {file.found !== null && <span className="text-[#707070] normal-case tracking-normal font-normal"> · {text.found(file.found)}</span>}
                  </span>
                </span>
              </span>
            </>
          );
          const layout = 'flex-1 min-w-0 flex items-start sm:items-center gap-x-3 pl-4 pr-2 py-2 min-h-11 md:min-h-9 text-left';
          return (
            <li
              key={file.id}
              data-testid="file-queue-row"
              data-status={file.status}
              className={`flex items-stretch ${file.open ? 'bg-[#F4F3EE] shadow-[inset_3px_0_0_0_#111111]' : ''}`}
            >
              {file.canOpen ? (
                <button
                  type="button"
                  onClick={() => onOpen(file.id)}
                  disabled={busy && !file.open}
                  aria-current={file.open ? 'true' : undefined}
                  className={`${layout} cursor-pointer hover:bg-[#F4F3EE] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#111111] disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                >
                  {row}
                </button>
              ) : (
                <div className={layout}>{row}</div>
              )}
              <button
                type="button"
                onClick={() => onRemove(file.id)}
                disabled={busy}
                aria-label={text.remove(file.name)}
                title={text.remove(file.name)}
                className="shrink-0 w-11 md:w-9 flex items-center justify-center text-[#707070] hover:text-[#CC0000] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
