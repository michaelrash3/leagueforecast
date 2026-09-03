import { useEffect, useRef, useState } from "react";

type TeamNameComboboxProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
};

/**
 * A previously-added team name needs to reliably show up again for future games — native
 * `<input list>` + `<datalist>` technically does this, but datalist suggestions are notoriously
 * unreliable on iOS Safari (often not shown at all), which is exactly where this app gets used
 * most. This is a small custom dropdown instead: pure React state, so it behaves identically on
 * every browser, while still allowing a brand-new name to be typed freely.
 */
export function TeamNameCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  className,
}: TeamNameComboboxProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const query = value.trim().toLowerCase();
  const matches = options
    .filter((name) => !query || name.toLowerCase().includes(query))
    .sort((a, b) => a.localeCompare(b));
  const listboxId = `${id}-listbox`;

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          {matches.map((name) => (
            <li key={name} role="option" aria-selected={name === value}>
              <button
                type="button"
                onMouseDown={(event) => {
                  // Fires before the input's blur, so the click registers before the list closes.
                  event.preventDefault();
                  onChange(name);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
