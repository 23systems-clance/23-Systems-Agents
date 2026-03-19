'use client';

import { useState, useEffect } from 'react';
import { WrenchIcon, TrashIcon, PlusIcon, CheckIcon, XIcon } from './icons.js';
import { getMCPServers, toggleMCPServer, deleteMCPServer, createMCPServer } from '../actions.js';
import { PageLayout } from './page-layout.js';

function AddServerForm({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('node');
  const [envPairs, setEnvPairs] = useState([{ key: '', value: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const addEnvRow = () => setEnvPairs([...envPairs, { key: '', value: '' }]);
  const removeEnvRow = (i) => setEnvPairs(envPairs.filter((_, idx) => idx !== i));
  const updateEnv = (i, field, val) => {
    const next = [...envPairs];
    next[i] = { ...next[i], [field]: val };
    setEnvPairs(next);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const env = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) {
          env[pair.key.trim()] = pair.value.trim() || `\${${pair.key.trim()}}`;
        }
      }
      const result = await createMCPServer({
        name: name.trim(),
        description: description.trim(),
        command: command.trim() || 'node',
        args: ['server.js'],
        env: Object.keys(env).length ? env : undefined,
      });
      if (result.error) {
        setError(result.error);
      } else {
        onCreated();
      }
    } catch (err) {
      setError(err.message || 'Failed to create server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Add MCP Server</h3>
        <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1">
          <XIcon size={14} />
        </button>
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium block mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-server"
            pattern="[a-z0-9][a-z0-9-]*"
            required
            className="w-full text-sm bg-background border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">Lowercase, hyphens allowed</p>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">Command</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="node"
            className="w-full text-sm bg-background border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">Default: node</p>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium block mb-1">Description</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What this server does"
          className="w-full text-sm bg-background border border-input rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div>
        <label className="text-xs font-medium block mb-1">Environment Variables</label>
        <p className="text-[10px] text-muted-foreground mb-2">
          Leave value empty to use <code className="font-mono bg-muted px-0.5 rounded">${'{VAR_NAME}'}</code> reference
        </p>
        {envPairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-2 mb-1.5">
            <input
              type="text"
              value={pair.key}
              onChange={(e) => updateEnv(i, 'key', e.target.value)}
              placeholder="VAR_NAME"
              className="flex-1 text-xs font-mono bg-background border border-input rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={pair.value}
              onChange={(e) => updateEnv(i, 'value', e.target.value)}
              placeholder="${VAR_NAME}"
              className="flex-1 text-xs font-mono bg-background border border-input rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {envPairs.length > 1 && (
              <button type="button" onClick={() => removeEnvRow(i)} className="text-muted-foreground hover:text-destructive p-1">
                <XIcon size={12} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addEnvRow}
          className="text-xs text-muted-foreground hover:text-foreground mt-1"
        >
          + Add variable
        </button>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Server'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
        >
          Cancel
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Creates <code className="font-mono bg-muted px-0.5 rounded">mcp-servers/{name || '...'}/</code> with
        a manifest, starter server.js, and package.json. Run <code className="font-mono bg-muted px-0.5 rounded">npm install</code> in the directory after creating.
      </p>
    </form>
  );
}

export function MCPServersPage({ session }) {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    try {
      const result = await getMCPServers();
      setServers(result || []);
    } catch (err) {
      console.error('Failed to load MCP servers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggle = async (name, currentActive) => {
    setBusy((prev) => ({ ...prev, [name]: true }));
    try {
      await toggleMCPServer(name, !currentActive);
      setServers((prev) =>
        prev.map((s) => (s.name === name ? { ...s, active: !currentActive } : s))
      );
    } catch (err) {
      console.error('Failed to toggle server:', err);
    } finally {
      setBusy((prev) => ({ ...prev, [name]: false }));
    }
  };

  const handleDelete = async (name) => {
    if (!confirm(`Delete MCP server "${name}"? This will remove its directory and all files.`)) return;
    setBusy((prev) => ({ ...prev, [name]: true }));
    try {
      await deleteMCPServer(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
    } catch (err) {
      console.error('Failed to delete server:', err);
    } finally {
      setBusy((prev) => ({ ...prev, [name]: false }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-md bg-border/50" />
        ))}
      </div>
    );
  }

  return (
    <PageLayout session={session}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">MCP Servers</h1>
      </div>
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          MCP servers provide tools to your agents via the Model Context Protocol.
        </p>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 shrink-0 ml-4"
          >
            <PlusIcon size={14} />
            Add Server
          </button>
        )}
      </div>

      {showAdd && (
        <div className="mb-4">
          <AddServerForm
            onCreated={() => {
              setShowAdd(false);
              setLoading(true);
              load();
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {servers.length === 0 && !showAdd ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <WrenchIcon size={32} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-2">No MCP servers found</p>
          <p className="text-xs text-muted-foreground mb-4">
            Add an MCP server to give your agents access to external tools and APIs.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90"
          >
            <PlusIcon size={14} />
            Add Server
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.name}
              className="flex items-center gap-4 rounded-lg border border-border p-4"
            >
              {/* Toggle */}
              <button
                type="button"
                onClick={() => handleToggle(server.name, server.active)}
                disabled={busy[server.name]}
                className="inline-flex items-center gap-2 group disabled:opacity-50 shrink-0"
                role="switch"
                aria-checked={server.active}
                aria-label={`Toggle ${server.name}`}
              >
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
                    server.active ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      server.active ? 'translate-x-4' : ''
                    }`}
                  />
                </span>
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{server.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {server.transport || 'stdio'}
                  </span>
                  {server.toolCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {server.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{server.description}</p>
                )}
                {server.env && server.env.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[10px] text-muted-foreground">Env:</span>
                    {server.env.map((key) => (
                      <span
                        key={key}
                        className={`text-[10px] font-mono px-1 py-0.5 rounded ${
                          server.envStatus?.[key]
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-destructive/10 text-destructive'
                        }`}
                        title={server.envStatus?.[key] ? `${key} is set` : `${key} is missing`}
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Delete */}
              <button
                onClick={() => handleDelete(server.name)}
                disabled={busy[server.name]}
                className="text-muted-foreground hover:text-destructive p-1.5 rounded-md hover:bg-muted disabled:opacity-50 shrink-0"
                title="Delete server"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Manifest format reference */}
      <div className="mt-8 border-t border-border pt-6">
        <h3 className="text-sm font-medium mb-2">MCP_SERVER.json Format</h3>
        <pre className="text-xs bg-muted rounded-md px-3 py-2 font-mono overflow-x-auto whitespace-pre">{`{
  "name": "my-server",
  "description": "What this server does",
  "transport": "stdio",
  "command": "node",
  "args": ["server.js"],
  "env": {
    "API_KEY": "\${API_KEY}"
  }
}`}</pre>
        <p className="text-xs text-muted-foreground mt-2">
          <code className="font-mono bg-muted px-1 rounded">{`\${VAR}`}</code> references are resolved from the process environment at runtime.
        </p>
      </div>
    </div>
    </PageLayout>
  );
}
