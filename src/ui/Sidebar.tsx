import { useStore } from "../state/context";
import { groupStatus, hitViews, countByStatus } from "../core/selectors";
import type { FixGroup } from "../core/types";
import { StatusBadge } from "./components";

export function Sidebar({
  selectedId,
  onSelect,
  mergeIds,
  onToggleMerge,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  mergeIds: string[];
  onToggleMerge: (id: string) => void;
}) {
  const { state } = useStore();
  const groups = Object.values(state.groups).sort((a, b) => {
    const rank = { regressed: 0, failed: 1, stale: 2, partial: 3, pending: 4, open: 5, resolved: 6 } as const;
    return rank[groupStatus(state, a)] - rank[groupStatus(state, b)] || a.createdAt - b.createdAt;
  });

  if (groups.length === 0) {
    return (
      <div className="sidebar">
        <div className="empty">
          <div className="big">🗂️</div>
          还没有修复组。<br />点击右上角「录入扫描结果」开始。
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="kv" style={{ margin: "2px 4px 8px" }}>
        {groups.length} 个修复组 · 勾选多个组可合并
      </div>
      {groups.map((g) => (
        <GroupCard
          key={g.id}
          group={g}
          selected={g.id === selectedId}
          checked={mergeIds.includes(g.id)}
          onSelect={() => onSelect(g.id)}
          onToggle={() => onToggleMerge(g.id)}
        />
      ))}
    </div>
  );
}

function GroupCard({
  group,
  selected,
  checked,
  onSelect,
  onToggle,
}: {
  group: FixGroup;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { state } = useStore();
  const status = groupStatus(state, group);
  const counts = countByStatus(hitViews(state, group));
  const pages = new Set(
    group.hitIds.map((id) => {
      const hit = state.hits[id];
      return state.instances[hit.instanceId]?.pageId;
    })
  );

  return (
    <div className={`group-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        title="勾选以合并修复组"
      />
      <div className="body">
        <div className="title">{group.title}</div>
        <div className="meta">
          {pages.size} 个页面 · {group.hitIds.length} 条证据
          {group.manual && <> · <span className="badge manual">手工组</span></>}
        </div>
        <div className="meta" style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusBadge status={status} />
          {counts.passed > 0 && <span className="count-chip">✓ {counts.passed}</span>}
          {counts.failed > 0 && <span className="count-chip" style={{ color: "var(--bad)" }}>✗ {counts.failed}</span>}
          {counts.regressed > 0 && <span className="count-chip" style={{ color: "var(--bad)" }}>↺ {counts.regressed}</span>}
          {counts.stale > 0 && <span className="count-chip" style={{ color: "var(--warn)" }}>⏱ {counts.stale}</span>}
          {counts.pending > 0 && <span className="count-chip">… {counts.pending}</span>}
        </div>
      </div>
    </div>
  );
}
