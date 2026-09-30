import { gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const budgets = JSON.parse(
  readFileSync(new URL("./bundle-budgets.json", import.meta.url), "utf8")
);
const files = readdirSync(assetsDirectory).filter(
  (file) => (file.endsWith(".js") || file.endsWith(".css")) && !file.endsWith(".map")
);
const measurements = Object.fromEntries(
  files.map((file) => {
    const contents = readFileSync(new URL(file, assetsDirectory));
    return [file, { rawBytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength }];
  })
);

const findOne = (label, pattern) => {
  const matches = files.filter((file) => pattern.test(file));
  if (matches.length !== 1) throw new Error(`${label}: expected one emitted asset, found ${matches}`);
  return matches[0];
};

const initialApp = findOne("initial application chunk", /^index-[^.]+\.js$/);
const css = findOne("application CSS", /^index-[^.]+\.css$/);
const views = Object.fromEntries(
  Object.entries(budgets.views).map(([view, limit]) => {
    const file = findOne(`${view} view`, new RegExp(`^${view}-[^.]+\\.js$`));
    return [view, { file, limit, ...measurements[file] }];
  })
);
const criticalFiles = files.filter(
  (file) =>
    file === initialApp ||
    /^(?:react|rolldown-runtime|preload-helper)-[^.]+\.js$/.test(file)
);
const criticalRawBytes = criticalFiles.reduce(
  (total, file) => total + measurements[file].rawBytes,
  0
);
const criticalGzipBytes = criticalFiles.reduce(
  (total, file) => total + measurements[file].gzipBytes,
  0
);

const report = {
  generatedAt: new Date().toISOString(),
  initial: { file: initialApp, ...measurements[initialApp] },
  critical: { files: criticalFiles, rawBytes: criticalRawBytes, gzipBytes: criticalGzipBytes },
  css: { file: css, ...measurements[css] },
  views,
};
mkdirSync(new URL("../dist/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../dist/bundle-report.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`
);

const failures = [];
const check = (label, actual, limit) => {
  if (actual > limit) failures.push(`${label}: ${actual} bytes exceeds ${limit} byte budget`);
};
check("Initial application chunk", measurements[initialApp].rawBytes, budgets.initialRawBytes);
check("Total critical JavaScript", criticalRawBytes, budgets.criticalRawBytes);
check("Application CSS", measurements[css].rawBytes, budgets.cssRawBytes);
for (const [view, measurement] of Object.entries(views)) {
  check(`${view} view chunk`, measurement.rawBytes, measurement.limit);
}

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) {
  console.error(`\nBundle budget failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
}
