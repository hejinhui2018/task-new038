/** 全局状态 / 撤销重做 */
import type { AppState } from "./types";

export const HISTORY_LIMIT = 100;

export interface History {
  past: AppState[];
  present: AppState;
  future: AppState[];
}

export function initHistory(present: AppState): History {
  return { past: [], present, future: [] };
}

export function commit(h: History, next: AppState): History {
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: next, future: [] };
}

export function undo(h: History): History {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
  };
}

export function redo(h: History): History {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return {
    past: [...h.past, h.present],
    present: next,
    future: rest,
  };
}
