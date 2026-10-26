import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { Check, FileText, Loader2, X } from 'lucide-react';
import {
  PdfExportCancelled,
  exportSectionToPdf,
  type PdfExportProgress,
  type PdfOrientation,
  type PdfPaperSize,
} from '../../utils/exportPdf';
import type { CanvasElement } from '../../types';

interface PdfExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  elements: CanvasElement[];
  notebookName: string;
  sectionName: string;
  onExported: (pages: number) => void;
}

type View = 'options' | 'working' | 'error';

const PAPER_OPTIONS: Array<{ value: PdfPaperSize; label: string; hint: string }> = [
  { value: 'a4', label: 'A4', hint: '210 × 297 mm' },
  { value: 'letter', label: 'Letter', hint: '8.5 × 11 in' },
];

const ORIENTATION_OPTIONS: Array<{ value: PdfOrientation; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
];

const BACKGROUND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '#ffffff', label: 'White' },
  { value: '#fbf7ec', label: 'Cream' },
  { value: '#f1f5f9', label: 'Slate' },
  { value: '#eef4ff', label: 'Blue' },
  { value: '#111827', label: 'Charcoal' },
];

const Segmented: FC<{
  options: Array<{ value: string; label: string; hint?: string }>;
  value: string;
  onChange: (value: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="flex gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.05] dark:border-white/[0.08]">
    {options.map((option) => {
      const active = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition cursor-pointer ${
            active
              ? 'bg-white dark:bg-[#3a3a3a] text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          <span className="block leading-tight">{option.label}</span>
          {option.hint && (
            <span className="block text-[9px] font-normal text-gray-400 dark:text-gray-500 mt-0.5">
              {option.hint}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

const Toggle: FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}> = ({ checked, onChange, label, description }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="w-full flex items-center justify-between gap-4 px-3 py-2.5 rounded-xl hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition cursor-pointer text-left"
  >
    <span className="min-w-0">
      <span className="block text-xs font-medium text-gray-800 dark:text-gray-200">{label}</span>
      <span className="block text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{description}</span>
    </span>
    <span
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${
        checked ? 'bg-gray-900 dark:bg-white' : 'bg-gray-300 dark:bg-[#4a4a4a]'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white dark:bg-[#1e1e1e] shadow-sm transition-transform flex items-center justify-center ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      >
        {checked && <Check size={10} className="text-gray-900 dark:text-white" />}
      </span>
    </span>
  </button>
);

export const PdfExportDialog: FC<PdfExportDialogProps> = ({
  isOpen,
  onClose,
  elements,
  notebookName,
  sectionName,
  onExported,
}) => {
  const [view, setView] = useState<View>('options');
  const [paper, setPaper] = useState<PdfPaperSize>('a4');
  const [orientation, setOrientation] = useState<PdfOrientation>('auto');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [includePageNumbers, setIncludePageNumbers] = useState(true);
  const [includeHeader, setIncludeHeader] = useState(true);
  const [progress, setProgress] = useState<PdfExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      setView('options');
      setProgress(null);
      setError(null);
    }
  }, [isOpen]);

  // Never leave a detached render loop behind when the dialog unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleClose = useCallback(() => {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    onClose();
  }, [onClose]);

  const startExport = useCallback(async () => {
    if (abortRef.current) return;
    if (elements.length === 0) {
      setError('This section is empty — add a note or import a page first.');
      setView('error');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setView('working');
    setError(null);
    setProgress({ phase: 'preparing', done: 0, total: 1, message: 'Preparing export…' });

    try {
      const result = await exportSectionToPdf(elements, notebookName, sectionName, {
        paper,
        orientation,
        backgroundColor,
        includePageNumbers,
        includeHeader,
        signal: controller.signal,
        onProgress: setProgress,
      });

      if (!result.saved) {
        // The native save dialog was dismissed — go back to the options.
        setView('options');
        setProgress(null);
        return;
      }

      onExported(result.pages);
      onClose();
    } catch (err) {
      if (err instanceof PdfExportCancelled) {
        setView('options');
        setProgress(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong while exporting.');
      setView('error');
    } finally {
      abortRef.current = null;
    }
  }, [
    elements,
    notebookName,
    sectionName,
    paper,
    orientation,
    backgroundColor,
    includePageNumbers,
    includeHeader,
    onExported,
    onClose,
  ]);

  const handleKeyDown = (event: globalThis.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
      return;
    }

    if (event.key !== 'Enter') return;

    // Never hijack Enter while a control has focus: buttons and toggles must
    // keep their native activation behaviour.
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, textarea, select, a')) return;

    if (view === 'options') {
      event.preventDefault();
      void startExport();
    } else if (view === 'error') {
      event.preventDefault();
      setView('options');
    }
  };

  const keyHandlerRef = useRef(handleKeyDown);
  keyHandlerRef.current = handleKeyDown;

  useEffect(() => {
    if (!isOpen) return;
    const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [isOpen]);

  if (!isOpen) return null;

  const totalSteps = progress?.total ?? 1;
  const doneSteps = progress?.done ?? 0;
  const percent =
    view === 'working'
      ? Math.min(100, Math.round((doneSteps / Math.max(1, totalSteps)) * 100))
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/60 backdrop-blur-md animate-fade-in p-4"
      onClick={view === 'working' ? undefined : handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-export-title"
        className="w-full max-w-[460px] rounded-3xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl border border-black/[0.08] dark:border-white/10 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.2)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] p-7 flex flex-col no-drag transition-colors"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gray-900 dark:bg-white flex items-center justify-center shrink-0 shadow-md">
              <FileText size={19} className="text-white dark:text-gray-900" />
            </div>
            <div className="min-w-0">
              <h2
                id="pdf-export-title"
                className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100"
              >
                Export as PDF
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                {sectionName || 'Untitled section'} · {elements.length} item
                {elements.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {view === 'options' && (
          <>
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Paper size
                </p>
                <Segmented
                  options={PAPER_OPTIONS}
                  value={paper}
                  onChange={(value) => setPaper(value as PdfPaperSize)}
                />
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Orientation
                </p>
                <Segmented
                  options={ORIENTATION_OPTIONS}
                  value={orientation}
                  onChange={(value) => setOrientation(value as PdfOrientation)}
                />
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Background
                </p>
                <div className="flex items-center gap-2">
                  {BACKGROUND_OPTIONS.map((option) => {
                    const active = backgroundColor.toLowerCase() === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        title={option.label}
                        aria-label={option.label}
                        aria-pressed={active}
                        onClick={() => setBackgroundColor(option.value)}
                        className={`w-8 h-8 rounded-lg border cursor-pointer transition ${
                          active
                            ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white dark:ring-offset-[#262626] border-transparent'
                            : 'border-black/10 dark:border-white/15 hover:scale-105'
                        }`}
                        style={{ backgroundColor: option.value }}
                      />
                    );
                  })}

                  <label className="ml-auto flex items-center gap-2 cursor-pointer">
                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                      Custom
                    </span>
                    <span
                      className="relative w-8 h-8 rounded-lg overflow-hidden border border-black/10 dark:border-white/15"
                      style={{ backgroundColor }}
                    >
                      <input
                        type="color"
                        value={backgroundColor}
                        onChange={(event) => setBackgroundColor(event.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label="Custom background colour"
                      />
                    </span>
                  </label>
                </div>
              </div>

              <div className="-mx-1.5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] p-1">
                <Toggle
                  checked={includeHeader}
                  onChange={setIncludeHeader}
                  label="Notebook & section title"
                  description="Small caption and rule above the content"
                />
                <Toggle
                  checked={includePageNumbers}
                  onChange={setIncludePageNumbers}
                  label="Page numbers"
                  description="Numbered footer on every page"
                />
              </div>

              <p className="text-[10px] leading-relaxed text-gray-400 dark:text-gray-500 px-1">
                The whole board is captured as one rectangle, fitted to the page width and cut
                into horizontal strips from top to bottom. Each strip becomes one page.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void startExport()}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white hover:bg-black dark:hover:bg-gray-200 transition cursor-pointer shadow-sm active:scale-[0.98]"
              >
                Export PDF
              </button>
            </div>
          </>
        )}

        {view === 'working' && (
          <div className="py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
              <Loader2 size={14} className="animate-spin text-gray-400" />
              <span>{progress?.message || 'Exporting…'}</span>
            </div>

            <div className="mt-4 h-1.5 rounded-full bg-black/[0.07] dark:bg-white/[0.1] overflow-hidden">
              <div
                className="h-full rounded-full bg-gray-900 dark:bg-white transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 font-mono">
              <span>
                {progress?.phase === 'saving'
                  ? 'Writing file'
                  : progress?.phase === 'preparing'
                  ? 'Preparing'
                  : 'Rendering'}
              </span>
              <span>{percent}%</span>
            </div>

            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition cursor-pointer"
              >
                Cancel export
              </button>
            </div>
          </div>
        )}

        {view === 'error' && (
          <>
            <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3.5">
              <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setView('options')}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white dark:text-gray-900 bg-gray-900 dark:bg-white hover:bg-black dark:hover:bg-gray-200 transition cursor-pointer shadow-sm active:scale-[0.98]"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
