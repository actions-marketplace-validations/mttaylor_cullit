/* dashboard.js — Full dashboard logic (CSP-safe, no inline handlers) */
(function () {
  'use strict';

  // --- State ---
  var currentOutput = '';
  var currentView = 'rendered';
  var currentUser = null;
  var PROVIDER_KEY_STORE = 'cullit_provider_keys';

  function readProviderKeyStore() {
    try {
      var raw = localStorage.getItem(PROVIDER_KEY_STORE);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeProviderKeyStore(store) {
    try {
      localStorage.setItem(PROVIDER_KEY_STORE, JSON.stringify(store || {}));
    } catch (e) {}
  }

  function getRememberedProviderKey(provider) {
    if (!provider) return '';
    var store = readProviderKeyStore();
    var value = store[provider];
    return typeof value === 'string' ? value : '';
  }

  function rememberProviderKey(provider, key) {
    if (!provider) return;
    var store = readProviderKeyStore();
    if (key) store[provider] = key;
    else delete store[provider];
    writeProviderKeyStore(store);
  }

  function refreshProviderKeyInput() {
    var providerEl = document.getElementById('provider');
    var keyEl = document.getElementById('providerApiKey');
    var rememberEl = document.getElementById('rememberProviderKey');
    if (!providerEl || !keyEl || !rememberEl) return;

    var provider = providerEl.value;
    var remembered = getRememberedProviderKey(provider);
    keyEl.value = remembered;
    rememberEl.checked = !!remembered;
  }

  function sourceDefaultsFromSettings() {
    var ownerInput = document.getElementById('sourceOwner');
    var repoInput = document.getElementById('sourceRepo');
    var psOwner = document.getElementById('ps-github-owner');
    var psRepo = document.getElementById('ps-github-repo');
    if (!ownerInput || !repoInput || !psOwner || !psRepo) return;
    if (!ownerInput.value.trim() && psOwner.value.trim()) ownerInput.value = psOwner.value.trim();
    if (!repoInput.value.trim() && psRepo.value.trim()) repoInput.value = psRepo.value.trim();
  }

  function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // --- API helpers (delegate to CullitSite) ---

  var isLocalContext = window.CullitSite.isLocalContext;

  function defaultApiUrl() {
    return window.CullitSite.getApiUrl();
  }

  var apiUrl = function () {
    var input = document.getElementById('apiUrl').value.trim();
    if (input) {
      var normalized = input.replace(/\/+$/, '');
      try { localStorage.setItem('cullit_api_url', normalized); } catch (e) {}
      return normalized;
    }
    return CullitSite.getApiUrl();
  };

  function apiFetch(path, opts) {
    opts = opts || {};
    var url = apiUrl() + path;
    return fetch(url, Object.assign({ credentials: 'include' }, opts)).then(function (res) {
      if (res.status === 401 && path !== '/auth/me') {
        showToast('Session expired — please log in again');
        setTimeout(function () { window.location.href = 'index.html'; }, 1500);
      }
      return res;
    });
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
    } catch (e) {
      console.error('Auth check failed:', e);
    }
    await showAuthWall();
  }

  async function showAuthWall() {
    document.getElementById('authWall').style.display = '';
    document.getElementById('dashApp').style.display = 'none';
    document.getElementById('navUser').style.display = 'none';

    var btn = document.getElementById('loginBtn');
    var statusBox = document.getElementById('apiStatus');
    var statusMessage = document.getElementById('apiStatusMessage');
    var cliHint = document.getElementById('cliHint');
    var base = apiUrl();

    btn.style.opacity = '';
    btn.style.pointerEvents = '';
    btn.href = base + '/auth/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash);

    statusBox.style.display = 'none';
    cliHint.style.display = '';

    try {
      var health = await fetch(base + '/healthz', { mode: 'cors', credentials: 'include' });
      if (health.ok) {
        return;
      }
    } catch (e) {}

    if (statusMessage) {
      statusMessage.innerHTML =
        'Could not verify API health at <code style="font-size:0.72rem">' + escapeHtml(base) + '</code>. '
        + 'Login may still work, but if it fails, make sure the API is running and '
        + '<code style="font-size:0.72rem">ALLOWED_ORIGINS</code> includes '
        + '<code style="font-size:0.72rem">' + escapeHtml(window.location.origin) + '</code>.';
    }
    statusBox.style.display = 'block';
    cliHint.style.display = 'none';
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
    }).catch(function () {
      showToast('Failed to copy — clipboard access denied');
    });
  }

  async function rotateApiKey() {
    if (!confirm('Rotate your API key? Your current key will stop working immediately.')) return;
    try {
      var res = await apiFetch('/auth/rotate-key', { method: 'POST' });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        showToast(err.error || 'Failed to rotate key (' + res.status + ')');
        return;
      }
      var data = await res.json();
      if (data.apiKey) {
        currentUser.apiKey = data.apiKey;
        document.getElementById('apiKeyDisplay').value = data.apiKey;
        showToast('API key rotated successfully');
      } else { showToast('Failed to rotate key'); }
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
    if (currentUser.avatarUrl && /^https?:\/\//i.test(currentUser.avatarUrl)) {
      avatarEl.src = currentUser.avatarUrl;
      avatarEl.hidden = false;
    }
    document.getElementById('navLogin').textContent = currentUser.login;
    document.getElementById('navTier').textContent = 'open-source';

    applyTabGating();
    applyAudienceToneGating();
    checkHealth().catch(function () {});
    loadHistory().catch(function () {});
    loadAnalytics().catch(function () {});
    loadTeam().catch(function () {});
    loadBilling().catch(function () {});

    var params = new URLSearchParams(location.search);
    if (params.get('checkout') || params.get('billing')) {
      history.replaceState(null, '', 'dashboard.html');
      showToast('Billing and upgrades are retired. Cullit is fully open source.');
    }
  }

  async function pollForTierUpdate() {
    showToast('Billing and checkout are retired. Cullit is fully open source.');
  }

  async function refreshAfterPortal() {
    showToast('Billing portal is retired. Support Cullit on GitHub Sponsors.');
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
    btn.textContent = actionText || 'Support Cullit';
    btn.href = actionHref || 'pricing.html';
    document.getElementById('upgradeOverlay').classList.add('visible');
  }

  function dismissUpgrade() {
    document.getElementById('upgradeOverlay').classList.remove('visible');
  }

  // --- Generate ---

  var isGenerating = false;

  async function generate() {
    if (isGenerating) { showToast('Already generating\u2026'); return; }
    isGenerating = true;

    var btn = document.getElementById('generateBtn');
    var fromRef = document.getElementById('fromRef').value.trim();
    var toRef = document.getElementById('toRef').value.trim() || 'HEAD';

    if (!fromRef) { isGenerating = false; showToast('Please enter a "From" tag or SHA'); return; }

    sourceDefaultsFromSettings();
    var sourceType = document.getElementById('sourceType').value || 'local';
    var sourceOwner = document.getElementById('sourceOwner').value.trim();
    var sourceRepo = document.getElementById('sourceRepo').value.trim();
    var provider = document.getElementById('provider').value;
    var providerApiKey = document.getElementById('providerApiKey').value.trim();
    var rememberProvider = !!document.getElementById('rememberProviderKey').checked;

    if (rememberProvider && providerApiKey) {
      rememberProviderKey(provider, providerApiKey);
    } else if (!rememberProvider) {
      rememberProviderKey(provider, '');
    }

    var source = { type: sourceType };
    if (sourceOwner) source.owner = sourceOwner;
    if (sourceRepo) source.repo = sourceRepo;

    if (sourceType === 'github' && (!sourceOwner || !sourceRepo)) {
      isGenerating = false;
      showToast('GitHub source requires both owner and repo');
      return;
    }

    var body = {
      from: fromRef,
      to: toRef,
      provider: provider,
      audience: document.getElementById('audience').value,
      tone: document.getElementById('tone').value,
      format: document.getElementById('format').value,
      source: source,
    };
    if (providerApiKey && provider !== 'none' && provider !== 'ollama') {
      body.apiKey = providerApiKey;
    }

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
      if (res.status === 401) {
        showToast('Session expired. Please refresh and log in again.');
        return;
      }
      if (res.status === 402 || res.status === 403) {
        showToast(data.error || 'This endpoint returned a legacy billing response.');
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
      isGenerating = false;
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
    }).catch(function () {
      showToast('Failed to copy — clipboard access denied');
    });
  }

  var escapeHtml = window.CullitSite.escapeHtml;
  var escapeAttr = function(text) { return escapeHtml(text).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); };
  var simpleMarkdown = window.CullitSite.markdownToHtml;

  // --- Dashboard Tabs ---

  var TAB_MIN_TIERS = {
    generate: 'free', history: 'free', settings: 'free', billing: 'free',
    drafts: 'free', analytics: 'free', team: 'free', changelog: 'free',
  };
  var TIER_RANK = { free: 0, paid: 1, pro: 1, team: 1, enterprise: 2 };

  function applyTabGating() {
    document.querySelectorAll('.dash-tab').forEach(function (btn) {
      btn.disabled = false;
      btn.title = '';
      btn.style.opacity = '';
      btn.style.cursor = '';
    });
  }

  function applyAudienceToneGating() {
    var audienceBadge = document.getElementById('audienceProBadge');
    var toneBadge = document.getElementById('toneProBadge');
    if (audienceBadge) audienceBadge.style.display = 'none';
    if (toneBadge) toneBadge.style.display = 'none';

    var audienceSelect = document.getElementById('audience');
    var toneSelect = document.getElementById('tone');
    if (audienceSelect) {
      Array.from(audienceSelect.options).forEach(function (opt) {
        opt.disabled = false;
      });
    }
    if (toneSelect) {
      Array.from(toneSelect.options).forEach(function (opt) {
        opt.disabled = false;
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
      var entries = (data && data.entries) ? data.entries : [];

      if (!entries.length) {
        list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>No generation history yet</p></div>';
        pager.innerHTML = '';
        return;
      }

      list.innerHTML = entries.map(function (h) {
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
      var totals = (data && data.totals) || {};

      document.getElementById('statGens').textContent = (totals.generations || 0).toLocaleString();
      document.getElementById('statChanges').textContent = (totals.totalChanges || 0).toLocaleString();
      document.getElementById('statAvgTime').textContent = (totals.avgDuration || 0) > 0 ? (totals.avgDuration / 1000).toFixed(1) + 's' : '-';
      document.getElementById('statMonthly').textContent = ((data && data.monthlyGenerations) || 0).toLocaleString();

      renderBarChart((data && data.daily) || []);
      renderProviders((data && data.topProviders) || []);
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
    var isPaid = true;
    document.getElementById('draftTeamGate').style.display = 'none';
    document.getElementById('draftList').parentElement.parentElement.style.display = 'block';
    if (document.getElementById('draftDetailPanel')) document.getElementById('draftDetailPanel').style.display = 'none';

    var list = document.getElementById('draftList');
    var pager = document.getElementById('draftPager');
    var statusFilter = document.getElementById('draftStatusFilter').value;
    try {
      var url = '/v1/drafts?limit=' + DRAFTS_LIMIT + '&offset=' + draftsOffset;
      if (statusFilter) url += '&status=' + statusFilter;
      var res = await apiFetch(url);
      if (!res.ok) throw new Error();
      var data = await res.json();
      var drafts = (data && data.drafts) ? data.drafts : [];

      if (!drafts.length) {
        list.innerHTML = '<div class="empty-state" style="min-height:100px"><p>No drafts' + (statusFilter ? ' with status &quot;' + escapeHtml(statusFilter) + '&quot;' : '') + '</p></div>';
        pager.innerHTML = '';
        return;
      }

      list.innerHTML = drafts.map(function (d) {
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

      var totalPages = Math.ceil((data.total || drafts.length) / DRAFTS_LIMIT);
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
    var isPaid = true;
    document.getElementById('settingsTeamGate').style.display = 'none';
    document.getElementById('projectSettingsForm').parentElement.parentElement.style.display = 'block';
    loadGithubInstallations();

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
      if (!res.ok) {
        container.innerHTML = '<div class="empty-state" style="min-height:60px"><p>No GitHub App installations linked to your account.</p></div>';
        return;
      }
      var data = await res.json();
      if (!data.installations || data.installations.length === 0) {
        container.innerHTML = '<div class="empty-state" style="min-height:60px"><p>No GitHub App installations linked to your account.</p></div>';
        return;
      }
      container.innerHTML = data.installations.map(function (inst) {
        var repos = (inst.repos || []).slice(0, 10);
        var repoList = repos.length ? repos.map(function (r) { return '<span style="display:inline-block;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:0.15rem 0.4rem;font-size:0.72rem;margin:0.15rem 0.1rem">' + escapeHtml(r) + '</span>'; }).join(' ') : '<span style="font-size:0.75rem;color:var(--text-dim)">No repos</span>';
        return '<div style="border:1px solid var(--border);border-radius:8px;padding:0.75rem;margin-bottom:0.5rem">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem">' +
          '<strong style="font-size:0.85rem;color:var(--text-bright)">' + escapeHtml(inst.github_login) + '</strong>' +
          '<button class="btn-small" data-action="disconnect-github" data-installation-id="' + escapeAttr(String(inst.installation_id)) + '" style="font-size:0.65rem;background:transparent;border:1px solid var(--danger,#e74c3c);color:var(--danger,#e74c3c)">Disconnect</button>' +
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
      document.getElementById('ps-github-owner').value = '';
      document.getElementById('ps-github-repo').value = '';
      document.getElementById('ps-publish-targets').value = '';
      return;
    }
    try {
      var res = await apiFetch('/v1/projects/settings');
      if (!res.ok) return;
      var data = await res.json();
      var s = (data.settings || []).find(function (x) { return x.project === project; });
      if (s) {
        var widgetConfig;
        try {
          widgetConfig = typeof s.widget_config_json === 'string'
            ? JSON.parse(s.widget_config_json)
            : (s.widget_config_json || {});
        } catch (_e) { widgetConfig = {}; }
        var templateConfig = widgetConfig && typeof widgetConfig === 'object' ? (widgetConfig.template || {}) : {};
        var githubConfig = widgetConfig && typeof widgetConfig === 'object' ? (widgetConfig.github || {}) : {};
        document.getElementById('ps-source').value = s.default_source || 'local';
        document.getElementById('ps-provider').value = s.default_provider || 'none';
        document.getElementById('ps-model').value = s.default_model || '';
        document.getElementById('ps-audience').value = s.default_audience || 'developer';
        document.getElementById('ps-tone').value = s.default_tone || 'professional';
        var categories;
        try {
          categories = Array.isArray(s.categories_json)
            ? s.categories_json
            : (typeof s.categories_json === 'string' ? JSON.parse(s.categories_json) : []);
        } catch (_e) { categories = []; }
        document.getElementById('ps-categories').value = categories.join(', ');
        document.getElementById('ps-format').value = templateConfig.defaultFormat || 'markdown';
        document.getElementById('ps-template-profile').value = templateConfig.profile || '';
        var sectionOrder = Array.isArray(templateConfig.sectionOrder) ? templateConfig.sectionOrder : [];
        document.getElementById('ps-section-order').value = sectionOrder.join(', ');
        document.getElementById('ps-github-owner').value = githubConfig.owner || '';
        document.getElementById('ps-github-repo').value = githubConfig.repo || '';
        var sourceTypeEl = document.getElementById('sourceType');
        if (sourceTypeEl) {
          sourceTypeEl.value = (s.default_source === 'github') ? 'github' : 'local';
        }
        var publishTargets = Array.isArray(s.publish_targets_json)
          ? s.publish_targets_json
          : (typeof s.publish_targets_json === 'string' ? JSON.parse(s.publish_targets_json) : []);
        document.getElementById('ps-publish-targets').value = publishTargets.length ? JSON.stringify(publishTargets, null, 2) : '';
        sourceDefaultsFromSettings();
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
        github: {
          owner: document.getElementById('ps-github-owner').value.trim(),
          repo: document.getElementById('ps-github-repo').value.trim(),
        },
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
    }).catch(function () {
      showToast('Failed to copy — clipboard access denied');
    });
  }

  async function loadBilling() {
    var tier = (currentUser && (currentUser.effectiveTier || currentUser.tier)) ? (currentUser.effectiveTier || currentUser.tier) : 'free';
    var planName = 'Open Source';
    document.getElementById('billingPlanName').textContent = planName;

    document.querySelectorAll('.billing-plan-option').forEach(function (el) { el.classList.remove('current'); });
    var planEl = document.getElementById('plan' + planName);
    if (planEl) planEl.classList.add('current');

    document.querySelectorAll('.billing-plan-option').forEach(function (el) {
      var btn = el.querySelector('.plan-upgrade-btn');
      if (!btn) return;
      btn.textContent = 'Support';
      btn.style.display = '';
      btn.onclick = function () { window.location.href = 'pricing.html'; };
    });

    ['Free', 'Pro', 'Team', 'Enterprise'].forEach(function (t) {
      var el = document.getElementById('support' + t);
      if (el) el.style.display = t === 'Free' ? '' : 'none';
    });

    var statusEl = document.getElementById('billingPlanStatus');
    var actionsEl = document.getElementById('billingActions');
    actionsEl.innerHTML = '';

    statusEl.textContent = 'Billing retired. Cullit is free and open source.';
    statusEl.style.color = 'var(--text-dim)';

    var supportBtn = document.createElement('button');
    supportBtn.className = 'btn-small';
    supportBtn.textContent = 'Sponsor on GitHub';
    supportBtn.addEventListener('click', function () {
      window.location.href = 'https://github.com/sponsors/mttaylor';
    });
    actionsEl.appendChild(supportBtn);

    var teamKeysPanel = document.getElementById('teamKeysPanel');
    var hasOrg = currentUser && currentUser.orgId;
    if (hasOrg) {
      teamKeysPanel.style.display = '';
      await loadTeamKeys();
    } else {
      teamKeysPanel.style.display = 'none';
    }

    var analyticsPanel = document.getElementById('analyticsQuickLink');
    if (analyticsPanel) {
      analyticsPanel.style.display = '';
    }

    // Usage bar
    try {
      var usageRes = await apiFetch('/v1/analytics/usage?days=30');
      if (usageRes.ok) {
        var usageData = await usageRes.json();
        var used = usageData.monthlyGenerations || 0;
        var limit = Infinity;
        var pct = 0;

        document.getElementById('usageCount').textContent = used.toLocaleString();
        document.getElementById('usageLimit').textContent = '/ unlimited';

        var bar = document.getElementById('usageBarFill');
        bar.style.width = pct + '%';
        bar.className = 'usage-bar-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : '');

        var warn = document.getElementById('usageWarning');
        warn.style.display = 'none';
      }
    } catch (e) {}
  }

  // --- Team Key Management ---

  // In-memory store of revealed key values (auto-expire after 5 minutes)
  var revealedKeys = {};
  var revealedKeyTimers = {};

  function storeRevealedKey(keyId, fullKey) {
    revealedKeys[keyId] = fullKey;
    if (revealedKeyTimers[keyId]) clearTimeout(revealedKeyTimers[keyId]);
    revealedKeyTimers[keyId] = setTimeout(function () {
      delete revealedKeys[keyId];
      delete revealedKeyTimers[keyId];
      loadTeamKeys();
    }, 5 * 60 * 1000);
  }

  async function loadTeamKeys() {
    var list = document.getElementById('teamKeysList');
    list.innerHTML = '<div style="color:var(--text-dim)">Loading team keys\u2026</div>';
    try {
      var res = await apiFetch('/v1/org/keys');
      if (!res.ok) {
        if (res.status === 403 || res.status === 401) {
          list.innerHTML = '<div style="color:var(--text-dim)">No team API keys yet. Create an organization to start sharing keys with your team.</div>';
        } else {
          list.innerHTML = '<div style="color:var(--terminal-red)">Failed to load team keys</div>';
        }
        return;
      }
      var data = await res.json();
      var keys = data.keys || [];

      var activeKeys = keys.filter(function (k) { return !k.revokedAt; });
      var revokedKeys = keys.filter(function (k) { return !!k.revokedAt; });

      var seatEl = document.getElementById('teamKeySeatCount');
      var activeCount = activeKeys.length;
      seatEl.textContent = activeCount + ' active key' + (activeCount === 1 ? '' : 's');

      var seatUtilEl = document.getElementById('seatUtilMsg');
      if (seatUtilEl) seatUtilEl.style.display = 'none';

      if (!keys.length) {
        list.innerHTML = '<div style="color:var(--text-dim)">No team API keys yet. Create one to share scoped access with your team.</div>';
        return;
      }

      list.innerHTML = '';

      // Render active keys
      activeKeys.forEach(function (k) {
        list.appendChild(buildKeyCard(k, false));
      });

      // Render revoked keys in a collapsible section
      if (revokedKeys.length > 0) {
        var section = document.createElement('div');
        section.className = 'revoked-keys-section';
        var toggle = document.createElement('button');
        toggle.className = 'btn-small revoked-keys-toggle';
        toggle.textContent = 'Show Revoked Keys (' + revokedKeys.length + ')';
        toggle.style.cssText = 'margin-top:12px;background:var(--bg-secondary);color:var(--text-dim);border:1px solid var(--border)';
        var container = document.createElement('div');
        container.className = 'revoked-keys-container';
        container.style.display = 'none';

        toggle.addEventListener('click', function () {
          var showing = container.style.display !== 'none';
          container.style.display = showing ? 'none' : '';
          toggle.textContent = (showing ? 'Show' : 'Hide') + ' Revoked Keys (' + revokedKeys.length + ')';
        });

        revokedKeys.forEach(function (k) {
          container.appendChild(buildKeyCard(k, true));
        });

        section.appendChild(toggle);
        section.appendChild(container);
        list.appendChild(section);
      }
    } catch (e) {
      list.innerHTML = '<div style="color:var(--terminal-red)">Error loading team keys</div>';
    }
  }

  function buildKeyCard(k, isRevoked) {
    var card = document.createElement('div');
    card.className = 'team-key-card' + (isRevoked ? ' revoked' : '');
    card.dataset.keyId = k.id;

    var isAssigned = !!k.assignedToEmail;
    var hasRevealedKey = !!revealedKeys[k.id];

    var keyDisplay = hasRevealedKey
      ? '<code class="team-key-code revealed">' + escapeHtml(revealedKeys[k.id]) + '</code>' +
        '<button class="team-key-copy-btn" title="Copy full key">\uD83D\uDCCB</button>' +
        '<button class="team-key-hide-btn" title="Hide key">\uD83D\uDC41\uFE0F</button>'
      : '<code class="team-key-code">' + escapeHtml(k.apiKeyPrefix || '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022') + '</code>' +
        (!isRevoked ? '<button class="team-key-copy-btn" title="Rotate to reveal full key">\uD83D\uDD04</button>' : '');

    card.innerHTML =
      '<div class="team-key-header">' +
        '<input class="team-key-label" value="' + escapeAttr(k.label || '') + '" placeholder="Label (e.g. Frontend Dev)" maxlength="64"' + (isRevoked ? ' disabled' : '') + '>' +
        (isRevoked ? '<span class="team-key-badge revoked-badge">Revoked</span>' : (isAssigned ? '<span class="team-key-badge assigned">Assigned</span>' : '<span class="team-key-badge">Unassigned</span>')) +
      '</div>' +
      '<div class="team-key-value">' + keyDisplay + '</div>' +
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
        (isRevoked ? '<button class="btn-small team-key-replace" title="Create a new key to fill this seat">Replace Key</button>' : '') +
      '</div>';

    // Wire up event handlers
    var copyBtn = card.querySelector('.team-key-copy-btn');
    if (copyBtn) {
      if (hasRevealedKey) {
        copyBtn.addEventListener('click', function () { copyTeamKey(revealedKeys[k.id]); });
      } else {
        copyBtn.addEventListener('click', function () { rotateTeamKey(k.id); });
      }
    }

    var hideBtn = card.querySelector('.team-key-hide-btn');
    if (hideBtn) hideBtn.addEventListener('click', function () { delete revealedKeys[k.id]; loadTeamKeys(); });

    var saveBtn = card.querySelector('.team-key-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { saveTeamKey(card, k.id); });

    var sendBtn = card.querySelector('.team-key-send');
    if (sendBtn) sendBtn.addEventListener('click', function () { sendTeamKeyEmail(k.id); });

    var rotateBtn = card.querySelector('.team-key-rotate');
    if (rotateBtn) rotateBtn.addEventListener('click', function () { rotateTeamKey(k.id); });

    var revokeBtn = card.querySelector('.team-key-revoke');
    if (revokeBtn) revokeBtn.addEventListener('click', function () { revokeTeamKey(k.id); });

    var replaceBtn = card.querySelector('.team-key-replace');
    if (replaceBtn) replaceBtn.addEventListener('click', function () { replaceTeamKey(k.id); });

    return card;
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
        if (data.sent) {
          showToast('Key emailed successfully');
        } else {
          var reasons = {
            not_configured: 'Email service is not configured on the server (RESEND_API_KEY missing)',
            throttled: 'Too many emails sent recently — please wait and try again',
            api_error: 'Email service returned an error — check server logs',
            network_error: 'Could not reach email service — check server network'
          };
          showToast(reasons[data.reason] || 'Email could not be sent');
        }
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
          storeRevealedKey(keyId, data.apiKey);
          navigator.clipboard.writeText(data.apiKey).then(function () {
            showToast('Key rotated \u2014 new key copied to clipboard');
          }).catch(function () {
            showToast('Key rotated \u2014 new key shown below');
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

  async function replaceTeamKey(keyId) {
    if (!confirm('Create a new key to replace this revoked seat?')) return;
    try {
      var res = await apiFetch('/v1/org/keys/' + keyId + '/replace', { method: 'POST' });
      var data = await res.json();
      if (res.ok) {
        if (data.apiKey && data.keyId) {
          storeRevealedKey(data.keyId, data.apiKey);
          navigator.clipboard.writeText(data.apiKey).then(function () {
            showToast('New key created \u2014 copied to clipboard');
          }).catch(function () {
            showToast('New key created \u2014 shown below');
          });
        } else {
          showToast('Key replaced');
        }
        loadTeamKeys();
      } else {
        showToast(data.error || 'Failed to replace key');
      }
    } catch (e) {
      showToast('Error replacing key');
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

    CullitSite.initMobileNav();

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
          case 'analytics-tab': switchDashTab('analytics'); break;
        }
        return;
      }

      if (target.id === 'clearProviderKey') {
        var providerEl = document.getElementById('provider');
        var keyEl = document.getElementById('providerApiKey');
        var rememberEl = document.getElementById('rememberProviderKey');
        if (providerEl && keyEl && rememberEl) {
          rememberProviderKey(providerEl.value, '');
          keyEl.value = '';
          rememberEl.checked = false;
          showToast('Saved provider key cleared');
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
      if (target.id === 'provider') refreshProviderKeyInput();
      if (target.id === 'rememberProviderKey') {
        var selectedProvider = document.getElementById('provider').value;
        var currentKey = document.getElementById('providerApiKey').value.trim();
        if (target.checked && currentKey) rememberProviderKey(selectedProvider, currentKey);
        if (!target.checked) rememberProviderKey(selectedProvider, '');
      }
    });

    document.addEventListener('input', function (e) {
      var target = e.target;
      if (target.id === 'widgetHeaderText') updateWidgetSnippet();
      if (target.id === 'widgetTriggerEmoji') updateWidgetSnippet();
      if (target.id === 'providerApiKey') {
        var provider = document.getElementById('provider').value;
        var remember = !!document.getElementById('rememberProviderKey').checked;
        if (remember) rememberProviderKey(provider, target.value.trim());
      }
    });

    // Form submit delegation
    var settingsForm = document.getElementById('projectSettingsForm');
    if (settingsForm) {
      settingsForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveProjectSettings();
      });
    }

    refreshProviderKeyInput();
  });
})();
