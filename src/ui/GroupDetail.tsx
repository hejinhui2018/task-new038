import { useMemo, useState } from "react";
import { useStore } from "../state/context";
import {
  affectedPages,
  countByStatus,
  explainMerge,
  explainSplit,
  explainVerification,
  explainVersionChange,
  groupStatus,
  hitPage,
  hitStatus,
  hitViews,
  latestCandidate,
  latestVerification,
} from "../core/selectors";
import type { FixGroup, ImpactNote } from "../core/types";
import { HitStatusBadge, Modal, Note, StatusBadge } from "./components";

export function GroupDetail({
  group,
  mergeIds,
  onClearMerge,
}: {
  group: FixGroup;
  mergeIds: string[];
  onClearMerge: () => void;
}) {
  const { state, dispatch } = useStore();
  const [fixTitle, setFixTitle] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ImpactNote | null>(null);
  const [versionDraft, setVersionDraft] = useState<Record<string, string>>({});

  const candidate = latestCandidate(state, group.id);
  const status = groupStatus(state, group);
  const views = hitViews(state, group);
  const counts = countByStatus(views);
  const verNote = useMemo(
    () => explainVerification(state, group.id),
    [state, group.id]
  );

  const submitFix = () => {
    if (!fixTitle.trim()) return;
    dispatch({
      type: "SUBMIT_CANDIDATE",
      groupId: group.id,
      title: fixTitle.trim(),
      now: Date.now(),
    });
    setFixTitle("");
  };

  const verify = (hitId: string, verdict: "pass" | "fail") => {
    if (!candidate) return;
    dispatch({ type: "VERIFY", candidateId: candidate.id, hitId, verdict, now: Date.now() });
  };

  const doSplit = () => {
    dispatch({
      type: "SPLIT_GROUP",
      groupId: group.id,
      movingHitIds: [...picked],
      now: Date.now(),
    });
    setSplitMode(false);
    setPicked(new Set());
    setPreview(null);
  };

  const togglePick = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    if (next.size === 0 || next.size === group.hitIds.length) {
      setPreview(null);
    } else {
      setPreview(explainSplit(state, group.id, [...next]));
    }
  };

  const mergeWithOthers = mergeIds.filter((id) => id !== group.id);
  const mergePreview =
    mergeWithOthers.length > 0
      ? explainMerge(state, [group.id, ...mergeWithOthers])
      : null;

  const doMerge = () => {
    dispatch({ type: "MERGE_GROUPS", groupIds: [group.id, ...mergeWithOthers], now: Date.now() });
    onClearMerge();
  };

  return (
    <div className="detail">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2>{group.title}</h2>
        <StatusBadge status={status} />
        {group.manual ? <span className="badge manual">手工组</span> : <span className="badge open">自动归并</span>}
      </div>
      <div className="hint kv sig" style={{ marginTop: 4 }}>
        归并键 signature：{group.signature ?? <em>null（手工组，不再自动吸纳新命中）</em>}
      </div>

      <Note note={verNote} />
      {mergePreview && (
        <>
          <Note note={mergePreview} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={doMerge}>
              确认合并 {mergeIds.length} 个组
            </button>
            <button onClick={onClearMerge}>取消勾选</button>
          </div>
        </>
      )}

      {/* 修复候选 */}
      <div className="section">
        <h3>① 提交修复候选</h3>
        {candidate ? (
          <div>
            当前候选：<b>{candidate.title}</b>
            <span className="kv">（{new Date(candidate.createdAt).toLocaleString()} 提交）</span>
            <div className="kv" style={{ marginTop: 4 }}>
              同一组可再次提交候选以开启新一轮修复尝试；旧候选的复验记录保留备查，不再驱动判定。
            </div>
          </div>
        ) : (
          <div className="kv">还没有修复候选，组内命中处于「未开始」。提交候选后才能逐页复验。</div>
        )}
        <div className="inline-form" style={{ marginTop: 10 }}>
          <div style={{ flex: 2 }}>
            <input
              value={fixTitle}
              onChange={(e) => setFixTitle(e.target.value)}
              placeholder={candidate ? "提交新的修复候选（将开启新一轮复验）" : "修复说明，如：Button 增加 aria-label 回退"}
              onKeyDown={(e) => e.key === "Enter" && submitFix()}
            />
          </div>
          <button className="primary" onClick={submitFix} disabled={!fixTitle.trim()}>
            {candidate ? "提交新候选" : "提交候选"}
          </button>
        </div>
      </div>

      {/* 页面证据 + 逐页复验 */}
      <div className="section">
        <h3>
          ② 分页面重新验证
          <span className="kv">
            通过 {counts.passed} · 失败 {counts.failed} · 回归 {counts.regressed} · 过期{" "}
            {counts.stale} · 待验 {counts.pending}
          </span>
        </h3>
        <div className="kv" style={{ marginBottom: 8 }}>
          每条证据属于独立页面实例；只有全部页面在当前版本通过，修复组才会关闭。重复验证会追加快照，以最新结果为准。
        </div>
        <table className="hits">
          <thead>
            <tr>
              {splitMode && <th style={{ width: 30 }}></th>}
              <th>页面 / 实例</th>
              <th>证据（采集版本）</th>
              <th>当前版本</th>
              <th>状态 / 最新复验</th>
              <th style={{ width: 170 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {views.map(({ hit, status: hs, latestVerification: lv }) => {
              const inst = state.instances[hit.instanceId];
              const page = hitPage(state, hit.id);
              const versionChanged = lv?.verdict === "pass" && lv.instanceVersion !== inst.version;
              return (
                <tr key={hit.id}>
                  {splitMode && (
                    <td>
                      <input
                        type="checkbox"
                        checked={picked.has(hit.id)}
                        onChange={() => togglePick(hit.id)}
                      />
                    </td>
                  )}
                  <td>
                    <b>{page?.name}</b>
                    <div className="kv">{page?.url}</div>
                    <code>{inst.componentName}</code> <span className="kv">{inst.selector}</span>
                  </td>
                  <td>
                    <code className="snippet">{hit.evidence.snippet}</code>
                    <span className="kv">证据采集于 {hit.evidence.codeVersion}</span>
                  </td>
                  <td>
                    <VersionEditor
                      instanceId={inst.id}
                      version={inst.version}
                      draft={versionDraft[inst.id] ?? ""}
                      onDraft={(v) => setVersionDraft((d) => ({ ...d, [inst.id]: v }))}
                    />
                  </td>
                  <td>
                    <HitStatusBadge status={hs} />
                    {lv && (
                      <div className="kv" style={{ marginTop: 4 }}>
                        {lv.verdict === "pass" ? "✓" : "✗"} {new Date(lv.checkedAt).toLocaleString()}
                        <div>
                          复验版本：
                          <span className={versionChanged ? "ver-old" : "ver-now"}>
                            {lv.instanceVersion}
                          </span>
                          {versionChanged && " ← 已过期"}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    {candidate ? (
                      <div className="row-actions">
                        <button
                          className="tiny good"
                          onClick={() => verify(hit.id, "pass")}
                          title="该页面在当前版本验证通过"
                        >
                          通过
                        </button>
                        <button className="tiny bad" onClick={() => verify(hit.id, "fail")}>
                          失败
                        </button>
                      </div>
                    ) : (
                      <span className="kv">先提交候选</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 复验历史 */}
      <VerificationHistory group={group} />

      {/* 拆分 */}
      <div className="section">
        <h3>③ 归并纠错：拆分修复组</h3>
        {!splitMode ? (
          <div>
            <div className="kv" style={{ marginBottom: 8 }}>
              如果这些命中并非同一组件根因，可把部分页面证据拆成独立手工组。候选与复验记录留在原组。
            </div>
            <button onClick={() => setSplitMode(true)} disabled={group.hitIds.length < 2}>
              进入拆分选择
            </button>
          </div>
        ) : (
          <div>
            <div className="kv" style={{ marginBottom: 8 }}>
              勾选要拆出的页面证据（{picked.size}/{group.hitIds.length}）。不能拆空任一侧。
            </div>
            {preview && <Note note={preview} />}
            <div className="row-actions">
              <button
                className="primary"
                disabled={picked.size === 0 || picked.size === group.hitIds.length}
                onClick={doSplit}
              >
                确认拆出 {picked.size} 条
              </button>
              <button
                onClick={() => {
                  setSplitMode(false);
                  setPicked(new Set());
                  setPreview(null);
                }}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VersionEditor({
  instanceId,
  version,
  draft,
  onDraft,
}: {
  instanceId: string;
  version: string;
  draft: string;
  onDraft: (v: string) => void;
}) {
  const { state, dispatch } = useStore();
  const [pendingNote, setPendingNote] = useState<ImpactNote | null>(null);
  const changed = draft.trim() && draft.trim() !== version;

  const apply = () => {
    const next = draft.trim();
    if (!next || next === version) return;
    // 先计算影响范围说明（基于旧状态），再执行换版
    setPendingNote(explainVersionChange(state, instanceId, next));
    dispatch({ type: "CHANGE_INSTANCE_VERSION", instanceId, version: next });
    onDraft("");
  };

  return (
    <div>
      <div className="mono ver-now">{version}</div>
      <div className="inline-form" style={{ marginTop: 4 }}>
        <input
          style={{ padding: "3px 6px", fontSize: 12 }}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="新版本号"
        />
        <button className="tiny" disabled={!changed} onClick={apply}>
          换版
        </button>
      </div>
      {pendingNote && (
        <div style={{ marginTop: 6 }}>
          <Note note={pendingNote} />
          <button className="tiny ghost" onClick={() => setPendingNote(null)}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}

function VerificationHistory({ group }: { group: FixGroup }) {
  const { state } = useStore();
  const candidate = latestCandidate(state, group.id);
  const records = state.verifications
    .filter((v) => group.hitIds.includes(v.hitId))
    .sort((a, b) => b.checkedAt - a.checkedAt);

  if (records.length === 0) return null;

  return (
    <div className="section">
      <h3>验证快照历史（{records.length}）</h3>
      <div className="history-list">
        {records.slice(0, 30).map((r) => {
          const page = state.pages[r.pageId];
          const isCurrent = r.candidateId === candidate?.id;
          return (
            <div key={r.id} className="item">
              <span style={{ color: r.verdict === "pass" ? "var(--good)" : "var(--bad)" }}>
                {r.verdict === "pass" ? "✓ 通过" : "✗ 失败"}
              </span>{" "}
              · {page?.name ?? r.pageId} · 复验版本 <code>{r.instanceVersion}</code> ·{" "}
              {new Date(r.checkedAt).toLocaleString()}
              {!isCurrent && <span className="kv">（旧候选记录，仅供溯源）</span>}
            </div>
          );
        })}
        {records.length > 30 && <div className="kv">…其余 {records.length - 30} 条已折叠</div>}
      </div>
    </div>
  );
}
