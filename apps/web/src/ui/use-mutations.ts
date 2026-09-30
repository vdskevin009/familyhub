import { useRef, useState } from "react";
import { MutationQueue, type MutationProgress } from "./mutation-queue";

export function useMutations(callbacks: {
  refresh: () => Promise<void>; saved: (count: number) => void; error: (message: string) => void;
}) {
  const current = useRef(callbacks); current.current = callbacks;
  const [pending, setPending] = useState<MutationProgress[]>([]);
  const [queue] = useState(() => new MutationQueue({
    change: setPending,
    refresh: () => current.current.refresh(),
    saved: count => current.current.saved(count),
    error: message => current.current.error(message)
  }));
  return { pending, queue, pendingFor: (key: string) => pending.find(item => item.key === key) };
}
