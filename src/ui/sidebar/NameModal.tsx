// src/ui/sidebar/NameModal.tsx
import { useEffect, useState } from "react";
import "../styles/modal.css";
import { PortType } from "../../models/attributes/enums/PortType";

type Props = {
  open: boolean;
  title?: string;
  placeholder?: string;
  initialValue?: string;

  error?: string;
  onChangeValue?: () => void;

  // show this only when creating a port
  showPortType?: boolean;
  initialPortType?: PortType;
  onConfirm: (payload: { name: string; portType?: PortType }) => void;

  onCancel: () => void;
};

export default function NameModal({
  open,
  title = "Name",
  placeholder = "Enter a name…",
  initialValue = "",
  error,
  onChangeValue,

  showPortType = false,
  initialPortType = PortType.Input,
  onConfirm,

  onCancel,
}: Props) {
  const [name, setName] = useState(initialValue);
  const [portType, setPortType] = useState<PortType>(initialPortType);

  useEffect(() => {
    if (!open) return;
    setName(initialValue);
    setPortType(initialPortType);
  }, [open, initialValue, initialPortType]);

  if (!open) return null;

  const trimmed = name.trim();

  const submit = () => {
    if (!trimmed) return;
    onConfirm({ name: trimmed, portType: showPortType ? portType : undefined });
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>

        <input
          className="modal-input"
          autoFocus
          value={name}
          placeholder={placeholder}
          onChange={(e) => {
            setName(e.target.value);
            onChangeValue?.();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") submit();
          }}
        />

        {showPortType && (
          <div className="modal-row">
            <label className="modal-label">Port type</label>
            <select
              className="modal-select"
              value={portType}
              onChange={(e) => setPortType(e.target.value as PortType)}
            >
              <option value={PortType.Input}>Input</option>
              <option value={PortType.Output}>Output</option>
            </select>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal-button confirm" onClick={submit} disabled={!trimmed}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

