/* dashboard.js — Full dashboard logic (CSP-safe, no inline handlers) */
(function () {
  'use strict';

  // --- State ---
  var currentOutput = '';
  var currentView = 'rendered';
  var currentUser = null;
  var manageSeatCount = 5;

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // --- API helpers (use CullitSite.getApiUrl() if available, else fallback) ---

  function isPrivateIpv4(hostname) {
    return /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  }

  function isLocalContext() {
    return location.hostname === 'localhost' || location.hostname === '127.0.0.1' || isPrivateIpv4(location.hostname);
  }

  function defaultApiUrl() {
    if (isLocalContext()) return 'http://localhost:3000';
    return 'https://api.cullit.io';
  }

  function apiUrl() {
    var input = document.getElementById('apiUrl').value.trim();
    if (input) {
      var normalized = input.replace(/\/+$/, '');
      try { localStorage.setItem('cullit_api_url', normalized); } catch (e) {}
      return normalized;
    }
    var saved = localStorage.getItem('cullit_api_url');
    if (isLocalContext() && saved && /api\.cullit\.io/i.test(saved)) return 'http://localhost:3000';
    if (saved) return saved.replace(/\/+$/, '');
    return defaultApiUrl();
  }

  function apiFetch(path, opts) {
    opts = opts || {};
    var url = apiUrl() + path;
    return fetch(url, Object.assign({ credentials: 'include' }, opts));
  }

  // --- Auth ---

  async function checkAuth() {
    try {
      var res = await apiFetch('/auth/me');
      if (res.ok) {
        currentUser = await res.json();
        showDashboard();
        return;
      }
    } catch (e) {}
    await showAuthWall();
  }

  async function showAuthWall() {
    document.getElementById('authWall').style.display = '';
    document.getElementById('dashApp').style.display = 'none';
    document.getElementById('navUser').style.display = 'none';

    var btn = document.getElementById('loginBtn');
    try {
      var health = await fetch(apiUrl() + '/health', { mode: 'cors' });
      if (health.ok) {
        btn.href = apiUrl() + '/auth/login';
        return;
      }
    } catch (e) {}
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';
    btn.removeAttribute('href');
    document.getElementById('apiStatus').style.display = 'block';
    document.getElementById('cliHint').style.display = 'none';
  }

  function toggleApiKeyVisibility() {
    var input = document.getElementById('apiKeyDisplay');
    var btn = document.getElementById('apiKeyToggle');
    if (input.type === 'password') { input.type = 'text'; btn.textContent = 'Hide'; }
    else { input.type = 'password'; btn.textContent = 'Show'; }
  }

  function copyApiKey() {
    var input = document.getElementById('apiKeyDisplay');
    navigator.clipboard.writeText(input.value).then(function () {
      var btn = document.getElementById('apiKeyToggle').parentElement.querySelector('[data-action="copy-api-key"]');
      if (!btn) btn = document.querySelector('[data-action="copy-api-key"]');
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
      }
    });
  }

  async function rotateApiKey() {
    if (!confirm('Rotate your API key? Your current key will stop working immediately.')) return;
    try {
      var res = await apiFetch('/auth/rotate-key', { method: 'POST' });
      var data = await res.json();
      if (data.apiKey) {
        currentUser.apiKey = data.apiKey;
        document.getElementById('apiKeyDisplay').value = data.apiKey;
        showToast('API key rotated successfully');
      } else { showToast(data.error || 'Failed to rotate key'); }
    } catch (e) { showToast('Could not rotate key'); }
  }

  function showDashboard() {
    document.getElementById('authWall').style.display = 'none';
    document.getElementById('dashApp').style.display = '';

    if (currentUser.apiKey) {
      document.getElementById('apiKeyDisplay').value = currentUser.apiKey;
    }

    var nav = document.getElementById('navUser');
    nav.style.display = 'flex';
    var avatarEl = document.getElementById('navAvatar');
    if (currentUser.avatarUrl) {
      avatarEl.src = currentUser.avatarUrl;
      avatarEl.hidden = false;
    }
    document.getElementById('navLogin').textContent = currentUser.login;
    document.getElementById('navTier').textContent = currentUser.effectiveTier || currentUser.tier;

    applyTabGating();
    applyAudienceToneGating();
    checkHealth();
    loadHistory();
    loadAnalytics();
    loadTeam();
    loadBilling();

    var params = new URLSearchParams(location.search);
    var pendingPlan = params.get('checkout');
    if (pendingPlan && ['pro', 'team'].indexOf(pendingPlan) !== -1) {
      history.replaceState(null, '', 'dashboard.html');
      upgradePlan(pendingPlan);
    }
    if (params.get('billing') === 'success') {
      history.replaceState(null, '', 'dashboard.html');
      pollForTierUpdate();
    }
    if (params.get('billing') === 'updated') {
      history.replaceState(null, '', 'dashboard.html');
      refreshAfterPortal();
    }
  }

  async function pollForTierUpdate() {
    for (var i = 0; i < 10; i++) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      try {
        var res = await apiFetch('/auth/me');
        var data = await res.json();
        if (data.tier && data.tier !== 'free') {
          currentUser = data;
          document.getElementById('navTier').textContent = data.effectiveTier || data.tier;
          var tierName = capitalize(data.effectiveTier || data.tier);
          showUpgradeModal(
            'Welcome to ' + tierName + '!',
            'Your upgrade is confirmed. All ' + tierName + ' features are now unlocked. Generate release notes, explore new publishers, and make the most of your plan.',
            'Start Generating', '#'
          );
          document.getElementById('upgradeAction').onclick = function (e) { e.preventDefault(); dismissUpgrade(); switchDashTab('generate'); };
          loadBilling();
          return;
        }
      } catch (e) {}
    }
    showToast('Payment is being processed. Refresh in a moment.');
  }

  async function refreshAfterPortal() {
    try {
      var res = await apiFetch('/auth/me');
      var data = await res.json();
      if (data.tier) {
        currentUser = data;
        document.getElementById('navTier').textContent = data.effectiveTier || data.tier;
        loadBilling();
        showToast('Billing updated \u2014 you are on ' + capitalize(data.effectiveTier || data.tier) + '.');
      }
    } catch (e) {}
  }

  async function logout() {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (e) {}
    currentUser = null;
    showAuthWall();
  }

  // --- Health ---

  async function checkHealth() {
    var dot = document.getElementById('statusDot');
    var text = document.getElementById('statusText');
    var meta = document.getElementById('statusMeta');
    try {
      var res = await apiFetch('/health');
      if (res.ok) {
        var data = await res.json();
        dot.className = 'status-dot connected';
        text.textContent = 'Connected';
        meta.textContent = 'v' + (data.version || '?');
      } else { throw new Error(); }
    } catch (e) {
      dot.className = 'status-dot disconnected';
      text.textContent = 'Not connected';
      meta.textContent = '';
    }
  }

  // --- Upgrade Modal ---

  function showUpgradeModal(title, msg, actionText, actionHref) {
    document.getElementById('upgradeTitle').textContent = title;
    document.getElementById('upgradeMsg').textContent = msg;
    var btn = document.getElementById('upgradeAction');
    btn.textContent = actionText || 'View Plans';
    btn.href = actionHref || 'pricing.html';
    document.getElementById('upgradeOverlay').classList.add('visible');
  }

  function dismissUpgrade() {
    document.getElementById('upgradeOverlay').classList.remove('visible');
  }

  // --- Generate ---

  async function generate() {
    var btn = document.getElementById('generateBtn');
    var fromRef = document.getElementById('fromRef').value.trim();
    var toRef = document.getElementById('toRef').value.trim() || 'HEAD';

    if (!fromRef) { showToast('Please enter a "From" tag or SHA'); return; }

    var body = {
      from: fromRef,
      to: toRef,
      provider: document.getElementById('provider').value,
      audience: document.getElementById('audience').value,
      tone: document.getElementById('tone').value,
      format: document.getElementById('format').value,
    };

    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = 'GENERATING';

    var dot = document.getElementById('statusDot');
    var statusText = document.getElementById('statusText');
    dot.className = 'status-dot loading';
    statusText.textContent = 'Generating...';

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (currentUser && currentUser.apiKey) headers['Authorization'] = 'Bearer ' + currentUser.apiKey;

      var res = await apiFetch('/generate', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });

      var data = await res.json();
      if (res.status === 402) {
        switchDashTab('billing');
        showUpgradeModal(
          'Generation Limit Reached',
          'You\u2019ve used all ' + (data.limit || 'your') + ' generations this month. Upgrade to get more.',
          'Upgrade Now', 'pricing.html'
        );
      } else if (res.status === 403) {
        showUpgradeModal(
          'Feature Locked',
          data.error || 'This feature requires a higher plan.',
          'View Plans', 'pricing.html'
        );
      }
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      currentOutput = data.formatted || JSON.stringify(data, null, 2);
      renderOutput();

      dot.className = 'status-dot connected';
      statusText.textContent = 'Done';
      document.getElementById('statusMeta').textContent =
        (data.changeCount || '?') + ' changes, ' + (data.duration || '?') + 'ms';

      loadHistory();
      loadAnalytics();
    } catch (err) {
      dot.className = 'status-dot disconnected';
      statusText.textContent = 'Error';
      showToast(err.message);
    } finally {
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = '\u26A1 GENERATE';
    }
  }

  // --- Output rendering ---

  function renderOutput() {
    var container = document.getElementById('outputBody');
    if (!currentOutput) return;
    if (currentView === 'raw') {
      container.innerHTML = '<pre>' + escapeHtml(currentOutput) + '</pre>';
    } else {
      container.innerHTML = '<div class="output-rendered">' + simpleMarkdown(currentOutput) + '</div>';
    }
  }

  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.output-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === view);
    });
    renderOutput();
  }

  function copyOutput() {
    if (!currentOutput) return;
    navigator.clipboard.writeText(currentOutput).then(function () {
      var btn = document.querySelector('[data-action="copy-output"]');
      if (btn) {
        btn.textContent = '\u2713 Copied';
        btn.setAttribute('aria-label', 'Copied to clipboard');
        setTimeout(function () { btn.textContent = '\uD83D\uDCCB Copy'; btn.setAttribute('aria-label', 'Copy output to clipboard'); }, 1500);
      }
    });
  }

  function simpleMarkdown(md) {
    var html = escapeHtml(md);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p>\s*<(h[123]|ul)/g, '<$1');
    html = html.replace(/<\/(h[123]|ul)>\s*<\/p>/g, '</$1>');
    return html;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  }

  // --- Dashboard Tabs ---

  var TAB_MIN_TIERS = {
    generate: 'free', history: 'free', settings: 'free', billing: 'free',
    drafts: 'team', analytics: 'pro', team: 'team', changelog: 'pro',
  };
  var TIER_RANK = { free: 0, pro: 1, team: 2, enterprise: 3 };

  function applyTabGating() {
    var tier = getEffectiveTierClient();
    var rank = TIER_RANK[tier] || 0;
    document.querySelectorAll('.dash-tab').forEach(function (btn) {
      var tab = btn.dataset.tab;
      var minTier = TAB_MIN_TIERS[tab] || 'free';
      var minRank = TIER_RANK[minTier] || 0;
      if (rank < minRank) {
        btn.disabled = true;
        btn.title = capitalize(minTier) + '+ plan required';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
      } else {
        btn.disabled = false;
        btn.title = '';
        btn.style.opacity = '';
        btn.style.cursor = '';
      }
    });
  }

  function applyAudienceToneGating() {
    var tier = getEffectiveTierClient();
    var rank = TIER_RANK[tier] || 0;
    var proRank = TIER_RANK['pro'] || 1;
    var isFree = rank < proRank;

    var audienceBadge = document.getElementById('audienceProBadge');
    var toneBadge = document.getElementById('toneProBadge');
    if (audienceBadge) audienceBadge.style.display = isFree ? 'inline' : 'none';
    if (toneBadge) toneBadge.style.display = isFree ? 'inline' : 'none';

    var audienceSelect = document.getElementById('audience');
    var toneSelect = document.getElementById('tone');
    if (audienceSelect) {
      Array.from(audienceSelect.options).forEach(function (opt) {
        opt.disabled = isFree && opt.value !== 'developer';
      });
      if (isFree) audienceSelect.value = 'developer';
    }
    if (toneSelect) {
      Array.from(toneSelect.options).forEach(function (opt) {
        opt.disabled = isFree && opt.value !== 'professional';
      });
      if (isFree) toneSelect.value = 'professional';
    }

    if (isFree) {
      [audienceSelect, toneSelect].forEach(function (select) {
        if (!select) return;
        select.addEventListener('focus', function handler() {
          if (getEffectiveTierClient() === 'free' || (TIER_RANK[getEffectiveTierClient()] || 0) < (TIER_RANK['pro'] || 1)) {
            showUpgradeModal(
              'Audience & Tone Control',
              'Custom audience and tone settings require a Pro plan or above. Upgrade to tailor output for customers, executives, or any audience.',
              'Upgrade to Pro', 'pricing.html'
            );
          }
        }, { once: true });
      });
    }
  }

  function switchDashTab(tab) {
    document.querySelectorAll('.dash-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(function (c) {
      c.classList.toggle('active', c.id === 'tab-' + tab);
    });
    if (tab === 'history') loadHistory();
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'team') loadTeam();
    if (tab === 'drafts') loadDrafts();
    if (tab === 'settings') loadSettingsTab();
    if (tab === 'changelog') loadChangelog();
    if (tab === 'billing') loadBilling();
  }

  // --- History (server-side) ---

  var historyOffset = 0;
  var HISTORY_LIMIT = 20;

  async function loadHistory() {
    var list = document.getElementById('historyList');
    var pager = document.getElementById('historyPager');
    try {
      var res = await apiFetch('/v1/history?limit=' + HISTORY_LIMIT + '&offset=' + historyOffset);
      if (!res.ok) throw new Error();
      var data = await res.json();

      if (!data.entries.length) {
        list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>No generation history yet</p></div>';
        pager.innerHTML = '';
        return;
      }

      list.innerHTML = data.entries.map(function (h) {
        var date = new Date(h.createdAt);
        var ago = timeAgo(date.getTime());
        return '<div class="history-item" data-from="' + escapeAttr(h.from) + '" data-to="' + escapeAttr(h.to) + '" data-provider="' + escapeAttr(h.provider) + '" data-summary="' + escapeAttr(h.summary) + '">' +
          '<span><span class="tag">' + escapeHtml(h.from) + '</span> &rarr; ' + escapeHtml(h.to) + ' <span style="color:var(--terminal-purple);font-size:0.7rem">' + escapeHtml(h.provider) + '</span></span>' +
          '<span class="time">' + escapeHtml(String(h.changeCount)) + ' changes &middot; ' + ago + '</span>' +
          '</div>';
      }).join('');

      list.querySelectorAll('.history-item[data-from]').forEach(function (el) {
        el.addEventListener('click', function () {
          loadHistoryEntry(el.dataset.from, el.dataset.to, el.dataset.provider, el.dataset.summary);
        });
      });

      // Pager
      var totalPages = Math.ceil(data.total / HISTORY_LIMIT);
      var currentPage = Math.floor(historyOffset / HISTORY_LIMIT);
      var pagerHtml = '';
      if (currentPage > 0) {
        pagerHtml += '<button class="btn-copy" data-action="history-prev">&larr; Prev</button>';
      }
      pagerHtml += '<span style="font-size:0.75rem;color:var(--text-dim);padding:0.35rem">' + (currentPage + 1) + '/' + totalPages + '</span>';
      if (currentPage < totalPages - 1) {
        pagerHtml += '<button class="btn-copy" data-action="history-next">Next &rarr;</button>';
      }
      pager.innerHTML = pagerHtml;

      var prevBtn = pager.querySelector('[data-action="history-prev"]');
      if (prevBtn) prevBtn.addEventListener('click', function () { historyOffset -= HISTORY_LIMIT; loadHistory(); });
      var nextBtn = pager.querySelector('[data-action="history-next"]');
      if (nextBtn) nextBtn.addEventListener('click', function () { historyOffset += HISTORY_LIMIT; loadHistory(); });
    } catch (e) {
      list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>Failed to load history</p></div>';
      pager.innerHTML = '';
    }
  }

  function loadHistoryEntry(from, to, provider, summary) {
    document.getElementById('fromRef').value = from;
    document.getElementById('toRef').value = to;
    document.getElementById('provider').value = provider;
    currentOutput = summary;
    renderOutput();
    switchDashTab('generate');
  }

  function timeAgo(ts) {
    var secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    return Math.floor(secs / 86400) + 'd ago';
  }

  // --- Analytics ---

  var PROVIDER_COLORS = {
    anthropic: '#d97706', openai: '#10b981', gemini: '#3b82f6',
    ollama: '#8b5cf6', none: '#6b7280',
  };

  async function loadAnalytics() {
    try {
      var res = await apiFetch('/v1/analytics/usage?days=30');
      if (!res.ok) throw new Error();
      var data = await res.json();

      document.getElementById('statGens').textContent = data.totals.generations.toLocaleString();
      document.getElementById('statChanges').textContent = data.totals.totalChanges.toLocaleString();
      document.getElementById('statAvgTime').textContent = data.totals.avgDuration > 0 ? (data.totals.avgDuration / 1000).toFixed(1) + 's' : '-';
      document.getElementById('statMonthly').textContent = data.monthlyGenerations.toLocaleString();

      renderBarChart(data.daily);
      renderProviders(data.topProviders);
    } catch (e) {
      document.getElementById('statGens').textContent = '-';
      document.getElementById('statChanges').textContent = '-';
      document.getElementById('statAvgTime').textContent = '-';
      document.getElementById('statMonthly').textContent = '-';
    }
  }

  function renderBarChart(daily) {
    var chart = document.getElementById('genChart');
    if (!daily || !daily.length) {
      chart.innerHTML = '<div class="empty-state" style="min-height:100px"><p>No data yet</p></div>';
      return;
    }

    var today = new Date();
    var days = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(d.getDate() - i);
      var key = d.toISOString().split('T')[0];
      var entry = daily.find(function (e) { return e.date === key; });
      days.push({ date: key, generations: entry ? entry.generations : 0 });
    }

    var max = Math.max.apply(null, days.map(function (d) { return d.generations; }).concat([1]));

    chart.innerHTML = days.map(function (d) {
      var height = Math.max(2, (d.generations / max) * 100);
      var label = d.date.slice(5);
      return '<div class="bar" style="height:' + height + '%" title="' + d.date + ': ' + d.generations + ' generations">' +
        '<span class="bar-label">' + label + '</span></div>';
    }).join('');
  }

  function renderProviders(topProviders) {
    var container = document.getElementById('providerBreakdown');
    if (!topProviders || !topProviders.length) {
      container.innerHTML = '<span style="color:var(--text-dim);font-size:0.8rem">No data yet</span>';
      return;
    }
    container.innerHTML = topProviders.map(function (p) {
      var color = PROVIDER_COLORS[p.provider] || '#6b7280';
      return '<div class="provider-chip"><span class="provider-dot" style="background:' + color + '"></span>' +
        escapeHtml(p.provider) + ' <span style="color:var(--text-dim)">' + p.count + '</span></div>';
    }).join('');
  }

  // --- Team ---

  async function loadTeam() {
    try {
      var res = await apiFetch('/v1/org');
      if (!res.ok) throw new Error();
      var data = await res.json();

      if (!data.org) {
        document.getElementById('teamNoOrg').style.display = '';
        document.getElementById('teamHasOrg').style.display = 'none';
        return;
      }

      document.getElementById('teamNoOrg').style.display = 'none';
      document.getElementById('teamHasOrg').style.display = '';
      document.getElementById('orgName').textContent = data.org.name;
      document.getElementById('orgMeta').textContent = data.org.tier.toUpperCase() + ' \u2022 ' + data.org.memberCount + '/' + data.org.maxSeats + ' seats';

      var isAdmin = currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin');
      document.getElementById('inviteSection').style.display = isAdmin ? '' : 'none';

      var members = data.members || [];
      document.getElementById('memberList').innerHTML = members.map(function (m) {
        var removeBtn = isAdmin && m.id !== currentUser.id
          ? '<button class="btn-danger" data-remove-id="' + escapeAttr(m.id) + '">Remove</button>'
          : '';
        return '<div class="member-row">' +
          '<img src="' + escapeAttr(m.avatarUrl || '') + '" alt="">' +
          '<div class="member-info"><div class="member-name">' + escapeHtml(m.name || m.login) + '</div>' +
          '<div class="member-role">' + escapeHtml(m.role) + '</div></div>' +
          removeBtn + '</div>';
      }).join('');

      document.querySelectorAll('[data-remove-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          removeMember(btn.dataset.removeId);
        });
      });
    } catch (e) {
      document.getElementById('teamNoOrg').style.display = '';
      document.getElementById('teamHasOrg').style.display = 'none';
    }
  }

  async function createOrgAction() {
    var name = document.getElementById('orgNameInput').value.trim();
    if (!name || name.length < 2) { showToast('Organization name must be at least 2 characters'); return; }

    try {
      var res = await apiFetch('/v1/org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create organization');
      showToast('Organization created: ' + data.org.name);
      await checkAuth();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function inviteMember() {
    var userId = document.getElementById('inviteUserId').value.trim();
    if (!userId) { showToast('Enter an email or GitHub username to invite'); return; }

    try {
      var res = await apiFetch('/v1/org/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to invite member');
      document.getElementById('inviteUserId').value = '';
      if (data.emailSent === false) {
        showToast('Invite created but email could not be sent \u2014 share the invite link manually');
      } else {
        showToast('Invite sent');
      }
      loadTeam();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function removeMember(userId) {
    if (!confirm('Remove this member from the organization?')) return;
    try {
      var res = await apiFetch('/v1/org/members', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId }),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove member');
      loadTeam();
    } catch (err) {
      showToast(err.message);
    }
  }

  // --- Toast ---

  function showToast(msg) {
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 5000);
  }

  // --- Billing ---

  var TIER_LIMITS = { free: 3, pro: 500, team: 2000, enterprise: Infinity };

  function updateTeamTotal() {
    var input = document.getElementById('dashTeamSeats');
    var display = document.getElementById('dashTeamTotal');
    if (input && display) {
      var seats = Math.max(5, parseInt(input.value) || 5);
      display.textContent = '$' + (seats * 8) + '/mo';
    }
    var manageSection = document.getElementById('manageSeatsSection');
    if (manageSection && manageSection.style.display !== 'none' && input) {
      var seatVal = Math.max(5, parseInt(input.value) || 5);
      var changed = seatVal !== manageSeatCount;
      var updateBtn = document.getElementById('updateSeatsBtn');
      var proNote = document.getElementById('prorationNote');
      if (updateBtn) updateBtn.style.display = changed ? '' : 'none';
      if (proNote) proNote.style.display = changed ? '' : 'none';
    }
  }

  function adjustSeats(delta) {
    var input = document.getElementById('dashTeamSeats');
    if (!input) return;
    var current = parseInt(input.value) || 5;
    var newVal = Math.max(5, Math.min(100, current + delta));
    input.value = newVal;
    updateTeamTotal();
    document.getElementById('seatDecrBtn').disabled = newVal <= 5;
    document.getElementById('seatIncrBtn').disabled = newVal >= 100;
  }

  async function updateTeamSeats() {
    var input = document.getElementById('dashTeamSeats');
    var newSeats = Math.max(5, Math.min(100, parseInt(input ? input.value : '5', 10)));
    if (newSeats === manageSeatCount) { showToast('Seat count unchanged'); return; }

    var delta = Math.abs(newSeats - manageSeatCount);
    var verb = newSeats > manageSeatCount ? 'Add' : 'Remove';
    if (!confirm(verb + ' ' + delta + ' seat(s)? Your subscription will be updated with prorated billing.')) return;

    var btn = document.getElementById('updateSeatsBtn');
    try {
      if (btn) { btn.disabled = true; btn.textContent = 'Updating\u2026'; }
      var res = await apiFetch('/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'team', seats: newSeats }),
      });
      var data = await res.json();
      if (data.updated) {
        manageSeatCount = data.seats || newSeats;
        showToast('Seats updated to ' + manageSeatCount + '!');
        var meRes = await apiFetch('/auth/me');
        currentUser = await meRes.json();
        loadBilling();
      } else if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Unable to update seats');
      }
    } catch (e) { showToast('Failed to update seats. Please try again.'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Update Seats'; } }
  }

  // --- Drafts Management ---

  var draftsOffset = 0;
  var DRAFTS_LIMIT = 20;

  function getEffectiveTierClient() {
    return (currentUser && (currentUser.effectiveTier || currentUser.tier)) || 'free';
  }

  function draftStatusBadge(status) {
    var colors = { draft: '#888', submitted: '#f5a623', approved: '#4ecdc4', published: 'var(--accent)' };
    var safe = escapeHtml(status);
    return '<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:3px;font-size:0.7rem;font-family:\'Space Mono\',monospace;background:' + (colors[status] || '#888') + '20;color:' + (colors[status] || '#888') + ';border:1px solid ' + (colors[status] || '#888') + '40">' + safe + '</span>';
  }

  async function loadDrafts() {
    var userTier = getEffectiveTierClient();
    var isTeam = userTier === 'team' || userTier === 'enterprise';
    document.getElementById('draftTeamGate').style.display = isTeam ? 'none' : 'block';
    document.getElementById('draftList').parentElement.parentElement.style.display = isTeam ? 'block' : 'none';
    if (document.getElementById('draftDetailPanel')) document.getElementById('draftDetailPanel').style.display = 'none';
    if (!isTeam) return;

    var list = document.getElementById('draftList');
    var pager = document.getElementById('draftPager');
    var statusFilter = document.getElementById('draftStatusFilter').value;
    try {
      var url = '/v1/drafts?limit=' + DRAFTS_LIMIT + '&offset=' + draftsOffset;
      if (statusFilter) url += '&status=' + statusFilter;
      var res = await apiFetch(url);
      if (!res.ok) throw new Error();
      var data = await res.json();

      if (!data.drafts.length) {
        list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>No drafts' + (statusFilter ? ' with status &quot;' + escapeHtml(statusFilter) + '&quot;' : '') + '</p></div>';
        pager.innerHTML = '';
        return;
      }

      list.innerHTML = data.drafts.map(function (d) {
        return '<div style="padding:0.75rem;border:1px solid var(--border);border-radius:6px;margin-bottom:0.5rem;cursor:pointer" data-draft-id="' + escapeAttr(d.id) + '">'
          + '<div style="display:flex;justify-content:space-between;align-items:center">'
          + '<div><strong style="font-size:0.85rem">' + escapeHtml(d.project) + '</strong> <span style="color:var(--text-dim);font-size:0.75rem">' + escapeHtml(d.version || '') + '</span></div>'
          + draftStatusBadge(d.status)
          + '</div>'
          + '<div style="font-size:0.7rem;color:var(--text-dim);margin-top:0.35rem">'
          + (d.provider ? escapeHtml(d.provider) + '/' + escapeHtml(d.model || '') + ' &middot; ' : '')
          + new Date(d.created_at).toLocaleDateString()
          + '</div></div>';
      }).join('');

      // Wire up draft click handlers via event delegation
      list.querySelectorAll('[data-draft-id]').forEach(function (el) {
        el.addEventListener('click', function () { loadDraftDetail(el.dataset.draftId); });
      });

      var totalPages = Math.ceil(data.total / DRAFTS_LIMIT);
      var currentPage = Math.floor(draftsOffset / DRAFTS_LIMIT) + 1;
      pager.innerHTML = (currentPage > 1 ? '<button class="btn-small" data-action="drafts-prev" style="font-size:0.7rem">&larr; Prev</button>' : '')
        + '<span style="font-size:0.75rem;color:var(--text-dim)">' + currentPage + ' / ' + totalPages + '</span>'
        + (currentPage < totalPages ? '<button class="btn-small" data-action="drafts-next" style="font-size:0.7rem">Next &rarr;</button>' : '');

      var prevBtn = pager.querySelector('[data-action="drafts-prev"]');
      if (prevBtn) prevBtn.addEventListener('click', function () { draftsOffset -= DRAFTS_LIMIT; loadDrafts(); });
      var nextBtn = pager.querySelector('[data-action="drafts-next"]');
      if (nextBtn) nextBtn.addEventListener('click', function () { draftsOffset += DRAFTS_LIMIT; loadDrafts(); });
    } catch (e) {
      list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>Failed to load drafts</p></div>';
    }
  }

  async function loadDraftDetail(id) {
    var panel = document.getElementById('draftDetailPanel');
    var meta = document.getElementById('draftDetailMeta');
    var content = document.getElementById('draftDetailContent');
    var actions = document.getElementById('draftDetailActions');
    var revisions = document.getElementById('draftRevisions');
    panel.style.display = 'block';

    try {
      var res = await apiFetch('/v1/drafts/' + id);
      if (!res.ok) throw new Error();
      var payload = await res.json();
      var d = payload.draft;

      meta.innerHTML = draftStatusBadge(d.status)
        + '<span>' + escapeHtml(d.project) + ' ' + escapeHtml(d.version || '') + '</span>'
        + (d.provider ? '<span>' + escapeHtml(d.provider) + '/' + escapeHtml(d.model || '') + '</span>' : '')
        + '<span>Created ' + new Date(d.created_at).toLocaleString() + '</span>';

      content.innerHTML = d.formatted_html ? simpleMarkdown(d.formatted_md || '') : ('<pre style="white-space:pre-wrap;font-size:0.8rem">' + escapeHtml(d.formatted_md || '') + '</pre>');

      var btns = '';
      if (d.status === 'draft') {
        btns += '<button class="btn-small" data-action="submit-draft" data-id="' + escapeAttr(id) + '" style="background:var(--accent);color:#000;border:none;font-size:0.75rem">Submit for Review</button>';
        btns += '<button class="btn-small" data-action="delete-draft" data-id="' + escapeAttr(id) + '" style="font-size:0.75rem;color:#e74c3c">Delete</button>';
      }
      if (d.status === 'submitted') {
        if (currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin')) {
          btns += '<button class="btn-small" data-action="approve-draft" data-id="' + escapeAttr(id) + '" style="background:#4ecdc4;color:#000;border:none;font-size:0.75rem">Approve</button>';
        }
      }
      if (d.status === 'approved') {
        if (currentUser && (currentUser.role === 'owner' || currentUser.role === 'admin')) {
          btns += '<button class="btn-small" data-action="publish-draft" data-id="' + escapeAttr(id) + '" style="background:var(--accent);color:#000;border:none;font-size:0.75rem">Publish</button>';
        }
      }
      actions.innerHTML = btns;

      // Wire up draft action buttons
      actions.querySelectorAll('[data-action]').forEach(function (btn) {
        var action = btn.dataset.action;
        var draftId = btn.dataset.id;
        if (action === 'submit-draft') btn.addEventListener('click', function () { submitDraft(draftId); });
        if (action === 'delete-draft') btn.addEventListener('click', function () { deleteDraft(draftId); });
        if (action === 'approve-draft') btn.addEventListener('click', function () { approveDraft(draftId); });
        if (action === 'publish-draft') btn.addEventListener('click', function () { publishDraft(draftId); });
      });

      if (payload.revisions && payload.revisions.length) {
        revisions.style.display = 'block';
        document.getElementById('draftRevisionList').innerHTML = payload.revisions.map(function (r) {
          return '<div style="padding:0.5rem;border-left:2px solid var(--border);margin-bottom:0.5rem;padding-left:0.75rem">'
            + '<div style="color:var(--text-dim);font-size:0.7rem">Revision ' + r.revision_number + ' &middot; ' + new Date(r.created_at).toLocaleString() + '</div>'
            + '</div>';
        }).join('');
      } else {
        revisions.style.display = 'none';
      }
    } catch (e) {
      content.innerHTML = '<p style="color:#e74c3c">Failed to load draft</p>';
    }
  }

  function closeDraftDetail() {
    document.getElementById('draftDetailPanel').style.display = 'none';
  }

  async function createDraftFromCurrentOutput() {
    if (!currentOutput || !currentOutput.trim()) {
      showToast('Generate release notes first, then create a draft.');
      switchDashTab('generate');
      return;
    }

    var project = prompt('Project slug (e.g. my-app):', 'my-app');
    if (!project) return;
    var version = prompt('Version (optional):', '') || '';
    var body = {
      project: project.trim(),
      version: version.trim(),
      sourceType: 'local',
      provider: document.getElementById('provider').value || 'none',
      model: '',
      audience: document.getElementById('audience').value || 'developer',
      tone: document.getElementById('tone').value || 'professional',
      notes: [],
      formattedMd: currentOutput,
      formattedHtml: simpleMarkdown(currentOutput),
      rawInputs: {
        from: document.getElementById('fromRef').value.trim(),
        to: document.getElementById('toRef').value.trim() || 'HEAD',
      },
    };

    try {
      var res = await apiFetch('/v1/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create draft');
      showToast('Draft created');
      draftsOffset = 0;
      await loadDrafts();
      if (data.draft && data.draft.id) await loadDraftDetail(data.draft.id);
    } catch (err) {
      showToast(err.message || 'Failed to create draft');
    }
  }

  async function submitDraft(id) {
    try {
      var res = await apiFetch('/v1/drafts/' + id + '/submit', { method: 'POST' });
      if (!res.ok) throw new Error();
      loadDraftDetail(id);
      loadDrafts();
    } catch (e) { showToast('Failed to submit draft'); }
  }

  async function approveDraft(id) {
    try {
      var res = await apiFetch('/v1/drafts/' + id + '/approve', { method: 'POST' });
      if (!res.ok) throw new Error();
      loadDraftDetail(id);
      loadDrafts();
    } catch (e) { showToast('Failed to approve draft'); }
  }

  async function publishDraft(id) {
    try {
      var res = await apiFetch('/v1/drafts/' + id + '/publish', { method: 'POST' });
      if (!res.ok) throw new Error();
      showToast('Draft published to changelog!');
      loadDraftDetail(id);
      loadDrafts();
    } catch (e) { showToast('Failed to publish draft'); }
  }

  async function deleteDraft(id) {
    if (!confirm('Delete this draft?')) return;
    try {
      var res = await apiFetch('/v1/drafts/' + id, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      closeDraftDetail();
      loadDrafts();
    } catch (e) { showToast('Failed to delete draft'); }
  }

  // --- Project Settings ---

  async function loadSettingsTab() {
    var userTier = getEffectiveTierClient();
    var isTeam = userTier === 'team' || userTier === 'enterprise';
    document.getElementById('settingsTeamGate').style.display = isTeam ? 'none' : 'block';
    document.getElementById('projectSettingsForm').parentElement.parentElement.style.display = isTeam ? 'block' : 'none';
    loadGithubInstallations();
    if (!isTeam) return;

    var select = document.getElementById('settingsProjectSelect');
    if (!select.options.length) {
      try {
        var res = await apiFetch('/v1/projects/settings');
        if (res.ok) {
          var data = await res.json();
          select.innerHTML = '';
          if (data.settings && data.settings.length) {
            data.settings.forEach(function (s) {
              var opt = document.createElement('option');
              opt.value = s.project;
              opt.textContent = s.project;
              select.appendChild(opt);
            });
          }
          var opt = document.createElement('option');
          opt.value = '__new__';
          opt.textContent = '+ New project...';
          select.appendChild(opt);
        }
      } catch (e) {}
    }
    loadProjectSettings();
  }

  async function loadGithubInstallations() {
    var container = document.getElementById('githubInstallations');
    try {
      var res = await apiFetch('/v1/github/installations');
      var data = await res.json();
      if (!res.ok || !data.installations || data.installations.length === 0) {
        container.innerHTML = '<div class="empty-state" style="min-height:60px"><p>No GitHub App installations linked to your account.</p></div>';
        return;
      }
      container.innerHTML = data.installations.map(function (inst) {
        var repos = (inst.repos || []).slice(0, 10);
        var repoList = repos.length ? repos.map(function (r) { return '<span style="display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.15rem 0.4rem;font-size:0.72rem;margin:0.15rem 0.1rem">' + escapeHtml(r) + '</span>'; }).join(' ') : '<span style="font-size:0.75rem;color:var(--text-dim)">No repos</span>';
        return '<div style="border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.5rem">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">' +
          '<strong style="font-size:0.85rem;color:var(--text-bright)">' + escapeHtml(inst.github_login) + '</strong>' +
          '<button class="btn-small" data-action="disconnect-github" data-installation-id="' + inst.installation_id + '" style="font-size:0.65rem;background:transparent;border:1px solid var(--danger,#e74c3c);color:var(--danger,#e74c3c)">Disconnect</button>' +
          '</div>' +
          '<div>' + repoList + '</div>' +
          '</div>';
      }).join('');

      container.querySelectorAll('[data-action="disconnect-github"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          disconnectGithub(parseInt(btn.dataset.installationId, 10));
        });
      });
    } catch (e) {
      container.innerHTML = '<div class="empty-state" style="min-height:60px"><p>Could not load installations.</p></div>';
    }
  }

  async function disconnectGithub(installationId) {
    if (!confirm('Disconnect this GitHub installation? Auto-generated release notes will stop for these repos.')) return;
    try {
      var res = await apiFetch('/v1/github/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installationId: installationId }),
      });
      if (!res.ok) { var d = await res.json(); throw new Error(d.error || 'Failed'); }
      showToast('GitHub installation disconnected');
      loadGithubInstallations();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadProjectSettings() {
    var select = document.getElementById('settingsProjectSelect');
    var project = select.value;
    if (!project || project === '__new__') {
      document.getElementById('ps-source').value = 'local';
      document.getElementById('ps-provider').value = 'none';
      document.getElementById('ps-model').value = '';
      document.getElementById('ps-audience').value = 'developer';
      document.getElementById('ps-tone').value = 'professional';
      document.getElementById('ps-categories').value = '';
      document.getElementById('ps-format').value = 'markdown';
      document.getElementById('ps-template-profile').value = '';
      document.getElementById('ps-section-order').value = '';
      document.getElementById('ps-publish-targets').value = '';
      return;
    }
    try {
      var res = await apiFetch('/v1/projects/settings');
      if (!res.ok) return;
      var data = await res.json();
      var s = (data.settings || []).find(function (x) { return x.project === project; });
      if (s) {
        var widgetConfig = typeof s.widget_config_json === 'string'
          ? JSON.parse(s.widget_config_json)
          : (s.widget_config_json || {});
        var templateConfig = widgetConfig && typeof widgetConfig === 'object' ? (widgetConfig.template || {}) : {};
        document.getElementById('ps-source').value = s.default_source || 'local';
        document.getElementById('ps-provider').value = s.default_provider || 'none';
        document.getElementById('ps-model').value = s.default_model || '';
        document.getElementById('ps-audience').value = s.default_audience || 'developer';
        document.getElementById('ps-tone').value = s.default_tone || 'professional';
        var categories = Array.isArray(s.categories_json)
          ? s.categories_json
          : (typeof s.categories_json === 'string' ? JSON.parse(s.categories_json) : []);
        document.getElementById('ps-categories').value = categories.join(', ');
        document.getElementById('ps-format').value = templateConfig.defaultFormat || 'markdown';
        document.getElementById('ps-template-profile').value = templateConfig.profile || '';
        var sectionOrder = Array.isArray(templateConfig.sectionOrder) ? templateConfig.sectionOrder : [];
        document.getElementById('ps-section-order').value = sectionOrder.join(', ');
        var publishTargets = Array.isArray(s.publish_targets_json)
          ? s.publish_targets_json
          : (typeof s.publish_targets_json === 'string' ? JSON.parse(s.publish_targets_json) : []);
        document.getElementById('ps-publish-targets').value = publishTargets.length ? JSON.stringify(publishTargets, null, 2) : '';
      }
    } catch (e) {}
  }

  async function saveProjectSettings() {
    var select = document.getElementById('settingsProjectSelect');
    var project = select.value;
    if (project === '__new__') {
      project = prompt('Project name (e.g. my-app):');
      if (!project) return;
    }
    var cats = document.getElementById('ps-categories').value.split(',').map(function (c) { return c.trim(); }).filter(Boolean);
    var sectionOrder = document.getElementById('ps-section-order').value
      .split(',')
      .map(function (c) { return c.trim(); })
      .filter(Boolean);
    var publishTargets = [];
    var publishTargetsRaw = document.getElementById('ps-publish-targets').value.trim();
    if (publishTargetsRaw) {
      try {
        var parsedTargets = JSON.parse(publishTargetsRaw);
        if (!Array.isArray(parsedTargets)) {
          showToast('Publish Targets JSON must be an array');
          return;
        }
        publishTargets = parsedTargets;
      } catch (e) {
        showToast('Publish Targets JSON is invalid');
        return;
      }
    }
    var body = {
      defaultSource: document.getElementById('ps-source').value,
      defaultProvider: document.getElementById('ps-provider').value,
      defaultModel: document.getElementById('ps-model').value,
      defaultAudience: document.getElementById('ps-audience').value,
      defaultTone: document.getElementById('ps-tone').value,
      categories: cats,
      publishTargets: publishTargets,
      widgetConfig: {
        template: {
          defaultFormat: document.getElementById('ps-format').value,
          profile: document.getElementById('ps-template-profile').value.trim(),
          sectionOrder: sectionOrder,
        },
      },
    };
    var status = document.getElementById('settingsSaveStatus');
    try {
      var res = await apiFetch('/v1/projects/' + encodeURIComponent(project) + '/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) throw new Error();
      status.textContent = 'Saved!';
      status.style.color = 'var(--accent)';
      setTimeout(function () { status.textContent = ''; }, 2000);
      var existingOpt = Array.from(select.options).find(function (o) { return o.value === project; });
      if (!existingOpt) {
        var newOpt = document.createElement('option');
        newOpt.value = project;
        newOpt.textContent = project;
        select.insertBefore(newOpt, select.querySelector('[value="__new__"]'));
        select.value = project;
      }
    } catch (e) {
      status.textContent = 'Failed to save';
      status.style.color = '#e74c3c';
    }
  }

  // --- Changelog Management ---

  async function loadChangelog() {
    try {
      var res = await apiFetch('/v1/changelog/projects');
      if (!res.ok) throw new Error();
      var data = await res.json();
      var select = document.getElementById('changelogProjectSelect');
      var current = select.value;
      select.innerHTML = '<option value="">Select a project...</option>';
      (data.projects || []).forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
      });
      if (current && data.projects.indexOf(current) !== -1) {
        select.value = current;
        loadChangelogReleases();
      }
      if (data.projects && data.projects.length > 0) {
        updateWidgetSnippet(data.projects[0]);
      }
    } catch (e) {
      document.getElementById('changelogReleaseList').innerHTML =
        '<div class="empty-state" style="min-height:100px"><p>Failed to load projects</p></div>';
    }
  }

  function updateWidgetSnippet(project) {
    var proj = project || document.getElementById('changelogProjectSelect').value || 'your-project';
    var liveLink = document.getElementById('changelogLiveLink');
    if (liveLink) {
      if (proj && proj !== 'your-project') {
        liveLink.href = 'changelog.html?project=' + encodeURIComponent(proj);
        liveLink.style.display = '';
      } else {
        liveLink.style.display = 'none';
      }
    }
    var accent = document.getElementById('widgetAccentColor').value;
    var header = document.getElementById('widgetHeaderText').value;
    var emoji = document.getElementById('widgetTriggerEmoji').value;
    var snippet = '<script src="https://cullit.io/widget.js"\n' +
      '  data-project="' + escapeHtml(proj) + '"\n' +
      '  data-position="bottom-right"';
    if (accent && accent !== '#e8ff47') snippet += '\n  data-accent-color="' + escapeHtml(accent) + '"';
    if (header && header !== "What's New") snippet += '\n  data-header-text="' + escapeHtml(header) + '"';
    if (emoji && emoji !== '\uD83D\uDD14') snippet += '\n  data-trigger-emoji="' + escapeHtml(emoji) + '"';
    snippet += '>\n<\/script>';
    document.getElementById('widgetSnippet').textContent = snippet;
  }

  async function loadChangelogReleases() {
    var project = document.getElementById('changelogProjectSelect').value;
    var list = document.getElementById('changelogReleaseList');
    if (!project) {
      list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>Select a project to view releases</p></div>';
      return;
    }
    updateWidgetSnippet(project);
    try {
      var res = await apiFetch('/v1/changelog/' + encodeURIComponent(project) + '/latest?limit=50');
      if (!res.ok) throw new Error();
      var data = await res.json();
      var releases = data.releases || [];
      if (!releases.length) {
        list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>No releases published yet</p></div>';
        return;
      }
      list.innerHTML = releases.map(function (r) {
        return '<div class="history-item" style="display:flex;justify-content:space-between;align-items:center">' +
          '<div>' +
            '<span class="tag">' + escapeHtml(r.version) + '</span> ' +
            '<span style="color:var(--text-dim);font-size:0.75rem">' + escapeHtml(r.date) + '</span>' +
            (r.summary ? '<div style="font-size:0.8rem;color:var(--text-dim);margin-top:0.25rem">' + escapeHtml(r.summary.slice(0, 120)) + '</div>' : '') +
          '</div>' +
          '<button class="btn-danger" style="font-size:0.7rem;padding:0.2rem 0.5rem" data-del-project="' + escapeAttr(project) + '" data-del-version="' + escapeAttr(r.version) + '">Delete</button>' +
        '</div>';
      }).join('');

      list.querySelectorAll('[data-del-project]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          deleteRelease(btn.dataset.delProject, btn.dataset.delVersion);
        });
      });
    } catch (e) {
      list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>Failed to load releases</p></div>';
    }
  }

  async function deleteRelease(project, version) {
    if (!confirm('Delete release ' + version + ' from ' + project + '?')) return;
    try {
      var res = await apiFetch('/v1/changelog/' + encodeURIComponent(project) + '/' + encodeURIComponent(version), {
        method: 'DELETE',
      });
      if (!res.ok) {
        var data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      showToast('Deleted ' + version);
      loadChangelogReleases();
    } catch (err) {
      showToast(err.message);
    }
  }

  function copyWidgetSnippet() {
    var text = document.getElementById('widgetSnippet').textContent;
    navigator.clipboard.writeText(text).then(function () {
      showToast('Widget snippet copied!');
    });
  }

  async function loadBilling() {
    var tier = (currentUser && (currentUser.effectiveTier || currentUser.tier)) ? (currentUser.effectiveTier || currentUser.tier) : 'free';
    var planName = tier.charAt(0).toUpperCase() + tier.slice(1);
    document.getElementById('billingPlanName').textContent = planName;

    document.querySelectorAll('.billing-plan-option').forEach(function (el) { el.classList.remove('current'); });
    var cardPlanMap = { planFree: 'free', planPro: 'pro', planTeam: 'team', planEnterprise: 'enterprise' };
    var planEl = document.getElementById('plan' + planName);
    if (planEl) planEl.classList.add('current');

    var tierRank = { free: 0, pro: 1, team: 2, enterprise: 3 };
    var currentRank = tierRank[tier] || 0;
    document.querySelectorAll('.billing-plan-option').forEach(function (el) {
      var btn = el.querySelector('.plan-upgrade-btn');
      if (!btn) return;
      var cardPlan = cardPlanMap[el.id] || 'free';
      var cardRank = tierRank[cardPlan] || 0;
      if (cardRank <= currentRank) {
        if (cardRank > 0 && cardRank < currentRank) {
          btn.textContent = 'Downgrade';
          btn.style.display = '';
          btn.style.background = 'transparent';
          btn.style.border = '1px solid var(--border)';
          btn.style.color = 'var(--text-dim)';
          btn.onclick = function () { openBillingPortal(); };
        } else {
          btn.style.display = 'none';
        }
      } else {
        btn.textContent = 'Upgrade';
        btn.style.display = '';
        btn.style.background = '';
        btn.style.border = '';
        btn.style.color = '';
      }
    });

    var manageSection = document.getElementById('manageSeatsSection');
    if (manageSection) {
      if (tier === 'team') {
        manageSection.style.display = '';
        var updateBtn = document.getElementById('updateSeatsBtn');
        var proNote = document.getElementById('prorationNote');
        if (updateBtn) updateBtn.style.display = 'none';
        if (proNote) proNote.style.display = 'none';
      } else {
        manageSection.style.display = 'none';
      }
    }

    ['Free', 'Pro', 'Team', 'Enterprise'].forEach(function (t) {
      var el = document.getElementById('support' + t);
      if (el) el.style.display = (t.toLowerCase() === tier) ? '' : 'none';
    });

    var statusEl = document.getElementById('billingPlanStatus');
    var actionsEl = document.getElementById('billingActions');
    actionsEl.innerHTML = '';

    try {
      var res = await apiFetch('/v1/billing/subscription');
      if (res.ok) {
        var sub = await res.json();
        if (sub && sub.subscription) {
          if (sub.subscription.status === 'past_due') {
            statusEl.textContent = 'Payment Failed';
            statusEl.style.color = 'var(--terminal-red)';
            var warningBtn = document.createElement('button');
            warningBtn.className = 'btn-small';
            warningBtn.style.background = 'var(--terminal-red)';
            warningBtn.style.color = '#fff';
            warningBtn.textContent = 'Update Payment Method';
            warningBtn.addEventListener('click', openBillingPortal);
            actionsEl.appendChild(warningBtn);
          } else {
            statusEl.textContent = sub.subscription.status === 'active' ? 'Active' : sub.subscription.status;
          }
          if (sub.subscription.currentPeriodEnd) {
            var end = new Date(sub.subscription.currentPeriodEnd);
            statusEl.textContent += ' \u2014 renews ' + end.toLocaleDateString();
          }
          var portalBtn = document.createElement('button');
          portalBtn.className = 'btn-small';
          portalBtn.textContent = 'Manage Billing';
          portalBtn.addEventListener('click', openBillingPortal);
          actionsEl.appendChild(portalBtn);
        } else {
          statusEl.textContent = tier === 'free' ? 'No active subscription' : '';
        }
      }
    } catch (e) {
      statusEl.textContent = '';
    }

    var teamKeysPanel = document.getElementById('teamKeysPanel');
    if (tier === 'team' || tier === 'enterprise') {
      teamKeysPanel.style.display = '';
      await loadTeamKeys();
      if (tier === 'team') {
        var seatInput = document.getElementById('dashTeamSeats');
        if (seatInput) { seatInput.value = manageSeatCount; updateTeamTotal(); }
      }
    } else {
      teamKeysPanel.style.display = 'none';
    }

    var analyticsPanel = document.getElementById('analyticsQuickLink');
    if (analyticsPanel) {
      analyticsPanel.style.display = tier !== 'free' ? '' : 'none';
    }

    // Usage bar
    try {
      var usageRes = await apiFetch('/v1/analytics/usage?days=30');
      if (usageRes.ok) {
        var usageData = await usageRes.json();
        var used = usageData.monthlyGenerations || 0;
        var limit = TIER_LIMITS[tier] || 3;
        var pct = limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100));

        document.getElementById('usageCount').textContent = used.toLocaleString();
        document.getElementById('usageLimit').textContent = limit === Infinity
          ? '/ unlimited'
          : '/ ' + limit.toLocaleString() + ' generations';

        var bar = document.getElementById('usageBarFill');
        bar.style.width = pct + '%';
        bar.className = 'usage-bar-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : '');

        var warn = document.getElementById('usageWarning');
        if (limit !== Infinity && pct >= 90) {
          warn.innerHTML = 'You\u2019ve used ' + used.toLocaleString() + ' of ' + limit.toLocaleString() + ' generations this month. <a href="pricing.html" style="color:inherit;font-weight:600;text-decoration:underline">Upgrade your plan</a> for more.';
          warn.className = 'usage-warning warn-red';
          warn.style.display = '';
        } else if (limit !== Infinity && pct >= 66) {
          warn.innerHTML = 'Approaching your limit &mdash; ' + used.toLocaleString() + ' of ' + limit.toLocaleString() + ' generations used. <a href="pricing.html" style="color:inherit;font-weight:600;text-decoration:underline">View upgrade options</a>';
          warn.className = 'usage-warning warn-yellow';
          warn.style.display = '';
        } else {
          warn.style.display = 'none';
        }
      }
    } catch (e) {}
  }

  async function upgradePlan(plan) {
    try {
      var body = { plan: plan };
      if (plan === 'team') {
        var seatInput = document.getElementById('dashTeamSeats');
        body.seats = parseInt(seatInput ? seatInput.value : '5', 10);
      }
      var res = await apiFetch('/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      var data = await res.json();
      if (data.updated) {
        showToast('Plan updated to ' + capitalize(plan) + '!');
        var meRes = await apiFetch('/auth/me');
        var me = await meRes.json();
        if (me.tier) {
          currentUser = me;
          document.getElementById('navTier').textContent = me.effectiveTier || me.tier;
          loadBilling();
        }
      } else if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Unable to start checkout');
      }
    } catch (e) {
      showToast('Billing is not configured yet. Contact sales@cullit.io');
    }
  }

  async function openBillingPortal() {
    try {
      var res = await apiFetch('/v1/billing/portal', { method: 'POST' });
      var data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Unable to open billing portal');
      }
    } catch (e) {
      showToast('Billing portal unavailable');
    }
  }

  // --- Team Key Management ---

  async function loadTeamKeys() {
    var list = document.getElementById('teamKeysList');
    list.innerHTML = '<div style="color:var(--text-dim)">Loading team keys\u2026</div>';
    try {
      var res = await apiFetch('/v1/org/keys');
      if (!res.ok) { list.innerHTML = '<div style="color:var(--terminal-red)">Failed to load team keys</div>'; return; }
      var data = await res.json();
      var keys = data.keys || [];

      var seatEl = document.getElementById('teamKeySeatCount');
      var activeCount = keys.filter(function (k) { return !k.revokedAt; }).length;
      manageSeatCount = Math.max(activeCount, 5);
      seatEl.textContent = activeCount + ' of ' + manageSeatCount + ' seats active';

      var seatUtilEl = document.getElementById('seatUtilMsg');
      if (seatUtilEl) {
        var unused = manageSeatCount - activeCount;
        if (unused > Math.ceil(manageSeatCount * 0.5)) {
          seatUtilEl.textContent = 'You\u2019re using ' + activeCount + ' of ' + manageSeatCount + ' seats. Invite more team members or consider a smaller plan.';
          seatUtilEl.style.display = '';
        } else if (activeCount >= manageSeatCount) {
          seatUtilEl.textContent = 'All ' + manageSeatCount + ' seats are in use. Add more seats above to expand your team.';
          seatUtilEl.style.display = '';
        } else {
          seatUtilEl.style.display = 'none';
        }
      }

      if (!keys.length) {
        list.innerHTML = '<div style="color:var(--text-dim)">No team API keys yet. Keys are provisioned when you subscribe to a Team plan.</div>';
        return;
      }
      list.innerHTML = '';
      keys.forEach(function (k) {
        var card = document.createElement('div');
        card.className = 'team-key-card' + (k.revokedAt ? ' revoked' : '');
        card.dataset.keyId = k.id;

        var isRevoked = !!k.revokedAt;
        var isAssigned = !!k.assignedToEmail;

        card.innerHTML =
          '<div class="team-key-header">' +
            '<input class="team-key-label" value="' + escapeAttr(k.label || '') + '" placeholder="Label (e.g. Frontend Dev)" maxlength="64"' + (isRevoked ? ' disabled' : '') + '>' +
            (isRevoked ? '<span class="team-key-badge revoked-badge">Revoked</span>' : (isAssigned ? '<span class="team-key-badge assigned">Assigned</span>' : '<span class="team-key-badge">Unassigned</span>')) +
          '</div>' +
          '<div class="team-key-value">' +
            '<code class="team-key-code">' + escapeHtml(k.apiKey) + '</code>' +
            (!isRevoked ? '<button class="team-key-copy-btn" title="Copy key">\uD83D\uDCCB</button>' : '') +
          '</div>' +
          (!isRevoked ?
            '<div class="team-key-assign">' +
              '<input type="email" class="team-key-email" value="' + escapeAttr(k.assignedToEmail || '') + '" placeholder="team-member@company.com">' +
              '<input type="text" class="team-key-name" value="' + escapeAttr(k.assignedToName || '') + '" placeholder="Name (optional)">' +
            '</div>' : '') +
          '<div class="team-key-actions">' +
            (!isRevoked ? '<button class="btn-small team-key-save" title="Save label and assignment">Save</button>' : '') +
            (!isRevoked && isAssigned ? '<button class="btn-small team-key-send" title="Email key to assignee">Send Email</button>' : '') +
            (!isRevoked ? '<button class="btn-small team-key-rotate" title="Generate new key value">Rotate</button>' : '') +
            (!isRevoked ? '<button class="btn-small team-key-revoke" style="background:var(--terminal-red)" title="Permanently revoke this key">Revoke</button>' : '') +
          '</div>';

        var copyBtn = card.querySelector('.team-key-copy-btn');
        if (copyBtn) copyBtn.addEventListener('click', function () { copyTeamKey(k.apiKey); });

        var saveBtn = card.querySelector('.team-key-save');
        if (saveBtn) saveBtn.addEventListener('click', function () { saveTeamKey(card, k.id); });

        var sendBtn = card.querySelector('.team-key-send');
        if (sendBtn) sendBtn.addEventListener('click', function () { sendTeamKeyEmail(k.id); });

        var rotateBtn = card.querySelector('.team-key-rotate');
        if (rotateBtn) rotateBtn.addEventListener('click', function () { rotateTeamKey(k.id); });

        var revokeBtn = card.querySelector('.team-key-revoke');
        if (revokeBtn) revokeBtn.addEventListener('click', function () { revokeTeamKey(k.id); });

        list.appendChild(card);
      });
    } catch (e) {
      list.innerHTML = '<div style="color:var(--terminal-red)">Error loading team keys</div>';
    }
  }

  function copyTeamKey(apiKey) {
    navigator.clipboard.writeText(apiKey).then(function () {
      showToast('API key copied to clipboard');
    }).catch(function () {
      showToast('Failed to copy');
    });
  }

  async function saveTeamKey(card, keyId) {
    var label = card.querySelector('.team-key-label').value.trim();
    var email = card.querySelector('.team-key-email') ? card.querySelector('.team-key-email').value.trim() : null;
    var name = card.querySelector('.team-key-name') ? card.querySelector('.team-key-name').value.trim() : null;

    try {
      var res = await apiFetch('/v1/org/keys/' + keyId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label, assignedToEmail: email || null, assignedToName: name || null }),
      });
      var data = await res.json();
      if (res.ok) {
        showToast('Saved');
        loadTeamKeys();
      } else {
        showToast(data.error || 'Failed to save');
      }
    } catch (e) {
      showToast('Error saving team key');
    }
  }

  async function sendTeamKeyEmail(keyId) {
    if (!confirm('Send the API key to the assigned email address?')) return;
    try {
      var res = await apiFetch('/v1/org/keys/' + keyId + '/send', { method: 'POST' });
      var data = await res.json();
      if (res.ok) {
        showToast(data.sent ? 'Key emailed successfully' : 'Email sending is not configured');
      } else {
        showToast(data.error || 'Failed to send');
      }
    } catch (e) {
      showToast('Error sending email');
    }
  }

  async function revokeTeamKey(keyId) {
    if (!confirm('Revoke this key? It will immediately stop working and cannot be undone.')) return;
    try {
      var res = await apiFetch('/v1/org/keys/' + keyId + '/revoke', { method: 'POST' });
      var data = await res.json();
      if (res.ok) {
        showToast('Key revoked');
        loadTeamKeys();
      } else {
        showToast(data.error || 'Failed to revoke');
      }
    } catch (e) {
      showToast('Error revoking key');
    }
  }

  async function rotateTeamKey(keyId) {
    if (!confirm('Rotate this key? The old key will stop working immediately. Make sure to share the new key with the team member.')) return;
    try {
      var res = await apiFetch('/v1/org/keys/' + keyId + '/rotate', { method: 'POST' });
      var data = await res.json();
      if (res.ok) {
        if (data.apiKey) {
          navigator.clipboard.writeText(data.apiKey).then(function () {
            showToast('Key rotated \u2014 new key copied to clipboard');
          }).catch(function () {
            showToast('Key rotated \u2014 copy the new key from below');
          });
        } else {
          showToast('Key rotated');
        }
        loadTeamKeys();
      } else {
        showToast(data.error || 'Failed to rotate');
      }
    } catch (e) {
      showToast('Error rotating key');
    }
  }

  // --- Init ---

  document.addEventListener('DOMContentLoaded', function () {
    var apiInput = document.getElementById('apiUrl');
    var savedApiUrl = localStorage.getItem('cullit_api_url');
    var preferredApiUrl = (isLocalContext() && savedApiUrl && /api\.cullit\.io/i.test(savedApiUrl))
      ? defaultApiUrl()
      : ((savedApiUrl && savedApiUrl.replace(/\/+$/, '')) || defaultApiUrl());
    apiInput.value = preferredApiUrl;

    checkAuth();
    document.getElementById('apiUrl').addEventListener('change', function () {
      checkAuth();
    });

    // Hamburger nav toggle
    var hamburger = document.getElementById('hamburger');
    var navLinks = document.getElementById('navLinks');
    hamburger.addEventListener('click', function () {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });

    // --- Event delegation for all static dashboard handlers ---
    document.addEventListener('click', function (e) {
      var target = e.target;
      var action = target.dataset ? target.dataset.action : null;
      var btn;

      // Upgrade overlay dismiss
      if (target.id === 'upgradeOverlay' || target.closest('#upgradeOverlay') === target) {
        if (target.id === 'upgradeOverlay') dismissUpgrade();
      }

      // data-action handlers
      if (action) {
        switch (action) {
          case 'dismiss-upgrade': dismissUpgrade(); break;
          case 'logout': logout(); break;
          case 'generate': generate(); break;
          case 'switch-view':
            switchView(target.dataset.view);
            break;
          case 'copy-output': copyOutput(); break;
          case 'create-draft': createDraftFromCurrentOutput(); break;
          case 'refresh-drafts': loadDrafts(); break;
          case 'close-draft-detail': closeDraftDetail(); break;
          case 'switch-tab':
            switchDashTab(target.dataset.tab);
            break;
          case 'create-org': createOrgAction(); break;
          case 'invite-member': inviteMember(); break;
          case 'toggle-api-key': toggleApiKeyVisibility(); break;
          case 'copy-api-key': copyApiKey(); break;
          case 'rotate-api-key': rotateApiKey(); break;
          case 'refresh-github': loadGithubInstallations(); break;
          case 'refresh-changelog': loadChangelog(); break;
          case 'copy-widget': copyWidgetSnippet(); break;
          case 'upgrade-pro': upgradePlan('pro'); break;
          case 'upgrade-team': upgradePlan('team'); break;
          case 'seat-decr': adjustSeats(-1); break;
          case 'seat-incr': adjustSeats(1); break;
          case 'update-seats': updateTeamSeats(); break;
          case 'analytics-tab': switchDashTab('analytics'); break;
        }
        return;
      }

      // Dash tab buttons (by class)
      btn = target.closest('.dash-tab');
      if (btn && btn.dataset.tab) {
        switchDashTab(btn.dataset.tab);
        return;
      }
    });

    // Change/input event delegation
    document.addEventListener('change', function (e) {
      var target = e.target;
      if (target.id === 'draftStatusFilter') loadDrafts();
      if (target.id === 'settingsProjectSelect') loadProjectSettings();
      if (target.id === 'changelogProjectSelect') loadChangelogReleases();
      if (target.id === 'widgetAccentColor') updateWidgetSnippet();
    });

    document.addEventListener('input', function (e) {
      var target = e.target;
      if (target.id === 'dashTeamSeats') updateTeamTotal();
      if (target.id === 'widgetHeaderText') updateWidgetSnippet();
      if (target.id === 'widgetTriggerEmoji') updateWidgetSnippet();
    });

    // Form submit delegation
    var settingsForm = document.getElementById('projectSettingsForm');
    if (settingsForm) {
      settingsForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveProjectSettings();
      });
    }
  });
})();
