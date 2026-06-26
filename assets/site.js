/* ============================================================
   UGFC SITE JAVASCRIPT
   Starfield · Mobile Menu · Scroll Reveals · CTA Handlers
   ============================================================ */

(function() {
  'use strict';

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
      stars = [];
      const count = Math.min(140, Math.floor((canvas.width * canvas.height) / 14000));
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.4 + 0.2,
          o: Math.random() * 0.6 + 0.2,
          tw: Math.random() * 0.02 + 0.005
        });
      }
    }
    let dir = 1;
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        s.o += s.tw * dir;
        if (s.o > 0.8 || s.o < 0.2) s.tw *= -1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(242,196,90,${s.o})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });
    draw();
  }

  // ====== MOBILE MENU ======
  function initMobileMenu() {
    const toggle = document.querySelector('.menu-toggle');
    const menu = document.querySelector('.mobile-menu');
    const close = document.querySelector('.menu-close');
    if (!toggle || !menu) return;
    const open = () => menu.classList.add('open');
    const shut = () => menu.classList.remove('open');
    toggle.addEventListener('click', open);
    if (close) close.addEventListener('click', shut);
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', shut));
  }

  // ====== SCROLL REVEALS ======
  function initReveals() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(el => io.observe(el));
  }

  // ====== SMOOTH ACCURATE SCROLL HELPER ======
  function landOn(target) {
    if (!target) return;
    const nav = document.querySelector('nav');
    const navH = nav ? nav.offsetHeight : 0;
    const y = target.getBoundingClientRect().top + window.pageYOffset - navH - 12;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
  scrollHelper.landOn = landOn;

  // ====== OFFERING CTAs ======
  function initOfferingCTAs() {
    document.querySelectorAll('[data-scroll]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sel = btn.getAttribute('data-scroll');
        const target = sel ? document.querySelector(sel) : null;
        if (target) { e.preventDefault(); landOn(target); }
      });
    });
  }

  // ====== SOW CTAs ======
  function initSowCTAs() {
    document.querySelectorAll('[data-sow]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sel = btn.getAttribute('data-sow');
        const target = sel ? document.querySelector(sel) : null;
        if (target) { e.preventDefault(); landOn(target); }
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

  // ====== FREE-GIFT OPT-IN FORM ======
  function initOptinForm() {
    const form = document.querySelector('.offering-optin');
    if (!form) return;
    const submit = form.querySelector('button[type="submit"], .offering-cta');
    let originalText = submit ? submit.textContent : '';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (submit) { submit.disabled = true; submit.textContent = 'Sending…'; }

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new FormData(form)
        });
        if (!response.ok) { console.error('Opt-in: Formspree returned', response.status); }
      } catch (err) {
        console.error('Opt-in submit error:', err);
      } finally {
        window.location.assign('/thank-you.html');
      }
    });
  }

  // ====== ANCHOR CLICKS ======
  function initAnchorClicks() {
    document.querySelectorAll('a[href^="#"], a[href*="/#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        const hash = href.indexOf('#') >= 0 ? href.slice(href.indexOf('#')) : '';
        if (!hash || hash === '#') return;
        const target = document.querySelector(hash);
        if (target) { e.preventDefault(); landOn(target); history.replaceState(null, '', hash); }
      });
    });
  }

  // ====== HASH LANDING ON LOAD ======
  function initHashLanding() {
    function run() {
      if (!window.location.hash) return;
      const target = document.querySelector(window.location.hash);
      if (target) setTimeout(() => landOn(target), 120);
    }
    if (document.readyState === 'complete') run();
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
    initOptinForm();
    initAnchorClicks();
    initHashLanding();
  }
})();
