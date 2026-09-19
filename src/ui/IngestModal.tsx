import { useState } from "react";
import { useStore } from "../state/context";
import { Modal } from "./components";
import type { Severity } from "../core/types";
import { uid } from "../core/id";

/** 一次扫描录入：可同时登记页面（或选择已有页面）、组件实例、规则命中与证据 */
export function IngestModal({ onClose }: { onClose: () => void }) {
  const { state, dispatchMany } = useStore();
  const existingPages = Object.values(state.pages);
  const [pageMode, setPageMode] = useState<"new" | "existing">(
    existingPages.length ? "existing" : "new"
  );
  const [pageId, setPageId] = useState(existingPages[0]?.id ?? "");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [componentName, setComponentName] = useState("Button");
  const [selector, setSelector] = useState("");
  const [version, setVersion] = useState("");
  const [ruleId, setRuleId] = useState("button-name");
  const [ruleTitle, setRuleTitle] = useState("按钮缺少可访问名称");
  const [severity, setSeverity] = useState<Severity>("critical");
  const [snippet, setSnippet] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    setError("");
    const targetPage =
      pageMode === "existing" ? state.pages[pageId] : { name: name.trim(), url: url.trim() };
    if (!targetPage || !targetPage.name.trim()) return setError("请填写页面名称");
    if (!componentName.trim()) return setError("请填写组件名");
    if (!selector.trim()) return setError("请填写实例选择器");
    if (!version.trim()) return setError("请填写当前代码版本");
    if (!ruleId.trim() || !ruleTitle.trim()) return setError("请填写规则编号与标题");
    if (!snippet.trim()) return setError("请粘贴扫描证据片段");

    const now = Date.now();
    const newPageId = pageMode === "existing" ? pageId : uid("page");
    const instanceId = uid("inst");
    const actions = [];
    if (pageMode === "new") {
      actions.push({
        type: "ADD_PAGE" as const,
        page: { id: newPageId, name: name.trim(), url: url.trim() },
        now,
      });
    }
    actions.push({
      type: "ADD_INSTANCE" as const,
      instance: {
        id: instanceId,
        pageId: newPageId,
        componentName: componentName.trim(),
        selector: selector.trim(),
        version: version.trim(),
      },
    });
    actions.push({
      type: "ADD_HIT" as const,
      now,
      hit: {
        instanceId,
        ruleId: ruleId.trim(),
        ruleTitle: ruleTitle.trim(),
        severity,
        evidence: { snippet: snippet.trim(), observedAt: now },
      },
    });
    dispatchMany(actions);
    onClose();
  };

  return (
    <Modal title="录入扫描结果（页面 / 组件实例 / 规则命中）" onClose={onClose}>
      <div className="inline-form">
        <div>
          <label>页面</label>
          {pageMode === "existing" && existingPages.length > 0 ? (
            <select value={pageId} onChange={(e) => setPageId(e.target.value)}>
              {existingPages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.url || "—"}）
                </option>
              ))}
            </select>
          ) : (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="页面名称，如 商品详情页" />
          )}
        </div>
        <div style={{ flex: "0 0 auto", alignSelf: "flex-end", paddingBottom: 6 }}>
          <button
            className="tiny ghost"
            onClick={() => setPageMode(pageMode === "new" ? "existing" : "new")}
            disabled={pageMode === "new" && existingPages.length === 0}
          >
            {pageMode === "new" ? "改用已有页面" : "改为新页面"}
          </button>
        </div>
      </div>
      {pageMode === "new" && (
        <div style={{ marginTop: 8 }}>
          <label>页面 URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/product/123" />
        </div>
      )}

      <div className="inline-form" style={{ marginTop: 10 }}>
        <div>
          <label>组件名</label>
          <input value={componentName} onChange={(e) => setComponentName(e.target.value)} />
        </div>
        <div style={{ flex: 2 }}>
          <label>实例选择器（页面内唯一）</label>
          <input value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="div.hero > button.cta" />
        </div>
        <div>
          <label>代码版本</label>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="button@2.1.0" />
        </div>
      </div>

      <div className="inline-form" style={{ marginTop: 10 }}>
        <div>
          <label>规则编号</label>
          <input value={ruleId} onChange={(e) => setRuleId(e.target.value)} />
        </div>
        <div style={{ flex: 2 }}>
          <label>规则标题</label>
          <input value={ruleTitle} onChange={(e) => setRuleTitle(e.target.value)} />
        </div>
        <div>
          <label>严重程度</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
            <option value="critical">critical</option>
            <option value="serious">serious</option>
            <option value="moderate">moderate</option>
            <option value="minor">minor</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <label>扫描证据片段（每个页面独立保留）</label>
        <textarea
          rows={3}
          value={snippet}
          onChange={(e) => setSnippet(e.target.value)}
          placeholder={'<button class="cta"><svg .../></button>'}
        />
      </div>

      {error && (
        <div className="note bad" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      <div className="actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>
          录入并自动归并
        </button>
      </div>
    </Modal>
  );
}
