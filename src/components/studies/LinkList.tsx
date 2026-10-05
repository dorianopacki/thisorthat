import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Copy } from "lucide-react";

interface Props {
  urls: string[];
}

type CopyTarget = "all" | number;

const COPIED_MS = 2000;

export default function LinkList({ urls }: Props) {
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      window.clearTimeout(timer.current);
    };
  }, []);

  async function copy(text: string, target: CopyTarget) {
    window.clearTimeout(timer.current);
    try {
      // Throws when the Clipboard API is unavailable (e.g. insecure context) or permission is denied.
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopied(target);
      timer.current = window.setTimeout(() => {
        setCopied(null);
      }, COPIED_MS);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => {
          void copy(urls.join("\n"), "all");
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        {copied === "all" ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copied === "all" ? "Skopiowano" : "Kopiuj wszystkie"}
      </button>

      {copyFailed && (
        <p
          className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          <CircleAlert className="size-4 shrink-0" />
          Nie udało się skopiować do schowka. Zaznacz link ręcznie i skopiuj go.
        </p>
      )}

      <ol className="space-y-2">
        {urls.map((url, index) => (
          <li
            key={url}
            className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm"
          >
            <span className="w-6 shrink-0 text-xs text-blue-100/60">{index + 1}.</span>
            <span className="min-w-0 flex-1 font-mono text-xs break-all select-all">{url}</span>
            <button
              type="button"
              onClick={() => {
                void copy(url, index);
              }}
              className="flex shrink-0 items-center gap-1 text-xs text-purple-300 transition-colors hover:text-purple-100"
              aria-label={`Kopiuj link ${String(index + 1)}`}
            >
              {copied === index ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied === index ? "Skopiowano" : "Kopiuj"}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
