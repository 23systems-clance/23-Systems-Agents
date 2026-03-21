'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const TYPING_DELAY_MIN = 600;
const TYPING_DELAY_MAX = 1500;

function typingDelay() {
  return Math.random() * (TYPING_DELAY_MAX - TYPING_DELAY_MIN) + TYPING_DELAY_MIN;
}

// ── Summary generator ──
function generateSummary(profile) {
  return Object.entries(profile)
    .filter(([, v]) => v && v !== '')
    .map(([k, v]) => `**${k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:** ${v}`)
    .join('\n');
}

// ── Persona Selector ──
function PersonaSelector({ onSelect, config }) {
  const personas = config.personas || {};
  const personaKeys = Object.keys(personas);

  // If no personas defined, skip selector and go straight to chat
  useEffect(() => {
    if (personaKeys.length === 0) onSelect('default');
  }, [personaKeys.length, onSelect]);

  if (personaKeys.length === 0) return null;

  const accent = config.accent || '#4361ee';
  const teal = config.teal || '#3ec6e0';

  return (
    <div className="pc-persona-selector">
      <div className="pc-persona-header">
        <div className="pc-logo" style={{ color: accent }}>23 Systems</div>
        <h1 style={{
          background: `linear-gradient(135deg, ${accent}, ${teal})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {config.title || 'Get Started'}
        </h1>
        <p>{config.subtitle || ''}</p>
      </div>
      <div className="pc-persona-options">
        {personaKeys.map((key) => {
          const p = personas[key];
          return (
            <button key={key} className="pc-persona-card" onClick={() => onSelect(key)}
              style={{ '--pc-accent': accent }}>
              <h3>{p.label || key}</h3>
              <p>{p.description || ''}</p>
            </button>
          );
        })}
      </div>
      {config.features && (
        <div className="pc-persona-stats">
          {(config.devPreview?.metrics || []).slice(0, 4).map((m, i) => (
            <div key={i} className="pc-stat">
              <span className="pc-stat-value" style={{ color: accent }}>{m.value}</span>
              <span className="pc-stat-label">{m.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Typing Indicator ──
function TypingIndicator() {
  return (
    <div className="pc-typing">
      <span /><span /><span />
    </div>
  );
}

// ── Message Bubble ──
function MessageBubble({ text, role, accent }) {
  const html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return (
    <div className={`pc-message pc-message-${role}`}>
      {role === 'assistant' && (
        <div className="pc-avatar" style={{ background: `${accent}22`, color: accent }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </div>
      )}
      <div className="pc-bubble" dangerouslySetInnerHTML={{ __html: html }}
        style={role === 'user' ? { background: accent } : undefined} />
    </div>
  );
}

// ── Choice Buttons ──
function ChoiceInput({ options, onSelect, disabled, accent }) {
  return (
    <div className="pc-choices">
      {options.map((opt) => (
        <button
          key={opt.value}
          className="pc-choice-btn"
          onClick={() => onSelect(opt.value, opt.label)}
          disabled={disabled}
          style={{ '--pc-accent': accent }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Free Text Input ──
function FreeTextInput({ placeholder, onSubmit, disabled, accent }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!disabled && inputRef.current) inputRef.current.focus();
  }, [disabled]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSubmit(value.trim());
    setValue('');
  };

  return (
    <form className="pc-text-input" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      <button type="submit" disabled={!value.trim() || disabled} aria-label="Send"
        style={{ color: accent }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );
}

// ── Lead Gate Form ──
function LeadGateForm({ onSubmit, loading, error, config }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const accent = config.accent || '#4361ee';

  const handleSubmit = (e) => {
    e.preventDefault();
    if (honeypot) return;
    if (!name.trim() || !email.trim()) return;
    onSubmit({ name: name.trim(), email: email.trim() });
  };

  return (
    <form className="pc-lead-form" onSubmit={handleSubmit}>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Your name" required autoComplete="name" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address" required autoComplete="email" />
      <input type="text" value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', tabIndex: -1 }}
        autoComplete="off" aria-hidden="true" />
      <button type="submit" disabled={loading || !name.trim() || !email.trim()}
        style={{ background: accent }}>
        {loading ? 'Generating...' : (config.reportCta || 'Get My Report')}
      </button>
      {error && <p className="pc-error">{error}</p>}
    </form>
  );
}

// ── Report Ready Screen ──
function ReportReady({ reportUrl, config }) {
  const accent = config.accent || '#4361ee';
  return (
    <div className="pc-report-ready">
      <div className="pc-report-icon" style={{ color: '#22c55e' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>
      <h2>{config.reportReadyTitle || 'Your Report is Ready!'}</h2>
      <p>{config.reportReadyText || 'View your personalized report:'}</p>
      {reportUrl && (
        <a href={reportUrl} target="_blank" rel="noopener noreferrer"
          className="pc-report-btn" style={{ background: accent }}>
          View Report
        </a>
      )}
      {config.calendarUrl && (
        <div className="pc-cta-section">
          <p>Want to discuss your recommendations with our team?</p>
          <a href={config.calendarUrl} target="_blank" rel="noopener noreferrer" className="pc-book-btn">
            Book a Free Consultation
          </a>
        </div>
      )}
    </div>
  );
}

// ── Left Panel: Simple Mode ──
function SimplePanel({ config }) {
  const accent = config.accent || '#4361ee';
  const teal = config.teal || '#3ec6e0';
  return (
    <div className="pc-hero-panel">
      <div className="pc-badge" style={{ background: `${accent}22`, color: accent }}>
        {config.badge || 'AI-Powered'}
      </div>
      <h1>
        <span style={{
          background: `linear-gradient(135deg, ${accent}, ${teal})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {config.title || 'Get Started'}
        </span>
      </h1>
      <p className="pc-subtitle">{config.subtitle || ''}</p>
      {config.features && (
        <div className="pc-features">
          {config.features.map((f, i) => (
            <div key={i} className="pc-feature-item">
              <span className="pc-feature-icon" style={{ color: accent }}>&#9670;</span>
              <div>
                <strong>{f.title}</strong>
                <p>{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Left Panel: Dev Mode ──
function DevPanel({ config }) {
  const accent = config.accent || '#4361ee';
  const teal = config.teal || '#3ec6e0';
  const preview = config.devPreview || {};
  return (
    <div className="pc-dev-panel">
      <div className="pc-dev-tagline">{preview.tagline || `// ${config.agentName || 'advisor'}`}</div>
      {preview.json && (
        <div className="pc-dev-json">
          <pre style={{ color: teal }}>{JSON.stringify(preview.json, null, 2)}</pre>
        </div>
      )}
      {preview.metrics && (
        <div className="pc-metrics">
          {preview.metrics.map((m, i) => (
            <div key={i} className="pc-metric">
              <span style={{ color: accent }}>{m.value}</span>{m.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Chat Engine ──
function ConsultChat({ mode, conversationTree, config, skillId }) {
  const tree = conversationTree[mode] || conversationTree[Object.keys(conversationTree).find(k => k !== 'meta')] || {};
  const [messages, setMessages] = useState([]);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [profile, setProfile] = useState({});
  const [isTyping, setIsTyping] = useState(false);
  const [inputReady, setInputReady] = useState(false);
  const [phase, setPhase] = useState('chat');
  const [reportUrl, setReportUrl] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const accent = config.accent || '#4361ee';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, inputReady, scrollToBottom]);

  const showMessages = useCallback(async (nodeMessages, nodeProfile) => {
    setIsTyping(true);
    setInputReady(false);
    for (const msg of nodeMessages) {
      await new Promise((r) => setTimeout(r, typingDelay()));
      let text = msg;
      if (text.includes('{{GENERATED_SUMMARY}}')) {
        text = generateSummary(nodeProfile);
      }
      setMessages((prev) => [...prev, { role: 'assistant', text }]);
    }
    setIsTyping(false);
    setInputReady(true);
  }, []);

  useEffect(() => {
    if (!tree?.opening) return;
    setCurrentNodeId('opening');
    showMessages(tree.opening.messages, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const handleAnswer = useCallback((value, displayText) => {
    const node = tree[currentNodeId];
    if (!node) return;

    setMessages((prev) => [...prev, { role: 'user', text: displayText || value }]);

    const newProfile = { ...profile };
    if (node.input?.storeAs) {
      newProfile[node.input.storeAs] = value;
    }
    setProfile(newProfile);

    let nextId;
    if (typeof node.next === 'string') {
      nextId = node.next;
    } else if (typeof node.next === 'object') {
      nextId = node.next[value] || node.next.default;
    }

    if (!nextId) return;
    const nextNode = tree[nextId];
    if (!nextNode) return;

    setCurrentNodeId(nextId);

    if (nextNode.type === 'lead_gate') {
      showMessages(nextNode.messages, newProfile).then(() => {
        setPhase('lead_gate');
      });
      return;
    }

    showMessages(nextNode.messages, newProfile);
  }, [tree, currentNodeId, profile, showMessages]);

  const handleLeadSubmit = useCallback(async ({ name, email }) => {
    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/consult/${skillId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectProfile: profile,
          contactName: name,
          contactEmail: email,
          personaMode: mode,
          wantsPartners: profile.wantsPartners === 'yes',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      const data = await res.json();
      setReportUrl(data.reportUrl || '#');
      setPhase('done');
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitLoading(false);
    }
  }, [profile, mode, skillId]);

  const currentNode = tree?.[currentNodeId];
  const isDevMode = mode === 'dev';

  return (
    <div className={`pc-layout ${isDevMode ? 'pc-dev' : 'pc-simple'}`}>
      {/* Left Panel */}
      <div className="pc-panel-left">
        {isDevMode ? <DevPanel config={config} /> : <SimplePanel config={config} />}
      </div>

      {/* Right Panel — Chat */}
      <div className="pc-panel-right">
        <div className="pc-chat-header">
          <div className="pc-chat-avatar" style={{ background: `${accent}22`, color: accent }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </div>
          <div>
            <div className="pc-chat-name">{config.agentName || 'Advisor'}</div>
            <div className="pc-chat-status"><span className="pc-status-dot" />Online</div>
          </div>
        </div>

        <div className="pc-messages">
          {phase === 'done' ? (
            <ReportReady reportUrl={reportUrl} config={config} />
          ) : (
            <>
              {messages.map((msg, i) => (
                <MessageBubble key={i} text={msg.text} role={msg.role} accent={accent} />
              ))}
              {isTyping && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area — pinned to bottom */}
        {phase !== 'done' && (
          <div className="pc-input-area">
            {inputReady && phase === 'chat' && currentNode && currentNode.input && (
              currentNode.input.type === 'choice' ? (
                <ChoiceInput
                  options={currentNode.input.options}
                  onSelect={(val, label) => handleAnswer(val, label)}
                  disabled={isTyping}
                  accent={accent}
                />
              ) : (
                <FreeTextInput
                  placeholder={currentNode.input.placeholder || 'Type your answer...'}
                  onSubmit={(val) => handleAnswer(val)}
                  disabled={isTyping}
                  accent={accent}
                />
              )
            )}

            {phase === 'lead_gate' && (
              <LeadGateForm
                onSubmit={handleLeadSubmit}
                loading={submitLoading}
                error={submitError}
                config={config}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page Component ──
export function PublicConsultPage({ skillId, config, conversationTree }) {
  const [mode, setMode] = useState(null);
  const personas = config?.personas || {};
  const hasPersonas = Object.keys(personas).length > 0;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode');
    if (urlMode && personas[urlMode]) {
      setMode(urlMode);
      return;
    }
    const stored = sessionStorage.getItem(`pc-mode-${skillId}`);
    if (stored && personas[stored]) {
      setMode(stored);
    }
    if (!hasPersonas) {
      setMode('default');
    }
  }, [skillId, hasPersonas, personas]);

  const handleSelectMode = useCallback((selected) => {
    setMode(selected);
    sessionStorage.setItem(`pc-mode-${skillId}`, selected);
  }, [skillId]);

  if (!conversationTree) {
    return <div className="pc-error-page">This consultation is not available.</div>;
  }

  const safeConfig = config || {};

  return (
    <div className="pc-root">
      <style>{`
        /* ── Reset ── */
        .pc-root {
          min-height: 100vh;
          background: #0f0f1a;
          color: #e4e4ef;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .pc-root *, .pc-root *::before, .pc-root *::after {
          box-sizing: border-box;
        }
        .pc-error-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0f0f1a;
          color: #9ca3b0;
          font-size: 1.125rem;
        }

        /* ── Persona Selector ── */
        .pc-persona-selector {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          gap: 3rem;
        }
        .pc-persona-header {
          text-align: center;
          max-width: 600px;
        }
        .pc-logo {
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 1rem;
        }
        .pc-persona-header h1 {
          font-size: 2.5rem;
          font-weight: 700;
          margin: 0 0 1rem;
        }
        .pc-persona-header p {
          color: #9ca3b0;
          font-size: 1.125rem;
          line-height: 1.6;
        }
        .pc-persona-options {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1.5rem;
          max-width: 720px;
          width: 100%;
          margin: 0 auto;
        }
        @media (max-width: 640px) {
          .pc-persona-options { grid-template-columns: 1fr; }
          .pc-persona-header h1 { font-size: 1.75rem; }
        }
        .pc-persona-card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 2rem;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
          color: #e4e4ef;
        }
        .pc-persona-card:hover {
          border-color: var(--pc-accent, #4361ee);
          background: rgba(67,97,238,0.08);
          transform: translateY(-2px);
        }
        .pc-persona-card h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin: 0 0 0.5rem;
        }
        .pc-persona-card p {
          font-size: 0.875rem;
          color: #9ca3b0;
          margin: 0;
          line-height: 1.5;
        }
        .pc-persona-stats {
          display: flex;
          gap: 3rem;
        }
        .pc-stat { text-align: center; }
        .pc-stat-value {
          display: block;
          font-size: 1.25rem;
          font-weight: 700;
        }
        .pc-stat-label {
          font-size: 0.75rem;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* ── Chat Layout ── */
        .pc-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 100vh;
        }
        @media (max-width: 768px) {
          .pc-layout { grid-template-columns: 1fr; }
          .pc-panel-left { display: none; }
        }

        /* ── Left Panel (Simple — Hero) ── */
        .pc-hero-panel {
          padding: 3rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .pc-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 1.5rem;
          width: fit-content;
        }
        .pc-hero-panel h1 {
          font-size: 2.25rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 0 0 1rem;
        }
        .pc-subtitle {
          color: #9ca3b0;
          font-size: 1rem;
          line-height: 1.6;
          margin-bottom: 2rem;
        }
        .pc-features {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .pc-feature-item {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
        }
        .pc-feature-icon {
          font-size: 0.625rem;
          margin-top: 0.375rem;
          flex-shrink: 0;
        }
        .pc-feature-item strong {
          display: block;
          font-size: 0.875rem;
          margin-bottom: 0.125rem;
        }
        .pc-feature-item p {
          font-size: 0.8125rem;
          color: #9ca3b0;
          margin: 0;
        }

        /* ── Left Panel (Dev — Terminal) ── */
        .pc-dev-panel {
          padding: 3rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }
        .pc-dev-tagline {
          color: #6b7280;
          font-size: 0.875rem;
          margin-bottom: 1.5rem;
        }
        .pc-dev-json {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 2rem;
        }
        .pc-dev-json pre {
          margin: 0;
          font-size: 0.8125rem;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .pc-metrics {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.75rem;
        }
        .pc-metric {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
          font-size: 0.75rem;
          color: #9ca3b0;
        }
        .pc-metric span {
          display: block;
          font-size: 1.25rem;
          font-weight: 700;
          margin-bottom: 0.25rem;
        }

        /* ── Right Panel — Chat ── */
        .pc-panel-right {
          border-left: 1px solid rgba(255,255,255,0.06);
          display: flex;
          flex-direction: column;
          max-height: 100vh;
        }
        .pc-chat-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }
        .pc-chat-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .pc-chat-name {
          font-weight: 600;
          font-size: 0.875rem;
        }
        .pc-chat-status {
          font-size: 0.75rem;
          color: #6b7280;
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .pc-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22c55e;
          display: inline-block;
        }

        /* ── Messages ── */
        .pc-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .pc-input-area {
          flex-shrink: 0;
          padding: 1rem 1.5rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .pc-message {
          display: flex;
          gap: 0.5rem;
          max-width: 85%;
          animation: pc-fade-in 0.3s ease;
        }
        .pc-message-user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }
        .pc-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .pc-bubble {
          padding: 0.75rem 1rem;
          border-radius: 12px;
          font-size: 0.875rem;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .pc-message-assistant .pc-bubble {
          background: rgba(255,255,255,0.06);
          border-bottom-left-radius: 4px;
        }
        .pc-message-user .pc-bubble {
          color: #fff;
          border-bottom-right-radius: 4px;
        }

        @keyframes pc-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Typing Indicator ── */
        .pc-typing {
          display: flex;
          gap: 4px;
          padding: 0.75rem 1rem;
          background: rgba(255,255,255,0.06);
          border-radius: 12px;
          width: fit-content;
          animation: pc-fade-in 0.3s ease;
        }
        .pc-typing span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #6b7280;
          animation: pc-bounce 1.4s ease-in-out infinite;
        }
        .pc-typing span:nth-child(2) { animation-delay: 0.2s; }
        .pc-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes pc-bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }

        /* ── Choice Buttons ── */
        .pc-choices {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          animation: pc-fade-in 0.3s ease;
        }
        .pc-choice-btn {
          padding: 0.5rem 1rem;
          border-radius: 999px;
          border: 1px solid rgba(67,97,238,0.3);
          background: rgba(67,97,238,0.08);
          color: var(--pc-accent, #4361ee);
          font-size: 0.8125rem;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .pc-choice-btn:hover:not(:disabled) {
          background: var(--pc-accent, #4361ee);
          color: #fff;
          border-color: var(--pc-accent, #4361ee);
        }
        .pc-choice-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Text Input ── */
        .pc-text-input {
          display: flex;
          gap: 0.5rem;
          animation: pc-fade-in 0.3s ease;
        }
        .pc-text-input input {
          flex: 1;
          padding: 0.625rem 1rem;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: #e4e4ef;
          font-size: 0.875rem;
          outline: none;
        }
        .pc-text-input input:focus {
          border-color: rgba(67,97,238,0.5);
        }
        .pc-text-input button {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .pc-text-input button:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        /* ── Lead Gate Form ── */
        .pc-lead-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          animation: pc-fade-in 0.3s ease;
          position: relative;
        }
        .pc-lead-form input[type="text"],
        .pc-lead-form input[type="email"] {
          padding: 0.75rem 1rem;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: #e4e4ef;
          font-size: 0.875rem;
          outline: none;
        }
        .pc-lead-form input:focus {
          border-color: rgba(67,97,238,0.5);
        }
        .pc-lead-form button[type="submit"] {
          padding: 0.75rem;
          border-radius: 8px;
          border: none;
          color: #fff;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .pc-lead-form button[type="submit"]:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .pc-error {
          color: #ef4444;
          font-size: 0.8125rem;
          margin: 0;
        }

        /* ── Report Ready ── */
        .pc-report-ready {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 3rem 1.5rem;
          gap: 1rem;
          flex: 1;
        }
        .pc-report-ready h2 {
          font-size: 1.5rem;
          margin: 0;
        }
        .pc-report-ready p {
          color: #9ca3b0;
          margin: 0;
        }
        .pc-report-btn {
          display: inline-block;
          padding: 0.75rem 2rem;
          border-radius: 8px;
          color: #fff;
          text-decoration: none;
          font-weight: 600;
          font-size: 0.875rem;
          transition: opacity 0.15s;
        }
        .pc-report-btn:hover { opacity: 0.9; }
        .pc-cta-section {
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .pc-book-btn {
          display: inline-block;
          margin-top: 0.75rem;
          padding: 0.625rem 1.5rem;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 8px;
          color: #e4e4ef;
          text-decoration: none;
          font-size: 0.8125rem;
          transition: all 0.15s;
        }
        .pc-book-btn:hover {
          background: rgba(255,255,255,0.06);
        }
      `}</style>

      {!mode ? (
        <PersonaSelector onSelect={handleSelectMode} config={safeConfig} />
      ) : (
        <ConsultChat
          mode={mode}
          conversationTree={conversationTree}
          config={safeConfig}
          skillId={skillId}
        />
      )}
    </div>
  );
}
