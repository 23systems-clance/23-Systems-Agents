'use client';

import { useState, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { AppSidebar } from '../chat/components/app-sidebar.js';
import { SidebarProvider, SidebarInset } from '../chat/components/ui/sidebar.js';
import { ChatNavProvider } from '../chat/components/chat-nav-context.js';
import { ChatHeader } from '../chat/components/chat-header.js';
import { ConfirmDialog } from '../chat/components/ui/confirm-dialog.js';
import { cn } from '../chat/utils.js';
import {
  ensureCodeWorkspaceContainer,
  closeInteractiveMode,
  getContainerGitStatus,
  createTerminalSession,
  closeTerminalSession,
  listTerminalSessions,
} from './actions.js';

const TerminalView = dynamic(() => import('./terminal-view.js'), { ssr: false });

export default function CodePage({ session, codeWorkspaceId }) {
  const [dialogState, setDialogState] = useState('closed'); // 'closed' | 'loading' | 'safe' | 'warning' | 'error'
  const [gitStatus, setGitStatus] = useState(null);
  const [closing, setClosing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [tabs, setTabs] = useState([
    { id: 'claude-code', label: 'Code', type: 'claude' },
  ]);
  const [activeTabId, setActiveTabId] = useState('claude-code');
  const [creatingShell, setCreatingShell] = useState(false);
  const [closingTabId, setClosingTabId] = useState(null);

  // Restore existing shell sessions on mount
  useEffect(() => {
    listTerminalSessions(codeWorkspaceId).then((result) => {
      if (result?.success && result.sessions?.length > 0) {
        setTabs((prev) => [
          prev[0],
          ...result.sessions.map((s) => ({ id: s.id, label: s.label, type: 'shell' })),
        ]);
      }
    });
  }, [codeWorkspaceId]);

  const handleNewShell = useCallback(async () => {
    setCreatingShell(true);
    try {
      const result = await createTerminalSession(codeWorkspaceId);
      if (result?.success) {
        const newTab = { id: result.sessionId, label: result.label, type: 'shell' };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabId(result.sessionId);
      }
    } catch (err) {
      console.error('[CodePage] Failed to create shell:', err);
    } finally {
      setCreatingShell(false);
    }
  }, [codeWorkspaceId]);

  const handleCloseTab = useCallback(async (tabId) => {
    try {
      await closeTerminalSession(codeWorkspaceId, tabId);
    } catch {
      // Best effort
    }
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setActiveTabId((prev) => (prev === tabId ? 'claude-code' : prev));
  }, [codeWorkspaceId]);

  const handleOpenCloseDialog = useCallback(async () => {
    setDialogState('loading');
    setGitStatus(null);
    setErrorMessage('');
    try {
      const status = await getContainerGitStatus(codeWorkspaceId);
      setGitStatus(status);
      if (status?.hasUnsavedWork) {
        setDialogState('warning');
      } else {
        setDialogState('safe');
      }
    } catch (err) {
      console.error('[CodePage] Failed to check git status:', err);
      setDialogState('safe'); // fallback to simple confirm
    }
  }, [codeWorkspaceId]);

  const handleConfirmClose = useCallback(async () => {
    setClosing(true);
    setErrorMessage('');
    try {
      const result = await closeInteractiveMode(codeWorkspaceId, dialogState === 'safe');
      if (result?.success) {
        window.location.href = result.chatId ? `/chat/${result.chatId}` : '/';
      } else {
        const msg = result?.message || 'Failed to close session';
        console.error('[CodePage] closeInteractiveMode failed:', msg);
        setErrorMessage(msg);
        setDialogState('error');
        setClosing(false);
      }
    } catch (err) {
      console.error('[CodePage] closeInteractiveMode error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred');
      setDialogState('error');
      setClosing(false);
    }
  }, [codeWorkspaceId, dialogState]);

  const handleCancel = useCallback(() => {
    setDialogState('closed');
    setGitStatus(null);
  }, []);

  const isOpen = dialogState !== 'closed';

  // Build dialog props based on state
  let dialogTitle = 'Close this session?';
  let dialogDescription = '';
  let confirmLabel = 'Close Session';
  let variant = 'default';

  if (dialogState === 'loading') {
    dialogTitle = 'Checking session...';
    dialogDescription = '';
  } else if (dialogState === 'warning') {
    dialogTitle = 'Warning';
    variant = 'destructive';
    dialogDescription = 'Your session contains unsaved changes. To keep them, commit and push your changes before closing. If you close now, those changes will be lost.';
  }

  return (
    <ChatNavProvider value={{ activeChatId: null, navigateToChat: (id) => { window.location.href = id ? `/chat/${id}` : '/'; } }}>
      <SidebarProvider>
        <AppSidebar user={session.user} />
        <SidebarInset>
          <div className="flex h-svh flex-col overflow-hidden">
            <ChatHeader workspaceId={codeWorkspaceId} />

            {/* Tab bar */}
            <div className="flex items-end gap-0 px-4 bg-muted/30 border-b border-border shrink-0 overflow-hidden">
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id;
                return (
                  <div
                    key={tab.id}
                    className={cn(
                      'group flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium font-mono rounded-t-md border border-b-0 transition-colors cursor-pointer',
                      isActive
                        ? 'bg-background text-foreground border-border -mb-px'
                        : 'bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                    )}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    {tab.type === 'claude' ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <polyline points="4,12 4,4 12,4" />
                        <line x1="7" y1="4" x2="7" y2="12" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="4,6 2,8 4,10" />
                        <line x1="2" y1="8" x2="10" y2="8" />
                      </svg>
                    )}
                    <span>{tab.label}</span>
                    <button
                      className="ml-1 rounded-sm p-0.5 hover:bg-destructive/20 hover:text-destructive transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tab.type === 'claude') {
                          handleOpenCloseDialog();
                        } else {
                          setClosingTabId(tab.id);
                        }
                      }}
                      title={tab.type === 'claude' ? 'Close session' : 'Close shell'}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="4" y1="4" x2="12" y2="12" />
                        <line x1="12" y1="4" x2="4" y2="12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
              <button
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-default"
                onClick={handleNewShell}
                disabled={creatingShell}
                title="New shell terminal"
              >
                + Shell
              </button>
            </div>

            {/* Terminal panels — all mounted, hidden via display */}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                style={{
                  display: activeTabId === tab.id ? 'flex' : 'none',
                  flex: 1,
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <TerminalView
                  codeWorkspaceId={codeWorkspaceId}
                  wsPath={tab.type === 'claude'
                    ? `/code/${codeWorkspaceId}/ws`
                    : `/code/${codeWorkspaceId}/term/${tab.id}/ws`}
                  isActive={activeTabId === tab.id}
                  showToolbar={tab.type === 'claude'}
                  ensureContainer={tab.type === 'claude' ? ensureCodeWorkspaceContainer : undefined}
                  onCloseSession={tab.type === 'claude' ? handleOpenCloseDialog : undefined}
                />
              </div>
            ))}
          </div>
          {dialogState === 'loading' && isOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="fixed inset-0 bg-black/50" />
              <div className="relative z-50 w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg flex flex-col items-center gap-3">
                <svg className="animate-spin h-5 w-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm text-muted-foreground">Checking session...</span>
              </div>
            </div>
          )}
          {(dialogState === 'safe' || dialogState === 'warning') && (
            <ConfirmDialog
              open
              title={dialogState === 'warning' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#ef4444' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.57 3.22L1.51 15.01c-.63 1.09.16 2.49 1.43 2.49h14.12c1.27 0 2.06-1.4 1.43-2.49L11.43 3.22c-.63-1.09-2.23-1.09-2.86 0z" fill="#ef4444" />
                    <path d="M10 8v3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="10" cy="13.5" r="0.75" fill="white" />
                  </svg>
                  Warning
                </span>
              ) : dialogTitle}
              description={dialogDescription}
              confirmLabel={closing ? 'Closing...' : confirmLabel}
              variant={variant}
              onConfirm={handleConfirmClose}
              onCancel={handleCancel}
            />
          )}
          {dialogState === 'error' && (
            <ConfirmDialog
              open
              title="Failed to close session"
              description={errorMessage}
              confirmLabel="Retry"
              variant="destructive"
              onConfirm={handleConfirmClose}
              onCancel={handleCancel}
            />
          )}
          {closingTabId && (
            <ConfirmDialog
              open
              title="Close terminal?"
              description="This will end the shell session."
              confirmLabel="Close"
              variant="default"
              onConfirm={() => {
                handleCloseTab(closingTabId);
                setClosingTabId(null);
              }}
              onCancel={() => setClosingTabId(null)}
            />
          )}
        </SidebarInset>
      </SidebarProvider>
    </ChatNavProvider>
  );
}
