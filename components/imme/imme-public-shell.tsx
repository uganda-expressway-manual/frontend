"use client";

import { ReactNode } from "react";
import { SiteHeader } from "@/components/imme/site-header";

/**
 * Wraps the public IMME site pages in the public header.
 * The footer has been removed so the book homepage fills the full viewport.
 */
export function ImmePublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-visible">
      <SiteHeader />
      <main className="relative flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
