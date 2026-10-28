import React, { useState } from "react";
import {
  Upload,
  FileJson,
  Search,
  ArrowUpRight,
  ChevronLeft,
  Database,
  ShieldCheck,
} from "lucide-react";
import { resolveRef, SOURCE_URL } from "../shared/domain.mjs";
import { caseOperationAccess } from "../shared/case-policy.mjs";
import { api } from "./bridge";

function JsonTree({ value, name, onRef, depth = 0 }) {
  if (depth > 30) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  if (value === null || typeof value !== "object")
    return (
      <div className="json-leaf">
        <span>{name}: </span>
        {name === "$ref" && typeof value === "string" ? (
          <button className="text-link" onClick={() => onRef(value)}>
            {String(value)}
          </button>
        ) : (
          <code>{JSON.stringify(value)}</code>
        )}
      </div>
    );
  const entries = Object.entries(value);
  return (
    <details className="json-node" open={depth < 2}>
      <summary>
        {name || "Definition"}{" "}
        <span className="muted">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </span>
      </summary>
      <div>
        {entries.map(([k, v]) => (
          <JsonTree
            key={k}
            name={k}
            value={v}
            onRef={onRef}
            depth={depth + 1}
          />
        ))}
      </div>
    </details>
  );
}

export default function Library({ library, setLibrary, run }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("operations");
  const [selected, setSelected] = useState(null);
  const [reference, setReference] = useState(null);
  const [group, setGroup] = useState("All groups");
  const [access, setAccess] = useState("get");
  const importSpec = () =>
    run(async () => {
      const result = await api["import-spec"]();
      if (result) {
        setLibrary(result);
        setSelected(null);
        setReference(null);
        setAccess("get");
      }
    });
  const onRef = (ref) => {
    const value = resolveRef(library.spec, ref);
    setReference({ name: ref, value });
  };
  const entries = library
    ? mode === "operations"
      ? library.operations.filter(
          (op) =>
            caseOperationAccess(op).group === access &&
            (group === "All groups" || op.group === group) &&
            `${op.id} ${op.summary} ${op.description}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
      : Object.entries(library.schemas).filter(([name]) =>
          name.toLowerCase().includes(query.toLowerCase()),
        )
    : [];
  return (
    <section className="page library-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">REFERENCE</p>
          <h1>API library</h1>
        </div>
        <button className="primary" onClick={importSpec}>
          <Upload size={16} /> Import JSON
        </button>
      </header>
      <div className="notice" role="status">
        <ShieldCheck size={18} />
        <span>API library: offline reference. Live access off.</span>
      </div>
      {!library ? (
        <>
          <div className="archive-status">
            <FileJson size={40} strokeWidth={1.25} />
            <div>
              <h2>OpenAPI reference</h2>
              <p className="muted">Raw specification pending</p>
            </div>
            <span className="badge amber">Awaiting import</span>
          </div>
          <div className="empty-reference">
            <h3>Bring your reference</h3>
            <p>Import a Swagger 2.0 or OpenAPI 3.x JSON file. Original bytes and their SHA-256 fingerprint are preserved locally.</p>
            <div className="notice">
              <ShieldCheck size={18} />
              <span>
                Local reference only. No API requests are sent.
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="library-stats">
            <strong>{library.title}</strong>
            <span>{library.operations.length} operations</span>
            <span>{Object.keys(library.schemas).length} schemas</span>
            <span className="badge green">Archived</span>
          </div>
          <div className="library-toolbar">
            <div className="segments">
              <button
                aria-pressed={mode === "operations"}
                onClick={() => {
                  setMode("operations");
                  setSelected(null);
                }}
              >
                Operations
              </button>
              <button
                aria-pressed={mode === "schemas"}
                onClick={() => {
                  setMode("schemas");
                  setSelected(null);
                }}
              >
                Schemas
              </button>
            </div>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="Search API library"
                placeholder="Search the local reference"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {mode === "operations" && (
              <select
                aria-label="API access category"
                value={access}
                onChange={(e) => {
                  setAccess(e.target.value);
                  setSelected(null);
                  setReference(null);
                }}
              >
                <option value="get">GET reference</option>
                <option value="blocked">Blocked reference</option>
              </select>
            )}
            {mode === "operations" && (
              <select
                aria-label="API group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                {[
                  "All groups",
                  ...new Set(library.operations.map((o) => o.group)),
                ].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            )}
          </div>
          <div className="api-grid">
            <div className="api-list">
              {entries.length ? (
                entries.map((item) => {
                  const id = mode === "operations" ? item.id : item[0];
                  return (
                    <button
                      key={id}
                      className={`api-row ${selected?.id === id ? "selected" : ""}`}
                      onClick={() => {
                        setSelected(
                          mode === "operations"
                            ? item
                            : { id, summary: id, operation: item[1] },
                        );
                        setReference(null);
                      }}
                    >
                      {mode === "operations" && (
                        <span className={`method ${item.method.toLowerCase()}`}>
                          {item.method}
                        </span>
                      )}
                      <span>
                        <strong>
                          {mode === "operations" ? item.path : item[0]}
                        </strong>
                        {mode === "operations" && (
                          <small>
                            {item.summary}{" "}
                            {item.deprecated ? "(deprecated)" : ""}
                          </small>
                        )}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="muted pad">No matching entries.</p>
              )}
            </div>
            <div className="api-detail">
              {reference ? (
                <>
                  <button
                    className="text-link"
                    onClick={() => setReference(null)}
                  >
                    <ChevronLeft size={16} /> Back to definition
                  </button>
                  <h3>{reference.name}</h3>
                  {reference.value === undefined ? (
                    <p>
                      Reference is external or unresolved. Nothing was fetched.
                    </p>
                  ) : (
                    <JsonTree value={reference.value} onRef={onRef} />
                  )}
                </>
              ) : selected ? (
                <>
                  <p className="eyebrow">{selected.method || "SCHEMA"}</p>
                  <h2>{selected.path || selected.summary}</h2>
                  {selected.method && <p>{selected.summary}</p>}
                  {selected.method && (
                    <p className="badge amber">
                      {caseOperationAccess(selected).label}
                    </p>
                  )}
                  {selected.deprecated && (
                    <p className="badge amber">
                      Deprecated in the imported specification
                    </p>
                  )}
                  {selected.pathParameters?.length > 0 && (
                    <JsonTree
                      name="Path-level parameters"
                      value={selected.pathParameters}
                      onRef={onRef}
                    />
                  )}
                  <JsonTree value={selected.operation} onRef={onRef} />
                </>
              ) : (
                <div className="empty-detail">
                  <Database size={28} />
                  <p>Select an operation or schema</p>
                </div>
              )}
            </div>
          </div>
          <details className="provenance">
            <summary>Snapshot provenance</summary>
            <dl className="facts">
              <div>
                <dt>SHA-256</dt>
                <dd>
                  <code>{library.manifest.sha256}</code>
                </dd>
              </div>
              <div>
                <dt>Imported</dt>
                <dd>{library.manifest.importedAt}</dd>
              </div>
              <div>
                <dt>Original file</dt>
                <dd>{library.manifest.originalName}</dd>
              </div>
              <div>
                <dt>Origin</dt>
                <dd>{library.manifest.sourceAttribution}</dd>
              </div>
            </dl>
          </details>
        </>
      )}
    </section>
  );
}
