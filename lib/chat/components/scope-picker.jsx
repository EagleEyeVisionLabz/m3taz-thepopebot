'use client';

import { Combobox } from './ui/combobox.js';

/**
 * Scope picker for agent mode — selects which subdirectory the agent runs in.
 * Defaults to root when no scope is selected.
 */
export function ScopePicker({ scope, onScopeChange, scopes }) {
  const options = [
    { value: '/', label: '/ (root)' },
    ...(scopes || []).map((s) => ({ value: s.path, label: `/${s.path}` })),
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <div className="w-full sm:w-auto sm:min-w-[240px] sm:max-w-[240px]">
        <Combobox
          options={options}
          value={scope || '/'}
          onChange={(val) => onScopeChange(val === '/' ? null : val)}
          placeholder="Select scope..."
        />
      </div>
    </div>
  );
}
