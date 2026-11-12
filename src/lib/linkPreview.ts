/**
 * The picture a link to the site is shown with, in a text thread or a team chat.
 *
 * `index.html` gave a link a title and a line of description and no picture, so a season shared
 * from the header arrived as bare text. A preview's picture has to be named by its whole address
 * (`og:image` takes no path on its own), and the site's address is nowhere in the repository: it
 * is whatever domain the Vercel project is given. So it is read at build time, and the tags are
 * written only by a build that knows it:
 *
 * - `VITE_SITE_URL`, where someone has set it, for a build served from anywhere else.
 * - `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every build of a project, a preview's
 *   too, to the project's shortest production domain, without the `https://`. Vercel gives it for
 *   this purpose: a link that points at production whichever deployment made it.
 *
 * A build with neither, as on a laptop or in CI, writes none of these tags and is the page it was.
 */
export type PreviewSettings = {
  VITE_SITE_URL?: string | undefined;
  VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
};

/** The picture in `public/`, drawn by `scripts/renderIcons.mjs`, and the size it is drawn at. */
export const PREVIEW_IMAGE = { path: "/og.png", width: 1200, height: 630 } as const;

const PREVIEW_ALT = "League Forecast: standings, power ratings and playoff odds.";

/**
 * A host, with `https://` before it or without, and nothing after it but a slash. Read by pattern,
 * as `contentPolicy.ts` reads an origin and for its reasons: the value goes into the page's head,
 * so anything that is not plainly a host name is turned away.
 */
const HOST = /^(?:https:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/?$/i;

/** The site's own origin for this build, or null where the build has not been told it. */
export const siteOrigin = (settings: PreviewSettings): string | null => {
  for (const raw of [settings.VITE_SITE_URL, settings.VERCEL_PROJECT_PRODUCTION_URL]) {
    const host = HOST.exec(raw?.trim() ?? "")?.[1];
    if (host) return `https://${host.toLowerCase()}`;
  }
  return null;
};

export type PreviewTag = { tag: "meta"; attrs: Record<string, string>; injectTo: "head" };

const property = (name: string, content: string): PreviewTag => ({
  tag: "meta",
  attrs: { property: name, content },
  injectTo: "head",
});

/** The tags a build adds to the page's head: none without the site's address. */
export const previewTags = (settings: PreviewSettings): PreviewTag[] => {
  const origin = siteOrigin(settings);
  if (!origin) return [];
  return [
    property("og:url", `${origin}/`),
    property("og:image", `${origin}${PREVIEW_IMAGE.path}`),
    property("og:image:type", "image/png"),
    property("og:image:width", String(PREVIEW_IMAGE.width)),
    property("og:image:height", String(PREVIEW_IMAGE.height)),
    property("og:image:alt", PREVIEW_ALT),
    // The wide card, where a service has one; it takes its picture from `og:image`.
    {
      tag: "meta",
      attrs: { name: "twitter:card", content: "summary_large_image" },
      injectTo: "head",
    },
  ];
};
