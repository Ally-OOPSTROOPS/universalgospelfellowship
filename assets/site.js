/* ============================================================
   UGFC SITE JAVASCRIPT
   Starfield · Mobile Menu · Scroll Reveals · CTA Handlers
   ============================================================ */

(function() {
  'use strict';

  // Shared scroll helper, populated once landOn() is defined below. Used by the
  // offering/sow CTA fallbacks so every click lands accurately.
  const scrollHelper = {};

  // ====== STARFIELD ======
  function initStarfield() {
    const canvas = document.getElementById('starfield');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let stars = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const count = Math.min(120, Math.floor((canvas.width * canvas.height) / 18000));
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.4 + 0.2,
          o: Math.random() * 0.6 + 0.2,
          tw: Math.random() * 0.02 + 0.005,
          dir: Math.random() > 0.5 ? 1 : -1
        });
      }
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach(s => {
        s.o += s.tw * s.dir;
        if (s.o > 0.85 || s.o < 0.15) s.dir *= -1;
        ctx.fillStyle = `rgba(242, 196, 90, ${s.o})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });
    draw();
  }

  // ====== MOBILE MENU ======
  function initMobileMenu() {
    const toggle = document.querySelector('.menu-toggle');
    const menu = document.getElementById('mobileMenu');
    const close = document.querySelector('.menu-close');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => menu.classList.add('open'));
    if (close) close.addEventListener('click', () => menu.classList.remove('open'));
    menu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => menu.classList.remove('open'));
    });
  }

  // ====== SCROLL REVEAL ======
  function initReveals() {
    const targets = document.querySelectorAll(
      '.section-header, .vision-card, .identity-card, .leader-card, ' +
      '.cred-card, .ally-gallery figure, .outreach-card, .fruit-card, ' +
      '.press-card, .timeline-item, .offering-card, .sow-card, ' +
      '.anchor-image-inner, .hope-memorial, .ally-crosslink-card, ' +
      '.history-ribbon-photo, .difference-callout, .scripture-banner'
    );
    targets.forEach(el => el.classList.add('reveal'));
    if (!('IntersectionObserver' in window)) {
      targets.forEach(el => el.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    targets.forEach(el => io.observe(el));
  }

  // ====== OFFERING CTAS (Stripe Checkout) ======
  function initOfferingCTAs() {
    document.querySelectorAll('.offering-cta').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = btn.dataset.action;
        const offering = btn.dataset.offering;
        const priceIdRef = btn.dataset.priceId;

        // Guard: the free-gift form submit shares the .offering-cta visual style but is
        // not a paid offering (it has no data-offering). Let its native form submission
        // proceed untouched instead of triggering a checkout.
        if (!offering) return;

        // Application-required offerings → scroll to contact form, pre-select reason
        if (action === 'apply') {
          const select = document.querySelector('select[name="reason"]');
          if (select) select.value = offering;
          if (scrollHelper.landOn) scrollHelper.landOn(document.getElementById('contact'), true);
          else document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
          const status = document.getElementById('contactStatus');
          if (status) {
            status.textContent = 'Please complete this application form. Leslie will personally respond within 72 hours.';
            status.className = 'contact-status success';
          }
          return;
        }

        // Stripe checkout flow
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Loading…';

        try {
          const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offering, priceIdRef })
          });
          if (!response.ok) throw new Error('Checkout creation failed');
          const data = await response.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            throw new Error('No checkout URL returned');
          }
        } catch (err) {
          console.error('Checkout error:', err);
          btn.textContent = originalText;
          btn.disabled = false;
          // Graceful fallback while Stripe is not yet active: route to the contact form
          // with the offering pre-selected, instead of dead-ending on an alert popup.
          const reason = document.querySelector('select[name="reason"]');
          if (reason && offering) reason.value = offering;
          const contactSection = document.getElementById('contact');
          if (contactSection) { if (scrollHelper.landOn) scrollHelper.landOn(contactSection, true); else contactSection.scrollIntoView({ behavior: 'smooth' }); }
          const status = document.getElementById('contactStatus');
          if (status) {
            status.textContent = 'To begin, send this short form and Leslie will personally respond with your next steps.';
            status.className = 'contact-status success';
          }
        }
      });
    });
  }

  // ====== SOW (Freewill) CTAS ======
  function initSowCTAs() {
    document.querySelectorAll('.sow-cta').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const stream = btn.dataset.sowStream;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = 'Loading…';

        try {
          const response = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offering: 'freewill', sowStream: stream })
          });
          if (!response.ok) throw new Error('Sow checkout creation failed');
          const data = await response.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            throw new Error('No checkout URL returned');
          }
        } catch (err) {
          console.error('Sow error:', err);
          btn.textContent = originalText;
          btn.disabled = false;
          // Graceful fallback while Stripe is not yet active: route to the contact form.
          const reason = document.querySelector('select[name="reason"]');
          if (reason) reason.value = 'general';
          const contactSection = document.getElementById('contact');
          if (contactSection) { if (scrollHelper.landOn) scrollHelper.landOn(contactSection, true); else contactSection.scrollIntoView({ behavior: 'smooth' }); }
          const status = document.getElementById('contactStatus');
          if (status) {
            status.textContent = 'To sow into the ministry, send this short form and Leslie will personally respond with how to give.';
            status.className = 'contact-status success';
          }
        }
      });
    });
  }

  // ====== CONTACT FORM ======
  function initContactForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;
    const status = document.getElementById('contactStatus');
    const submit = form.querySelector('.contact-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      submit.disabled = true;
      const originalText = submit.textContent;
      submit.textContent = 'Sending…';
      status.textContent = '';
      status.className = 'contact-status';

      const data = Object.fromEntries(new FormData(form).entries());

      try {
        const response = await fetch('/api/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Submission failed');
          throw new Error(errorBody);
        }
        status.textContent = 'Message received. Leslie will respond personally within 72 hours. Blessings.';
        status.className = 'contact-status success';
        form.reset();
      } catch (err) {
        console.error('Contact submit error:', err);
        status.textContent = 'Something went wrong. Please email allystoryhorse@pm.me directly while we resolve this.';
        status.className = 'contact-status error';
      } finally {
        submit.disabled = false;
        submit.textContent = originalText;
      }
    });
  }

  // ====== ACCURATE ANCHOR LANDING ======
  // Root cause this solves: images on this site use loading="lazy". When the
  // browser jumps to an anchor (a banner CTA, a nav link, or a cross-page
  // #section link), the lazy images ABOVE the target have not loaded yet, so the
  // document is far shorter than its final height. The browser lands at the
  // target's *temporary* position; then those images load, grow the page, and
  // shove the target thousands of pixels away from where the viewport is parked.
  // The result the user sees: "I clicked and it landed in the wrong place."
  //
  // The fix: force every image to load so the layout reaches full height, then
  // re-scroll to the target repeatedly until its position STOPS moving (or we
  // time out). This guarantees an accurate landing regardless of image timing.

  function forceAllImagesEager() {
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
      img.loading = 'eager';
      // Nudge any image that the browser deferred so it begins fetching now.
      if (!img.complete && img.getAttribute('src')) {
        const src = img.getAttribute('src');
        img.setAttribute('src', src);
      }
    });
  }

  // Scroll an element to just below the fixed nav and keep it there until the
  // layout settles. `smooth` controls only the FIRST move (for same-page clicks
  // we want a smooth glide; for page-load jumps we want an instant snap).
  //
  // We deliberately do NOT use scrollIntoView(): on some mobile engines it lands
  // the element hundreds of pixels short of the top even when the page can scroll
  // further. Computing the absolute Y position and calling window.scrollTo is
  // deterministic and identical across desktop and mobile.
  function landOn(target, smooth) {
    if (!target) return;
    forceAllImagesEager();

    const navHeight = () => {
      const n = document.querySelector('nav');
      return n ? Math.ceil(n.getBoundingClientRect().height) : 0;
    };
    const GAP = 12; // small breathing room below the fixed nav
    const targetY = () => {
      const y = window.pageYOffset + target.getBoundingClientRect().top - navHeight() - GAP;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return Math.max(0, Math.min(Math.round(y), Math.round(max)));
    };
    const snap = () => window.scrollTo(0, targetY());

    if (smooth && 'scrollBehavior' in document.documentElement.style) {
      window.scrollTo({ top: targetY(), behavior: 'smooth' });
    } else {
      snap();
    }

    const allImagesComplete = () =>
      Array.prototype.slice.call(document.images).every(i => i.complete);

    // Every image that finishes can shift layout above the target, so re-snap
    // each time one completes.
    Array.prototype.slice.call(document.images)
      .filter(i => !i.complete)
      .forEach(i => {
        i.addEventListener('load', snap, { once: true });
        i.addEventListener('error', snap, { once: true });
      });

    // Backstop: re-snap until we are actually parked at the target AND every
    // image has finished, or we time out (~10s).
    let stableHits = 0, tries = 0;
    const startDelay = smooth ? 360 : 0; // let a quick glide play first
    setTimeout(() => {
      const settle = setInterval(() => {
        const want = targetY();
        if (Math.abs(window.pageYOffset - want) > 1) {
          window.scrollTo(0, want);
          stableHits = 0;
        } else {
          stableHits++;
        }
        tries++;
        if ((stableHits >= 5 && allImagesComplete()) || tries > 80) {
          clearInterval(settle);
          window.scrollTo(0, targetY());
        }
      }, 120);
    }, startDelay);

    // Final correction once the window fully loads.
    window.addEventListener('load', snap, { once: true });
  }
  // expose for the CTA fallbacks
  scrollHelper.landOn = landOn;

  // Same-page anchor clicks (nav links, mobile-menu links, in-page CTAs).
  function initAnchorClicks() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const raw = a.getAttribute('href');
      if (!raw || raw === '#') return;
      a.addEventListener('click', (e) => {
        const id = decodeURIComponent(raw.slice(1));
        const target = document.getElementById(id);
        if (!target) return;            // let the browser handle anything unknown
        e.preventDefault();
        if (history.pushState) history.pushState(null, '', raw);
        landOn(target, true);           // smooth glide for in-page clicks
      });
    });
  }

  // Cross-page / direct hash arrivals (e.g. arriving at index.html#offerings).
  function initHashLanding() {
    if (!window.location.hash) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    const run = () => landOn(target, false);   // instant snap on arrival
    if (document.readyState === 'complete') { run(); }
    else { window.addEventListener('load', run, { once: true }); run(); }
  }

  // ====== INIT ======
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  function init() {
    initStarfield();
    initMobileMenu();
    initReveals();
    initOfferingCTAs();
    initSowCTAs();
    initContactForm();
    initAnchorClicks();
    initHashLanding();
  }
})();
