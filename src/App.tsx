import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewContext } from "./state/context";
import {
  exportSnapshot,
  parseSnapshot,
  useReviewStore,
} from "./state/store";
import { buildSeedState } from "./core/seed";
import { groupStatus, hitViews } from "./core/selectors";
import { Sidebar } from "./ui/Sidebar";
import { GroupDetail } from "./ui/GroupDetail";
import { IngestModal } from "./ui/IngestModal";
import { Modal } from "./ui/components";
import "./ui/styles.css";

export default function App() {
  const store = useReviewStore();
  const { state, undo, redo, canUndo, canRedo, reset } = store;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 选中的组被删除（合并）后自动切换到现存组
  useEffect(() => {
    const ids = Object.keys(state.groups);
    if (selectedId && !ids.includes(selectedId)) {
      setSelectedId(ids[0] ?? null);
    } else if (!selectedId && ids.length > 0) {
      setSelectedId(ids[0]);
    }
  }, [state.groups, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const stats = useMemo(() => {
    const groups = Object.values(state.groups);
    const byStatus = { resolved: 0, partial: 0, regressed: 0, failed: 0, stale: 0, pending: 0, open: 0 };
    let openHits = 0;
    for (const g of groups) {
      const s = groupStatus(state, g);
      byStatus[s] += 1;
      openHits += hitViews(state, g).filter((v) => v.status !== "passed").length;
    }
    return {
      pages: Object.keys(state.pages).length,
      instances: Object.keys(state.instances).length,
      hits: Object.keys(state.hits).length,
      groups: groups.length,
      byStatus,
      openHits,
    };
  }, [state]);

  const downloadSnapshot = useCallback(() => {
    const blob = new Blob([exportSnapshot(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accessreview-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const importSnapshot = async (file: File) => {
    try {
      const text = await file.text();
      const next = parseSnapshot(text);
      reset(next);
      setSelectedId(Object.keys(next.groups)[0] ?? null);
      setSnapshotError("");
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "快照解析失败");
    }
  };

  const loadSeed = () => {
    const seeded = buildSeedState(Date.now());
    reset(seeded);
    setSelectedId(Object.keys(seeded.groups)[0] ?? null);
  };

  const toggleMerge = (id: string) => {
    setMergeIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    );
  };

  const selectedGroup = selectedId ? state.groups[selectedId] : undefined;

  return (
    <ReviewContext.Provider value={store}>
      <div className="app">
        <header className="topbar">
          <h1>AccessReview</h1>
          <span className="sub">问题归并与修复验证台 · 纯本地运行</span>
          <div className="spacer" />
          <div className="toolgroup">
            <button onClick={() => setIngestOpen(true)} className="primary">
              ＋ 录入扫描结果
            </button>
            <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
              ↶ 撤销
            </button>
            <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
              ↷ 重做
            </button>
            <button onClick={downloadSnapshot} title="导出当前全部数据为 JSON 快照">
              导出快照
            </button>
            <button onClick={() => fileRef.current?.click()} title="从 JSON 快照恢复">
              导入快照
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importSnapshot(f);
                e.target.value = "";
              }}
            />
            <button className="danger" onClick={() => setConfirmReset(true)}>
              一键复位
            </button>
          </div>
        </header>

        <div className="stats">
          <span className="stat"><b>{stats.pages}</b>页面</span>
          <span className="stat"><b>{stats.instances}</b>组件实例</span>
          <span className="stat"><b>{stats.hits}</b>规则命中</span>
          <span className="stat"><b>{stats.groups}</b>修复组</span>
          <span className="stat" style={{ color: "var(--good)" }}><b>{stats.byStatus.resolved}</b>全部通过</span>
          <span className="stat" style={{ color: "var(--warn)" }}><b>{stats.byStatus.partial + stats.byStatus.stale}</b>部分通过/过期</span>
          <span className="stat" style={{ color: "var(--bad)" }}><b>{stats.byStatus.failed + stats.byStatus.regressed}</b>失败/回归</span>
          <span className="stat"><b>{stats.openHits}</b>条页面证据未关闭</span>
        </div>

        <div className="main">
          <Sidebar
            selectedId={selectedId}
            onSelect={setSelectedId}
            mergeIds={mergeIds}
            onToggleMerge={toggleMerge}
          />
          {selectedGroup ? (
            <GroupDetail
              group={selectedGroup}
              mergeIds={mergeIds}
              onClearMerge={() => setMergeIds([])}
            />
          ) : (
            <div className="detail">
              <div className="empty">
                <div className="big">✅</div>
                <p>当前没有修复组。</p>
                <p>
                  <button className="primary" onClick={() => setIngestOpen(true)}>
                    录入扫描结果
                  </button>{" "}
                  或{" "}
                  <button onClick={loadSeed}>载入示例数据</button>
                </p>
                <p className="hint">所有数据仅保存在本浏览器 localStorage，刷新自动恢复。</p>
              </div>
            </div>
          )}
        </div>

        {ingestOpen && <IngestModal onClose={() => setIngestOpen(false)} />}

        {confirmReset && (
          <Modal title="一键复位" onClose={() => setConfirmReset(false)}>
            <p>将清空本浏览器中的全部页面、实例、命中、修复组、候选与复验记录（含撤销历史）。此操作本身可以撤销。</p>
            <p className="hint">建议先「导出快照」留底。</p>
            <div className="actions">
              <button onClick={() => setConfirmReset(false)}>取消</button>
              <button
                className="danger"
                onClick={() => {
                  reset();
                  setSelectedId(null);
                  setMergeIds([]);
                  setConfirmReset(false);
                }}
              >
                确认清空
              </button>
            </div>
          </Modal>
        )}

        {snapshotError && (
          <Modal title="快照导入失败" onClose={() => setSnapshotError("")}>
            <div className="note bad">{snapshotError}</div>
            <div className="actions">
              <button onClick={() => setSnapshotError("")}>知道了</button>
            </div>
          </Modal>
        )}
      </div>
    </ReviewContext.Provider>
  );
}
