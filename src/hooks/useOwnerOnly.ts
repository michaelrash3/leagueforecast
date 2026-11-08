import { useEffect, useState } from "react";
import { OWNER_ONLY, type MemberRole } from "../lib/cloud/members";

/**
 * What to say under the cloud copy's owner's controls (`OWNER_ONLY`), drawn off, once `role` says
 * the account signed in is a member's; null, and they are drawn as they always were, for the owner
 * and for as long as it is not known: before the entry is read, where it cannot be (offline, nobody
 * to ask as), and with no `role` to ask. The server and the rules refuse a member whatever this
 * says, so an entry not read costs a member only the refusal it always had, and the owner's
 * controls never wait on a read, or go off because one failed. Read again each time `ready` comes
 * back on, so a page opened offline finds out once it is online.
 */
export function useOwnerOnly(
  role: (() => Promise<MemberRole | null>) | undefined,
  ready = true
): string | null {
  const [member, setMember] = useState(false);
  useEffect(() => {
    if (!role || !ready) return;
    let alive = true;
    role().then(
      (read) => {
        if (alive) setMember(read === "member");
      },
      // Not read: what was known before stands, and nothing known leaves the controls on.
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, [role, ready]);
  return member ? OWNER_ONLY : null;
}
