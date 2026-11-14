"use client";

import { Suspense } from "react";
import Inbox from "@/components/Inbox";

export default function Page() {
  return (
    <Suspense>
      <Inbox kind="customer" />
    </Suspense>
  );
}
