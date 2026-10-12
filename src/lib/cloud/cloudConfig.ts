/**
 * The Firebase web app's settings, which say which project the cloud copy lives in.
 *
 * None of this is secret. The console hands it to any page that asks, the app's bundle carries it
 * for anyone to read, and what keeps the data private is the Firestore rules (`firestore.rules`),
 * which open the copy to a Google sign-in and nothing else. See README, "Your data on every device".
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

/**
 * The project this app keeps its copy in, written here rather than read from a build setting.
 *
 * It was a Vercel setting (`VITE_FIREBASE_CONFIG`), and the site built from it sent Google a key
 * the sign-in service rejected ("API key not valid"), still after the setting was entered again,
 * with nothing outside Vercel's dashboard able to show what the build had been given. These are the
 * web app's settings as Firebase reports them for the project, and this key was accepted by the
 * same sign-in service when tried from outside the site. Kept in the source, every build gets
 * exactly these, and a change to them is a reviewed commit.
 */
export const FIREBASE_WEB_CONFIG: FirebaseWebConfig = {
  apiKey: "AIzaSyBwv4yv7iKeTH-Vc8cuGANrXZ7kJ7qXDi0",
  authDomain: "league-forecast-youth.firebaseapp.com",
  projectId: "league-forecast-youth",
  storageBucket: "league-forecast-youth.firebasestorage.app",
  messagingSenderId: "528218953059",
  appId: "1:528218953059:web:a614601c1b924b1ed9af56",
};
