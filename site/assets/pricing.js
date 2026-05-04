document.addEventListener('DOMContentLoaded', () => {
  const site = window.CullitSite;
  site?.initMobileNav();
  site?.trackEvent('support_page_viewed', 'pricing');
});
