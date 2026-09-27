import React, { useEffect, useState } from 'react';
import { applyTextSize, readTextSize } from '../../services/textSizePreference';

const options = [
  ['small', 'A−', 'Small text'],
  ['default', 'A', 'Default text'],
  ['large', 'A+', 'Large text'],
  ['extraLarge', 'A++', 'Extra large text'],
];

const TextSizeControl = () => {
  const [size, setSize] = useState(readTextSize);
  useEffect(() => { applyTextSize(size); }, [size]);

  return (
    <div className="blockgo-text-size-control" role="group" aria-label="Text size">
      <span className="hidden text-[11px] font-semibold sm:inline">Text Size</span>
      {options.map(([value, label, ariaLabel]) => (
        <button key={value} type="button" aria-label={ariaLabel} aria-pressed={size === value} onClick={() => setSize(value)}
          className={size === value ? 'is-active' : ''}>{label}</button>
      ))}
    </div>
  );
};

export default TextSizeControl;
