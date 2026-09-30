import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Search, SlidersHorizontal, X } from "lucide-react";

/** Native modal semantics supply focus containment, Escape and focus restoration. */
export function Sheet({ open, onClose, title, description, children, footer, wide = false }: {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) { if (dialog.open) dialog.close(); return; }
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [open]);
  return <dialog ref={ref} className={`app-sheet${wide ? " wide" : ""}`} aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
        .filter(control => control.getClientRects().length > 0 && getComputedStyle(control).visibility !== "hidden");
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }}
    onClick={event => { if (event.target === event.currentTarget) {
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    } }}>
    <header className="sheet-header"><div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={20} /></button>
    </header>
    <div className="sheet-content">{open ? children : null}</div>
    {footer && <footer className="sheet-footer">{footer}</footer>}
  </dialog>;
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return <header className="page-heading"><div className="page-heading-copy"><h1>{title}</h1>{subtitle && <div className="page-subtitle">{subtitle}</div>}</div>{children && <div className="page-heading-actions">{children}</div>}</header>;
}

export function SearchField({ value, onChange, placeholder = "Search", label = "Search", id }: {
  value: string; onChange: (value: string) => void; placeholder?: string; label?: string; id?: string;
}) {
  return <div className="search-field"><Search size={18} aria-hidden="true" />
    <input id={id} type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={label} />
    {value && <button type="button" className="search-clear" onClick={() => onChange("")} aria-label={`Clear ${label.toLowerCase()}`}><X size={16} /></button>}
  </div>;
}

export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return <button type="button" className="button secondary filter-button" onClick={onClick} aria-haspopup="dialog" aria-label={`Filters${count ? `, ${count} active` : ""}`}>
    <SlidersHorizontal size={18} /><span>Filters</span>{count > 0 && <span className="count-badge">{count}</span>}
  </button>;
}

export type ActiveFilter = { id: string; label: string; clear: () => void };
export function FilterChips({ filters, onReset }: { filters: ActiveFilter[]; onReset: () => void }) {
  if (!filters.length) return null;
  return <div className="active-filters" aria-label="Active filters">{filters.map(filter =>
    <button type="button" className="active-filter" key={filter.id} onClick={filter.clear} aria-label={`Remove filter: ${filter.label}`}>{filter.label}<X size={13} aria-hidden="true" /></button>)}
    {filters.length > 1 && <button type="button" className="text-action filter-reset" onClick={onReset}>Reset</button>}
  </div>;
}

export function Notice({ children, error = false, onDismiss }: { children: ReactNode; error?: boolean; onDismiss?: () => void }) {
  return <div className={`app-notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
    {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{children}</span>
    {onDismiss && <button type="button" className="icon-button subtle" onClick={onDismiss} aria-label="Dismiss message"><X size={16} /></button>}
  </div>;
}

export function SkeletonList({ label = "Loading saved results" }: { label?: string }) {
  return <div className="skeleton-list" role="status" aria-label={label}><span className="sr-only">{label}</span>{[0, 1, 2].map(index => <div className="skeleton-card" key={index}><i /><i /><i /></div>)}</div>;
}

/** UI preferences only. Does not migrate or overwrite any household data store. */
export function useSessionValue<T>(key: string, fallback: T, valid?: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = sessionStorage.getItem(`familyhub.ui.${key}`); const parsed: unknown = raw ? JSON.parse(raw) : fallback;
      return !valid || valid(parsed) ? parsed as T : fallback;
    } catch { return fallback; }
  });
  useEffect(() => { try { sessionStorage.setItem(`familyhub.ui.${key}`, JSON.stringify(value)); } catch { /* Storage may be disabled. */ } }, [key, value]);
  return [value, setValue] as const;
}
