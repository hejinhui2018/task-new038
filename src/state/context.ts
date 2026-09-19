import { createContext, useContext } from "react";
import type { ReviewStore } from "./store";

export const ReviewContext = createContext<ReviewStore | null>(null);

export function useStore(): ReviewStore {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("ReviewContext missing");
  return ctx;
}
