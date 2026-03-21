'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

const TYPING_DELAY_MIN = 600;
const TYPING_DELAY_MAX = 1500;

function typingDelay() {
  return Math.random() * (TYPING_DELAY_MAX - TYPING_DELAY_MIN) + TYPING_DELAY_MIN;
}

// ── Summary generator ──
function generateSummary(profile) {
  const lines = [];
  if (profile.projectDescription) lines.push(`**Project:** ${profile.projectDescription}`);
  if (profile.projectStage) lines.push(`**Stage:** ${profile.projectStage}`);
  if (profile.teamSize) lines.push(`**Team:** ${profile.teamSize}`);
  if (profile.currentStack) lines.push(`**Current Stack:** ${profile.currentStack}`);
  if (profile.realtimeNeeds) lines.push(`**Real-time:** ${profile.realtimeNeeds}`);
  if (profile.expectedScale) lines.push(`**Scale:** ${profile.expectedScale}`);
  if (profile.integrations) lines.push(`**Integrations:** ${profile.integrations}`);
  if (profile.budget) lines.push(`**Budget:** ${profile.budget}`);
  if (profile.complianceNeeded) lines.push(`**Compliance:** ${profile.complianceNeeded}`);
  if (profile.complianceDetails) lines.push(`**Compliance Details:** ${profile.complianceDetails}`);
  if (profile.dxVsPerf) lines.push(`**DX vs Performance:** ${profile.dxVsPerf}`);
  if (profile.hostingPreference) lines.push(`**Hosting Preference:** ${profile.hostingPreference}`);
  if (profile.constraints) lines.push(`**Constraints:** ${profile.constraints}`);
  if (profile.timeline) lines.push(`**Timeline:** ${profile.timeline}`);
  return lines.join('\n');
}

// ── Persona Selector ──
function PersonaSelector({ onSelect }) {
  return (
    <div className="consult-persona-selector">
      <div className="consult-persona-header">
        <div className="consult-logo">23 Systems</div>
        <h1>Find Your Perfect Tech Stack</h1>
        <p>AI-powered technology recommendations tailored to your project, team, and goals.</p>
      </div>
      <div className="consult-persona-options">
        <button className="consult-persona-card" onClick={() => onSelect('simple')}>
          <div className="consult-persona-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z" />
              <path d="M12 12L20 7.5" />
              <path d="M12 12V21" />
              <path d="M12 12L4 7.5" />
            </svg>
          </div>
          <h3>I&apos;m a founder or PM</h3>
          <p>Plain language, business-focused recommendations with cost and timeline guidance.</p>
        </button>
        <button className="consult-persona-card" onClick={() => onSelect('dev')}>
          <div className="consult-persona-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
              <line x1="12" y1="2" x2="12" y2="22" opacity="0.3" />
            </svg>
          </div>
          <h3>I&apos;m a developer or CTO</h3>
          <p>Technical deep-dive with architecture patterns, library choices, and performance tradeoffs.</p>
        </button>
      </div>
      <div className="consult-persona-stats">
        <div className="consult-stat">
          <span className="consult-stat-value">8</span>
          <span className="consult-stat-label">Categories</span>
        </div>
        <div className="consult-stat">
          <span className="consult-stat-value">2-5m</span>
          <span className="consult-stat-label">Duration</span>
        </div>
        <div className="consult-stat">
          <span className="consult-stat-value">Free</span>
          <span className="consult-stat-label">Cost</span>
        </div>
        <div className="consult-stat">
          <span className="consult-stat-value">PDF</span>
          <span className="consult-stat-label">Report</span>
        </div>
      </div>
    </div>
  );
}

// ── Typing Indicator ──
function TypingIndicator() {
  return (
    <div className="consult-typing">
      <span /><span /><span />
    </div>
  );
}

// ── Message Bubble ──
function MessageBubble({ text, role }) {
  // Simple bold markdown support
  const html = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  return (
    <div className={`consult-message consult-message-${role}`}>
      {role === 'assistant' && (
        <div className="consult-avatar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </div>
      )}
      <div className="consult-bubble" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ── Choice Buttons ──
function ChoiceInput({ options, onSelect, disabled }) {
  return (
    <div className="consult-choices">
      {options.map((opt) => (
        <button
          key={opt.value}
          className="consult-choice-btn"
          onClick={() => onSelect(opt.value, opt.label)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Free Text Input ──
function FreeTextInput({ placeholder, onSubmit, disabled }) {
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
    <form className="consult-text-input" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      <button type="submit" disabled={!value.trim() || disabled} aria-label="Send">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </form>
  );
}

// ── Lead Gate Form ──
function LeadGateForm({ onSubmit, loading, error }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (honeypot) return; // bot trap
    if (!name.trim() || !email.trim()) return;
    onSubmit({ name: name.trim(), email: email.trim() });
  };

  return (
    <form className="consult-lead-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        required
        autoComplete="name"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        required
        autoComplete="email"
      />
      {/* honeypot — hidden from humans */}
      <input
        type="text"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', tabIndex: -1 }}
        autoComplete="off"
        aria-hidden="true"
      />
      <button type="submit" disabled={loading || !name.trim() || !email.trim()}>
        {loading ? 'Generating your report...' : 'Get My Tech Stack Report'}
      </button>
      {error && <p className="consult-error">{error}</p>}
    </form>
  );
}

// ── Report Ready Screen ──
function ReportReady({ reportUrl }) {
  return (
    <div className="consult-report-ready">
      <div className="consult-report-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>
      <h2>Your Tech Stack Report is Ready!</h2>
      <p>We&apos;ve sent a copy to your email. You can also view it now:</p>
      <a href={reportUrl} target="_blank" rel="noopener noreferrer" className="consult-report-btn">
        View Report
      </a>
      <div className="consult-cta-section">
        <p>Want to discuss your recommendations with our team?</p>
        <a href="https://cal.com/23systems" target="_blank" rel="noopener noreferrer" className="consult-book-btn">
          Book a Free Consultation
        </a>
      </div>
    </div>
  );
}

// ── Main Chat Engine ──
function ConsultChat({ mode, conversationTree }) {
  const tree = conversationTree[mode];
  const [messages, setMessages] = useState([]);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [profile, setProfile] = useState({});
  const [isTyping, setIsTyping] = useState(false);
  const [inputReady, setInputReady] = useState(false);
  const [phase, setPhase] = useState('chat'); // chat | lead_gate | loading | done
  const [reportUrl, setReportUrl] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, inputReady, scrollToBottom]);

  // Display assistant messages one by one with typing delay
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

  // Start conversation
  useEffect(() => {
    if (!tree) return;
    const startNode = tree.opening;
    setCurrentNodeId('opening');
    showMessages(startNode.messages, profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const handleAnswer = useCallback((value, displayText) => {
    const node = tree[currentNodeId];
    if (!node) return;

    // Show user's response
    setMessages((prev) => [...prev, { role: 'user', text: displayText || value }]);

    // Store answer
    const newProfile = { ...profile };
    if (node.input?.storeAs) {
      newProfile[node.input.storeAs] = value;
    }
    setProfile(newProfile);

    // Determine next node
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

    // Check if next node is lead_gate
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
      const res = await fetch('/api/consult', {
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
  }, [profile, mode]);

  const currentNode = tree?.[currentNodeId];
  const isDevMode = mode === 'dev';

  return (
    <div className={`consult-layout ${isDevMode ? 'consult-dev' : 'consult-simple'}`}>
      {/* Left Panel */}
      <div className="consult-panel-left">
        {isDevMode ? (
          <div className="consult-dev-panel">
            <div className="consult-dev-tagline">// tech-stack-advisor</div>
            <div className="consult-dev-json">
              <pre>{JSON.stringify({
                categories: ['Frontend', 'Backend', 'Database', 'Hosting', 'Auth', 'Payments', 'DevOps', 'Monitoring'],
                output: 'architecture + alternatives + tradeoffs',
                confidence: '0.0 - 1.0 per category',
              }, null, 2)}</pre>
            </div>
            <div className="consult-metrics">
              <div className="consult-metric"><span>8</span>Categories</div>
              <div className="consult-metric"><span>2-5m</span>Duration</div>
              <div className="consult-metric"><span>Free</span>Cost</div>
              <div className="consult-metric"><span>PDF</span>Report</div>
            </div>
          </div>
        ) : (
          <div className="consult-hero-panel">
            <div className="consult-badge">AI-Powered</div>
            <h1>Find your perfect <span className="consult-gradient-text">tech stack</span></h1>
            <p className="consult-subtitle">Answer a few questions, get a complete technology recommendation with architecture diagrams, alternatives, and tradeoff analysis.</p>
            <div className="consult-features">
              <div className="consult-feature-item">
                <span className="consult-feature-icon">&#9670;</span>
                <div>
                  <strong>Personalized Recommendations</strong>
                  <p>Tailored to your project, team, and timeline</p>
                </div>
              </div>
              <div className="consult-feature-item">
                <span className="consult-feature-icon">&#9670;</span>
                <div>
                  <strong>8 Technology Categories</strong>
                  <p>Frontend, backend, database, hosting, and more</p>
                </div>
              </div>
              <div className="consult-feature-item">
                <span className="consult-feature-icon">&#9670;</span>
                <div>
                  <strong>Branded PDF Report</strong>
                  <p>Architecture diagrams and detailed reasoning</p>
                </div>
              </div>
              <div className="consult-feature-item">
                <span className="consult-feature-icon">&#9670;</span>
                <div>
                  <strong>Partner Resources</strong>
                  <p>Cloud credits and startup programs matched to your stack</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right Panel — Chat */}
      <div className="consult-panel-right">
        <div className="consult-chat-header">
          <div className="consult-chat-avatar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          </div>
          <div>
            <div className="consult-chat-name">Tech Stack Advisor</div>
            <div className="consult-chat-status">
              <span className="consult-status-dot" />Online
            </div>
          </div>
        </div>

        <div className="consult-messages">
          {phase === 'done' ? (
            <ReportReady reportUrl={reportUrl} />
          ) : (
            <>
              {messages.map((msg, i) => (
                <MessageBubble key={i} text={msg.text} role={msg.role} />
              ))}
              {isTyping && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area — pinned to bottom, outside scrollable messages */}
        {phase !== 'done' && (
          <div className="consult-input-area">
            {inputReady && phase === 'chat' && currentNode && currentNode.input && (
              currentNode.input.type === 'choice' ? (
                <ChoiceInput
                  options={currentNode.input.options}
                  onSelect={(val, label) => handleAnswer(val, label)}
                  disabled={isTyping}
                />
              ) : (
                <FreeTextInput
                  placeholder={currentNode.input.placeholder || 'Type your answer...'}
                  onSubmit={(val) => handleAnswer(val)}
                  disabled={isTyping}
                />
              )
            )}

            {phase === 'lead_gate' && (
              <LeadGateForm
                onSubmit={handleLeadSubmit}
                loading={submitLoading}
                error={submitError}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page Component ──
export function ConsultPage({ conversationTree }) {
  const [mode, setMode] = useState(null);

  // Check URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode');
    if (urlMode === 'simple' || urlMode === 'dev') {
      setMode(urlMode);
    }
    // Also check sessionStorage
    const stored = sessionStorage.getItem('consult-mode');
    if (stored === 'simple' || stored === 'dev') {
      setMode(stored);
    }
  }, []);

  const handlePersonaSelect = (selected) => {
    setMode(selected);
    sessionStorage.setItem('consult-mode', selected);
  };

  return (
    <>
      <style>{`
        /* ── Consult Page Styles ── */
        .consult-page {
          min-height: 100vh;
          background: #0f0f1a;
          color: #e4e4ef;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        /* ── Persona Selector ── */
        .consult-persona-selector {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          gap: 3rem;
        }
        .consult-persona-header {
          text-align: center;
          max-width: 600px;
        }
        .consult-logo {
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #4361ee;
          margin-bottom: 1rem;
        }
        .consult-persona-header h1 {
          font-size: 2.5rem;
          font-weight: 700;
          margin: 0 0 1rem;
          background: linear-gradient(135deg, #4361ee, #3ec6e0);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .consult-persona-header p {
          color: #9ca3b0;
          font-size: 1.125rem;
          line-height: 1.6;
        }
        .consult-persona-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.5rem;
          max-width: 720px;
          width: 100%;
          margin: 0 auto;
        }
        @media (max-width: 640px) {
          .consult-persona-options {
            grid-template-columns: 1fr;
          }
          .consult-persona-header h1 {
            font-size: 1.75rem;
          }
        }
        .consult-persona-card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 2rem;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s;
          color: #e4e4ef;
        }
        .consult-persona-card:hover {
          border-color: #4361ee;
          background: rgba(67,97,238,0.08);
          transform: translateY(-2px);
        }
        .consult-persona-icon {
          width: 48px;
          height: 48px;
          border-radius: 10px;
          background: rgba(67,97,238,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1rem;
          color: #4361ee;
        }
        .consult-persona-card h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin: 0 0 0.5rem;
        }
        .consult-persona-card p {
          font-size: 0.875rem;
          color: #9ca3b0;
          margin: 0;
          line-height: 1.5;
        }
        .consult-persona-stats {
          display: flex;
          gap: 3rem;
        }
        .consult-stat {
          text-align: center;
        }
        .consult-stat-value {
          display: block;
          font-size: 1.25rem;
          font-weight: 700;
          color: #4361ee;
        }
        .consult-stat-label {
          font-size: 0.75rem;
          color: #6b7280;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* ── Chat Layout ── */
        .consult-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 100vh;
        }
        @media (max-width: 768px) {
          .consult-layout {
            grid-template-columns: 1fr;
          }
          .consult-panel-left {
            display: none;
          }
        }

        /* ── Left Panel (Simple — Hero) ── */
        .consult-hero-panel {
          padding: 3rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .consult-badge {
          display: inline-block;
          padding: 0.25rem 0.75rem;
          background: rgba(67,97,238,0.15);
          color: #4361ee;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 1.5rem;
          width: fit-content;
        }
        .consult-hero-panel h1 {
          font-size: 2.25rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 0 0 1rem;
        }
        .consult-gradient-text {
          background: linear-gradient(135deg, #4361ee, #3ec6e0);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .consult-subtitle {
          color: #9ca3b0;
          font-size: 1rem;
          line-height: 1.6;
          margin-bottom: 2rem;
        }
        .consult-features {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .consult-feature-item {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
        }
        .consult-feature-icon {
          color: #4361ee;
          font-size: 0.625rem;
          margin-top: 0.375rem;
          flex-shrink: 0;
        }
        .consult-feature-item strong {
          display: block;
          font-size: 0.875rem;
          margin-bottom: 0.125rem;
        }
        .consult-feature-item p {
          font-size: 0.8125rem;
          color: #9ca3b0;
          margin: 0;
        }

        /* ── Left Panel (Dev — Terminal) ── */
        .consult-dev-panel {
          padding: 3rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }
        .consult-dev-tagline {
          color: #6b7280;
          font-size: 0.875rem;
          margin-bottom: 1.5rem;
        }
        .consult-dev-json {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          padding: 1.5rem;
          margin-bottom: 2rem;
        }
        .consult-dev-json pre {
          margin: 0;
          font-size: 0.8125rem;
          color: #3ec6e0;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .consult-metrics {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.75rem;
        }
        .consult-metric {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
          font-size: 0.75rem;
          color: #9ca3b0;
        }
        .consult-metric span {
          display: block;
          font-size: 1.25rem;
          font-weight: 700;
          color: #4361ee;
          margin-bottom: 0.25rem;
        }

        /* ── Right Panel — Chat ── */
        .consult-panel-right {
          border-left: 1px solid rgba(255,255,255,0.06);
          display: flex;
          flex-direction: column;
          max-height: 100vh;
        }
        .consult-chat-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
        }
        .consult-chat-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(67,97,238,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4361ee;
        }
        .consult-chat-name {
          font-weight: 600;
          font-size: 0.875rem;
        }
        .consult-chat-status {
          font-size: 0.75rem;
          color: #6b7280;
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .consult-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22c55e;
          display: inline-block;
        }

        /* ── Messages Area ── */
        .consult-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .consult-input-area {
          flex-shrink: 0;
          padding: 1rem 1.5rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .consult-message {
          display: flex;
          gap: 0.5rem;
          max-width: 85%;
          animation: consult-fade-in 0.3s ease;
        }
        .consult-message-user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }
        .consult-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: rgba(67,97,238,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4361ee;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .consult-bubble {
          padding: 0.75rem 1rem;
          border-radius: 12px;
          font-size: 0.875rem;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .consult-message-assistant .consult-bubble {
          background: rgba(255,255,255,0.06);
          border-bottom-left-radius: 4px;
        }
        .consult-message-user .consult-bubble {
          background: #4361ee;
          color: #fff;
          border-bottom-right-radius: 4px;
        }

        @keyframes consult-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Typing Indicator ── */
        .consult-typing {
          display: flex;
          gap: 4px;
          padding: 0.75rem 1rem;
          background: rgba(255,255,255,0.06);
          border-radius: 12px;
          width: fit-content;
          animation: consult-fade-in 0.3s ease;
        }
        .consult-typing span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #6b7280;
          animation: consult-bounce 1.4s ease-in-out infinite;
        }
        .consult-typing span:nth-child(2) { animation-delay: 0.2s; }
        .consult-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes consult-bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }

        /* ── Choice Buttons ── */
        .consult-choices {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          animation: consult-fade-in 0.3s ease;
        }
        .consult-choice-btn {
          padding: 0.5rem 1rem;
          border-radius: 999px;
          border: 1px solid rgba(67,97,238,0.3);
          background: rgba(67,97,238,0.08);
          color: #4361ee;
          font-size: 0.8125rem;
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .consult-choice-btn:hover:not(:disabled) {
          background: #4361ee;
          color: #fff;
          border-color: #4361ee;
        }
        .consult-choice-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* ── Text Input ── */
        .consult-text-input {
          display: flex;
          gap: 0.5rem;
          animation: consult-fade-in 0.3s ease;
        }
        .consult-text-input input {
          flex: 1;
          padding: 0.625rem 1rem;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: #e4e4ef;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .consult-text-input input:focus {
          border-color: #4361ee;
        }
        .consult-text-input input::placeholder {
          color: #6b7280;
        }
        .consult-text-input button {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: none;
          background: #4361ee;
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: opacity 0.15s;
        }
        .consult-text-input button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* ── Lead Gate Form ── */
        .consult-lead-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 1.5rem;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          animation: consult-fade-in 0.3s ease;
        }
        .consult-lead-form input[type="text"],
        .consult-lead-form input[type="email"] {
          padding: 0.75rem 1rem;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: #e4e4ef;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .consult-lead-form input:focus {
          border-color: #4361ee;
        }
        .consult-lead-form input::placeholder {
          color: #6b7280;
        }
        .consult-lead-form button[type="submit"] {
          padding: 0.75rem 1.5rem;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #4361ee, #3ec6e0);
          color: #fff;
          font-weight: 600;
          font-size: 0.875rem;
          cursor: pointer;
          transition: opacity 0.15s;
        }
        .consult-lead-form button[type="submit"]:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .consult-error {
          color: #ef4444;
          font-size: 0.8125rem;
          margin: 0;
        }

        /* ── Report Ready ── */
        .consult-report-ready {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 3rem 1.5rem;
          gap: 1rem;
          flex: 1;
        }
        .consult-report-icon {
          color: #22c55e;
          margin-bottom: 0.5rem;
        }
        .consult-report-ready h2 {
          font-size: 1.5rem;
          margin: 0;
        }
        .consult-report-ready p {
          color: #9ca3b0;
          font-size: 0.875rem;
          margin: 0;
        }
        .consult-report-btn {
          display: inline-block;
          padding: 0.75rem 2rem;
          background: linear-gradient(135deg, #4361ee, #3ec6e0);
          color: #fff;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 0.875rem;
          margin-top: 0.5rem;
        }
        .consult-cta-section {
          margin-top: 2rem;
          padding-top: 2rem;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .consult-book-btn {
          display: inline-block;
          padding: 0.625rem 1.5rem;
          border: 1px solid rgba(67,97,238,0.3);
          color: #4361ee;
          text-decoration: none;
          border-radius: 8px;
          font-size: 0.8125rem;
          margin-top: 0.75rem;
          transition: all 0.15s;
        }
        .consult-book-btn:hover {
          background: rgba(67,97,238,0.08);
        }

        /* ── Dev mode overrides ── */
        .consult-dev .consult-panel-right {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }
        .consult-dev .consult-bubble {
          font-size: 0.8125rem;
        }
      `}</style>
      <div className="consult-page">
        {!mode ? (
          <PersonaSelector onSelect={handlePersonaSelect} />
        ) : (
          <ConsultChat mode={mode} conversationTree={conversationTree} />
        )}
      </div>
    </>
  );
}
