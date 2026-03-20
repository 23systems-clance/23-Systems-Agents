'use client';

import { useState } from 'react';
import { searchToolsOnline, installMCPFromPackage, installMCPFromUrl } from '../actions.js';

/**
 * Modal for discovering and installing new tools.
 * Two tabs: "Search" (LLM finds tools) and "Connect" (manual URL/package).
 */
export function AddToolModal({ onClose, onInstalled }) {
  const [tab, setTab] = useState('search');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [installing, setInstalling] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Manual connect state
  const [connectMode, setConnectMode] = useState('package'); // 'package' or 'url'
  const [manualName, setManualName] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualPackage, setManualPackage] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');
  const [manualInstalling, setManualInstalling] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const res = await searchToolsOnline(query);
      if (res.success) {
        setResults(res.results);
      } else {
        setError(res.error || 'Search failed');
      }
    } catch (err) {
      setError('Search failed. Try again.');
    } finally {
      setSearching(false);
    }
  };

  const handleInstallResult = async (result) => {
    setInstalling(result.name);
    setError(null);
    setSuccess(null);
    try {
      const env = {};
      if (result.setupNotes && result.setupNotes.includes('API')) {
        // Prompt will show in setup notes — user can configure env later
      }

      const res = await installMCPFromPackage({
        name: result.name,
        description: result.description,
        npmPackage: result.npmPackage || result.name,
        env,
      });

      if (res.success) {
        setSuccess(`Installed "${result.displayName || result.name}" successfully!`);
        onInstalled?.({
          id: res.toolId,
          name: result.displayName || result.name,
          desc: result.description,
          type: 'mcp',
        });
      } else {
        setError(res.error || 'Installation failed');
      }
    } catch (err) {
      setError(err.message || 'Installation failed');
    } finally {
      setInstalling(null);
    }
  };

  const handleManualInstall = async () => {
    if (!manualName.trim()) return;
    setManualInstalling(true);
    setError(null);
    setSuccess(null);

    try {
      let res;
      if (connectMode === 'package') {
        if (!manualPackage.trim()) {
          setError('Package name is required');
          setManualInstalling(false);
          return;
        }
        res = await installMCPFromPackage({
          name: manualName.trim(),
          description: manualDesc.trim(),
          npmPackage: manualPackage.trim(),
        });
      } else {
        if (!manualUrl.trim()) {
          setError('URL is required');
          setManualInstalling(false);
          return;
        }
        const headers = manualApiKey.trim()
          ? { Authorization: `Bearer ${manualApiKey.trim()}` }
          : undefined;
        res = await installMCPFromUrl({
          name: manualName.trim(),
          description: manualDesc.trim(),
          url: manualUrl.trim(),
          headers,
        });
      }

      if (res.success) {
        setSuccess(`Installed "${manualName}" successfully!`);
        onInstalled?.({
          id: res.toolId,
          name: manualDesc || manualName,
          desc: manualDesc || `MCP server: ${manualName}`,
          type: 'mcp',
        });
        // Reset form
        setManualName('');
        setManualDesc('');
        setManualPackage('');
        setManualUrl('');
        setManualApiKey('');
      } else {
        setError(res.error || 'Installation failed');
      }
    } catch (err) {
      setError(err.message || 'Installation failed');
    } finally {
      setManualInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Add a Tool</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('search')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === 'search'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <SearchIcon />
              Search
            </span>
          </button>
          <button
            onClick={() => setTab('connect')}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === 'connect'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <LinkIcon />
              Connect
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'search' && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                Describe what you need and we'll find the right MCP tool for it.
              </p>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="e.g., Google Sheets integration, Stripe payments, send emails..."
                  className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={handleSearch}
                  disabled={searching || !query.trim()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </div>

              {searching && (
                <div className="flex items-center justify-center py-8">
                  <SpinnerIcon />
                  <span className="ml-2 text-sm text-muted-foreground">Finding tools...</span>
                </div>
              )}

              {results.length > 0 && (
                <div className="space-y-3">
                  {results.map((result, i) => (
                    <div key={i} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-medium">{result.displayName || result.name}</h4>
                            {result.npmPackage && (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                npm
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mb-1.5">{result.description}</p>
                          {result.npmPackage && (
                            <code className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                              {result.npmPackage}
                            </code>
                          )}
                          {result.setupNotes && (
                            <p className="text-[10px] text-amber-600 mt-1.5 flex items-start gap-1">
                              <InfoIcon className="w-3 h-3 mt-0.5 shrink-0" />
                              {result.setupNotes}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleInstallResult(result)}
                          disabled={installing === result.name || !result.npmPackage}
                          className="shrink-0 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                        >
                          {installing === result.name ? (
                            <span className="flex items-center gap-1.5">
                              <SpinnerIcon />
                              Installing...
                            </span>
                          ) : !result.npmPackage ? (
                            'No package'
                          ) : (
                            'Install'
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!searching && results.length === 0 && query && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No results yet. Try searching above.
                </p>
              )}
            </div>
          )}

          {tab === 'connect' && (
            <div>
              <p className="text-xs text-muted-foreground mb-4">
                Connect a tool by providing an npm package name or an MCP server URL.
              </p>

              {/* Connect mode toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setConnectMode('package')}
                  className={`flex-1 rounded-lg border p-2.5 text-xs font-medium transition-colors ${
                    connectMode === 'package'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  npm Package
                </button>
                <button
                  onClick={() => setConnectMode('url')}
                  className={`flex-1 rounded-lg border p-2.5 text-xs font-medium transition-colors ${
                    connectMode === 'url'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/30'
                  }`}
                >
                  MCP Server URL
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Tool Name</label>
                  <input
                    type="text"
                    value={manualName}
                    onChange={e => setManualName(e.target.value)}
                    placeholder="e.g., google-sheets"
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Lowercase letters, numbers, and hyphens only</p>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Description</label>
                  <input
                    type="text"
                    value={manualDesc}
                    onChange={e => setManualDesc(e.target.value)}
                    placeholder="What does this tool do?"
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {connectMode === 'package' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">npm Package</label>
                    <input
                      type="text"
                      value={manualPackage}
                      onChange={e => setManualPackage(e.target.value)}
                      placeholder="e.g., @modelcontextprotocol/server-github"
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                    />
                  </div>
                )}

                {connectMode === 'url' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1">Server URL</label>
                      <input
                        type="url"
                        value={manualUrl}
                        onChange={e => setManualUrl(e.target.value)}
                        placeholder="https://your-mcp-server.com/sse"
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        API Key <span className="text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <input
                        type="password"
                        value={manualApiKey}
                        onChange={e => setManualApiKey(e.target.value)}
                        placeholder="Bearer token or API key"
                        className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </>
                )}

                <button
                  onClick={handleManualInstall}
                  disabled={manualInstalling || !manualName.trim()}
                  className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {manualInstalling ? (
                    <span className="flex items-center justify-center gap-2">
                      <SpinnerIcon />
                      Installing...
                    </span>
                  ) : (
                    'Install Tool'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        {(error || success) && (
          <div className={`px-4 py-3 border-t text-sm ${
            error
              ? 'border-red-500/20 bg-red-500/5 text-red-600'
              : 'border-green-500/20 bg-green-500/5 text-green-600'
          }`}>
            {error || success}
          </div>
        )}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeOpacity="1" />
    </svg>
  );
}

function InfoIcon({ className }) {
  return (
    <svg className={className || "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
