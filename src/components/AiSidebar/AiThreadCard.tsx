import { type FC, memo, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Trash2 } from 'lucide-react';
import type { AiThread, AiMessage } from '../../types';
import { getPageImageUrl } from '../../store/imageStore';
import { useAiStore } from '../../store/aiStore';

function formatThreadDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isSameDay) return `Today ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  }
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Loads + memoises the object URL for a thread's screenshot. */
function useThreadImageUrl(imageKey: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPageImageUrl(imageKey).then((value) => {
      if (!cancelled) setUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [imageKey]);
  return url;
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500 animate-bounce"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}

function MessageBubble({ message }: { message: AiMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gray-100 dark:bg-white/[0.09] px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words leading-relaxed">
          {message.text}
        </div>
      </div>
    );
  }

  const isError = message.status === 'error';
  const isStreaming = message.status === 'streaming';
  return (
    <div
      className={`text-[16px] leading-relaxed text-gray-800 dark:text-gray-200 ${
        isError ? 'text-gray-500 dark:text-gray-400' : ''
      }`}
    >
      {message.text ? (
        // eslint-disable-next-line
        <div className="ai-md">
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { errorColor: 'currentColor' }]]}
          >
            {message.text}
          </Markdown>
        </div>
      ) : null}
      {isStreaming && message.text && (
        <span className="ml-0.5 inline-block w-1.5 h-3.5 align-middle rounded-sm bg-gray-400 dark:bg-gray-300 animate-pulse" />
      )}
      {isStreaming && !message.text && <TypingDots />}
    </div>
  );
}

interface ThreadCardProps {
  thread: AiThread;
}

const AiThreadCardInner: FC<ThreadCardProps> = ({ thread }) => {
  const removeThread = useAiStore((s) => s.removeThread);
  const imageUrl = useThreadImageUrl(thread.imageKey);

  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastTextLength = lastMessage ? lastMessage.text.length : 0;
  const scrollRef = useRef<HTMLDivElement>(null);

  // One continuous, ChatGPT-style scroll: the newest content is always at the
  // bottom. Switching captures also snaps to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.id, thread.messages.length, lastTextLength]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
      {/* Capture reference header */}
      <div className="flex items-center justify-between px-1 shrink-0 sticky top-0 bg-transparent pt-0.5 pb-1 -mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          Capture · {formatThreadDate(thread.createdAt)}
        </span>
        <button
          type="button"
          onClick={() => removeThread(thread.id)}
          title="Delete capture and conversation"
          className="w-5 h-5 rounded-md flex items-center justify-center text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition shrink-0"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Screenshot reference */}
      {imageUrl ? (
        <div className="shrink-0 rounded-xl overflow-hidden border border-black/[0.05] dark:border-white/[0.07] bg-gray-50 dark:bg-black/20">
          <img
            src={imageUrl}
            alt="Captured region"
            draggable={false}
            className="w-full max-h-36 object-contain select-none"
          />
        </div>
      ) : (
        <div className="shrink-0 rounded-xl bg-gray-50 dark:bg-black/20 border border-black/[0.05] dark:border-white/[0.07] h-10 flex items-center justify-center">
          <span className="text-[10px] text-gray-400">Loading capture…</span>
        </div>
      )}

      {/* Messages — continuous flow in the same scroll context */}
      {thread.messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
};

export const AiThreadCard = memo(AiThreadCardInner);

interface ThreadRowProps {
  thread: AiThread;
  onOpen: () => void;
}

/** Row shown in the history popover for an inactive capture thread. */
export const AiThreadRow: FC<ThreadRowProps> = ({ thread, onOpen }) => {
  const removeThread = useAiStore((s) => s.removeThread);
  const imageUrl = useThreadImageUrl(thread.imageKey);

  const firstUserMessage = thread.messages.find((m) => m.role === 'user');
  const replyCount = thread.messages.filter((m) => m.role === 'model' && m.text.trim()).length;
  const isStreamingRow = thread.messages.some((m) => m.status === 'streaming');

  return (
    <div className="flex items-center gap-2 rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.06] pl-1.5 pr-1 py-1 transition">
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Captured region thumbnail"
            draggable={false}
            className="w-10 h-8 rounded-md object-cover border border-black/[0.05] dark:border-white/[0.08] shrink-0 select-none"
          />
        ) : (
          <span className="w-10 h-8 rounded-md bg-gray-100 dark:bg-white/10 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-gray-800 dark:text-gray-200 truncate">
            {firstUserMessage ? firstUserMessage.text : 'Captured region'}
          </span>
          <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate">
            {formatThreadDate(thread.createdAt)}
            {isStreamingRow
              ? ' · generating…'
              : replyCount > 0
              ? ` · ${replyCount} answer${replyCount > 1 ? 's' : ''}`
              : ' · no messages yet'}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => removeThread(thread.id)}
        title="Delete capture and conversation"
        className="w-6 h-6 rounded-md flex items-center justify-center text-gray-300 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer transition shrink-0"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
};
