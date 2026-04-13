(() => {
  function isPrivateIpv4(hostname) {
    return /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  }

  function isLocalContext() {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1' || isPrivateIpv4(location.hostname);
  }

  function getSavedApiUrl() {
    try {
      return localStorage.getItem('cullit_api_url');
    } catch {
      return null;
    }
  }

  function getApiUrl() {
    const saved = getSavedApiUrl();
    if (isLocalContext() && (!saved || /api\.cullit\.io/i.test(saved))) return 'http://localhost:3000';
    if (saved) return saved.replace(/\/+$/, '');
    if (isLocalContext()) return 'http://localhost:3000';
    return 'https://api.cullit.io';
  }

  function initMobileNav() {
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('navLinks');
    if (!hamburger || !navLinks || hamburger.dataset.bound === 'true') return;

    hamburger.dataset.bound = 'true';
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });

    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  function initCookieConsent() {
    const banner = document.getElementById('cookie-consent');
    if (!banner) return;

    const acceptButton = banner.querySelector('[data-cookie-consent-accept]');
    if (acceptButton && acceptButton.dataset.bound !== 'true') {
      acceptButton.dataset.bound = 'true';
      acceptButton.addEventListener('click', () => {
        banner.style.display = 'none';
        try {
          localStorage.setItem('cullit_consent', '1');
        } catch {}
      });
    }

    try {
      if (!localStorage.getItem('cullit_consent')) {
        banner.style.display = 'block';
      }
    } catch {
      banner.style.display = 'block';
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  function toggleTarget(targetId) {
    const target = document.getElementById(targetId);
    if (target) target.classList.toggle('open');
  }

  function initLegalNavToggle() {
    document.querySelectorAll('[data-legal-nav-toggle]').forEach((toggle) => {
      if (toggle.dataset.bound === 'true') return;
      toggle.dataset.bound = 'true';

      const targetId = toggle.getAttribute('data-legal-nav-toggle');
      if (!targetId) return;

      toggle.addEventListener('click', () => toggleTarget(targetId));
      toggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleTarget(targetId);
        }
      });
    });
  }

  function initClipboardCopies() {
    document.querySelectorAll('[data-copy-text]').forEach((element) => {
      if (element.dataset.bound === 'true') return;
      element.dataset.bound = 'true';

      const originalLabel = element.dataset.copyLabel || element.textContent || '';
      const successLabel = element.dataset.copySuccess || 'Copied!';

      const copy = () => {
        navigator.clipboard.writeText(element.dataset.copyText || '').then(() => {
          element.textContent = successLabel;
          window.setTimeout(() => {
            element.textContent = originalLabel;
          }, 2000);
        }).catch(() => {});
      };

      element.setAttribute('role', 'button');
      if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
      element.addEventListener('click', copy);
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          copy();
        }
      });
    });
  }

  async function trackEvent(event, source, metadata = {}) {
    try {
      await fetch(getApiUrl() + '/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ event, source, metadata }),
      });
    } catch {
      // Best effort only.
    }
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function markdownToHtml(md) {
    if (!md) return '<p style="color:var(--text-dim)"><em>No content available.</em></p>';
    var html = escapeHtml(md);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, function (m) { return '<ul>' + m + '</ul>'; });
    html = html.replace(/^---$/gm, '<hr>');
    html = html.replace(/\n{2,}/g, '</p><p>');
    html = html.replace(/^(?!<[hulo]|<hr)(.*\S.*)$/gm, '<p>$1</p>');
    html = html.replace(/<p><\/p>/g, '');
    return html;
  }

  function initScrollReveal(selector) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll(selector).forEach(function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      observer.observe(el);
    });
  }

  window.CullitSite = {
    escapeHtml,
    getApiUrl,
    initClipboardCopies,
    initCookieConsent,
    initLegalNavToggle,
    initMobileNav,
    initScrollReveal,
    isLocalContext,
    markdownToHtml,
    registerServiceWorker,
    trackEvent,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initCookieConsent();
    initLegalNavToggle();
    initClipboardCopies();
    registerServiceWorker();
  });
})();
