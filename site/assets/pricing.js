document.addEventListener('DOMContentLoaded', () => {
  const site = window.CullitSite;
  site?.initMobileNav();
  site?.trackEvent('pricing_viewed', 'pricing');

  const paidPlan = { monthlySeat: 8, annualSeat: 6.8 };

  const billingToggle = document.getElementById('billingToggle');
  const monthlyLabel = document.getElementById('lblMonthly');
  const annualLabel = document.getElementById('lblAnnual');
  const paidPrice = document.getElementById('paidPrice');
  const paidTotal = document.getElementById('paidTotal');
  const paidNote = document.getElementById('paidAnnualNote');
  const paidSeatInput = document.getElementById('paidSeats');
  const paidCta = document.getElementById('paidCta');

  let annual = false;

  function readSeats() {
    let seats = parseInt(paidSeatInput?.value || '1', 10);
    if (Number.isNaN(seats) || seats < 1) seats = 1;
    if (seats > 100) seats = 100;
    if (paidSeatInput) paidSeatInput.value = String(seats);
    return seats;
  }

  function updatePaidCard() {
    const seats = readSeats();
    const perSeat = annual ? paidPlan.annualSeat : paidPlan.monthlySeat;
    const total = (perSeat * seats).toFixed(2);

    if (paidPrice) {
      paidPrice.innerHTML = '$' + perSeat.toFixed(2) + ' <span class="period">/ seat / mo</span>';
    }

    if (paidTotal) {
      paidTotal.textContent = seats > 1
        ? 'Total: $' + total + ' / mo for ' + seats + ' seats'
        : '';
    }

    if (paidNote) {
      if (annual) {
        paidNote.textContent = 'Billed as $' + (perSeat * seats * 12).toFixed(2) + '/yr';
        paidNote.style.display = '';
      } else {
        paidNote.style.display = 'none';
      }
    }
  }

  function setBilling(nextAnnual) {
    annual = nextAnnual;
    billingToggle?.classList.toggle('on', annual);
    billingToggle?.setAttribute('aria-checked', String(annual));
    monthlyLabel?.classList.toggle('active', !annual);
    annualLabel?.classList.toggle('active', annual);

    updatePaidCard();
    site?.trackEvent('billing_toggle', 'pricing', { annual });
  }

  async function startCheckout(event) {
    event.preventDefault();

    const seats = readSeats();
    const body = { plan: 'paid', annual, seats };

    site?.trackEvent('checkout_started', 'pricing', { plan: 'paid', annual, seats });

    try {
      const response = await fetch(site.getApiUrl() + '/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (response.status === 401) {
        site?.trackEvent('checkout_failed', 'pricing', { plan: 'paid', annual, reason: 'unauthenticated' });
        window.location.href = site.getApiUrl() + '/auth/login?returnTo=' + encodeURIComponent('/dashboard.html?checkout=paid' + (annual ? '&annual=1' : ''));
        return;
      }

      const data = await response.json();
      if (data.url) {
        site?.trackEvent('checkout_redirected', 'pricing', { plan: 'paid', annual, seats });
        window.location.href = data.url;
        return;
      }

      site?.trackEvent('checkout_failed', 'pricing', { plan: 'paid', annual, reason: data.error || 'unknown' });
      alert(data.error || 'Could not start checkout. Please try again.');
    } catch {
      site?.trackEvent('checkout_failed', 'pricing', { plan: 'paid', annual, reason: 'network_error' });
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

  paidSeatInput?.addEventListener('input', updatePaidCard);
  paidSeatInput?.addEventListener('change', updatePaidCard);
  paidCta?.addEventListener('click', (event) => startCheckout(event));

  setBilling(false);
});
