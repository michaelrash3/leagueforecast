import { useEffect, useId, useState, type FormEvent } from "react";
import { isMemberAddress, memberAddress, type Member } from "../lib/cloud/members";
import { button } from "../styles/tokens";

/** What the list is read and changed through: the cloud session's calls, but for a test. */
export type MembersApi = {
  /** The list, for its owner; null for anyone else. */
  list: () => Promise<Member[] | null>;
  add: (address: string) => Promise<void>;
  remove: (address: string) => Promise<void>;
  /** What to say about a call that failed. */
  message: (error: unknown) => string;
};

/**
 * Who may use the cloud copy, in its panel: drawn for the owner alone, the only account the rules
 * let read the list (`firestore.rules`). The owner adds an account by the address it signs in to
 * Google with and takes one off with a click; the owner's own entry has no button, since it is
 * made and changed only in the Firebase console, so no click here can lock the owner out.
 */
export function CloudMembers({ api }: { api: MembersApi }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const headingId = useId();
  const inputId = useId();

  useEffect(() => {
    let live = true;
    api.list().then(
      (list) => {
        if (live) setMembers(list);
      },
      () => {
        // Not the owner's to see, or not reachable now: nothing is drawn, as for anyone else.
        if (live) setMembers(null);
      }
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!members) return null;

  /** Runs one change, then reads the list again, so what is drawn is what the cloud holds. */
  const change = async (work: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      setMembers(await api.list());
      return true;
    } catch (error) {
      setProblem(api.message(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const address = memberAddress(draft);
    if (!isMemberAddress(address)) {
      setProblem("Type the email address the account signs in to Google with.");
      return;
    }
    if (members.some((member) => member.address === address)) {
      setProblem(`${address} is already on the list.`);
      return;
    }
    if (await change(() => api.add(address))) setDraft("");
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-black text-slate-950 dark:text-slate-100">
        Who can use the cloud copy
      </h3>
      <p className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">
        Only the Google accounts on this list can open the cloud copy or change it. Anyone else
        signing in is turned away, and keeps using the app with the data in their own browser.
      </p>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.address}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
          >
            <span className="min-w-0 break-all text-sm font-semibold text-slate-700 dark:text-slate-200">
              {member.address}
              <span className="ml-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {member.role === "owner" ? "Owner" : "Member"}
              </span>
            </span>
            {member.role === "member" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void change(() => api.remove(member.address))}
                aria-label={`Take ${member.address} off the list`}
                className={button.ghost}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        noValidate
        onSubmit={(event) => void add(event)}
        className="flex flex-wrap items-end gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Google account to add
        </label>
        <input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="name@gmail.com"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
        />
        <button type="submit" disabled={busy || !draft.trim()} className={button.dark}>
          Add
        </button>
      </form>
      {problem && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          {problem}
        </p>
      )}
    </section>
  );
}
