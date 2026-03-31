/**
 * Cullit Changelog Widget
 * 
 * Embed a "What's New" popup in any web app.
 * 
 * Usage:
 *   <script src="https://cullit.io/widget.js" 
 *           data-project="your-project" 
 *           data-position="bottom-right"
 *           data-accent-color="#ff6b00"
 *           data-header-text="Release Notes"
 *           data-trigger-emoji="🚀">
 *   </script>
 *
 * Or programmatic:
 *   CullitWidget.init({ project: 'your-project', position: 'bottom-right', accentColor: '#ff6b00' });
 *
 * Reads from: https://api.cullit.io/v1/changelog/{project}/latest
 */

(function() {
  'use strict';

  const STYLES = `
    .cullit-widget-trigger {
      position: fixed;
      z-index: 10001;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #e8ff47;
      color: #0a0a0a;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.2s, box-shadow 0.2s;
      font-size: 20px;
    }
    .cullit-widget-trigger:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    }
    .cullit-widget-trigger[data-count]:not([data-count="0"])::after {
      content: attr(data-count);
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ff4444;
      color: white;
      font-size: 11px;
      font-weight: bold;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cullit-widget-panel {
      position: fixed;
      z-index: 100000;
      width: 380px;
      max-height: 520px;
      background: #1a1a2e;
      color: #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .cullit-widget-panel.open { display: flex; }
    .cullit-widget-header {
      padding: 16px 20px;
      background: #16213e;
      border-bottom: 1px solid #2a2a4a;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cullit-widget-header h3 {
      margin: 0;
      font-size: 16px;
      color: #e8ff47;
    }
    .cullit-widget-close {
      background: none;
      border: none;
      color: #999;
      cursor: pointer;
      font-size: 18px;
      padding: 0;
    }
    .cullit-widget-body {
      padding: 16px 20px;
      overflow-y: auto;
      flex: 1;
    }
    .cullit-widget-release {
      margin-bottom: 20px;
    }
    .cullit-widget-version {
      font-size: 14px;
      font-weight: 600;
      color: #e8ff47;
      margin-bottom: 4px;
    }
    .cullit-widget-date {
      font-size: 12px;
      color: #888;
      margin-bottom: 8px;
    }
    .cullit-widget-change {
      font-size: 13px;
      line-height: 1.5;
      padding: 2px 0;
    }
    .cullit-widget-footer {
      padding: 8px 20px;
      text-align: center;
      border-top: 1px solid #2a2a4a;
      font-size: 11px;
    }
    .cullit-widget-footer a {
      color: #e8ff47;
      text-decoration: none;
    }
    /* Positions */
    .cullit-pos-br .cullit-widget-trigger { bottom: 24px; right: 24px; }
    .cullit-pos-br .cullit-widget-panel { bottom: 84px; right: 24px; }
    .cullit-pos-bl .cullit-widget-trigger { bottom: 24px; left: 24px; }
    .cullit-pos-bl .cullit-widget-panel { bottom: 84px; left: 24px; }
    .cullit-pos-tr .cullit-widget-trigger { top: 24px; right: 24px; }
    .cullit-pos-tr .cullit-widget-panel { top: 84px; right: 24px; }
    .cullit-pos-tl .cullit-widget-trigger { top: 24px; left: 24px; }
    .cullit-pos-tl .cullit-widget-panel { top: 84px; left: 24px; }
  `;

  const POSITION_MAP: Record<string, string> = {
    'bottom-right': 'br', 'bottom-left': 'bl',
    'top-right': 'tr', 'top-left': 'tl',
  };

  const CATEGORY_EMOJI: Record<string, string> = {
    features: '✨', fixes: '🐛', breaking: '⚠️',
    improvements: '🔧', chores: '🧹', other: '📝',
  };

  interface WidgetConfig {
    project: string;
    position?: string;
    apiUrl?: string;
    branding?: boolean;
    accentColor?: string;
    headerText?: string;
    triggerEmoji?: string;
  }

  interface ReleaseData {
    version: string;
    date: string;
    summary?: string;
    changes: { description: string; category: string; ticketKey?: string }[];
  }

  function init(config: WidgetConfig) {
    const pos = POSITION_MAP[config.position || 'bottom-right'] || 'br';
    const apiUrl = config.apiUrl || 'https://api.cullit.io/v1/changelog';
    const showBranding = config.branding !== false;
    const accent = config.accentColor || '#e8ff47';
    const headerText = config.headerText || "What's New";
    const triggerEmoji = config.triggerEmoji || '🔔';

    // Inject styles with custom accent color
    const style = document.createElement('style');
    const customStyles = STYLES
      .replace(/background: #e8ff47/g, `background: ${accent}`)
      .replace(/color: #e8ff47/g, `color: ${accent}`);
    style.textContent = customStyles;
    document.head.appendChild(style);

    // Create container
    const container = document.createElement('div');
    container.className = `cullit-widget cullit-pos-${pos}`;

    // Trigger button
    const trigger = document.createElement('button');
    trigger.className = 'cullit-widget-trigger';
    trigger.innerHTML = triggerEmoji;
    trigger.setAttribute('aria-label', headerText);
    trigger.setAttribute('data-count', '0');
    if (accent !== '#e8ff47') trigger.style.background = accent;

    // Panel
    const panel = document.createElement('div');
    panel.className = 'cullit-widget-panel';
    panel.innerHTML = `
      <div class="cullit-widget-header">
        <h3>${escapeHtml(headerText)}</h3>
        <button class="cullit-widget-close" aria-label="Close">&times;</button>
      </div>
      <div class="cullit-widget-body">
        <p style="color:#888">Loading...</p>
      </div>
      ${showBranding ? '<div class="cullit-widget-footer">Powered by <a href="https://cullit.io" target="_blank" rel="noopener">Cullit</a></div>' : ''}
    `;
    // Apply custom accent to header title
    if (accent !== '#e8ff47') {
      const h3 = panel.querySelector('h3');
      if (h3) h3.style.color = accent;
    }

    container.appendChild(trigger);
    container.appendChild(panel);
    document.body.appendChild(container);

    // Toggle
    trigger.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        trigger.setAttribute('data-count', '0');
        localStorage.setItem('cullit_widget_seen', new Date().toISOString());
      }
    });

    panel.querySelector('.cullit-widget-close')!.addEventListener('click', () => {
      panel.classList.remove('open');
    });

    // Fetch releases
    fetch(`${apiUrl}/${encodeURIComponent(config.project)}/latest`)
      .then(r => r.ok ? r.json() as Promise<{ releases: ReleaseData[] }> : Promise.reject(r))
      .then(data => {
        const body = panel.querySelector('.cullit-widget-body')!;
        const releases = data.releases || [];

        if (releases.length === 0) {
          body.innerHTML = '<p style="color:#888">No releases yet.</p>';
          return;
        }

        // Count unseen
        const lastSeen = localStorage.getItem('cullit_widget_seen');
        const unseen = lastSeen
          ? releases.filter(r => new Date(r.date) > new Date(lastSeen)).length
          : releases.length;
        trigger.setAttribute('data-count', String(Math.min(unseen, 9)));

        body.innerHTML = releases.map(release => `
          <div class="cullit-widget-release">
            <div class="cullit-widget-version">${escapeHtml(release.version)}</div>
            <div class="cullit-widget-date">${escapeHtml(release.date)}</div>
            ${release.changes.map(c => {
              const emoji = CATEGORY_EMOJI[c.category] || '•';
              return `<div class="cullit-widget-change">${emoji} ${escapeHtml(c.description)}</div>`;
            }).join('')}
          </div>
        `).join('');
      })
      .catch(() => {
        panel.querySelector('.cullit-widget-body')!.innerHTML =
          '<p style="color:#888">Could not load changelog.</p>';
      });
  }

  function escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Auto-init from script tag attributes
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (currentScript?.dataset.project) {
    const cfg: WidgetConfig = {
      project: currentScript.dataset.project!,
      position: currentScript.dataset.position,
      accentColor: currentScript.dataset.accentColor,
      headerText: currentScript.dataset.headerText,
      triggerEmoji: currentScript.dataset.triggerEmoji,
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => init(cfg));
    } else {
      init(cfg);
    }
  }

  // Global API
  (window as any).CullitWidget = { init };
})();
