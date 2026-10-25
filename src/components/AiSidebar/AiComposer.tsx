import { type FC, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Check, ChevronDown, Loader2, Square } from 'lucide-react';
import type { AiThread, AiTone } from '../../types';
import { useAiStore } from '../../store/aiStore';
import { listGeminiModels } from '../../utils/aiClient';

const TONE_OPTIONS: Array<{ id: AiTone; label: string; blurb: string }> = [
  { id: 'formal', label: 'Formal', blurb: 'Precise, academic, neutral' },
  { id: 'friendly', label: 'Friendly', blurb: 'Warm tutor, approachable' },
  { id: 'genz', label: 'Gen Z', blurb: 'Casual internet energy' },
];

interface AiComposerProps {
  /** Active thread — null when no capture has been made yet. */
  thread: AiThread | null;
}

/** Message input pinned to the bottom of the AI panel, with a model switcher. */
export const AiComposer: FC<AiComposerProps> = ({ thread }) => {
  const apiKey = useAiStore((s) => s.settings.apiKey);
  const model = useAiStore((s) => s.settings.model);
  const saveSettings = useAiStore((s) => s.saveSettings);
  const sendMessage = useAiStore((s) => s.sendMessage);
  const stopStreaming = useAiStore((s) => s.stopStreaming);

  const [draft, setDraft] = useState('');
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isToneMenuOpen, setIsToneMenuOpen] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const toneMenuRef = useRef<HTMLDivElement>(null);

  const isStreaming = thread ? thread.messages.some((m) => m.status === 'streaming') : false;
  const tone = useAiStore((s) => s.settings.tone ?? 'friendly');

  // Focus the fresh composer the moment a new capture lands.
  useEffect(() => {
    if (thread && thread.messages.length === 0) {
      textareaRef.current?.focus();
    }
  }, [thread]);

  // Close any open menu on outside clicks.
  useEffect(() => {
    if (!isModelMenuOpen && !isToneMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inModelMenu = modelMenuRef.current?.contains(target) ?? false;
      const inToneMenu = toneMenuRef.current?.contains(target) ?? false;
      if (!inModelMenu && !inToneMenu) {
        setIsModelMenuOpen(false);
        setIsToneMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isModelMenuOpen, isToneMenuOpen]);

  // Escape closes an open menu first (capture phase, before the global
  // Escape handler minimizes the sidebar).
  useEffect(() => {
    if (!isModelMenuOpen && !isToneMenuOpen) return;
    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setIsModelMenuOpen(false);
      setIsToneMenuOpen(false);
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [isModelMenuOpen, isToneMenuOpen]);

  const toggleModelMenu = async () => {
    if (isModelMenuOpen) {
      setIsModelMenuOpen(false);
      return;
    }
    setIsModelMenuOpen(true);
    if (models) return;
    setIsFetchingModels(true);
    setModelsError(null);
    try {
      const list = await listGeminiModels(apiKey);
      if (list.length === 0) throw new Error('No chat models available for this key.');
      setModels(list);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Could not load models.');
    } finally {
      setIsFetchingModels(false);
    }
  };

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  };

  const submit = () => {
    const text = draft.trim();
    if (!thread || !text || isStreaming) return;
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    void sendMessage(thread.id, text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-black/[0.06] dark:border-white/[0.06] px-2.5 pt-1.5 pb-2 flex flex-col gap-1">
      {/* Selectors — model + answer tone, menus open above the composer */}
      <div className="flex items-center gap-1 px-0.5">
        <div ref={modelMenuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => void toggleModelMenu()}
            disabled={!apiKey}
            title="Change model"
            className="flex items-center gap-1 max-w-[220px] px-1 py-0.5 rounded-md text-[10px] font-mono text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition disabled:cursor-not-allowed hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <span className="truncate">{model}</span>
            <ChevronDown size={10} className="shrink-0" />
          </button>

          {isModelMenuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-64 max-h-56 overflow-y-auto rounded-xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] border border-black/[0.08] dark:border-white/[0.1] p-1 z-50 animate-fade-in no-drag">
              {isFetchingModels && (
                <div className="px-2.5 py-2.5 flex items-center gap-2 text-[11px] text-gray-400">
                  <Loader2 size={12} className="animate-spin" />
                  <span>Loading models…</span>
                </div>
              )}
              {modelsError && (
                <p className="px-2.5 py-2 text-[11px] text-gray-500 dark:text-gray-400 leading-snug">
                  {modelsError}
                </p>
              )}
              {!isFetchingModels &&
                !modelsError &&
                models?.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      saveSettings({ model: m });
                      setIsModelMenuOpen(false);
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-lg text-left text-[11px] font-mono flex items-center justify-between gap-2 cursor-pointer transition ${
                      m === model
                        ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-900 dark:text-gray-100'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="truncate">{m}</span>
                    {m === model && <Check size={11} className="shrink-0" />}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="w-px h-2.5 bg-gray-300 dark:bg-white/20 shrink-0" />

        <div ref={toneMenuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => {
              setIsToneMenuOpen((v) => !v);
              setIsModelMenuOpen(false);
            }}
            title="Answer tone"
            className="flex items-center gap-1 px-1 py-0.5 rounded-md text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <span className="whitespace-nowrap">
              {TONE_OPTIONS.find((t) => t.id === tone)?.label ?? 'Friendly'}
            </span>
            <ChevronDown size={10} className="shrink-0" />
          </button>

          {isToneMenuOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-52 rounded-xl bg-white/95 dark:bg-[#262626]/98 backdrop-blur-2xl shadow-[0_12px_32px_rgba(0,0,0,0.15)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] border border-black/[0.08] dark:border-white/[0.1] p-1 z-50 animate-fade-in no-drag">
              {TONE_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    saveSettings({ tone: t.id });
                    setIsToneMenuOpen(false);
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-left cursor-pointer transition ${
                    t.id === tone
                      ? 'bg-gray-100 dark:bg-white/[0.08]'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[11px] font-medium ${
                        t.id === tone
                          ? 'text-gray-900 dark:text-gray-100'
                          : 'text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {t.label}
                    </span>
                    {t.id === tone && <Check size={11} className="text-gray-500 shrink-0" />}
                  </span>
                  <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {t.blurb}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Input row */}
      <div
        className={`flex items-end gap-1.5 rounded-2xl pl-3 pr-1.5 py-1.5 border border-transparent transition ${
          thread
            ? 'bg-gray-100/80 dark:bg-white/[0.06] focus-within:border-gray-300 dark:focus-within:border-white/20'
            : 'bg-gray-100/40 dark:bg-white/[0.03]'
        }`}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          disabled={!thread}
          placeholder={
            thread ? 'Ask anything about this capture…' : 'Capture a region to start asking…'
          }
          onInput={() => {
            setDraft(textareaRef.current?.value ?? '');
            autoGrow();
          }}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent resize-none text-[13px] text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 py-1.5 focus:outline-none max-h-[110px] disabled:cursor-default disabled:opacity-60"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => stopStreaming(thread!.id)}
            title="Stop generating"
            className="w-7 h-7 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center cursor-pointer transition active:scale-90 shrink-0"
          >
            <Square size={10} className="text-white dark:text-black" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            title="Send (Enter)"
            disabled={!thread || !draft.trim()}
            className="w-7 h-7 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center cursor-pointer transition hover:opacity-90 active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <ArrowUp size={14} className="text-white dark:text-black" />
          </button>
        )}
      </div>
    </div>
  );
};
