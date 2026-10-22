"use client";

import { createContext, useContext, useMemo } from "react";
import { DEFAULT_FORMAT, makeFormatters, type Formatters, type OrgFormat } from "@/lib/brand/format";

const FormatContext = createContext<OrgFormat>(DEFAULT_FORMAT);

/** Gives client components the company's currency, locale and timezone. */
export function FormatProvider({ format, children }: { format: OrgFormat; children: React.ReactNode }) {
  return <FormatContext.Provider value={format}>{children}</FormatContext.Provider>;
}

export function useFormat(): Formatters {
  const format = useContext(FormatContext);
  return useMemo(() => makeFormatters(format), [format]);
}
