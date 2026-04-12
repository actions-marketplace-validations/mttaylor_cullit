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

  window.CullitSite = {
    getApiUrl,
    initClipboardCopies,
    initCookieConsent,
    initLegalNavToggle,
    initMobileNav,
    isLocalContext,
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
