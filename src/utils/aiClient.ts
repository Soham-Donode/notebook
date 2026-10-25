/**
 * Minimal Gemini (Google AI Studio) REST client with SSE streaming.
 * Calls go directly from the app to generativelanguage.googleapis.com;
 * the Tauri CSP allows exactly this origin in connect-src.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiTurn {
  role: 'user' | 'model';
  text: string;
  /** Base64 JPEG/PNG payload attached to user turns (the captured region). */
  imageBase64?: string;
  imageMime?: string;
}

export interface StreamGeminiOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  turns: GeminiTurn[];
  signal?: AbortSignal;
  /** Called with accumulated text chunks (throttled to ~16/s for smooth streaming). */
  onDelta: (delta: string) => void;
}

/** Human-readable error text for common Gemini API failures. */
async function describeError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body) as { error?: { message?: string } };
      detail = json.error?.message ?? '';
    } catch {
      detail = body.slice(0, 200);
    }
  } catch {
    // Response body unreadable — fall through to status-only message.
  }

  if (res.status === 400 && /api key not valid/i.test(detail)) {
    return 'That API key was rejected by Google. Double-check it and try again.';
  }
  if (res.status === 401 || res.status === 403) {
    return 'This API key does not have access to the Gemini API.';
  }
  if (res.status === 404) {
    return 'Model not found. Pick another model in the AI settings.';
  }
  if (res.status === 429) {
    return 'Free-tier rate limit reached. Wait a few seconds and try again.';
  }
  if (res.status === 503) {
    return 'The model is overloaded right now. Try again shortly.';
  }
  return detail ? `${detail} (HTTP ${res.status})` : `Request failed with HTTP ${res.status}.`;
}

/** Lists chat-capable model IDs (e.g. "gemini-2.0-flash"), best first. */
export async function listGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`);
  if (!res.ok) throw new Error(await describeError(res));

  const data = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };

  // Only text-chat flash-lite models — the free-tier-friendly fast lane.
  const usable = (data.models ?? [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((name) => /^gemini-.+/.test(name))
    .filter((name) => /flash-lite/.test(name))
    .filter((name) => !/image|video|audio|tts|veo|imagen|embedding|aqa|live|native|learnlm|robotics|exp-/.test(name));

  return usable.sort((a, b) => modelScore(a) - modelScore(b) || a.localeCompare(b));
}

// Rank stable `latest` aliases above dated preview snapshots.
function modelScore(name: string): number {
  return /latest/.test(name) ? 0 : 1;
}

/**
 * Streams a chat completion. Resolves with the full text once the stream ends;
 * throws Errors with user-ready messages (or AbortError on stopStreaming()).
 */
export async function streamGemini(options: StreamGeminiOptions): Promise<string> {
  const { apiKey, model, systemPrompt, turns, signal, onDelta } = options;

  const url = `${BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: turns.map((turn) => ({
      role: turn.role,
      parts: [
        ...(turn.imageBase64
          ? [{ inline_data: { mime_type: turn.imageMime ?? 'image/jpeg', data: turn.imageBase64 } }]
          : []),
        { text: turn.text },
      ],
    })),
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(await describeError(res));
  if (!res.body) throw new Error('The model did not return a readable response stream.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let pending = '';
  let lastFlush = 0;

  const flush = (force = false) => {
    if (!pending) return;
    const now = performance.now();
    if (!force && now - lastFlush < 60) return;
    onDelta(pending);
    full += pending;
    pending = '';
    lastFlush = now;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let parsed: {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { code?: number; message?: string };
      };
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // Incomplete/ignorable SSE chunk.
      }

      if (parsed.error) {
        await reader.cancel().catch(() => undefined);
        throw new Error(parsed.error.message || 'The Gemini API returned an error.');
      }

      const parts = parsed.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part.text === 'string') pending += part.text;
        }
      }
      flush();
    }
  }
  flush(true);

  if (!full.trim()) {
    throw new Error('The model returned an empty response — try rephrasing or recapture a clearer region.');
  }
  return full;
}

/** Cached base64 conversion of a stored screenshot (same key = same blob). */
const base64Cache = new Map<string, string>();

export async function loadImageBase64(imageKey: string, blob: Blob): Promise<string> {
  const cached = base64Cache.get(imageKey);
  if (cached) return cached;

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the screenshot data.'));
    reader.readAsDataURL(blob);
  });

  base64Cache.set(imageKey, base64);
  return base64;
}
