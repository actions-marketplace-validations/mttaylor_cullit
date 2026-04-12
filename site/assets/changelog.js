/* changelog.js — Embeddable changelog page logic (CSP-safe) */
(function () {
  'use strict';

  // --- Config ---
  var API_BASE = window.CULLIT_API_URL || 'https://api.cullit.io';
  var params = new URLSearchParams(window.location.search);
  var project = params.get('project') || window.location.pathname.split('/changelog/')[1] || 'default';
  var activeFilter = 'all';
  var releases = [];

  // Update project badge
  var badge = document.getElementById('projectBadge');
  if (badge) badge.textContent = project;

  // --- Fetch releases ---
  async function loadReleases() {
    var timeline = document.getElementById('timeline');
    try {
      var res = await fetch(API_BASE + '/v1/changelog/' + encodeURIComponent(project) + '/latest?limit=50');
      if (!res.ok) throw new Error('API returned ' + res.status);
      var data = await res.json();
      releases = data.releases || [];
      renderReleases();
      showEmbed();
    } catch (err) {
      timeline.innerHTML = '<div class="empty-state"><h2>No releases yet</h2><p>Publish your first release with <code>cullit generate --publish changelog</code></p></div>';
    }
  }

  // --- Render ---
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function badgeClass(category) {
    var cat = (category || 'chores').toLowerCase();
    if (cat === 'features' || cat === 'feature') return 'badge-features';
    if (cat === 'fixes' || cat === 'fix' || cat === 'bugfix') return 'badge-fixes';
    if (cat === 'breaking') return 'badge-breaking';
    if (cat === 'improvements' || cat === 'improvement') return 'badge-improvements';
    return 'badge-chores';
  }

  function renderReleases() {
    var timeline = document.getElementById('timeline');
    if (!releases.length) {
      timeline.innerHTML = '<div class="empty-state"><h2>No releases yet</h2><p>Publish your first release to see it here.</p></div>';
      return;
    }

    var html = '';
    releases.forEach(function (r) {
      var changes = r.changes || [];
      if (activeFilter !== 'all') {
        changes = changes.filter(function (c) { return (c.category || '').toLowerCase() === activeFilter; });
      }
      if (activeFilter !== 'all' && changes.length === 0) return;

      html += '<div class="release">';
      html += '<div class="release-header">';
      html += '<span class="release-version">' + escapeHtml(r.version) + '</span>';
      html += '<span class="release-date">' + escapeHtml(r.date || '') + '</span>';
      html += '</div>';
      if (r.summary) {
        html += '<p class="release-summary">' + escapeHtml(r.summary) + '</p>';
      }
      if (changes.length) {
        html += '<ul class="changes-list">';
        changes.forEach(function (c) {
          html += '<li class="change-item">';
          html += '<span class="change-badge ' + badgeClass(c.category) + '">' + escapeHtml(c.category || 'chore') + '</span>';
          html += '<span>' + escapeHtml(c.description || '');
          if (c.ticketKey) html += ' <span class="change-ticket">' + escapeHtml(c.ticketKey) + '</span>';
          html += '</span>';
          html += '</li>';
        });
        html += '</ul>';
      }
      if (r.contributors && r.contributors.length) {
        html += '<div class="contributors">';
        r.contributors.forEach(function (c) {
          html += '<span class="contributor">@' + escapeHtml(c) + '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });

    timeline.innerHTML = html || '<div class="empty-state"><p>No changes match the selected filter.</p></div>';
  }

  function showEmbed() {
    var section = document.getElementById('embedSection');
    var code = document.getElementById('embedCode');
    if (section && code) {
      section.style.display = 'block';
      var snippet = '<script src="https://cullit.io/widget.js" data-project="' + project + '"><\/script>';
      code.textContent = snippet;
      code.addEventListener('click', function () {
        navigator.clipboard.writeText(snippet).then(function () {
          code.style.borderColor = 'var(--accent)';
          var orig = code.textContent;
          code.textContent = 'Copied!';
          setTimeout(function () { code.textContent = orig; code.style.borderColor = ''; }, 1500);
        });
      });
    }
  }

  // --- Filter buttons ---
  document.getElementById('filterControls').addEventListener('click', function (e) {
    var btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    activeFilter = btn.getAttribute('data-filter');
    renderReleases();
  });

  // --- Init ---
  loadReleases();

  // --- Hamburger ---
  var hamburger = document.getElementById('hamburger');
  var navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () { navLinks.classList.toggle('open'); });
  }
})();
