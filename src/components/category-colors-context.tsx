"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CategoryColors } from "@/lib/category-colors";

/** The user's category colours, provided once by the dashboard for every row's dot. */
const CategoryColorsContext = createContext<CategoryColors>({});

export function CategoryColorsProvider({ value, children }: { value: CategoryColors; children: ReactNode }) {
  return <CategoryColorsContext.Provider value={value}>{children}</CategoryColorsContext.Provider>;
}

export function useCategoryColors(): CategoryColors {
  return useContext(CategoryColorsContext);
}
