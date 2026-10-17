/**
 * Where the nightly keeps its weekly re-measure of where a rating starts (`closedLevelRecord.ts`),
 * named once for the server that writes it (`serverStores.ts`) and the browser that reads it
 * (`firebaseCloud.ts`). A module of its own, importing nothing, so the cloud's chunk takes in this
 * name and not the model code the record's words are made with. Typed twice before, writer and
 * reader could drift apart and the card would silently never show the Monday line: both paths
 * changed together, or either alone, passed the whole suite.
 */
export const CLOSED_LEVEL_PATH = "live/closedLevel";
