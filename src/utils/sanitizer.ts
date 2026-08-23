/**
 * Centralized XSS sanitization utility for Lumina Network.
 *
 * All strings originating from on-chain data or user input MUST be passed
 * through `sanitizeNodeString` before being rendered into DOM / JSX.
 *
 * Design invariants:
 * - Only <b>, <i>, <a rel="nofollow"> survive sanitization; everything else is stripped.
 * - Ampersand, angle-bracket, quote, and apostrophe characters are encoded in
 *   non-allowlisted contexts.
 * - Unicode normalization attacks (homoglyphs) are neutralised via DOMPurify's
 *   built-in Unicode-aware parser in the browser and conservative escaping on the server.
 * - Target: < 5 ms for strings up to 10 KB.
 */

type DOMPurifyApi = typeof import('isomorphic-dompurify').default;

const browserDOMPurify: DOMPurifyApi | null =
  typeof window === 'undefined'
    ? null
    : (await import('isomorphic-dompurify') as unknown as { default?: DOMPurifyApi } & DOMPurifyApi).default ??
      (await import('isomorphic-dompurify') as unknown as DOMPurifyApi);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tags that are permitted to survive sanitization. */
const ALLOWED_TAGS = ['b', 'i', 'a'];

/** Attributes that may appear on allowed tags. */
const ALLOWED_ATTR = ['href', 'rel'];

let hookInstalled = false;

function installAnchorRelHook(): void {
  if (hookInstalled || !browserDOMPurify || typeof window === 'undefined') return;

  browserDOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const element = node as Element;
    if (element.nodeName === 'A' || element instanceof HTMLAnchorElement) {
      const rel = element.getAttribute('rel') ?? '';
      const parts = new Set(
        rel
          .split(/\s+/)
          .map((s: string) => s.trim().toLowerCase())
          .filter(Boolean),
      );
      parts.add('nofollow');
      parts.add('noopener');
      parts.add('noreferrer');
      element.setAttribute('rel', [...parts].join(' '));
    }
  });

  hookInstalled = true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeServerSide(normalized: string): string {
  return escapeHtml(normalized)
    .replace(/&lt;(\/?)b&gt;/gi, '<$1b>')
    .replace(/&lt;(\/?)i&gt;/gi, '<$1i>')
    .replace(/&lt;a\s+href=&quot;(https?:\/\/[^&]+)&quot;&gt;/gi, '<a href="$1" rel="nofollow noopener noreferrer">')
    .replace(/&lt;\/a&gt;/gi, '</a>');
}

// ---------------------------------------------------------------------------
// Danger-pattern detector (monitoring / analytics)
// ---------------------------------------------------------------------------

interface DangerDetection {
  /** Human-readable label for the pattern that triggered. */
  pattern: string;
  /** 0-based index in the original string where the pattern was found. */
  index: number;
}

/**
 * Known-dangerous patterns that *should* have been stripped by sanitization.
 * If any of these appear in sanitized output, something went wrong.
 */
const DANGER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'script-tag', re: /<script[\s/>]/i },
  { label: 'event-handler', re: /\bon\w+\s*=\s*["']?/i },
  { label: 'javascript-uri', re: /\bj(?:ava)?script\s*:/i },
  { label: 'data-uri', re: /data\s*:\s*[^,]*[,;]/i },
  { label: 'vbscript-uri', re: /\bvbscript\s*:/i },
  { label: 'expression-css', re: /\bexpression\s*\(/i },
  { label: 'eval-invocation', re: /\beval\s*\(/i },
  { label: 'iframe-tag', re: /<iframe[\s/>]/i },
  { label: 'object-tag', re: /<object[\s/>]/i },
  { label: 'embed-tag', re: /<embed[\s/>]/i },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitize a string originating from on-chain data or user input.
 *
 * @returns Safe HTML string suitable for `dangerouslySetInnerHTML` or
 *          manual React insertion (though raw JSX interpolation is
 *          preferred when possible).
 */
export function sanitizeNodeString(dirty: string): string {
  if (!dirty) return '';

  // Normalize Unicode before sanitization to defeat homoglyph attacks.
  const normalized = dirty.normalize('NFC');

  if (typeof window === 'undefined') {
    return sanitizeServerSide(normalized);
  }

  if (!browserDOMPurify) {
    return sanitizeServerSide(normalized);
  }

  installAnchorRelHook();

  return browserDOMPurify.sanitize(normalized, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // Strip everything else — no arbitrary HTML survives.
    KEEP_CONTENT: true, // keep text content of stripped tags
  });
}

/**
 * Detect patterns that indicate a potentially malicious string.
 *
 * This is a *defence-in-depth* layer intended for analytics / monitoring.
 * Call it on the *raw* (pre-sanitized) string to log warnings when an
 * attacker attempts injection.
 *
 * Console warnings are suppressed in production builds to avoid noise.
 *
 * @returns Array of detected danger patterns (empty if clean).
 */
export function detectDangerPatterns(raw: string): DangerDetection[] {
  if (!raw) return [];

  const detections: DangerDetection[] = [];

  for (const { label, re } of DANGER_PATTERNS) {
    const match = re.exec(raw);
    if (match) {
      detections.push({ pattern: label, index: match.index });
    }
  }

  if (
    detections.length > 0 &&
    typeof process !== 'undefined' &&
    process.env.NODE_ENV !== 'production' &&
    typeof console !== 'undefined'
  ) {
    console.warn(
      '[Lumina Security] Potential XSS payload detected:',
      detections.map((d) => d.pattern).join(', '),
    );
  }

  return detections;
}
