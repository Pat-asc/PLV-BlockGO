import React from 'react';
import { passwordRequirements, passwordStrength } from '../../utils/passwordPolicy';

const labels = {
  length: '8–128 characters',
  uppercase: 'uppercase letter',
  lowercase: 'lowercase letter',
  number: 'number',
  special: 'special character',
};

const PasswordStrength = ({ password = '' }) => {
  const requirements = passwordRequirements(password);
  const strength = passwordStrength(password);

  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((segment) => (
            <span key={segment} className={`h-1.5 rounded-full ${segment <= strength.score ? strength.color : 'bg-slate-200'}`} />
          ))}
        </div>
        <span className="text-[11px] font-bold text-slate-700">{strength.label}</span>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        Requires {Object.entries(labels).map(([key, label]) => (
          <span key={key} className={requirements[key] ? 'text-emerald-700' : undefined}>
            {requirements[key] ? '✓' : '○'} {label}{key === 'special' ? '.' : ', '}
          </span>
        ))}
      </p>
    </div>
  );
};

export default PasswordStrength;
