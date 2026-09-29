/**
 * Bundles the functions (`npm run build`), each entry with everything of the app's it imports.
 *
 * The pulls in the cloud (`startPull`, `runPull`) are built only when CLOUD_PULLS is `on`: the
 * last step of their one-time setup (README, "Pulls in the cloud: the one-time setup"). A deploy
 * asks for every API any function it finds needs, whatever it was told to deploy, and `runPull`
 * needs Cloud Tasks, which the deploy account may not turn on; built without them, a project not
 * yet set up for them deploys the rest as it always has.
 */
import { build } from "esbuild";

const pulls = process.env.CLOUD_PULLS === "on";
await build({
  entryPoints: ["src/index.ts", "src/pullLeg.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  outdir: "lib",
  define: { CLOUD_PULLS: JSON.stringify(pulls) },
  logLevel: "info",
});
console.log(`Pulls in the cloud ${pulls ? "built" : "left out (CLOUD_PULLS is not on)"}.`);
