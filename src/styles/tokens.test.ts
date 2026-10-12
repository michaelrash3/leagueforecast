import theme from "tailwindcss/theme.css?raw";
import { describe, expect, it } from "vitest";
import { pill, stateTone, surface, textRole, type PillTone, type StateKind } from "./tokens";

/*
 * Contrast, measured rather than eyeballed (2.5): every text role on every surface, and every
 * status pill on the surface it sits on, in light mode and in dark, against WCAG's 4.5:1 for text
 * of ordinary size. The colours are Tailwind's own, read from its theme as the build uses them
 * (OKLCH), so a token pointed at a paler grey fails here before it ships.
 */

type Rgb = [number, number, number];

const PALETTE = (() => {
  const colours = new Map<string, Rgb>([
    ["white", [1, 1, 1]],
    ["black", [0, 0, 0]],
  ]);
  // A grey's hue is `none`: it has none, and its chroma is 0 either way.
  for (const [, name, l, c, h] of theme.matchAll(
    /--color-([a-z]+-\d+): oklch\(([\d.]+)% ([\d.]+) ([\d.]+|none)\)/g
  )) {
    colours.set(
      name ?? "",
      oklchToLinear(Number(l) / 100, Number(c), h === "none" ? 0 : Number(h))
    );
  }
  return colours;
})();

/** OKLCH to linear-light sRGB (Björn Ottosson's matrices), clipped to the gamut. */
function oklchToLinear(L: number, C: number, hue: number): Rgb {
  const a = C * Math.cos((hue * Math.PI) / 180);
  const b = C * Math.sin((hue * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const encode = (linear: number) =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
const decode = (gamma: number) =>
  gamma <= 0.04045 ? gamma / 12.92 : ((gamma + 0.055) / 1.055) ** 2.4;

/** A colour drawn at `alpha` over another, blended as a browser does, in gamma-encoded sRGB. */
const over = (top: Rgb, alpha: number, bottom: Rgb): Rgb =>
  top.map((channel, at) =>
    decode(alpha * encode(channel) + (1 - alpha) * encode(bottom[at] ?? 0))
  ) as Rgb;

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (one: Rgb, two: Rgb) => {
  const [light, dark] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

/** The colour a class list gives one property, light or dark, with any `/alpha`. */
const colourOf = (classes: string, property: "text" | "bg", dark: boolean) => {
  const pattern = new RegExp(
    `(?:^|\\s)${dark ? "dark:" : ""}${property}-(white|black|[a-z]+-\\d{2,3})(?:/(\\d+))?(?=\\s|$)`
  );
  const match = classes.match(pattern);
  if (!match?.[1]) return null;
  const rgb = PALETTE.get(match[1]);
  if (!rgb) throw new Error(`No colour ${match[1]} in Tailwind's theme`);
  return { rgb, alpha: match[2] ? Number(match[2]) / 100 : 1 };
};

const page = (dark: boolean) => colourOf(surface.page, "bg", dark)?.rgb ?? [1, 1, 1];

/** A surface's own colour, laid over the page where it is see-through. */
const background = (classes: string, dark: boolean): Rgb => {
  const own = colourOf(classes, "bg", dark) ?? (dark ? null : colourOf(classes, "bg", false));
  return own ? over(own.rgb, own.alpha, page(dark)) : page(dark);
};

const textOn = (classes: string, ground: Rgb, dark: boolean) => {
  const text = colourOf(classes, "text", dark) ?? colourOf(classes, "text", false);
  if (!text) throw new Error(`No text colour in "${classes}"`);
  return contrast(over(text.rgb, text.alpha, ground), ground);
};

const SURFACES = Object.entries(surface) as [keyof typeof surface, string][];
const ROLES = Object.entries(textRole) as [keyof typeof textRole, string][];

describe("contrast", () => {
  it("reads Tailwind's palette", () => {
    // Every shade the theme defines, and white and black.
    expect(PALETTE.size).toBe([...theme.matchAll(/--color-[a-z]+-\d+:/g)].length + 2);
    expect(PALETTE.size).toBeGreaterThan(200);
    // Slate-500 as a browser draws it in sRGB: #62748e.
    const slate = PALETTE.get("slate-500")?.map((channel) => Math.round(encode(channel) * 255));
    expect(slate).toEqual([0x62, 0x74, 0x8e]);
  });

  it("measures as WCAG does", () => {
    expect(contrast([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 5);
    // #62748e on white, as any contrast checker gives it: 4.76:1.
    expect(textOn("text-slate-500", [1, 1, 1], false)).toBeCloseTo(4.76, 1);
  });

  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";

    it(`gives every text role 4.5:1 or more on every surface, ${mode}`, () => {
      const short: string[] = [];
      for (const [role, classes] of ROLES) {
        for (const [name, ground] of SURFACES) {
          const ratio = textOn(classes, background(ground, dark), dark);
          if (ratio < 4.5) short.push(`${role} on ${name}: ${ratio.toFixed(2)}`);
        }
      }
      expect(short).toEqual([]);
    });

    it(`gives every status pill 4.5:1 or more on a card, ${mode}`, () => {
      const short: string[] = [];
      const card = background(surface.primary, dark);
      for (const tone of ["neutral", "emerald", "blue", "amber", "red", "dark"] as PillTone[]) {
        const classes = pill(tone);
        const own = colourOf(classes, "bg", dark) ?? colourOf(classes, "bg", false);
        const ground = own ? over(own.rgb, own.alpha, card) : card;
        const ratio = textOn(classes, ground, dark);
        if (ratio < 4.5) short.push(`${tone}: ${ratio.toFixed(2)}`);
      }
      expect(short).toEqual([]);
    });
  }

  for (const dark of [false, true]) {
    it(`gives each state panel's words 4.5:1 or more on its own surface, ${dark ? "dark" : "light"}`, () => {
      const short: string[] = [];
      for (const [kind, tone] of Object.entries(stateTone) as [
        StateKind,
        (typeof stateTone)[StateKind],
      ][]) {
        const ground = background(tone.box, dark);
        for (const part of ["title", "body"] as const) {
          const ratio = textOn(tone[part], ground, dark);
          if (ratio < 4.5) short.push(`${kind} ${part}: ${ratio.toFixed(2)}`);
        }
      }
      expect(short).toEqual([]);
    });
  }

  it("found the grey the app used for small text too pale on the page", () => {
    // Why the roles are slate-600 and not slate-500 (see `textRole`).
    const ratio = textOn("text-slate-500", background(surface.page, false), false);
    expect(ratio).toBeLessThan(4.5);
  });
});
