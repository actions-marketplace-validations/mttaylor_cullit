/* tutorial.js — Tutorial page logic (CSP-safe, no inline handlers) */
(function () {
  'use strict';

  // Reading progress bar
  window.addEventListener('scroll', function () {
    var doc = document.documentElement;
    var scrollTop = doc.scrollTop;
    var scrollHeight = doc.scrollHeight - doc.clientHeight;
    var progress = (scrollTop / scrollHeight) * 100;
    document.getElementById('progress').style.width = progress + '%';
  });

  // Tab switching for output preview
  function switchTab(btn, panelId) {
    var container = btn.closest('.output-preview');
    container.querySelectorAll('.output-tab').forEach(function (t) { t.classList.remove('active'); });
    container.querySelectorAll('.output-panel').forEach(function (p) { p.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById(panelId).classList.add('active');
  }

  // Copy code blocks
  function copyCode(btn) {
    var code = btn.closest('.code-block').querySelector('.code-body').textContent;
    navigator.clipboard.writeText(code).then(function () {
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
    });
  }

  // Smooth reveal on scroll
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.tutorial-step, .flow-node, .callout').forEach(function (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });

  // Hamburger nav toggle
  var hamburger = document.getElementById('hamburger');
  var navLinks = document.getElementById('navLinks');
  hamburger.addEventListener('click', function () {
    hamburger.classList.toggle('open');
    navLinks.classList.toggle('open');
  });
  navLinks.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      hamburger.classList.remove('open');
      navLinks.classList.remove('open');
    });
  });

  // Event delegation: copy buttons [data-copy-code]
  document.addEventListener('click', function (e) {
    var copyBtn = e.target.closest('[data-copy-code]');
    if (copyBtn) { copyCode(copyBtn); return; }

    var tabBtn = e.target.closest('[data-switch-tab]');
    if (tabBtn) { switchTab(tabBtn, tabBtn.dataset.switchTab); return; }
  });
})();
