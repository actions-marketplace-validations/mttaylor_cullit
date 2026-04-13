document.addEventListener('DOMContentLoaded', () => {
  const site = window.CullitSite;
  site?.initMobileNav();
  site?.trackEvent('pricing_viewed', 'pricing');

  const proPlan = { monthlySeat: 9, annualSeat: 8.1 };

  const billingToggle = document.getElementById('billingToggle');
  const monthlyLabel = document.getElementById('lblMonthly');
  const annualLabel = document.getElementById('lblAnnual');
  const proPrice = document.getElementById('proPrice');
  const proTotal = document.getElementById('proTotal');
  const proNote = document.getElementById('proAnnualNote');
  const proSeatInput = document.getElementById('proSeats');
  const proCta = document.getElementById('proCta');

  let annual = false;

  function readSeats() {
    let seats = parseInt(proSeatInput?.value || '1', 10);
    if (Number.isNaN(seats) || seats < 1) seats = 1;
    if (seats > 100) seats = 100;
    if (proSeatInput) proSeatInput.value = String(seats);
    return seats;
  }

  function updateProCard() {
    const seats = readSeats();
    const perSeat = annual ? proPlan.annualSeat : proPlan.monthlySeat;
    const total = (perSeat * seats).toFixed(2);

    if (proPrice) {
      proPrice.innerHTML = '$' + perSeat.toFixed(2) + ' <span class="period">/ seat / mo</span>';
    }

    if (proTotal) {
      proTotal.textContent = seats > 1
        ? 'Total: $' + total + ' / mo for ' + seats + ' seats'
        : '';
    }

    if (proNote) {
      if (annual) {
        proNote.textContent = 'Billed as $' + (perSeat * seats * 12).toFixed(2) + '/yr';
        proNote.style.display = '';
      } else {
        proNote.style.display = 'none';
      }
    }
  }

  function setBilling(nextAnnual) {
    annual = nextAnnual;
    billingToggle?.classList.toggle('on', annual);
    billingToggle?.setAttribute('aria-checked', String(annual));
    monthlyLabel?.classList.toggle('active', !annual);
    annualLabel?.classList.toggle('active', annual);

    updateProCard();
    site?.trackEvent('billing_toggle', 'pricing', { annual });
  }

  async function startCheckout(event) {
    event.preventDefault();

    const seats = readSeats();
    const body = { plan: 'pro', annual, seats };

    site?.trackEvent('checkout_started', 'pricing', { plan: 'pro', annual, seats });

    try {
      const response = await fetch(site.getApiUrl() + '/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        site?.trackEvent('checkout_failed', 'pricing', { plan: 'pro', annual, reason: 'unauthenticated' });
        window.location.href = site.getApiUrl() + '/auth/login?returnTo=' + encodeURIComponent('/dashboard.html?checkout=pro' + (annual ? '&annual=1' : ''));
        return;
      }

      const data = await response.json();
      if (data.url) {
        site?.trackEvent('checkout_redirected', 'pricing', { plan: 'pro', annual, seats });
        window.location.href = data.url;
        return;
      }

      site?.trackEvent('checkout_failed', 'pricing', { plan: 'pro', annual, reason: data.error || 'unknown' });
      alert(data.error || 'Could not start checkout. Please try again.');
    } catch {
      site?.trackEvent('checkout_failed', 'pricing', { plan: 'pro', annual, reason: 'network_error' });
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

  proSeatInput?.addEventListener('input', updateProCard);
  proSeatInput?.addEventListener('change', updateProCard);
  proCta?.addEventListener('click', (event) => startCheckout(event));

  setBilling(false);
});
