import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Modal from './Modal';

const SystemDialogContext = createContext(null);
let externalDialogRequest = null;

const actionDetails = (message = '') => {
  const value = String(message).toLowerCase();
  if (value.includes('log out')) return { title: 'Logout', confirmLabel: 'Log Out', tone: 'destructive' };
  if (value.includes('reset the password')) return { title: 'Reset Password', confirmLabel: 'Reset Password', tone: 'destructive' };
  if (value.includes('encoding context') || value.includes('encoding season')) return { title: 'Reset Encoding Season', confirmLabel: 'Reset Encoding Season', tone: 'destructive' };
  if (value.startsWith('delete') || value.includes('permanently delete')) return { title: 'Delete Record', confirmLabel: 'Delete', tone: 'destructive' };
  if (value.startsWith('remove')) return { title: 'Remove Record', confirmLabel: 'Remove', tone: 'destructive' };
  if (value.startsWith('archive')) return { title: 'Archive Curriculum', confirmLabel: 'Archive', tone: 'destructive' };
  if (value.startsWith('finalize')) return { title: 'Finalize', confirmLabel: 'Finalize' };
  if (value.startsWith('promote') || value.startsWith('advance')) return { title: 'Promote Students', confirmLabel: 'Promote Students' };
  if (value.startsWith('approve') || value.includes('want to approve')) return { title: 'Approve', confirmLabel: 'Approve' };
  if (value.startsWith('publish')) return { title: 'Publish Curriculum', confirmLabel: 'Publish' };
  if (value.startsWith('submit')) return { title: 'Submit for Review', confirmLabel: 'Submit' };
  if (value.startsWith('assign')) return { title: 'Assign Curriculum', confirmLabel: 'Assign' };
  if (value.startsWith('replace') || value.includes('overwrite')) return { title: 'Replace Existing Data', confirmLabel: 'Replace', tone: 'destructive' };
  return {};
};

const normalizeOptions = (options, defaults = {}) => {
  const supplied = typeof options === 'string' ? { message: options } : (options || {});
  return { ...defaults, ...actionDetails(supplied.message), ...supplied };
};

export const requestSystemConfirmation = (options) => {
  if (!externalDialogRequest) return Promise.resolve(false);
  return externalDialogRequest('confirm', normalizeOptions(options, {
    title: 'Confirm Action',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    tone: 'primary',
  }));
};

export const requestSystemPrompt = (options) => {
  if (!externalDialogRequest) return Promise.resolve(null);
  return externalDialogRequest('prompt', normalizeOptions(options, {
    title: 'Additional Information',
    confirmLabel: 'Continue',
    cancelLabel: 'Cancel',
    inputLabel: 'Details',
  }));
};

export const useSystemDialog = () => useContext(SystemDialogContext);

export function SystemDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const settledRef = useRef(false);

  const requestDialog = useCallback((kind, options) => new Promise((resolve) => {
    settledRef.current = false;
    setInputValue(options.defaultValue || '');
    setDialog({ kind, options, resolve });
  }), []);

  useEffect(() => {
    externalDialogRequest = requestDialog;
    return () => {
      if (externalDialogRequest === requestDialog) externalDialogRequest = null;
    };
  }, [requestDialog]);

  const settle = useCallback((result) => {
    if (!dialog || settledRef.current) return;
    settledRef.current = true;
    dialog.resolve(result);
    setDialog(null);
  }, [dialog]);

  const cancel = useCallback(() => settle(dialog?.kind === 'prompt' ? null : false), [dialog?.kind, settle]);
  const confirm = useCallback(() => {
    if (dialog?.kind === 'prompt') {
      const value = inputValue.trim();
      if (dialog.options.required !== false && !value) return;
      settle(value);
      return;
    }
    settle(true);
  }, [dialog, inputValue, settle]);

  const options = dialog?.options || {};
  const destructive = options.tone === 'destructive';

  return (
    <SystemDialogContext.Provider value={{ confirm: requestSystemConfirmation, prompt: requestSystemPrompt }}>
      {children}
      <Modal
        isOpen={Boolean(dialog)}
        onClose={cancel}
        title={options.title}
        description={options.message}
      >
        {dialog?.kind === 'prompt' ? (
          <label className="block text-sm font-semibold text-slate-700">
            {options.inputLabel}
            <textarea
              autoFocus
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-[#003366] focus:ring-2 focus:ring-blue-100"
            />
          </label>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={cancel}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003366] focus-visible:ring-offset-2"
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={dialog?.kind === 'prompt' && options.required !== false && !inputValue.trim()}
            className={`min-h-11 rounded-lg px-5 py-2.5 text-sm font-bold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${destructive ? 'bg-red-700 hover:bg-red-800 focus-visible:ring-red-700' : 'bg-[#003366] hover:bg-[#004b8f] focus-visible:ring-[#003366]'}`}
          >
            {options.confirmLabel || 'Confirm'}
          </button>
        </div>
      </Modal>
    </SystemDialogContext.Provider>
  );
}
