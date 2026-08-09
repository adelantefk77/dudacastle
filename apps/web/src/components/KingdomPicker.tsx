import { KINGDOMS } from "@dudacastle/shared";
import "./kingdom-picker.css";

export interface KingdomPickerProps {
  value: string | null;
  onChange: (kingdomId: string) => void;
  disabledIds?: string[];
}

export function KingdomPicker({ value, onChange, disabledIds = [] }: KingdomPickerProps) {
  return (
    <div className="kingdom-picker">
      {KINGDOMS.map((kingdom) => (
        <button
          key={kingdom.id}
          type="button"
          className={[
            "kingdom-picker__option",
            value === kingdom.id ? "kingdom-picker__option--selected" : "",
          ].join(" ")}
          disabled={disabledIds.includes(kingdom.id)}
          onClick={() => onChange(kingdom.id)}
        >
          {kingdom.name}
        </button>
      ))}
    </div>
  );
}
