"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/client/store";

/** Customer-only pages (catalogue, chat with us, my requests). The team and resellers have their own. */
export default function CustomerPagesLayout({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const router = useRouter();
  const other = state && state.scope !== "customer" ? state.scope : null;
  useEffect(() => { if (other) router.replace(other === "team" ? "/" : "/portal"); }, [other, router]);
  if (!state || other) return null;
  return <>{children}</>;
}
