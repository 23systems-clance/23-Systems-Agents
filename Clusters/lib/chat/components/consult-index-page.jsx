'use client';

import { useState, useEffect } from 'react';

export function ConsultIndexPage({ skills }) {
  // Skills is an array of { skillId, name, description, title, accent }
  if (!skills || skills.length === 0) {
    return (
      <div className="cip-root">
        <style>{CIP_STYLES}</style>
        <div className="cip-empty">
          <h1>No consultations available</h1>
          <p>Check back soon — we&apos;re building something for you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cip-root">
      <style>{CIP_STYLES}</style>
      <div className="cip-container">
        <div className="cip-header">
          <div className="cip-logo">23 Systems</div>
          <h1>AI-Powered Consultations</h1>
          <p>Interactive advisors that help you make the right technology decisions. Pick one to get started.</p>
        </div>

        <div className="cip-grid">
          {skills.map((skill) => (
            <a key={skill.skillId} href={`/consult/${skill.skillId}`} className="cip-card">
              <div className="cip-card-accent" style={{ background: skill.accent || '#4361ee' }} />
              <div className="cip-card-body">
                <h2>{skill.title || skill.name}</h2>
                <p>{skill.description}</p>
                <span className="cip-card-cta" style={{ color: skill.accent || '#4361ee' }}>
                  Start consultation &rarr;
                </span>
              </div>
            </a>
          ))}
        </div>

        <div className="cip-footer">
          <p>Powered by <strong>23 Systems</strong></p>
        </div>
      </div>
    </div>
  );
}

const CIP_STYLES = `
  .cip-root {
    min-height: 100vh;
    background: #0f0f1a;
    color: #e4e4ef;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .cip-root *, .cip-root *::before, .cip-root *::after {
    box-sizing: border-box;
  }
  .cip-empty {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.5rem;
  }
  .cip-empty h1 { font-size: 1.5rem; font-weight: 600; }
  .cip-empty p { color: #9ca3b0; }
  .cip-container {
    max-width: 900px;
    margin: 0 auto;
    padding: 4rem 2rem;
  }
  .cip-header {
    text-align: center;
    margin-bottom: 3rem;
  }
  .cip-logo {
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #4361ee;
    margin-bottom: 1rem;
  }
  .cip-header h1 {
    font-size: 2.5rem;
    font-weight: 700;
    margin: 0 0 1rem;
    background: linear-gradient(135deg, #4361ee, #3ec6e0);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .cip-header p {
    color: #9ca3b0;
    font-size: 1.125rem;
    line-height: 1.6;
    max-width: 560px;
    margin: 0 auto;
  }
  .cip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.5rem;
  }
  .cip-card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: all 0.2s;
    display: flex;
    flex-direction: column;
  }
  .cip-card:hover {
    border-color: rgba(67,97,238,0.4);
    transform: translateY(-2px);
    background: rgba(255,255,255,0.06);
  }
  .cip-card-accent {
    height: 4px;
    width: 100%;
  }
  .cip-card-body {
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    flex: 1;
  }
  .cip-card-body h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0;
  }
  .cip-card-body p {
    font-size: 0.875rem;
    color: #9ca3b0;
    line-height: 1.5;
    margin: 0;
    flex: 1;
  }
  .cip-card-cta {
    font-size: 0.8125rem;
    font-weight: 600;
    margin-top: 0.5rem;
  }
  .cip-footer {
    text-align: center;
    margin-top: 4rem;
    color: #6b7280;
    font-size: 0.8125rem;
  }
  @media (max-width: 640px) {
    .cip-header h1 { font-size: 1.75rem; }
    .cip-container { padding: 2rem 1rem; }
  }
`;
