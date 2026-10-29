const screens = {
  home: { title: 'Make yourself at home.', description: 'Pick up where you left off and keep your favourites close.', alt: 'Freaky IPTV home screen with example content', count: '01 / 04' },
  live: { title: 'Find something to watch.', description: 'Browse your channels and settle in with the ones you love.', alt: 'Freaky IPTV live TV screen with example channels', count: '02 / 04' },
  guide: { title: 'See what’s on.', description: 'Explore your schedule and see what is coming up next.', alt: 'Freaky IPTV programme guide with example programming', count: '03 / 04' },
  stats: { title: 'Get the bigger picture.', description: 'Look back at your viewing history and local statistics.', alt: 'Freaky IPTV statistics screen with example viewing history', count: '04 / 04' }
};
const buttons = document.querySelectorAll('.screen-tab');
const screenImage = document.querySelector('#showcase-image');
buttons.forEach((button) => button.addEventListener('click', () => {
  const screen = screens[button.dataset.screen];
  if (!screen) return;
  buttons.forEach((item) => { const selected = item === button; item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected)); });
  screenImage.src = `assets/app-previews/${button.dataset.screen}.png`;
  screenImage.alt = screen.alt;
  document.querySelector('#screen-title').textContent = screen.title;
  document.querySelector('#screen-description').textContent = screen.description;
  document.querySelector('#screen-counter').textContent = screen.count;
}));
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.classList.add('js');
  const observer = new IntersectionObserver((entries, instance) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); instance.unobserve(entry.target); }
  }), { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));
}
const tickerPause = document.querySelector('.ticker-pause');
tickerPause.addEventListener('click', () => {
  const paused = tickerPause.getAttribute('aria-pressed') !== 'true';
  tickerPause.setAttribute('aria-pressed', String(paused));
  tickerPause.setAttribute('aria-label', paused ? 'Play moving text' : 'Pause moving text');
  tickerPause.textContent = paused ? '▶' : 'Ⅱ';
  tickerPause.closest('.ticker').classList.toggle('paused', paused);
});
