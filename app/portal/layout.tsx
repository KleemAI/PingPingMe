"use client";

import { StoreProvider } from "@/lib/client/store";
import PortalShell from "@/components/PortalShell";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider expect="reseller">
      <PortalShell>{children}</PortalShell>
    </StoreProvider>
  );
}
