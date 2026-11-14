// WCAG contrast ratios for the theme's colour tokens (ADR 0020). The tokens
// are read from main.css: `:root` for the default theme, and
// `:root[data-contrast="high"]` layered over it for high contrast.
// Translucent colours are composited over the pair's background first.

// WCAG 2.x thresholds.
export const thresholds = {
  // 1.4.6 Contrast (Enhanced): normal text.
  enhancedText: 7,
  // 1.4.3 Contrast (Minimum): normal text, and status messages.
  minimumText: 4.5,
  // 1.4.11 Non-text Contrast: control edges and focus indicators.
  nonText: 3
};

// What each pair is, its foreground and background tokens, and the ratio
// high contrast must reach. The default theme is the user's choice of look,
// so only its body text is held to 1.4.3; the rest is reported.
export const contrastPairs = [
  {
    name: "primary text on the app background",
    fg: "--text-primary",
    bg: "--app-background",
    high: 15,
    body: true
  },
  {
    name: "muted text on the app background",
    fg: "--text-muted",
    bg: "--app-background",
    high: thresholds.enhancedText,
    body: true
  },
  {
    name: "secondary text on the app background",
    fg: "--text-secondary",
    bg: "--app-background",
    high: thresholds.enhancedText
  },
  {
    name: "hint text on the app background",
    fg: "--text-hint",
    bg: "--app-background",
    high: thresholds.enhancedText
  },
  {
    name: "placeholder text in a control",
    fg: "--text-placeholder",
    bg: "--control-fill",
    over: "--app-background",
    high: thresholds.enhancedText
  },
  {
    name: "text on a focused (light) control",
    fg: "--focus-text",
    bg: "--focus-fill",
    high: thresholds.enhancedText
  },
  {
    name: "text on the selected item",
    fg: "--text-primary",
    bg: "--selected-fill",
    over: "--app-background",
    high: thresholds.enhancedText
  },
  {
    name: "text in a drop-down list",
    fg: "--text-primary",
    bg: "--dropdown-fill",
    high: thresholds.enhancedText
  },
  {
    name: "text over photos on its plate",
    fg: "--text-emphasis",
    bg: "--overlay-plate",
    over: "--viewer-backdrop",
    high: thresholds.enhancedText
  },
  {
    name: "error status",
    fg: "--status-error",
    bg: "--app-background",
    high: thresholds.minimumText
  },
  {
    name: "warning status",
    fg: "--status-warning",
    bg: "--app-background",
    high: thresholds.minimumText
  },
  {
    name: "success status",
    fg: "--status-success",
    bg: "--app-background",
    high: thresholds.minimumText
  },
  {
    name: "control edge on the app background",
    fg: "--control-border",
    bg: "--app-background",
    high: thresholds.nonText
  },
  {
    name: "focused control against the app background",
    fg: "--focus-fill",
    bg: "--app-background",
    high: thresholds.nonText
  },
  {
    name: "focus ring's dark band against the focused control",
    fg: "--focus-ring",
    bg: "--focus-fill",
    high: thresholds.nonText
  },
  {
    name: "focus ring's dark band against its white outer band",
    fg: "--focus-ring",
    bg: "--focus-halo",
    high: thresholds.nonText
  }
];

// The custom properties declared in the first rule whose selector is
// exactly `selector`.
export function readTokens(css, selector) {
  const start = css.indexOf(`${selector} {`);

  if (start < 0) {
    return {};
  }

  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const tokens = {};

  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }

  return tokens;
}

// Follows var() references to a colour.
export function resolveToken(tokens, name, seen = new Set()) {
  if (seen.has(name) || !(name in tokens)) {
    throw new Error(`Unknown colour token ${name}.`);
  }

  seen.add(name);
  const value = tokens[name];
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);

  return reference ? resolveToken(tokens, reference[1], seen) : value;
}

// [r, g, b, a] with channels 0-255 and alpha 0-1.
export function parseColour(value) {
  const text = value.trim().toLowerCase();

  if (text === "transparent") {
    return [0, 0, 0, 0];
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);

  if (hex) {
    const digits =
      hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit) : hex[1].match(/../g);

    return [...digits.map((pair) => parseInt(pair, 16)), 1];
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);

  if (rgb) {
    const parts = rgb[1].split(",").map((part) => Number(part.trim()));

    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }

  throw new Error(`Not a plain colour: ${value}`);
}

// Source-over compositing of a colour onto an opaque one.
export function composite(top, bottom) {
  const alpha = top[3];

  return [0, 1, 2].map((channel) => top[channel] * alpha + bottom[channel] * (1 - alpha)).concat(1);
}

function luminance([r, g, b]) {
  const linear = (channel) => {
    const value = channel / 255;

    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

// The ratio for one pair in one theme. A translucent background is
// composited over the pair's `over` token, or over black.
export function measurePair(tokens, pair) {
  const base = pair.over ? parseColour(resolveToken(tokens, pair.over)) : [0, 0, 0, 1];
  const background = composite(
    parseColour(resolveToken(tokens, pair.bg)),
    composite(base, [0, 0, 0, 1])
  );
  const foreground = composite(parseColour(resolveToken(tokens, pair.fg)), background);

  return contrastRatio(foreground, background);
}

// Every pair in both themes, with failures: high contrast below its target,
// and default-theme body text below 1.4.3.
export function checkContrast(css) {
  const defaults = readTokens(css, ":root");
  const high = { ...defaults, ...readTokens(css, ':root[data-contrast="high"]') };
  const results = [];

  for (const pair of contrastPairs) {
    const normal = measurePair(defaults, pair);
    const contrast = measurePair(high, pair);

    results.push({
      contrast,
      failures: [
        contrast < pair.high
          ? `High contrast: ${pair.name} is ${contrast.toFixed(2)}:1, below ${pair.high}:1.`
          : null,
        pair.body && normal < thresholds.minimumText
          ? `Default theme: ${pair.name} is ${normal.toFixed(2)}:1, below ${thresholds.minimumText}:1.`
          : null
      ].filter(Boolean),
      name: pair.name,
      normal
    });
  }

  return results;
}

// Selectors whose colours are media-only and stay local (main.css says why).
export const mediaOnlySelectors = [
  ".asset-video-icon",
  ".asset-live-photo-icon",
  ".asset-live-photo-icon::after",
  ".asset-viewer-spinner",
  ".asset-viewer-player",
  ".asset-viewer-face-box",
  ".dropdown-list",
  ".ambient-screen",
  ".ambient-layer[data-incoming]",
  ".ambient-video",
  // The Support Us QR code: black on white in every theme, like a photo, so
  // phones can read it (ADR 0021).
  ".support-qr",
  ".support-qr path"
];

// Raw colours outside the two token blocks and the media-only rules, so a new
// theme colour can't bypass the tokens (and high contrast) unnoticed.
export function findUntokenedColours(css) {
  const found = [];
  let selector = "";

  css.split("\n").forEach((line, index) => {
    const opening = /^\s*([^{}]+?)\s*\{\s*$/.exec(line);

    if (opening) {
      selector = opening[1];
    }

    const tokenBlock = selector === ":root" || selector === ':root[data-contrast="high"]';

    if (
      !tokenBlock &&
      !mediaOnlySelectors.includes(selector) &&
      /#[0-9a-f]{3,8}\b|rgba?\(/i.test(line)
    ) {
      found.push(`line ${index + 1} (${selector}): ${line.trim()}`);
    }
  });

  return found;
}
