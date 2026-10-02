import { describe, expect, it } from "vitest";
import { coerceMember, isMemberAddress, memberAddress, sortMembers } from "../members";

/*
 * The list's addresses, as the rules compare them: in lower case, and only what can name an entry.
 * The rules hold an entry to the same shape (`firestore.rules`); these keep the panel from sending
 * what they would refuse.
 */
describe("an address on the list", () => {
  it("is read trimmed and in lower case, as the rules compare it", () => {
    expect(memberAddress("  Coach@Example.COM ")).toBe("coach@example.com");
  });

  it("is something, an at sign and something, with no space or slash", () => {
    expect(isMemberAddress("coach@example.com")).toBe(true);
    for (const junk of [
      "coach",
      "@example.com",
      "coach@",
      "co ach@example.com",
      "coach@exa\tmple.com",
      "a/b@example.com",
      "a@b@example.com",
      "",
    ]) {
      expect(isMemberAddress(junk)).toBe(false);
    }
  });
});

describe("an entry as Firestore hands it back", () => {
  it("keeps its role and when it was added, and nothing it cannot read", () => {
    expect(coerceMember("a@example.com", { role: "member", addedAt: "2026-10-02" })).toEqual({
      address: "a@example.com",
      role: "member",
      addedAt: "2026-10-02",
    });
    expect(coerceMember("o@example.com", { role: "owner", addedAt: 3 })).toEqual({
      address: "o@example.com",
      role: "owner",
    });
    for (const junk of [null, "member", { role: "admin" }, {}]) {
      expect(coerceMember("x@example.com", junk)).toBeNull();
    }
  });

  it("lists the owner first, then everyone by address", () => {
    expect(
      sortMembers([
        { address: "b@example.com", role: "member" },
        { address: "z@example.com", role: "owner" },
        { address: "a@example.com", role: "member" },
      ]).map((member) => member.address)
    ).toEqual(["z@example.com", "a@example.com", "b@example.com"]);
  });
});
