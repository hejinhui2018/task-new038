import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cloneState,
  emptyState,
  reducer,
  type Action,
  type AppState,
} from "../core/reducer";
import {
  commit as historyCommit,
  initHistory,
  redo as historyRedo,
  undo as historyUndo,
  type History,
} from "../core/history";

const STORAGE_KEY = "accessreview.state.v1";

interface PersistedShape {
  version: 1;
  savedAt: number;
  state: AppState;
}

function loadInitial(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed.version !== 1 || !parsed.state) return emptyState;
    return sanitize(parsed.state);
  } catch {
    return emptyState;
  }
}

/** 导入/恢复前的最小结构校验，避免坏快照把应用弄崩 */
export function sanitize(input: unknown): AppState {
  if (!input || typeof input !== "object") throw new Error("快照不是对象");
  const s = input as Record<string, unknown>;
  const required = ["pages", "instances", "hits", "groups", "candidates"];
  for (const key of required) {
    if (!s[key] || typeof s[key] !== "object") {
      throw new Error(`快照缺少字段：${key}`);
    }
  }
  if (!Array.isArray(s.verifications)) throw new Error("快照缺少字段：verifications");
  return cloneState(input as AppState);
}

export function exportSnapshot(state: AppState): string {
  const payload: PersistedShape = {
    version: 1,
    savedAt: Date.now(),
    state,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseSnapshot(text: string): AppState {
  const parsed = JSON.parse(text) as PersistedShape;
  if (parsed.version !== 1 || !parsed.state) {
    throw new Error("无法识别的快照格式");
  }
  return sanitize(parsed.state);
}

export function useReviewStore() {
  const [history, setHistory] = useState<History>(() =>
    initHistory(loadInitial())
  );

  // 刷新恢复：present 变化即写入 localStorage（撤销/重做同样被持久化）
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: Date.now(), state: history.present } satisfies PersistedShape)
    );
  }, [history.present]);

  const dispatch = useCallback((action: Action) => {
    setHistory((h) => {
      const next = reducer(h.present, action);
      if (next === h.present) return h;
      return historyCommit(h, next);
    });
  }, []);

  // 多个动作合并为一次历史提交（如一次扫描录入同时新增页面/实例/命中）
  const dispatchMany = useCallback((actions: Action[]) => {
    setHistory((h) => {
      let next = h.present;
      for (const action of actions) next = reducer(next, action);
      if (next === h.present) return h;
      return historyCommit(h, next);
    });
  }, []);

  const undo = useCallback(() => setHistory((h) => historyUndo(h)), []);
  const redo = useCallback(() => setHistory((h) => historyRedo(h)), []);

  const reset = useCallback((next?: AppState) => {
    setHistory((h) =>
      historyCommit(h, next ? cloneState(next) : emptyState)
    );
  }, []);

  return useMemo(
    () => ({
      state: history.present,
      dispatch,
      dispatchMany,
      undo,
      redo,
      reset,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    }),
    [history, dispatch, dispatchMany, undo, redo, reset]
  );
}

export type ReviewStore = ReturnType<typeof useReviewStore>;
