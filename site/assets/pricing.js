document.addEventListener('DOMContentLoaded', () => {
  const site = window.CullitSite;
  site?.initMobileNav();
  site?.trackEvent('pricing_viewed', 'pricing');

  const proPlan = { monthly: 9, annual: 7.65 };
  const teamPlan = { monthlySeat: 8, annualSeat: 6.8 };

  const billingToggle = document.getElementById('billingToggle');
  const monthlyLabel = document.getElementById('lblMonthly');
  const annualLabel = document.getElementById('lblAnnual');
  const proPrice = document.getElementById('proPrice');
  const proNote = document.getElementById('proAnnualNote');
  const teamPrice = document.getElementById('teamPrice');
  const teamTotal = document.getElementById('teamTotal');
  const teamNote = document.getElementById('teamAnnualNote');
  const teamSeatInput = document.getElementById('teamSeats');
  const proCta = document.getElementById('proCta');
  const teamCta = document.getElementById('teamCta');

  let annual = false;

  function readSeats() {
    let seats = parseInt(teamSeatInput?.value || '5', 10);
    if (Number.isNaN(seats) || seats < 5) seats = 5;
    if (seats > 100) seats = 100;
    if (teamSeatInput) teamSeatInput.value = String(seats);
    return seats;
  }

  function updateTeamCard() {
    const seats = readSeats();
    const perSeat = annual ? teamPlan.annualSeat : teamPlan.monthlySeat;
    const total = (perSeat * seats).toFixed(2);

    if (teamPrice) {
      teamPrice.innerHTML = '$' + perSeat.toFixed(2) + ' <span class="period">/ seat / mo</span>';
    }

    if (teamTotal) {
      teamTotal.textContent = 'Total: $' + total + ' / mo for ' + seats + ' seat' + (seats === 1 ? '' : 's');
    }

    if (teamNote) {
      if (annual) {
        teamNote.textContent = 'Billed as $' + (perSeat * seats * 12).toFixed(2) + '/yr';
        teamNote.style.display = '';
      } else {
        teamNote.style.display = 'none';
      }
    }
  }

  function setBilling(nextAnnual) {
    annual = nextAnnual;
    billingToggle?.classList.toggle('on', annual);
    billingToggle?.setAttribute('aria-checked', String(annual));
    monthlyLabel?.classList.toggle('active', !annual);
    annualLabel?.classList.toggle('active', annual);

    if (proPrice && proNote) {
      if (annual) {
        proPrice.innerHTML = '$' + proPlan.annual.toFixed(2) + ' <span class="period">/ mo</span>';
        proNote.textContent = 'Billed as $' + (proPlan.annual * 12).toFixed(2) + '/yr';
        proNote.style.display = '';
      } else {
        proPrice.innerHTML = '$' + proPlan.monthly + ' <span class="period">/ mo</span>';
        proNote.style.display = 'none';
      }
    }

    updateTeamCard();
    site?.trackEvent('billing_toggle', 'pricing', { annual });
  }

  async function startCheckout(plan, event) {
    event.preventDefault();

    const body = { plan, annual };
    if (plan === 'team') {
      body.seats = readSeats();
    }

    site?.trackEvent('checkout_started', 'pricing', { plan, annual, seats: body.seats });

    try {
      const response = await fetch(site.getApiUrl() + '/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        site?.trackEvent('checkout_failed', 'pricing', { plan, annual, reason: 'unauthenticated' });
        window.location.href = site.getApiUrl() + '/auth/login?returnTo=' + encodeURIComponent('/dashboard.html?checkout=' + plan + (annual ? '&annual=1' : ''));
        return;
      }

      const data = await response.json();
      if (data.url) {
        site?.trackEvent('checkout_redirected', 'pricing', { plan, annual, seats: body.seats });
        window.location.href = data.url;
        return;
      }

      site?.trackEvent('checkout_failed', 'pricing', { plan, annual, reason: data.error || 'unknown' });
      alert(data.error || 'Could not start checkout. Please try again.');
    } catch {
      site?.trackEvent('checkout_failed', 'pricing', { plan, annual, reason: 'network_error' });
      alert('Could not reach billing service at ' + site.getApiUrl() + '. Check your API URL/server and try again.');
    }
  }

  monthlyLabel?.addEventListener('click', () => setBilling(false));
  annualLabel?.addEventListener('click', () => setBilling(true));
  billingToggle?.addEventListener('click', () => setBilling(!annual));
  billingToggle?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setBilling(!annual);
    }
  });

  teamSeatInput?.addEventListener('input', updateTeamCard);
  teamSeatInput?.addEventListener('change', updateTeamCard);
  proCta?.addEventListener('click', (event) => startCheckout('pro', event));
  teamCta?.addEventListener('click', (event) => startCheckout('team', event));

  setBilling(false);
});
