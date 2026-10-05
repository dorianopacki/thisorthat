import { CircleAlert, Trash } from "lucide-react";
import { cn } from "@/lib/utils";

interface VariantFieldProps {
  id: string;
  index: number;
  value: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  error?: string;
}

export function VariantField({ id, index, value, onChange, onRemove, canRemove, error }: VariantFieldProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={id} className="block text-sm text-blue-100/80">
          Wariant {index + 1}
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="flex items-center gap-1 text-xs text-purple-300 transition-colors hover:text-purple-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-purple-300"
          aria-label={`Usuń wariant ${String(index + 1)}`}
        >
          <Trash className="size-3" />
          Usuń
        </button>
      </div>
      <textarea
        id={id}
        name="variant"
        rows={3}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder="Treść wariantu"
        className={cn(
          "w-full rounded-lg border bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:outline-none",
          error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
        )}
      />
      {error && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
