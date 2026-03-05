/* ================================================================
   ANIMEWALLPAPERZ.IN — Coming Soon  |  script.js
   ================================================================ */

/* ===== THEME TOGGLE ===== */
const html      = document.documentElement;
const themeBtn  = document.getElementById('themeBtn');
const themeIcon = document.getElementById('themeIcon');

const savedTheme = localStorage.getItem('awz-theme') || 'dark';
html.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

themeBtn.addEventListener('click', () => {
  const current = html.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('awz-theme', next);
  updateThemeIcon(next);
});

function updateThemeIcon(theme) {
  themeIcon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
}

/* ===== MOBILE MENU ===== */
const burger      = document.getElementById('burger');
const mobileDrawer = document.getElementById('mobileDrawer');

burger.addEventListener('click', () => {
  burger.classList.toggle('open');
  mobileDrawer.classList.toggle('open');
});

// Close on drawer link click
mobileDrawer.querySelectorAll('.drawer-link').forEach(link => {
  link.addEventListener('click', () => {
    burger.classList.remove('open');
    mobileDrawer.classList.remove('open');
  });
});

/* ===== NAVBAR SCROLL SHADOW ===== */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

/* ===== ACTIVE NAV LINK ===== */
const sections  = document.querySelectorAll('section[id]');
const navLinksEl = document.querySelectorAll('.nav-link');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinksEl.forEach(l => {
        l.classList.toggle('active', l.getAttribute('href') === '#' + entry.target.id);
      });
    }
  });
}, { rootMargin: '-50% 0px -50% 0px' });

sections.forEach(s => sectionObserver.observe(s));

/* ===== COUNTDOWN TIMER ===== */
const LAUNCH_DATE = new Date('2026-06-01T00:00:00');

const elDays    = document.getElementById('cd-days');
const elHours   = document.getElementById('cd-hours');
const elMins    = document.getElementById('cd-minutes');
const elSecs    = document.getElementById('cd-seconds');

function pad(n) { return String(n).padStart(2, '0'); }

function flipUpdate(el, newVal) {
  if (el.textContent === newVal) return;
  el.classList.remove('flip-anim');
  // Force reflow to restart animation
  void el.offsetWidth;
  el.textContent = newVal;
  el.classList.add('flip-anim');
}

function tick() {
  const now  = new Date();
  const diff = LAUNCH_DATE - now;

  if (diff <= 0) {
    [elDays, elHours, elMins, elSecs].forEach(el => el.textContent = '00');
    document.querySelector('.countdown-wrap').innerHTML =
      '<p style="font-family:Orbitron,sans-serif;font-size:1.5rem;color:var(--purple)">🎉 We Are LIVE!</p>';
    return;
  }

  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000)  / 60000);
  const secs  = Math.floor((diff % 60000)    / 1000);

  flipUpdate(elDays,  pad(days));
  flipUpdate(elHours, pad(hours));
  flipUpdate(elMins,  pad(mins));
  flipUpdate(elSecs,  pad(secs));
}

tick();
setInterval(tick, 1000);

/* ===== TOAST ===== */
function showToast(msg, duration = 3500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

/* ===== SCROLL REVEAL ===== */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      // Staggered delay for grid children
      const siblings = [...entry.target.parentElement.children];
      const idx = siblings.indexOf(entry.target);
      entry.target.style.transitionDelay = (idx * 0.08) + 's';
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

/* ===== PARTICLE SYSTEM ===== */
const canvas = document.getElementById('particles-canvas');
const ctx    = canvas.getContext('2d');
let W, H, particles = [];

function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize, { passive: true });

const COLORS = ['#a855f7', '#ec4899', '#3b82f6', '#06b6d4'];

class Particle {
  constructor() { this.init(); }

  init() {
    this.x    = Math.random() * W;
    this.y    = Math.random() * H;
    this.r    = Math.random() * 1.8 + 0.4;
    this.vx   = (Math.random() - 0.5) * 0.35;
    this.vy   = (Math.random() - 0.5) * 0.35;
    this.a    = Math.random() * 0.45 + 0.08;
    this.col  = COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < -10 || this.x > W + 10 || this.y < -10 || this.y > H + 10) this.init();
  }

  draw() {
    ctx.globalAlpha = this.a;
    ctx.fillStyle   = this.col;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function getParticleCount() {
  // Fewer particles on mobile for perf
  return window.innerWidth < 600 ? 40 : 90;
}

function initParticles() {
  particles = Array.from({ length: getParticleCount() }, () => new Particle());
}

function connectParticles() {
  const MAX_DIST = 130;
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx   = particles[i].x - particles[j].x;
      const dy   = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAX_DIST) {
        ctx.globalAlpha = (1 - dist / MAX_DIST) * 0.07;
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }
}

// Subtle mouse interaction
let mouse = { x: null, y: null };
window.addEventListener('mousemove', e => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
}, { passive: true });

function applyMouseRepel() {
  if (mouse.x === null) return;
  const REPEL_DIST = 100;
  particles.forEach(p => {
    const dx   = p.x - mouse.x;
    const dy   = p.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < REPEL_DIST) {
      const force = (REPEL_DIST - dist) / REPEL_DIST;
      p.x += (dx / dist) * force * 1.2;
      p.y += (dy / dist) * force * 1.2;
    }
  });
}

function animate() {
  ctx.clearRect(0, 0, W, H);
  particles.forEach(p => { p.update(); p.draw(); });
  applyMouseRepel();
  connectParticles();
  ctx.globalAlpha = 1;
  requestAnimationFrame(animate);
}

initParticles();
animate();

// Re-init particles on resize
window.addEventListener('resize', () => {
  initParticles();
}, { passive: true });
