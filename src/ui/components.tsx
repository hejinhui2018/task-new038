import type { ReactNode } from "react";
import type { GroupStatus, HitStatus, ImpactNote } from "../core/types";
import { hitStatusLabel, statusLabel } from "../core/selectors";

export function StatusBadge({ status }: { status: GroupStatus }) {
  return <span className={`badge ${status}`}>{statusLabel(status)}</span>;
}

export function HitStatusBadge({ status }: { status: HitStatus }) {
  return <span className={`badge ${status}`}>{hitStatusLabel(status)}</span>;
}

export function Note({ note }: { note: ImpactNote }) {
  return (
    <div className={`note ${note.tone}`}>
      <div className="note-title">{note.title}</div>
      {note.lines.length === 1 ? (
        <div>{note.lines[0]}</div>
      ) : (
        <ul>
          {note.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={width ? { width } : undefined}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
