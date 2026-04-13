document.addEventListener('DOMContentLoaded', () => {
  const site = window.CullitSite;
  site?.initMobileNav();

  site?.initScrollReveal('.feature-card, .step, .integration-chip');

  const ctaFree = document.getElementById('ctaFree');
  const ctaPricing = document.getElementById('ctaPricing');

  if (ctaFree) {
    ctaFree.addEventListener('click', () => {
      site?.trackEvent('landing_cta_clicked', 'landing', { target: 'free' });
    });
  }

  if (ctaPricing) {
    ctaPricing.addEventListener('click', () => {
      site?.trackEvent('landing_cta_clicked', 'landing', { target: 'pricing' });
    });
  }
});
