// Vitest 3 dropped the module augmentation that let Vite's own `defineConfig` accept a `test`
// block, so the config is defined through `vitest/config` instead. It is Vite's `defineConfig`
// with the test options typed on top; every Vite option below is unchanged.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      /*
       * A new version waits to be let in rather than taking over.
       *
       * Under `autoUpdate` the page reloads itself the moment a new service worker activates —
       * no warning, mid-score-entry, and every open tab at once on every deploy. It also made
       * the "A fresh app version is ready" toast in App unreachable: vite-plugin-pwa only wires
       * `onNeedRefresh` on this branch, so the app had a prompt in its source that could never
       * fire. Prompting makes that toast real and puts the moment of reloading in the hands of
       * whoever is standing at the field with a phone.
       */
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-maskable.svg"],
      manifest: {
        name: "League Forecast",
        short_name: "Forecast",
        description:
          "Prediction dashboard, power ratings, matchup analysis, and forecast accuracy for any league.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Without this, the service worker answers *every* navigation with the
        // cached app shell — including /api/*, so opening an API URL in the
        // browser shows the dashboard instead of the server's response and the
        // endpoint looks broken when it is not.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              networkTimeoutSeconds: 3,
            },
          },
          {
            urlPattern: ({ request }) =>
              ["script", "style", "worker"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "assets" },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        /*
         * React and React DOM go in a chunk of their own. They are a third of what a first visit
         * downloads and they change only when the dependency is upgraded, so keeping them apart
         * means a deploy of our own code re-downloads our own code and nothing else — every
         * returning visit after a release is that much lighter.
         */
        manualChunks: (id) =>
          /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? "react" : undefined,
      },
    },
  },
  test: {
    /*
     * Reported, not enforced. There are sixteen hundred tests and no measurement of what they
     * miss, which is the gap this closes — but a threshold picked before anybody has seen the real
     * numbers is a number invented to be met, and it would start failing pull requests on its
     * first day for reasons nobody chose. Add one once the report has been read.
     *
     * `include` is what makes this honest. Every file it matches is reported whether a test
     * touched it or not, so a file with no test counts as zero rather than vanishing from the
     * denominator — the point is to find what is untested, and the untested files are exactly the
     * ones that would otherwise not appear. (This was `all: true` before Vitest 3; `include` now
     * carries that meaning on its own.)
     */
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/lib/__tests__/**",
        // Type-only and entry modules: nothing to execute, so a percentage says nothing.
        "src/lib/types.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      reporter: ["text-summary", "lcov"],
    },
    // Two projects rather than one environment, because they want different ones. The lib tests are
    // pure functions and run fastest with no DOM at all; the component tests need one. Splitting
    // them keeps the 1,000-odd lib tests from paying for a jsdom they never touch.
    projects: [
      {
        extends: true,
        test: {
          name: "lib",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
