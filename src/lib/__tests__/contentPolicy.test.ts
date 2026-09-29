import { describe, expect, it } from "vitest";
import indexHtml from "../../../index.html?raw";
import { widenPolicy, widenPolicyInHtml } from "../contentPolicy";

const BASE = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(indexHtml)?.[1] ?? "";

const directive = (policy: string, name: string): string[] | undefined =>
  policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([first]) => first === name)
    ?.slice(1);

const FIREBASE = `const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "demo-project.firebaseapp.com",
  projectId: "demo-project",
  appId: "1:1:web:1"
};`;

describe("the page's content policy", () => {
  it("is index.html's, to the character, for a build with nothing configured", () => {
    expect(BASE).toContain("connect-src 'self'");
    expect(widenPolicy(BASE, {})).toBe(BASE);
    expect(widenPolicy(BASE, { VITE_GC_PROXY_URL: "", VITE_FIREBASE_CONFIG: "" })).toBe(BASE);
  });

  it("lets pulls reach a proxy on another origin, and changes nothing else", () => {
    const policy = widenPolicy(BASE, {
      VITE_GC_PROXY_URL: " https://us-central1-demo.cloudfunctions.net/gcTeam/ ",
    });
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://us-central1-demo.cloudfunctions.net",
    ]);
    for (const name of ["default-src", "script-src", "img-src", "style-src", "worker-src"]) {
      expect(directive(policy, name)).toEqual(directive(BASE, name));
    }
  });

  it("adds nothing for a proxy address that is not a plain https one", () => {
    for (const bad of [
      "http://proxy.example",
      "not a url",
      "https://proxy.example; script-src *",
      "https://proxy.example script-src *",
      "https://user@proxy.example/gcTeam",
      "javascript:alert(1)",
    ]) {
      expect(widenPolicy(BASE, { VITE_GC_PROXY_URL: bad })).toBe(BASE);
    }
  });

  it("keeps a port, and reads the host whatever its case", () => {
    const policy = widenPolicy(BASE, {
      VITE_GC_PROXY_URL: "https://Proxy.Example:8443/gcTeam?x=1",
    });
    expect(directive(policy, "connect-src")).toEqual(["'self'", "https://proxy.example:8443"]);
  });

  it("lets a build that keeps a cloud copy sign in to Google and reach Firestore", () => {
    const policy = widenPolicy(BASE, { VITE_FIREBASE_CONFIG: FIREBASE });
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://firestore.googleapis.com",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
    ]);
    expect(directive(policy, "script-src")).toEqual(["'self'", "https://apis.google.com"]);
    // Not in the base: it starts from what it fell back to, the page's own origin.
    expect(directive(BASE, "frame-src")).toBeUndefined();
    expect(directive(policy, "frame-src")).toEqual([
      "'self'",
      "https://demo-project.firebaseapp.com",
    ]);
    expect(directive(policy, "default-src")).toEqual(directive(BASE, "default-src"));
  });

  it("adds nothing for a Firebase setting missing what sign-in needs", () => {
    const half = FIREBASE.replace(/authDomain: "[^"]*",/, "");
    expect(widenPolicy(BASE, { VITE_FIREBASE_CONFIG: half })).toBe(BASE);
    const broken = FIREBASE.replace("demo-project.firebaseapp.com", "demo project.example");
    expect(widenPolicy(BASE, { VITE_FIREBASE_CONFIG: broken })).toBe(BASE);
  });

  it("holds both at once, each source once", () => {
    const policy = widenPolicy(BASE, {
      VITE_GC_PROXY_URL: "https://firestore.googleapis.com/somewhere",
      VITE_FIREBASE_CONFIG: FIREBASE,
    });
    const connect = directive(policy, "connect-src") ?? [];
    expect(connect.filter((source) => source === "https://firestore.googleapis.com")).toHaveLength(
      1
    );
  });

  it("names a source once, however often it is asked for", () => {
    const once = widenPolicy(BASE, { VITE_GC_PROXY_URL: "https://proxy.example/gcTeam" });
    expect(widenPolicy(once, { VITE_GC_PROXY_URL: "https://proxy.example/other" })).toBe(once);
  });

  it("starts a directive the base leaves out from what it fell back to", () => {
    const policy = widenPolicy("default-src 'self'; img-src 'self' data:", {
      VITE_GC_PROXY_URL: "https://proxy.example/gcTeam",
    });
    expect(directive(policy, "connect-src")).toEqual(["'self'", "https://proxy.example"]);
    expect(directive(policy, "img-src")).toEqual(["'self'", "data:"]);
  });

  it("is written into the page's policy tag and nowhere else", () => {
    const html = widenPolicyInHtml(indexHtml, {
      VITE_GC_PROXY_URL: "https://us-central1-demo.cloudfunctions.net/gcTeam",
    });
    expect(html).toContain("connect-src 'self' https://us-central1-demo.cloudfunctions.net");
    expect(html.replace(/content="[^"]*connect-src[^"]*"/, "")).toBe(
      indexHtml.replace(/content="[^"]*connect-src[^"]*"/, "")
    );
  });
});
