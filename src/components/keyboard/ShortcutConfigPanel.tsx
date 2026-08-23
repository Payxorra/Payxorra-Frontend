import React, { useState, useEffect, useRef } from 'react';
import { useShortcutStore, Shortcut } from '../../store/shortcutStore'; // eslint-disable-line @typescript-eslint/no-unused-vars

export const ShortcutConfigPanel: React.FC = () => {
  const { shortcuts, rebindShortcut, resetToDefaults } = useShortcutStore();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordedKeys, setRecordedKeys] = useState<string[]>([]);
  const [countdown, setCountdown] = useState<number>(3);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const BROWSER_DEFAULTS = ['t', 'n', 'w', 'r', 'd', 'f'];

  const startRecording = (id: string) => {
    setRecordingId(id);
    setRecordedKeys([]);
    setCountdown(3);
    setConflictMsg(null);
  };

  useEffect(() => {
    if (recordingId !== null) {
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            saveBinding();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [recordingId, recordedKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (recordingId === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      
      setRecordedKeys((prev) => {
        if (prev.length >= 3) return prev;
        return [...prev, e.key.toLowerCase()];
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [recordingId]);

  const saveBinding = async () => {
    if (!recordingId || recordedKeys.length === 0) {
      cancelRecording();
      return;
    }

    const conflictsWithBrowser = recordedKeys.some((k) => BROWSER_DEFAULTS.includes(k));
    if (conflictsWithBrowser) {
      const confirmOverride = window.confirm(
        `Warning: This shortcut sequence overrides common browser behaviors. Do you want to proceed?`
      );
      if (!confirmOverride) {
        cancelRecording();
        return;
      }
    }

    const result = await rebindShortcut(recordingId, recordedKeys);
    if (!result.success) {
      setConflictMsg(`Conflict detected! Assigned to: "${result.conflict}"`);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    } else {
      cancelRecording();
    }
  };

  const cancelRecording = () => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    setRecordingId(null);
    setRecordedKeys([]);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4 mb-6">
        <div>
          <h3 className="text-lg font-bold text-white">Keyboard Customization Matrix</h3>
          <p className="text-xs text-slate-400 mt-0.5">Customize workspace mappings. Up to 3 unique keystrokes maximum.</p>
        </div>
        <button
          onClick={() => { if(confirm("Reset all customizations?")) resetToDefaults(); }}
          className="text-xs bg-red-950/40 text-red-400 border border-red-900/50 px-3 py-1.5 rounded-lg hover:bg-red-900/30 transition font-medium"
        >
          Reset All Mappings
        </button>
      </div>

      {recordingId && (
        <div className="mb-6 p-4 rounded-xl border border-cyan-800/50 bg-cyan-950/30 text-cyan-200 flex flex-col md:flex-row justify-between items-center gap-4 animate-pulse">
          <div className="text-center md:text-left">
            <span className="font-bold block text-sm">Listening for Keystrokes...</span>
            <span className="text-xs text-cyan-400">Press sequential bindings. Finalizing in {countdown}s...</span>
          </div>
          <div className="flex gap-2 items-center">
            <div className="flex gap-1.5 bg-slate-950 p-2 rounded-lg border border-slate-800 min-w-[120px] justify-center">
              {recordedKeys.length === 0 ? (
                <span className="text-xs text-slate-500 font-mono">Press keys...</span>
              ) : (
                recordedKeys.map((k, idx) => (
                  <kbd key={idx} className="bg-slate-800 px-2 py-0.5 border border-slate-700 text-white font-mono text-xs font-bold rounded uppercase">{k}</kbd>
                ))
              )}
            </div>
            <button onClick={cancelRecording} className="text-xs text-slate-400 hover:text-white px-2 py-1 bg-slate-800 rounded">Cancel</button>
          </div>
          {conflictMsg && <p className="w-full text-xs text-red-400 mt-2 font-bold">{conflictMsg}</p>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-slate-950/20">
              <th className="py-3 px-4">Action Context</th>
              <th className="py-3 px-4">Category</th>
              <th className="py-3 px-4">Assigned Mapping</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {shortcuts.map((shortcut) => (
              <tr key={shortcut.id} className="hover:bg-slate-800/20 transition-colors">
                <td className="py-3 px-4 font-medium text-white">{shortcut.description}</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-800 text-slate-400 font-medium">
                    {shortcut.category}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex gap-1">
                    {shortcut.keys.map((key, i) => (
                      <kbd key={i} className="px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded font-mono font-bold uppercase text-[11px] text-cyan-400">{key}</kbd>
                    ))}
                  </div>
                </td>
                <td className="py-3 px-4 text-right">
                  <button
                    disabled={recordingId !== null}
                    onClick={() => startRecording(shortcut.id)}
                    className="text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium px-2.5 py-1 rounded transition"
                  >
                    Rebind
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};