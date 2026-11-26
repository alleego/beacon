import React from "react";
import { BarChart3 } from "lucide-react";
import { summarizeUsage, USAGE_PERIODS } from "../shared/usage.mjs";

const number = (n) => n.toLocaleString();
const compact = (n) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
export function UsageBadge({ data, settings, onClick }) {
  const total = summarizeUsage(data, settings);
  return (
    <button
      className="usage-badge"
      onClick={onClick}
      aria-label="Usage details"
      title="Recorded usage on this device"
    >
      <BarChart3 size={16} />
      <span>
        <small>{USAGE_PERIODS[settings.usagePeriod]}</small>
        <strong>
          {total ? `${compact(total.total)} tokens` : "Choose dates"}
          {total &&
          (total.unknown ||
            total.pending ||
            total.partial ||
            data.storageError ||
            data.warning)
            ? " *"
            : ""}
        </strong>
      </span>
    </button>
  );
}
export default function Usage({ data, settings, onSave }) {
  const total = summarizeUsage(data, settings);
  return (
    <section className="usage-details">
      <label className="field">
        Reporting period
        <select
          aria-label="Reporting period"
          value={settings.usagePeriod}
          onChange={(e) => onSave({ ...settings, usagePeriod: e.target.value })}
        >
          {Object.entries(USAGE_PERIODS).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {settings.usagePeriod === "custom" && (
        <div className="form-grid">
          <label className="field">
            From
            <input
              type="date"
              value={settings.usageFrom}
              onChange={(e) =>
                onSave({ ...settings, usageFrom: e.target.value })
              }
            />
          </label>
          <label className="field">
            Through
            <input
              type="date"
              value={settings.usageTo}
              onChange={(e) => onSave({ ...settings, usageTo: e.target.value })}
            />
          </label>
        </div>
      )}
      {data?.storageError && (
        <p role="alert" className="error-inline">
          {data.storageError}
        </p>
      )}
      {data?.warning && (
        <p role="alert" className="error-inline">
          {data.warning}
        </p>
      )}
      {total ? (
        <>
          <div className="usage-total">
            <strong>{number(total.total)}</strong>
            <span>Recorded tokens</span>
          </div>
          <dl className="facts">
            {[
              ["Input", total.input],
              ["Output", total.output],
              ["Cache read", total.cacheRead],
              ["Cache creation", total.cacheWrite],
              ["Reported requests", total.requests],
              ["Usage unknown", total.unknown],
              ["Requests in progress", total.pending],
            ].map(([name, count]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{number(count)}</dd>
              </div>
            ))}
          </dl>
          <h3>By activity</h3>
          <dl className="facts">
            {Object.entries(total.groups).map(([kind, g]) => (
              <div key={kind}>
                <dt>
                  {
                    {
                      chat: "Chats",
                      module: "Modules",
                      connection: "Connection checks",
                    }[kind]
                  }
                </dt>
                <dd>
                  {number(g.input + g.output + g.cacheRead + g.cacheWrite)}{" "}
                  tokens{g.unknown > 0 ? ` / ${g.unknown} unknown` : ""}
                </dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            Recorded on this device since{" "}
            {new Date(data.startedAt).toLocaleString()}.{" "}
            {total.partial
              ? "This period includes dates before recording began. "
              : ""}
            {total.unknown
              ? "Some requests have no reported token count. "
              : ""}
            Not an account-wide total or a billing statement.
          </p>
          <p className="muted">
            Calendar boundaries use{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. Input, output
            and separately reported cache tokens are included.
          </p>
        </>
      ) : (
        <p className="muted">Choose a valid date range.</p>
      )}
    </section>
  );
}
