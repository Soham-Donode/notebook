import { type FC, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Crop, GraduationCap, Minus, Settings2 } from 'lucide-react';
import { useAiStore } from '../../store/aiStore';
import { useUiStore } from '../../store/useUiStore';
import { AiSettings } from './AiSettings';
import { AiComposer } from './AiComposer';
import { AiChatFeed } from './AiThreadCard';

/** Floating pill shown while the ai-capture tool is armed. */
export const CaptureHint: FC = () => (
  <div className="no-drag fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-gray-900/90 dark:bg-[#1E1E1E]/95 text-white dark:text-gray-100 text-xs font-medium flex items-center gap-2 shadow-2xl border border-white/10 pointer-events-none animate-slide-down">
    <Crop size={13} />
    <span>Drag a region on the canvas to capture</span>
    <span className="opacity-50">· Esc to cancel</span>
  </div>
);

const AI_SIDEBAR_WIDTH_KEY = 'notebook_ai_sidebar_width';
const MIN_AI_SIDEBAR_WIDTH = 340;
const MAX_AI_SIDEBAR_WIDTH = 760;
const DEFAULT_AI_SIDEBAR_WIDTH = 400;

function loadSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(AI_SIDEBAR_WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= MIN_AI_SIDEBAR_WIDTH && raw <= MAX_AI_SIDEBAR_WIDTH) {
      return Math.round(raw);
    }
  } catch {
    // Storage unavailable — fall back to the default width.
  }
  return DEFAULT_AI_SIDEBAR_WIDTH;
}

export const AiSidebar: FC = () => {
  const isOpen = useUiStore((s) => s.isAiSidebarOpen);
  const setAiSidebarOpen = useUiStore((s) => s.setAiSidebarOpen);
  const activeTool = useUiStore((s) => s.activeTool);
  const setActiveTool = useUiStore((s) => s.setActiveTool);
  const threads = useAiStore((s) => s.threads);
  const activeThreadId = useAiStore((s) => s.activeThreadId);
  const apiKey = useAiStore((s) => s.settings.apiKey);
  const [showSettings, setShowSettings] = useState(false);
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  // Resizable panel width (persisted; drag the left edge handle)
  const [width, setWidth] = useState(loadSidebarWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);

  const handleResizeStart = (e: ReactPointerEvent) => {
    e.preventDefault();
    resizeStartRef.current = { x: e.clientX, width: widthRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
  };

  const handleResizeMove = (e: ReactPointerEvent) => {
    const start = resizeStartRef.current;
    if (!start) return;
    // Dragging left widens the panel (panel is right-anchored).
    const maxWidth = Math.max(MIN_AI_SIDEBAR_WIDTH, Math.min(MAX_AI_SIDEBAR_WIDTH, window.innerWidth - 360));
    const next = Math.min(maxWidth, Math.max(MIN_AI_SIDEBAR_WIDTH, start.width + (start.x - e.clientX)));
    setWidth(Math.round(next));
  };

  const handleResizeEnd = (e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer may already be released.
    }
    resizeStartRef.current = null;
    setIsResizing(false);
    try {
      localStorage.setItem(AI_SIDEBAR_WIDTH_KEY, String(widthRef.current));
    } catch {
      // Storage unavailable — width applies for this session only.
    }
  };

  // Arm the capture tool and clear the way so the whole canvas is draggable.
  const startCapture = () => {
    setShowSettings(false);
    setAiSidebarOpen(false);
    setActiveTool('ai-capture');
  };

  // Minimized state: single circular icon in the bottom-right corner.
  if (!isOpen) {
    return (
      <>
        {activeTool === 'ai-capture' && <CaptureHint />}
        <button
          type="button"
          onClick={() => setAiSidebarOpen(true)}
          title="Ask AI"
          className="no-drag fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-gray-900 dark:bg-white shadow-[0_10px_28px_rgba(0,0,0,0.35)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.65)] flex items-center justify-center cursor-pointer transition hover:scale-105 active:scale-95"
        >
          <GraduationCap size={20} className="text-white dark:text-black" />
        </button>
      </>
    );
  }

  return (
    <>
      {activeTool === 'ai-capture' && <CaptureHint />}

      <aside
        data-ai-panel
        style={{ width: `${width}px` }}
        className="no-drag fixed top-2.5 right-2.5 bottom-2.5 z-40 flex flex-col rounded-3xl bg-white/85 dark:bg-[#1A1A1A]/85 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.1] shadow-[0_18px_50px_rgba(0,0,0,0.16)] dark:shadow-[0_18px_50px_rgba(0,0,0,0.5)] overflow-hidden animate-fade-in"
      >
        {/* Left-edge resize handle — drag toward the canvas to widen */}
        <div
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          title="Drag to resize"
          className="no-drag absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-50 group flex items-center justify-center"
        >
          <div
            className={`h-12 w-1 rounded-full transition-colors duration-150 ${
              isResizing
                ? 'bg-gray-400 dark:bg-gray-500'
                : 'bg-transparent group-hover:bg-gray-300 dark:group-hover:bg-white/25'
            }`}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between h-12 px-3.5 border-b border-black/[0.06] dark:border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2 select-none">
            <span className="w-6 h-6 rounded-full bg-gray-900 dark:bg-white flex items-center justify-center shrink-0">
              <GraduationCap size={13} className="text-white dark:text-black" />
            </span>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Ask</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={startCapture}
              title="Capture a region of the canvas"
              className="h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200/80 dark:bg-white/[0.07] dark:hover:bg-white/[0.12] text-gray-800 dark:text-gray-200 cursor-pointer transition active:scale-95"
            >
              <Crop size={13} />
              <span>Capture</span>
            </button>
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              title="AI settings"
              className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer transition active:scale-95 ${
                showSettings
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]'
              }`}
            >
              <Settings2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setAiSidebarOpen(false)}
              title="Minimize"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] cursor-pointer transition active:scale-95"
            >
              <Minus size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        {showSettings || !apiKey ? (
          <AiSettings onDone={() => setShowSettings(false)} />
        ) : threads.length === 0 ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-white/[0.08] flex items-center justify-center">
                <GraduationCap size={26} className="text-gray-500 dark:text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Capture anything on your canvas
                </p>
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                  Drag over a page, diagram or sketch to get a clear explanation — then keep asking
                  follow-up questions.
                </p>
              </div>
              <button
                type="button"
                onClick={startCapture}
                className="h-9 px-4 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-xs font-semibold flex items-center gap-2 cursor-pointer transition hover:opacity-90 active:scale-[0.98]"
              >
                <Crop size={14} />
                <span>Capture a region</span>
              </button>
            </div>
            <AiComposer thread={null} />
          </>
        ) : (
          <>
            <div className="flex-1 min-h-0 flex flex-col px-2.5 pt-2.5 pb-1">
              {/* Single unified chat feed — all captures oldest-to-newest */}
              <AiChatFeed threads={[...threads].reverse()} />
            </div>
            <AiComposer thread={activeThread} />
          </>
        )}
      </aside>
    </>
  );
};
