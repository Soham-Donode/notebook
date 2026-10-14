const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** Label for the platform's primary modifier key. */
export const modKey = isMac ? '⌘' : 'Ctrl+';
