import { describe, expect, it } from "vitest";
import type { GcImportProblem } from "../../gameChangerReport";
import {
  downloadProblems,
  filingProblems,
  importReportPath,
  readImportReportCsv,
  restImportReports,
} from "../importReports";

const ID = "0123456789abcdef0123456789abcdef";
const problem = (n: number): GcImportProblem => ({
  teamId: `gc${String(n).padStart(10, "0")}`,
  teamName: `Team ${n}`,
  kind: "not-reached",
  reason: "Timed out",
  detail: "No profile reply.",
  url: "https://web.gc.com",
});
const setup = () => {
  const values = new Map<string, Record<string, unknown>>();
  let fail = false;
  const docs = {
    read: async (path: string) => values.get(path) ?? null,
    set: async (path: string, value: Record<string, unknown>) => {
      if (fail && path.includes("/reports/")) throw new Error("Interrupted report manifest");
      values.set(path, structuredClone(value));
    },
  };
  return {
    values,
    docs,
    writer: restImportReports(docs, ID),
    fail: () => {
      fail = true;
    },
  };
};

describe("durable skipped-team reports", () => {
  it("exports every download and filing failure, retaining earlier checkpoints", async () => {
    const test = setup();
    await test.writer.download(0, [problem(0), problem(1)]);
    await test.writer.download(1, [problem(2)]);
    await test.writer.filing([
      {
        ...problem(3),
        kind: "not-filed",
        reason: "no age",
        detail: "Opponents could not establish an age.",
      },
    ]);
    const csv = (await readImportReportCsv(test.docs.read, ID, 4)).join("");
    expect(csv.split("\n")).toHaveLength(5);
    for (let n = 0; n < 4; n++) expect(csv).toContain(problem(n).teamId);
    expect(csv).toContain("Not filed,no age");
    expect(csv).toContain("https://web.gc.com/teams/");
    expect([...test.values.keys()].every((key) => !key.includes("/artifacts/"))).toBe(true);
  });
  it("replaces a checkpoint report without duplicating rows and replaces the final filing report", async () => {
    const test = setup();
    await test.writer.download(0, [problem(0)]);
    await test.writer.download(0, [problem(0), problem(1)]);
    await test.writer.filing([{ ...problem(2), kind: "not-filed" }]);
    await test.writer.filing([]);
    const csv = (await readImportReportCsv(test.docs.read, ID, 2)).join("");
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).not.toContain(problem(2).teamId);
  });
  it("keeps the previous readable report if publishing new chunks is interrupted", async () => {
    const test = setup();
    await test.writer.download(0, [problem(0)]);
    test.fail();
    await expect(test.writer.download(0, [problem(0), problem(1)])).rejects.toThrow("Interrupted");
    const csv = (await readImportReportCsv(test.docs.read, ID, 1)).join("");
    expect(csv).toContain(problem(0).teamId);
    expect(csv).not.toContain(problem(1).teamId);
  });
  it("splits large filing reports, rejects damaged or missing chunks, and protects CSV cells", async () => {
    const test = setup();
    const rows = Array.from({ length: 2001 }, (_, n) => ({
      ...problem(n),
      kind: "not-filed" as const,
    }));
    rows[0]!.teamName = '=IMPORTXML("bad")';
    await test.writer.filing(rows);
    expect(test.values.get(importReportPath(ID, "filing"))!.parts as unknown[]).toHaveLength(2);
    const csv = (await readImportReportCsv(test.docs.read, ID, 2001)).join("");
    expect(csv.split("\n")).toHaveLength(2002);
    expect(csv).toContain("'=IMPORTXML");
    const key = [...test.values.keys()].find((path) => path.includes("/reportChunks/"))!;
    test.values.set(key, { data: new Uint8Array([0, 1]) });
    await expect(readImportReportCsv(test.docs.read, ID)).rejects.toThrow();
    test.values.delete(key);
    await expect(readImportReportCsv(test.docs.read, ID)).rejects.toThrow("missing");
  });
  it("rejects an absent report when the job says skipped rows are available", async () => {
    const test = setup();
    await expect(readImportReportCsv(test.docs.read, ID, 1)).rejects.toThrow("incomplete");
  });
  it("makes only failure rows and includes intentionally unfiled seasons", () => {
    const failed = downloadProblems(
      [["gc0000000000", { ok: false, reason: "timeout", message: "Slow" }]],
      new Map([["gc0000000000", "My team"]])
    );
    expect(failed[0]).toMatchObject({ teamName: "My team", reason: "Timed out", detail: "Slow" });
    const rows = filingProblems([
      {
        gcTeamId: "gc0000000001",
        teamName: "Another season",
        skip: "other-season",
        issue: "Outside the requested season.",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "other season", kind: "not-filed" });
  });
});
