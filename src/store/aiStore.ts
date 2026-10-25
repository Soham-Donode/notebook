import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AiMessage, AiSettings, AiThread, AiTone } from '../types';
import { deletePageImage, getPageBlob, putAiImage } from './imageStore';
import { loadImageBase64, streamGemini, type GeminiTurn } from '../utils/aiClient';

export const AI_SYSTEM_PROMPT = `You are the AI study companion inside Inkwell, an infinite-canvas personal notebook. The user shares screenshots of their canvas — diagrams, textbook pages, lecture slides, sketches, charts, code, handwriting, math, or anything else — and asks questions about them.

For the first message about a capture: give a comprehensive, well-structured explanation of what the image shows. Describe it, define the key terms simply, walk through the main ideas and how they connect, and mention anything useful the viewer might miss. Use markdown with short headings, tight bullets and code blocks for code or formulas. Be accurate: if something is ambiguous, handwritten or unreadable, say so plainly instead of guessing.

For follow-up questions: answer directly and precisely, building on what you have already explained. Never repeat the full explanation unless asked.

Prefer plain language and define any jargon you use. Follow the answer tone specified in the tone directive; it governs voice and style only — accuracy and structure rules above always apply.`;

const AI_TONE_PROMPTS: Record<AiTone, string> = {
  formal:
    'Communicate in a formal, academic register: precise, neutral and well-structured. No slang, no contractions.',
  friendly:
    'Communicate in a warm, friendly, encouraging tone — like a helpful tutor. Contractions are welcome; keep it approachable.',
  genz: [
    'Communicate in a casual Gen-Z voice: short punchy sentences, natural internet slang and lowercase-leaning energy.',
    'Stay factually precise and keep the markdown structure — never sacrifice accuracy for style.',
  ].join(' '),
};

const DEFAULT_SETTINGS: AiSettings = {
  apiKey: '',
  model: 'gemini-flash-lite-latest',
  tone: 'friendly',
};

const abortControllers = new Map<string, AbortController>();

const newId = () => crypto.randomUUID();

interface AiStore {
  settings: AiSettings;
  threads: AiThread[];
  activeThreadId: string | null;
  saveSettings: (patch: Partial<AiSettings>) => void;
  setActiveThread: (threadId: string | null) => void;
  /** Stores the screenshot blob and creates the thread. Resolves with the new thread id. */
  startThreadFromCapture: (blob: Blob, width: number, height: number) => Promise<string>;
  sendMessage: (threadId: string, text: string) => Promise<void>;
  stopStreaming: (threadId: string) => void;
  removeThread: (threadId: string) => void;
}

export const useAiStore = create<AiStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      threads: [],
      activeThreadId: null,

      saveSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

      setActiveThread: (activeThreadId) => set({ activeThreadId }),

      startThreadFromCapture: async (blob, width, height) => {
        const imageKey = `ai:${newId()}`;
        await putAiImage(imageKey, blob);

        const thread: AiThread = {
          id: newId(),
          createdAt: Date.now(),
          imageKey,
          imageWidth: width,
          imageHeight: height,
          messages: [],
        };
        set((state) => ({
          threads: [thread, ...state.threads],
          activeThreadId: thread.id,
        }));
        return thread.id;
      },

      sendMessage: async (threadId, text) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        const { settings } = get();
        if (!settings.apiKey) return;

        const userMessage: AiMessage = {
          id: newId(),
          role: 'user',
          text: trimmed,
          createdAt: Date.now(),
          status: 'done',
        };
        const modelMessage: AiMessage = {
          id: newId(),
          role: 'model',
          text: '',
          createdAt: Date.now(),
          status: 'streaming',
        };
        const modelId = modelMessage.id;

        set((state) => ({
          threads: state.threads.map((t) =>
            t.id === threadId
              ? { ...t, messages: [...t.messages, userMessage, modelMessage] }
              : t
          ),
        }));

        const finalize = (errorText: string | null) => {
          set((state) => ({
            threads: state.threads.map((t) =>
              t.id === threadId
                ? {
                    ...t,
                    messages: t.messages.map((m) =>
                      m.id === modelId
                        ? { ...m, text: errorText ?? m.text, status: errorText ? ('error' as const) : ('done' as const) }
                        : m
                    ),
                  }
                : t
            ),
          }));
        };

        try {
          const thread = get().threads.find((t) => t.id === threadId);
          if (!thread) return;

          const blob = await getPageBlob(thread.imageKey);
          if (!blob) {
            finalize('The screenshot for this capture is missing — it may have been cleared.');
            return;
          }
          const imageBase64 = await loadImageBase64(thread.imageKey, blob);
          const imageMime = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';

          // Conversation history so far (errors excluded; the empty model
          // placeholder is filtered by the non-empty text check).
          const history = get().threads.find((t) => t.id === threadId)?.messages ?? [];
          const turns: GeminiTurn[] = history
            .filter((m) => (m.status ?? 'done') !== 'error' && m.text.trim().length > 0)
            .map((m) =>
              m.role === 'user'
                ? { role: 'user' as const, text: m.text, imageBase64, imageMime }
                : { role: 'model' as const, text: m.text }
            );

          const controller = new AbortController();
          abortControllers.set(threadId, controller);

          await streamGemini({
            apiKey: settings.apiKey,
            model: settings.model,
            systemPrompt: `${AI_SYSTEM_PROMPT}\n\nTone: ${AI_TONE_PROMPTS[settings.tone ?? 'friendly']}`,
            turns,
            signal: controller.signal,
            onDelta: (delta) => {
              set((state) => ({
                threads: state.threads.map((t) =>
                  t.id === threadId
                    ? {
                        ...t,
                        messages: t.messages.map((m) =>
                          m.id === modelId ? { ...m, text: m.text + delta } : m
                        ),
                      }
                    : t
                ),
              }));
            },
          });

          finalize(null);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            finalize(null); // Keep whatever streamed before the stop.
            return;
          }
          console.error('[AiStore] Request failed:', err);
          finalize(err instanceof Error ? err.message : String(err));
        } finally {
          abortControllers.delete(threadId);
        }
      },

      stopStreaming: (threadId) => {
        abortControllers.get(threadId)?.abort();
      },

      removeThread: (threadId) => {
        abortControllers.get(threadId)?.abort();
        const thread = get().threads.find((t) => t.id === threadId);
        set((state) => ({
          threads: state.threads.filter((t) => t.id !== threadId),
          activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
        }));
        if (thread) {
          deletePageImage(thread.imageKey).catch((err) =>
            console.warn('[AiStore] Failed to delete screenshot blob:', err)
          );
        }
      },
    }),
    {
      name: 'inkwell-ai-v1',
      version: 1,
      partialize: (s) => ({
        settings: {
          apiKey: s.settings.apiKey,
          model: s.settings.model,
          tone: s.settings.tone ?? 'friendly',
        },
        // Messages persist without the transient streaming/error status.
        threads: s.threads.map((t) => ({
          ...t,
          messages: t.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.text,
            createdAt: m.createdAt,
          })),
        })),
        activeThreadId: s.activeThreadId,
      }),
    }
  )
);
