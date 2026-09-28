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

describe("the page's content policy", () => {
  it("is index.html's, to the character, for a build with nothing configured", () => {
    expect(BASE).toContain("connect-src 'self'");
    expect(widenPolicy(BASE, {})).toBe(BASE);
    expect(widenPolicy(BASE, { VITE_GC_PROXY_URL: "" })).toBe(BASE);
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
