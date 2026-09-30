import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const uid = process.env.FIREBASE_OWNER_UID?.trim();
if (!uid) throw new Error("Set FIREBASE_OWNER_UID to the verified Firebase Authentication UID.");
const apply = process.argv.includes("--apply");
const removeLegacy = process.argv.includes("--delete-legacy");
if (removeLegacy && !apply) throw new Error("--delete-legacy also requires --apply.");

const db = getFirestore(initializeApp({ credential: applicationDefault() }));
const source = db.doc("copies/main");
const target = db.doc(`users/${uid}/copies/main`);

const collect = async (from, to, output) => {
  const snap = await from.get();
  if (snap.exists) output.push({ from, to, data: snap.data() });
  for (const collection of await from.listCollections()) {
    for (const child of (await collection.get()).docs) {
      await collect(child.ref, to.collection(collection.id).doc(child.id), output);
    }
  }
};

const documents = [];
await collect(source, target, documents);
if (!documents.length) {
  console.log("No legacy copies/main data exists; nothing to migrate.");
  process.exit(0);
}
console.log(`${apply ? "Migrating" : "Would migrate"} ${documents.length} documents to owner ${uid}.`);
if (!apply) {
  console.log("Dry run only. Re-run with --apply after a Firestore export backup.");
  process.exit(0);
}

for (let offset = 0; offset < documents.length; offset += 400) {
  const batch = db.batch();
  for (const document of documents.slice(offset, offset + 400)) {
    // Merge makes reruns safe and preserves any newer target-only metadata.
    batch.set(document.to, document.data, { merge: true });
  }
  await batch.commit();
}
console.log("Copied and verified the owner namespace. Legacy data was retained.");

if (removeLegacy) {
  // Deepest first; deleting a Firestore document does not delete its subcollections.
  for (const document of [...documents].reverse()) await document.from.delete();
  console.log("Deleted the closed legacy namespace after the successful copy.");
}
