import { describe, expect, it } from "vitest";
import indexHtml from "../../../index.html?raw";
import { FIREBASE_WEB_CONFIG, type FirebaseWebConfig } from "../cloud/cloudConfig";
import { widenPolicy, widenPolicyInHtml } from "../contentPolicy";
import { EDIT_URL } from "../live/editClient";

const BASE = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(indexHtml)?.[1] ?? "";

const directive = (policy: string, name: string): string[] | undefined =>
  policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([first]) => first === name)
    ?.slice(1);

const FIREBASE: FirebaseWebConfig = {
  apiKey: "demo-key",
  authDomain: "demo-project.firebaseapp.com",
  projectId: "demo-project",
  appId: "1:1:web:1",
};

describe("the page's content policy", () => {
  it("is index.html's, to the character, for a build with nothing configured", () => {
    expect(BASE).toContain("connect-src 'self'");
    expect(widenPolicy(BASE, {})).toBe(BASE);
    expect(widenPolicy(BASE, { VITE_GC_PROXY_URL: "", firebase: null })).toBe(BASE);
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

  it("lets a build that keeps a cloud copy sign in to Google, reach Firestore, and call its functions", () => {
    const policy = widenPolicy(BASE, { firebase: FIREBASE });
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "https://firestore.googleapis.com",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
      "https://us-central1-demo-project.cloudfunctions.net",
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

  it("opens the frame to the app's own project, the one its sign-in goes to", () => {
    const policy = widenPolicy(BASE, { firebase: FIREBASE_WEB_CONFIG });
    expect(directive(policy, "frame-src")).toEqual([
      "'self'",
      `https://${FIREBASE_WEB_CONFIG.authDomain}`,
    ]);
  });

  it("lets the app's own build reach the edit function its devices call", () => {
    const policy = widenPolicy(BASE, { firebase: FIREBASE_WEB_CONFIG });
    expect(directive(policy, "connect-src")).toContain(new URL(EDIT_URL).origin);
  });

  it("adds nothing for an auth domain that is not a plain host", () => {
    for (const authDomain of ["demo project.example", "demo.example; script-src *", ""]) {
      expect(widenPolicy(BASE, { firebase: { ...FIREBASE, authDomain } })).toBe(BASE);
    }
  });

  it("names no functions host for a project id that is not a plain name", () => {
    for (const projectId of ["demo project", "demo; script-src *", ""]) {
      const connect = directive(
        widenPolicy(BASE, { firebase: { ...FIREBASE, projectId } }),
        "connect-src"
      );
      expect(connect?.some((source) => source.includes("cloudfunctions"))).toBe(false);
    }
  });

  it("holds both at once, each source once", () => {
    const policy = widenPolicy(BASE, {
      VITE_GC_PROXY_URL: "https://firestore.googleapis.com/somewhere",
      firebase: FIREBASE,
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
