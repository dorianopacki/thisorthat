import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /** Extra pending flag for native form POSTs, which `useFormStatus` does not track. */
  pending?: boolean;
  /** Disables the button without showing the pending state (e.g. nothing selected yet). */
  disabled?: boolean;
}

export function SubmitButton({
  pendingText,
  icon,
  children,
  pending: externalPending = false,
  disabled = false,
}: SubmitButtonProps) {
  const { pending: formPending } = useFormStatus();
  const pending = formPending || externalPending;

  return (
    <Button type="submit" disabled={pending || disabled} className="w-full rounded-lg">
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="border-primary-foreground/30 border-t-primary-foreground size-4 animate-spin rounded-full border-2" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
