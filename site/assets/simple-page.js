document.addEventListener('DOMContentLoaded', () => {
  window.CullitSite?.initMobileNav();

  const path = document.getElementById('path');
  if (path) {
    path.textContent = window.location.pathname;
  }
});
