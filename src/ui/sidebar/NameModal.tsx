// src/ui/sidebar/NameModal.tsx
import { useEffect, useState } from "react";
import "../styles/modal.css";

type Props = {
  open: boolean;
  title?: string;
  placeholder?: string;
  initialValue?: string;
  error?: string;
  onChangeValue?: () => void;
  onCancel: () => void;
  onConfirm: (name: string) => void;
};

export default function NameModal({
  open,
  title = "Name",
  placeholder = "Enter a name…",
  initialValue = "",
  error,
  onChangeValue,
  onCancel,
  onConfirm,
}: Props) {
  const [name, setName] = useState(initialValue);

  useEffect(() => {
    if (open) setName(initialValue);
  }, [open, initialValue]);

  if (!open) return null;

  const trimmed = name.trim();

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={onCancel}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>

        <input
          className="modal-input"
          autoFocus
          value={name}
          placeholder={placeholder}
          onChange={(e) => {
            setName(e.target.value);
            onChangeValue?.(); // clears error while typing
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
              return;
            }

            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (trimmed) onConfirm(trimmed);
            }
          }}
        />

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="modal-button cancel" onClick={onCancel}>
            Cancel
          </button>

          <button
            type="button"
            className="modal-button confirm"
            onClick={() => onConfirm(trimmed)}
            disabled={!trimmed}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
