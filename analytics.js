/* Tamper Signal — site analytics & tagging.
 *
 * One shared file loaded by every page (one <script src="/analytics.js"> line
 * in each <head>). All tag management lives here so the 15 static pages never
 * need editing again — add GA4, ad pixels, etc. from the GTM container UI.
 *
 * Privacy posture: Google Consent Mode v2, default-DENIED. No analytics or ad
 * storage fires until the visitor accepts via the banner. The choice is
 * remembered in localStorage. Fitting for a tamper-evident, "your data is
 * yours" product.
 *
 * SETUP: replace the GTM container ID below with your real one (GTM-XXXXXXX).
 * That is the only value you need to change here.
 */
(function () {
  'use strict';

  var GTM_ID = 'GTM-MVF72B8T'; // Tamper Signal GTM container
  var STORAGE_KEY = 'ts_consent'; // 'granted' | 'denied'

  // Don't run on localhost / file previews — keeps dev traffic out of reports.
  var host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '' || location.protocol === 'file:') {
    return;
  }
  if (GTM_ID.indexOf('XXXX') !== -1) {
    // Container ID not configured yet — do nothing rather than load a broken tag.
    return;
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode */ }

  // Consent Mode v2 defaults — denied until the visitor opts in.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  // If the visitor already chose to allow, restore that before GTM loads.
  if (stored === 'granted') {
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted'
    });
  }

  // Load the GTM container (async).
  (function (w, d, s, i) {
    w[s] = w[s] || [];
    w[s].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = d.getElementsByTagName('script')[0];
    var j = d.createElement('script');
    j.async = true;
    j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i;
    f.parentNode.insertBefore(j, f);
  })(window, document, 'dataLayer', GTM_ID);

  function persist(choice) {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (e) { /* ignore */ }
  }

  function grant() {
    gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted'
    });
    persist('granted');
    removeBanner();
  }

  function deny() {
    persist('denied');
    removeBanner();
  }

  var banner;
  function removeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }

  function buildBanner() {
    banner = document.createElement('div');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Privacy & analytics consent');
    banner.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'max-width:640px', 'margin:0 auto', 'padding:16px 18px',
      'background:#11161d', 'color:#e5e7eb', 'border:1px solid #1f2937',
      'border-radius:12px', 'box-shadow:0 8px 30px rgba(0,0,0,.45)',
      'font-family:-apple-system,\'SF Pro Display\',\'Segoe UI\',Roboto,Helvetica,sans-serif',
      'font-size:14px', 'line-height:1.55',
      'display:flex', 'flex-wrap:wrap', 'gap:12px', 'align-items:center', 'justify-content:space-between'
    ].join(';');

    var text = document.createElement('div');
    text.style.cssText = 'flex:1 1 280px;min-width:240px;';
    text.innerHTML = 'We use privacy-respecting analytics to understand what’s useful. ' +
      'Nothing is stored until you allow it. ' +
      '<a href="/privacy.html" style="color:#34d399;text-decoration:underline;">Learn more</a>.';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex:0 0 auto;';

    var declineBtn = document.createElement('button');
    declineBtn.type = 'button';
    declineBtn.textContent = 'Decline';
    declineBtn.style.cssText = 'cursor:pointer;padding:8px 14px;border-radius:8px;font-size:14px;' +
      'background:transparent;color:#8b98a5;border:1px solid #1f2937;';

    var acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.textContent = 'Allow analytics';
    acceptBtn.style.cssText = 'cursor:pointer;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:600;' +
      'background:#34d399;color:#0b0f14;border:1px solid #34d399;';

    declineBtn.addEventListener('click', deny);
    acceptBtn.addEventListener('click', grant);

    actions.appendChild(declineBtn);
    actions.appendChild(acceptBtn);
    banner.appendChild(text);
    banner.appendChild(actions);
    document.body.appendChild(banner);
  }

  // Reopen the banner so a visitor can change a previous choice.
  function openSettings() { if (!banner) buildBanner(); }
  window.tsOpenCookieSettings = openSettings;

  // Any element marked data-ts-cookie-settings reopens the banner.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest && e.target.closest('[data-ts-cookie-settings]');
    if (el) { e.preventDefault(); openSettings(); }
  });

  // Add a "Manage cookies" control to the footer. JS-only by design: it
  // controls a JS banner, so there is nothing to show when JS is off.
  function injectFooterLink() {
    var gh = document.querySelector('footer a[href*="github.com/welovejeff"]');
    var foot = gh ? gh.parentNode
                  : (document.querySelector('footer .wrap') || document.querySelector('footer'));
    if (!foot || foot.querySelector('[data-ts-cookie-settings]')) return;
    var sep = document.createElement('span');
    sep.textContent = '·';
    var link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Manage cookies';
    link.setAttribute('data-ts-cookie-settings', '');
    foot.appendChild(document.createTextNode(' '));
    foot.appendChild(sep);
    foot.appendChild(document.createTextNode(' '));
    foot.appendChild(link);
  }

  function onReady() {
    injectFooterLink();
    if (stored !== 'granted' && stored !== 'denied') buildBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
