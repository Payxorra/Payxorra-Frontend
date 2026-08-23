'use client';

/**
 * AlertRuleEditor.tsx
 *
 * Page-level component for creating and editing alert rules.
 * Provides two modes:
 *
 *  1. **Form mode** (default) — threshold-based rule editor with
 *     metric selection, operator, value, and time-window controls.
 *  2. **Script mode** — Monaco Script Playground for custom JavaScript
 *     alert expressions executed in a sandboxed Web Worker.
 *
 * A toggle at the top switches between the two modes. On save the rule
 * is serialized via `useAlertRuleMutation`.
 */

import React, { useState, useCallback } from 'react';
import { ScriptPlayground } from '../../components/alerts/ScriptPlayground';
import {
  useAlertRuleMutation,
  type AlertRuleDefinition,
  type AlertRuleType,
} from '../../hooks/useAlertRuleMutation';

// ─── Constants ────────────────────────────────────────────────────────────────

const METRICS = [
  { value: 'bandwidth', label: 'Bandwidth (Mbps)' },
  { value: 'cpu', label: 'CPU Usage (%)' },
  { value: 'memory', label: 'Memory Usage (%)' },
  { value: 'latency', label: 'Latency (ms)' },
  { value: 'packetLoss', label: 'Packet Loss (%)' },
  { value: 'uptime', label: 'Uptime (s)' },
] as const;

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '≥' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '≤' },
  { value: 'eq', label: '=' },
] as const;

const SEVERITIES = ['critical', 'warning', 'info'] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AlertRuleEditorProps {
  /** Pre-existing rule to edit (omit for new rule). */
  existingRule?: AlertRuleDefinition;
  /** Called after a successful save. */
  onSaved?: (rule: AlertRuleDefinition) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertRuleEditor({
  existingRule,
  onSaved,
}: AlertRuleEditorProps) {
  // ── Determine initial mode from existing rule ─────────────────────────────

  const initialMode: AlertRuleType =
    existingRule?.config.type === 'script' ? 'script' : 'threshold';

  // ── State ─────────────────────────────────────────────────────────────────

  const [mode, setMode] = useState<AlertRuleType>(initialMode);
  const [name, setName] = useState(existingRule?.name ?? '');
  const [description, setDescription] = useState(
    existingRule?.description ?? ''
  );
  const [severity, setSeverity] = useState<'critical' | 'warning' | 'info'>(
    existingRule?.severity ?? 'warning'
  );
  const [enabled, setEnabled] = useState(existingRule?.enabled ?? true);

  // Threshold mode state
  const [metric, setMetric] = useState(
    existingRule?.config.type === 'threshold'
      ? existingRule.config.metric
      : 'bandwidth'
  );
  const [operator, setOperator] = useState(
    existingRule?.config.type === 'threshold'
      ? existingRule.config.operator
      : 'gt'
  );
  const [thresholdValue, setThresholdValue] = useState(
    existingRule?.config.type === 'threshold'
      ? existingRule.config.value
      : 100
  );
  const [windowMinutes, setWindowMinutes] = useState(
    existingRule?.config.type === 'threshold'
      ? existingRule.config.windowMinutes
      : 5
  );

  // Script mode state
  const [scriptCode, setScriptCode] = useState(
    existingRule?.config.type === 'script' ? existingRule.config.code : ''
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const { saveRule, isSaving, saveError } = useAlertRuleMutation();

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleModeToggle = useCallback(
    (newMode: AlertRuleType) => setMode(newMode),
    []
  );

  const handleSave = useCallback(() => {
    const rule: AlertRuleDefinition = {
      id: existingRule?.id,
      name,
      description,
      severity,
      enabled,
      config:
        mode === 'script'
          ? { type: 'script', code: scriptCode }
          : {
              type: 'threshold',
              metric,
              operator: operator as 'gt' | 'gte' | 'lt' | 'lte' | 'eq',
              value: thresholdValue,
              windowMinutes,
            },
    };

    saveRule(rule, {
      onSuccess: (saved) => onSaved?.(saved),
    });
  }, [
    existingRule,
    name,
    description,
    severity,
    enabled,
    mode,
    scriptCode,
    metric,
    operator,
    thresholdValue,
    windowMinutes,
    saveRule,
    onSaved,
  ]);

  const isFormValid = name.trim().length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="alert-rule-editor" id="alert-rule-editor-root">
      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div className="alert-rule-editor__header">
        <h2 className="alert-rule-editor__title">
          {existingRule ? 'Edit Alert Rule' : 'Create Alert Rule'}
        </h2>
        <p className="alert-rule-editor__subtitle">
          Define conditions that trigger alerts on your Lumina network nodes.
        </p>
      </div>

      {/* ── Mode toggle ────────────────────────────────────────────────────── */}
      <div
        className="alert-rule-editor__mode-toggle"
        id="alert-rule-editor-mode-toggle"
        role="tablist"
        aria-label="Rule editor mode"
      >
        <button
          role="tab"
          aria-selected={mode === 'threshold'}
          className={`alert-rule-editor__mode-btn ${
            mode === 'threshold' ? 'alert-rule-editor__mode-btn--active' : ''
          }`}
          onClick={() => handleModeToggle('threshold')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          Threshold Mode
        </button>
        <button
          role="tab"
          aria-selected={mode === 'script'}
          className={`alert-rule-editor__mode-btn ${
            mode === 'script' ? 'alert-rule-editor__mode-btn--active' : ''
          }`}
          onClick={() => handleModeToggle('script')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          Script Mode
        </button>
      </div>

      {/* ── Common fields ──────────────────────────────────────────────────── */}
      <div className="alert-rule-editor__fields">
        <div className="alert-rule-editor__field-row">
          <div className="alert-rule-editor__field">
            <label
              htmlFor="alert-rule-name"
              className="alert-rule-editor__label"
            >
              Rule Name <span className="alert-rule-editor__required">*</span>
            </label>
            <input
              id="alert-rule-name"
              type="text"
              className="alert-rule-editor__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. High Bandwidth Alert"
              maxLength={120}
            />
          </div>

          <div className="alert-rule-editor__field">
            <label
              htmlFor="alert-rule-severity"
              className="alert-rule-editor__label"
            >
              Severity
            </label>
            <div className="alert-rule-editor__severity-group">
              {SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`alert-rule-editor__severity-btn alert-rule-editor__severity-btn--${s} ${
                    severity === s
                      ? 'alert-rule-editor__severity-btn--selected'
                      : ''
                  }`}
                  onClick={() => setSeverity(s)}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="alert-rule-editor__field">
          <label
            htmlFor="alert-rule-description"
            className="alert-rule-editor__label"
          >
            Description
          </label>
          <textarea
            id="alert-rule-description"
            className="alert-rule-editor__input alert-rule-editor__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this rule monitors and when it should fire…"
            rows={2}
          />
        </div>

        {/* Enabled toggle */}
        <label className="alert-rule-editor__toggle-label">
          <span className="alert-rule-editor__toggle-text">
            Rule is {enabled ? 'enabled' : 'disabled'}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className={`alert-rule-editor__toggle ${
              enabled ? 'alert-rule-editor__toggle--on' : ''
            }`}
            onClick={() => setEnabled((v) => !v)}
            id="alert-rule-enabled-toggle"
          >
            <span className="alert-rule-editor__toggle-knob" />
          </button>
        </label>
      </div>

      {/* ── Mode-specific content ──────────────────────────────────────────── */}
      {mode === 'threshold' ? (
        <div
          className="alert-rule-editor__threshold-section"
          id="alert-rule-threshold-config"
        >
          <h3 className="alert-rule-editor__section-title">
            Threshold Configuration
          </h3>

          <div className="alert-rule-editor__threshold-grid">
            <div className="alert-rule-editor__field">
              <label
                htmlFor="alert-rule-metric"
                className="alert-rule-editor__label"
              >
                Metric
              </label>
              <select
                id="alert-rule-metric"
                className="alert-rule-editor__select"
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="alert-rule-editor__field">
              <label
                htmlFor="alert-rule-operator"
                className="alert-rule-editor__label"
              >
                Operator
              </label>
              <select
                id="alert-rule-operator"
                className="alert-rule-editor__select"
                value={operator}
                onChange={(e) => setOperator(e.target.value as 'gt' | 'gte' | 'lt' | 'lte' | 'eq')}
              >
                {OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="alert-rule-editor__field">
              <label
                htmlFor="alert-rule-value"
                className="alert-rule-editor__label"
              >
                Value
              </label>
              <input
                id="alert-rule-value"
                type="number"
                className="alert-rule-editor__input"
                value={thresholdValue}
                onChange={(e) =>
                  setThresholdValue(parseFloat(e.target.value) || 0)
                }
              />
            </div>

            <div className="alert-rule-editor__field">
              <label
                htmlFor="alert-rule-window"
                className="alert-rule-editor__label"
              >
                Window (min)
              </label>
              <input
                id="alert-rule-window"
                type="number"
                className="alert-rule-editor__input"
                value={windowMinutes}
                min={1}
                max={1440}
                onChange={(e) =>
                  setWindowMinutes(parseInt(e.target.value, 10) || 5)
                }
              />
            </div>
          </div>

          {/* Threshold preview */}
          <div className="alert-rule-editor__threshold-preview">
            <span className="alert-rule-editor__preview-label">Preview:</span>
            <code className="alert-rule-editor__preview-code">
              avg({metric}, {windowMinutes}m){' '}
              {OPERATORS.find((o) => o.value === operator)?.label ?? '>'}{' '}
              {thresholdValue}
            </code>
          </div>
        </div>
      ) : (
        <div
          className="alert-rule-editor__script-section"
          id="alert-rule-script-config"
        >
          <ScriptPlayground
            initialCode={scriptCode || undefined}
            onCodeChange={setScriptCode}
          />
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="alert-rule-editor__footer">
        {saveError && (
          <p className="alert-rule-editor__error" role="alert">
            Failed to save rule: {String(saveError)}
          </p>
        )}

        <button
          id="alert-rule-save-btn"
          className="alert-rule-editor__save-btn"
          onClick={handleSave}
          disabled={isSaving || !isFormValid}
        >
          {isSaving ? 'Saving…' : 'Save Rule'}
        </button>
      </div>
    </div>
  );
}
