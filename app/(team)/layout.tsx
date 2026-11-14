"use client";

import { StoreProvider } from "@/lib/client/store";
import TeamShell from "@/components/TeamShell";

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider expect="team">
      <TeamShell>{children}</TeamShell>
    </StoreProvider>
  );
}
