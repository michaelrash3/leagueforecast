import { describe, expect, it } from "vitest";
import rules from "../../../../firestore.rules?raw";
import { OWNER_STAND_IN, pinCloudOwner } from "../cloudOwner";

describe("pinning the cloud copy's owner into the rules at deploy", () => {
  it("names the owner in place of the stand-in, and nowhere else", () => {
    const pinned = pinCloudOwner(rules, "someone@example.com");
    expect(pinned).not.toContain(OWNER_STAND_IN);
    expect(pinned.split('"someone@example.com"')).toHaveLength(2);
    // Nothing else in the file moves.
    expect(pinned.replace('"someone@example.com"', `"${OWNER_STAND_IN}"`)).toBe(rules);
  });

  it("writes the address as the rules compare it: trimmed and in lower case", () => {
    expect(pinCloudOwner(rules, "  Some.One+Games@Example.COM \n")).toContain(
      '"some.one+games@example.com"'
    );
  });

  it("refuses anything that could close the quotes or is not an address", () => {
    for (const email of [
      "",
      "someone",
      "someone@example",
      'some"one@example.com',
      "some one@example.com",
      "some\\one@example.com",
      'someone@example.com" || true || "',
    ]) {
      expect(() => pinCloudOwner(rules, email), email).toThrow(/not an email address/);
    }
  });

  it("refuses rules that do not name the stand-in exactly once", () => {
    expect(() => pinCloudOwner("service cloud.firestore {}", "someone@example.com")).toThrow(
      /0 times/
    );
    expect(() =>
      pinCloudOwner(`"${OWNER_STAND_IN}" "${OWNER_STAND_IN}"`, "someone@example.com")
    ).toThrow(/2 times/);
  });

  it("is what the repository's rules name as the owner", () => {
    expect(rules).toContain(`email.lower() == "${OWNER_STAND_IN}"`);
  });
});
