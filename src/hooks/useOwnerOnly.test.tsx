import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OWNER_ONLY, type MemberRole } from "../lib/cloud/members";
import { useOwnerOnly } from "./useOwnerOnly";

/*
 * What the owner's controls say for the account signed in (`useOwnerOnly`): the line for a member,
 * and nothing, which leaves them on, for the owner and for whatever is not known. The server
 * refuses a member all the same, so only a member known to be one is told.
 */

/** Lets the role's answer, and the render it brings, land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("the owner's controls for the account signed in", () => {
  it("says only the owner can to a member, and nothing to the owner", async () => {
    const member = renderHook(() => useOwnerOnly(async () => "member"));
    await waitFor(() => expect(member.result.current).toBe(OWNER_ONLY));
    const owner = renderHook(() => useOwnerOnly(async () => "owner"));
    await settle();
    expect(owner.result.current).toBeNull();
  });

  it("says nothing with no role to ask, or an account not on the list", async () => {
    expect(renderHook(() => useOwnerOnly(undefined)).result.current).toBeNull();
    const off = renderHook(() => useOwnerOnly(async () => null));
    await settle();
    expect(off.result.current).toBeNull();
  });

  it("asks only once ready, and again each time it comes back on, after a read that failed", async () => {
    let online = false;
    const role = vi.fn(async (): Promise<MemberRole | null> => {
      if (!online) throw new Error("offline");
      return "member";
    });
    const { result, rerender } = renderHook(({ ready }) => useOwnerOnly(role, ready), {
      initialProps: { ready: false },
    });
    await settle();
    expect(role).not.toHaveBeenCalled();
    // On, and the read fails: not known, so nothing is said.
    rerender({ ready: true });
    await settle();
    expect(role).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
    // Off and on again, online now: read again, and the member told.
    online = true;
    rerender({ ready: false });
    rerender({ ready: true });
    await waitFor(() => expect(result.current).toBe(OWNER_ONLY));
    expect(role).toHaveBeenCalledTimes(2);
  });

  it("keeps a member's line through a later read that fails", async () => {
    let answer: () => Promise<MemberRole | null> = async () => "member";
    const role = () => answer();
    const { result, rerender } = renderHook(({ ready }) => useOwnerOnly(role, ready), {
      initialProps: { ready: true },
    });
    await waitFor(() => expect(result.current).toBe(OWNER_ONLY));
    answer = () => Promise.reject(new Error("offline"));
    rerender({ ready: false });
    rerender({ ready: true });
    await settle();
    expect(result.current).toBe(OWNER_ONLY);
  });
});
