import  { useEffect } from "react";
import "../styles/connectionMenu.css";
import type { RelationshipKind } from "../../models/relationships/enums/RelationshipTypes";
import { StructuralKind, LogicalKind, PhysicalKind } from "../../models/relationships/enums/RelationshipTypes";

export type ConnectionMenuChoice = RelationshipKind | ""; // "" = cancel

type Props = {
  position: { x: number; y: number } | null; // screen coords relative to canvas wrapper
  onChoose: (kind: ConnectionMenuChoice) => void;
};

export default function ConnectionMenu({ position, onChoose }: Props) {
  useEffect(() => {
    if (!position) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest(".connection-menu-container")) {
        onChoose("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [position, onChoose]);

  if (!position) return null;

  const connectionTypes: { kind: RelationshipKind; label: string; className: string }[] = [
    { kind: StructuralKind.HasPart, label: "Has Part", className: "haspart" },
    { kind: LogicalKind.Controls, label: "Controls", className: "controls" },
    { kind: PhysicalKind.Feeds, label: "Feeds", className: "feeds" },
  ];

  return (
    <div
      className="connection-menu-container"
      style={{ left: position.x, top: position.y }}
    >
      <button className="connection-menu-close" onClick={() => onChoose("")} title="Close">
        ×
      </button>

      <div className="connection-menu">
        <div className="connection-menu-title">Select connection type</div>

        <div className="connection-menu-actions">
          {connectionTypes.map(({ kind, label, className }) => (
            <button
              key={String(kind)}
              className={`connection-menu-btn ${className}`}
              onClick={() => onChoose(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
