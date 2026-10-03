/**
 * The parts of Firestore's full SDK the app uses, which the copy's lite one lacks: a listener on a
 * document (`watchLiveMeta`), and, for the emulator's tests, pointing a client at the emulator and
 * cutting it off the network. A module of its own so the build gives it a chunk of its own under
 * this name, which the service worker leaves out of what it stores ahead (`vite.config.ts`): a
 * listener is no use offline, and a browser that never opens a live board never needs it.
 */
export {
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  enableNetwork,
  getFirestore,
  onSnapshot,
  type Firestore,
} from "firebase/firestore";
