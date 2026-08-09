import { useState } from "react";
import "./ability-modal.css";

export interface ModalFieldOption {
  value: string;
  label: string;
}

export interface ModalField {
  key: string;
  label: string;
  options: ModalFieldOption[];
}

export interface AbilityModalProps {
  title: string;
  description?: string;
  fields: ModalField[];
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Generyczny modal do zdolności/kart wymagających wyboru celu (np. Wojownik Srebrnych Głów:
 * jednostka + jedna z 4 zdolności; Powietrzny Transport: sojusznik + wolne miejsce). Zamiast
 * klikania po planszy dla każdego z ~10 takich przypadków z osobna, jeden formularz z listami
 * rozwijanymi pokrywa je wszystkie.
 */
export function AbilityModal({ title, description, fields, onConfirm, onCancel }: AbilityModalProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.options[0]?.value ?? ""])),
  );

  const canConfirm = fields.every((f) => values[f.key]);

  return (
    <div className="ability-modal__backdrop" onClick={onCancel}>
      <div className="ability-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {description && <p className="ability-modal__description">{description}</p>}
        {fields.map((field) => (
          <label key={field.key} className="ability-modal__field">
            {field.label}
            <select
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            >
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="ability-modal__actions">
          <button type="button" onClick={onCancel}>
            Anuluj
          </button>
          <button type="button" disabled={!canConfirm} onClick={() => onConfirm(values)}>
            Potwierdź
          </button>
        </div>
      </div>
    </div>
  );
}
