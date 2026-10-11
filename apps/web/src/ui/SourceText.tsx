import type { ReactNode } from "react";

/** Stored research stays plain text; only explicit HTTP(S) Markdown links become anchors. No HTML execution. */
export default function SourceText({ text }: { text: string }) {
    const parts: ReactNode[] = []; let previous = 0;
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi)) {
        parts.push(text.slice(previous, match.index));
        try {
            const url = new URL(match[2]);
            parts.push(<a key={match.index} href={url.href} target="_blank" rel="noreferrer">{match[1]}</a>);
        } catch { parts.push(match[0]); }
        previous = match.index! + match[0].length;
    }
    parts.push(text.slice(previous));
    return <p className="source-text">{parts}</p>;
}
