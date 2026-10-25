/**
 * Colour helpers shared by canvas shape rendering and PDF export.
 *
 * Shapes store an optional user colour; an empty value means "theme default"
 * (dark stroke on light backgrounds, light stroke on dark ones), matching the
 * behaviour of text notes and arrows.
 */

export const DEFAULT_STROKE_LIGHT = '#111827';
export const DEFAULT_STROKE_DARK = '#ECECEC';

/** Resolves a stored shape colour to a concrete CSS colour for the active theme. */
export function resolveShapeColor(color: string | undefined, isDark: boolean): string {
  if (!color) return isDark ? DEFAULT_STROKE_DARK : DEFAULT_STROKE_LIGHT;
  // Arrow/rect default black is rendered light in dark mode so it stays visible.
  if (isDark && (color === '#000000' || color === '#111827')) return DEFAULT_STROKE_DARK;
  return color;
}

/**
 * Converts a hex colour to an rgba() string with the given alpha.
 * Falls back to the original value when it is not a hex colour, so CSS colour
 * names and rgb()/oklch() inputs still render as a solid tint.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();

  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    const normalized =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}
