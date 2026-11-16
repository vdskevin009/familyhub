import { useEffect, useRef } from "react";

/** One same-URL history entry per finance panel. Browser Back closes the panel first. */
export function useFinanceDialogHistory(open: boolean, close: () => void | boolean) {
  const callback = useRef(close); callback.current = close;
  useEffect(() => {
    if (!open) return;
    const token = crypto.randomUUID(), previous = history.state, url = location.href;
    history.pushState({ ...previous, financeDialog: token }, "", location.href);
    const onBack = () => {
      if (history.state?.financeDialog !== token && callback.current() === false) {
        history.pushState({ ...previous, financeDialog: token }, "", url);
      }
    };
    window.addEventListener("popstate", onBack);
    return () => {
      window.removeEventListener("popstate", onBack);
      if (history.state?.financeDialog === token && location.href === url) history.back();
    };
  }, [open]);
}
