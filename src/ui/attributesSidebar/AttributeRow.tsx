import type { AttrDef } from "./attributeSchema";
import "../styles/attributesSidebar.css";

type Props = {
  def: AttrDef;
  value: any;
  onChange: (newValue: any) => void;

  // for "unit" attributes
  unitValue?: string;
  onUnitChange?: (newUnit: string) => void;

  disabled?: boolean;
};

export default function AttributeRow({
  def,
  value,
  onChange,
  unitValue,
  onUnitChange,
  disabled,
}: Props) {
  return (
    <div className="attr-row">
      <div className="attr-label">{def.label}</div>

      <div className="attr-control">
        {def.kind === "text" && (
          <textarea
            ref={(el) => {
              if (!el) return;
              // adjust immediately for initial content
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            className="attr-textarea"
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onInput={(e) => {
              const t = e.currentTarget as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = `${t.scrollHeight}px`;
            }}
          />
        )}

        {def.kind === "number" && (
          <input
            className="attr-input"
            value={value ?? ""}
            disabled={disabled}
            inputMode="decimal"
            onChange={(e) => {
              const raw = e.target.value;
              onChange(raw === "" ? "" : Number(raw));
            }}
          />
        )}

        {def.kind === "enum" && (
          <select
            className="attr-select"
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {def.kind === "unit" && (
          <div className="attr-unit">
            <input
              className="attr-input"
              value={value ?? ""}
              disabled={disabled}
              inputMode="decimal"
              onChange={(e) => {
                const raw = e.target.value;
                onChange(raw === "" ? "" : Number(raw));
              }}
            />
            <select
              className="attr-select"
              value={unitValue ?? def.unitOptions[0]?.value ?? ""}
              disabled={disabled}
              onChange={(e) => onUnitChange?.(e.target.value)}
            >
              {def.unitOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
