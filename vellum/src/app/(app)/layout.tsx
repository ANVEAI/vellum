import type { ReactNode } from "react";
import { ThemeModeProvider } from "@/components/ui/theme-mode";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/primitives";
import { CommandProvider } from "@/components/ui/command-palette";

/**
 * Shell for every signed-in screen: appearance, toasts, the confirm dialog
 * and the ⌘K palette live here so no screen re-implements them.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeModeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <CommandProvider>{children}</CommandProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeModeProvider>
  );
}
