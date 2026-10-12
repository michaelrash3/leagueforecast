/**
 * Who may use the cloud copy: the list `firestore.rules` reads, one document per Google account
 * under `members/{address}`, named by the account's address in lower case.
 *
 * The owner's own entry, `{ role: "owner" }`, is made once by hand in the Firebase console, and the
 * app never changes it, so no click can lock the owner out. Every other entry is
 * `{ role: "member", addedAt }`, added and taken off by the owner from the cloud panel.
 */

export type MemberRole = "owner" | "member";

export type Member = {
  /** The account's address, in lower case: the entry's document id. */
  address: string;
  role: MemberRole;
  /** When the owner added it, as an ISO instant; the owner's own entry has none. */
  addedAt?: string;
};

/** The collection the list is kept in. */
export const MEMBERS = "members";

/**
 * An address as the list names it. Google hands an address back in whatever case the account was
 * made in, and the rules compare it in lower case.
 */
export const memberAddress = (raw: string): string => raw.trim().toLowerCase();

/**
 * Whether `address` can name an entry: something, an at sign, something, with no space. A slash
 * cannot be in a document's id at all. Not a check that the account exists; Google's sign-in is.
 */
export const isMemberAddress = (address: string): boolean => /^[^@\s/]+@[^@\s/]+$/.test(address);

/** One entry as Firestore hands it back, or null for one the app cannot read. */
export const coerceMember = (address: string, raw: unknown): Member | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const { role, addedAt } = raw as { role?: unknown; addedAt?: unknown };
  if (role !== "owner" && role !== "member") return null;
  return { address, role, ...(typeof addedAt === "string" ? { addedAt } : {}) };
};

/** The owner first, then everyone else by address. */
export const sortMembers = (members: readonly Member[]): Member[] =>
  [...members].sort((a, b) =>
    a.role !== b.role
      ? a.role === "owner"
        ? -1
        : 1
      : a.address < b.address
        ? -1
        : a.address > b.address
          ? 1
          : 0
  );
