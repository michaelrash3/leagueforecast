/**
 * Handing a file to the browser.
 *
 * Six places in this app build a Blob, make an object URL, click an invented anchor and revoke the
 * URL. Five of them write CSV and differ only in the filename. This is that, once — lifted here at
 * the moment the waiting-on-an-age export became the second caller of the copy that already had
 * the part worth keeping.
 */

/**
 * Saves text as a CSV.
 *
 * The byte order mark is not decoration. These files are opened in Excel and mailed on, and
 * without it Excel reads them in the system codepage and mangles every accented and apostrophed
 * team name — which is most of what makes the rows readable, and all of the evidence about what a
 * club calls itself. A twelve-megabyte file nobody can read does not get downloaded twice.
 *
 * The body may be given in pieces, and for a large list it should be: `Blob` joins them itself,
 * so thirty-six thousand rows never exist as one multi-megabyte JavaScript string sitting beside
 * the array it was built from.
 */
export const downloadCsv = (name: string, body: string | readonly string[]) => {
  const parts = typeof body === "string" ? [body] : body;
  const blob = new Blob(["﻿", ...parts], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

/** Today, as "2026-09-17", so two days' files do not overwrite each other. */
export const fileDay = (at: Date = new Date()): string => at.toISOString().slice(0, 10);
