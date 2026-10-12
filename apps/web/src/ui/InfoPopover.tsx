import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Info, X } from "lucide-react";
import "./compact.css";

/** A small native modal: Escape, focus containment and an explicit return to its trigger. */
export function CompactDialog({ open, onClose, title, children, anchor, id }: {
    open: boolean; onClose: () => void; title: string; children: ReactNode;
    anchor: RefObject<HTMLButtonElement | null>; id: string;
}) {
    const ref = useRef<HTMLDialogElement>(null), titleId = useId();
    useLayoutEffect(() => {
        const dialog = ref.current;
        if (!open || !dialog) return;
        const previousOverflow = document.body.style.overflow;
        dialog.showModal(); document.body.style.overflow = "hidden";
        const position = () => {
            const trigger = anchor.current?.getBoundingClientRect(), box = dialog.getBoundingClientRect();
            dialog.style.left = Math.max(12, Math.min(trigger?.left ?? 12, window.innerWidth - box.width - 12)) + "px";
            dialog.style.top = Math.max(12, Math.min((trigger?.bottom ?? 12) + 8, window.innerHeight - box.height - 12)) + "px";
        };
        const observer = new ResizeObserver(position);
        observer.observe(dialog); position(); window.addEventListener("resize", position);
        return () => {
            observer.disconnect(); window.removeEventListener("resize", position); dialog.close();
            document.body.style.overflow = previousOverflow;
            if (anchor.current?.isConnected) anchor.current.focus({ preventScroll: true });
        };
    }, [open, anchor]);
    return <dialog id={id} ref={ref} className="compact-dialog" aria-labelledby={titleId}
        onCancel={e => { e.preventDefault(); e.stopPropagation(); onClose(); }}
        onKeyDown={e => {
            if (e.key !== "Tab") return;
            const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter(c => c.getClientRects().length > 0);
            const first = controls[0], last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}
        onClick={e => {
            if (e.target !== e.currentTarget) return;
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
        }}>
        <header><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={"Fermer : " + title}><X size={18} aria-hidden="true" /></button></header>
        <div className="compact-dialog-content">{children}</div>
    </dialog>;
}

export default function InfoPopover({ title, children }: { title: string; children: ReactNode }) {
    const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null), id = useId();
    return <><button ref={anchor} type="button" className="icon-button info-trigger" aria-label={"Informations : " + title} aria-haspopup="dialog" aria-controls={id} aria-expanded={open} onClick={() => setOpen(true)}><Info size={18} aria-hidden="true" /></button>
        <CompactDialog id={id} open={open} onClose={() => setOpen(false)} title={title} anchor={anchor}>{children}</CompactDialog></>;
}
