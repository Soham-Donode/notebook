import { type FC, useState } from 'react';
import { KeyRound, Loader2, Sparkles } from 'lucide-react';
import { useAiStore } from '../../store/aiStore';
import { listGeminiModels } from '../../utils/aiClient';

const AI_STUDIO_URL = 'https://aistudio.google.com/apikey';

type Phase = 'key' | 'model';

interface AiSettingsProps {
  onDone: () => void;
}

export const AiSettings: FC<AiSettingsProps> = ({ onDone }) => {
  const settings = useAiStore((s) => s.settings);
  const saveSettings = useAiStore((s) => s.saveSettings);

  const [keyInput, setKeyInput] = useState('');
  const [phase, setPhase] = useState<Phase>('key');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(settings.model);

  const handleOpenAiStudio = async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(AI_STUDIO_URL);
    } catch {
      window.open(AI_STUDIO_URL, '_blank', 'noopener');
    }
  };

  const handleContinue = async () => {
    const key = keyInput.trim();
    if (!key || isValidating) return;
    setIsValidating(true);
    setError(null);
    try {
      const list = await listGeminiModels(key);
      if (list.length === 0) {
        throw new Error('This key has no text models available.');
      }
      setModels(list);
      setModel(list[0]);
      setPhase('model');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the key.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = () => {
    saveSettings({ apiKey: keyInput.trim(), model });
    onDone();
  };

  return (
    <div className="no-drag flex-1 min-h-0 overflow-y-auto px-4 py-5 flex flex-col">
      <div className="flex flex-col items-center text-center gap-2 mb-5">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/[0.08] flex items-center justify-center">
          <KeyRound size={22} className="text-gray-500 dark:text-gray-400" />
        </div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {settings.apiKey ? 'AI settings' : 'Connect Gemini'}
        </h2>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed max-w-[240px]">
          Paste a free API key from Google AI Studio. It stays on this Mac — the app shares your
          captures with Google only when you send a question.
        </p>
      </div>

      {phase === 'key' ? (
        <div className="flex flex-col gap-2.5">
          <input
            type="password"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleContinue();
            }}
            placeholder="Paste your Google AI Studio key (AIza…)"
            className="w-full h-10 rounded-xl border border-black/10 dark:border-white/10 bg-gray-50 dark:bg-white/[0.05] px-3 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-white/20"
          />

          {error && (
            <p className="text-[11px] text-red-500 dark:text-red-400 leading-snug">{error}</p>
          )}

          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={!keyInput.trim() || isValidating}
            className="h-9 mt-1 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isValidating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            <span>{isValidating ? 'Verifying key…' : 'Continue'}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleOpenAiStudio()}
            className="text-[11px] text-gray-500 dark:text-gray-400 underline underline-offset-2 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer transition"
          >
            Get a free key at aistudio.google.com ↗
          </button>

          {settings.apiKey && (
            <button
              type="button"
              onClick={onDone}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer transition mt-1"
            >
              Back to chat
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-0.5">
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full h-10 rounded-xl border border-black/10 dark:border-white/10 bg-gray-50 dark:bg-white/[0.05] px-2.5 text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-white/20 cursor-pointer"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-white dark:bg-[#262626]">
                {m}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 px-0.5">
            Flash Lite only — the fastest, free-tier friendly option.
          </p>

          <button
            type="button"
            onClick={handleSave}
            className="h-9 mt-1 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer transition hover:opacity-90 active:scale-[0.98]"
          >
            <Sparkles size={14} />
            <span>Save &amp; start</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPhase('key');
              setError(null);
            }}
            className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer transition"
          >
            Use a different key
          </button>
        </div>
      )}
    </div>
  );
};
