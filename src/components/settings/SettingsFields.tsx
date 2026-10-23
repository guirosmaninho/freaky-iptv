import React, { useId, useRef, useState } from 'react';

export const SettingsSection: React.FC<React.PropsWithChildren<{ id: string; title: string }>> = ({ id, title, children }) => (
  <section className="settings-group" aria-labelledby={`${id}-heading`}>
    <div className="settings-group-heading"><h3 id={`${id}-heading`}>{title}</h3></div>
    {children}
  </section>
);

interface NumberFieldProps {
  label: string;
  zeroLabel: string;
  enabledValue: number;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

export const NumberField: React.FC<NumberFieldProps> = ({ label, zeroLabel, enabledValue, value, min, max, disabled, onChange }) => {
  const id = useId();
  const lastEnabledValue = useRef(value || enabledValue);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="settings-field">
      <span id={id}>{label}</span>
      <div className="settings-number-controls">
        <label className="settings-zero-option">
          <input type="checkbox" checked={value === 0} disabled={disabled} onChange={event => {
            if (value > 0) lastEnabledValue.current = value;
            onChange(event.target.checked ? 0 : lastEnabledValue.current);
          }} />
          <span>{zeroLabel}</span>
        </label>
        <input
          aria-labelledby={id}
          type="number"
          className="text-input"
          min={Math.max(1, min)}
          max={max}
          value={value === 0 ? 0 : draft ?? value}
          onChange={event => {
            setDraft(event.target.value);
            // Clearing a number while editing must not activate the Off option.
            if (event.target.value !== '') onChange(Number(event.target.value));
          }}
          onBlur={() => setDraft(null)}
          disabled={disabled || value === 0}
        />
      </div>
    </div>
  );
};

export const StatusRow: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div><span>{label}</span><strong className={strong ? 'is-active' : ''}>{value}</strong></div>
);
