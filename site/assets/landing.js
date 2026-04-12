document.addEventListener('DOMContentLoaded', () => {
  const site = window.CullitSite;
  site?.initMobileNav();

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card, .step, .integration-chip').forEach((element) => {
    element.style.opacity = '0';
    element.style.transform = 'translateY(20px)';
    element.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(element);
  });

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
