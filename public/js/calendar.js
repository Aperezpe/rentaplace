const root = document.getElementById('portfolio-calendar');
const source = document.getElementById('calendar-data');
if (root && source) {
  const calendar = JSON.parse(source.textContent);
  const inspector = document.getElementById('calendar-inspector');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let current = '';
  function render(key) {
    const columns = `grid-template-columns:225px repeat(${calendar.days.length},minmax(27px,1fr))`;
    const heading = `<div class="portfolio-head portfolio-row" style="${columns}"><div class="portfolio-label">${calendar.listings.length} homes</div>${calendar.days.map(date => `<div class="portfolio-day"><span class="cell-date">${new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'narrow',timeZone:'UTC'})}</span><strong>${Number(date.slice(-2))}</strong></div>`).join('')}</div>`;
    root.innerHTML = heading + calendar.listings.map(home => `<div class="portfolio-row" style="${columns}"><a class="portfolio-label" href="/host/calendar?month=${escape(calendar.month)}&slug=${escape(home.slug)}"><img src="${escape(home.image)}" alt="" width="31" height="27"><span>${escape(home.title)}</span></a>${home.days.map(day => `<button class="portfolio-day ${escape(day.status)} ${key===home.slug+':'+day.date?'hovered':''}" type="button" data-day="${escape(day.date)}" data-slug="${escape(home.slug)}" data-status="${escape(day.status)}" aria-label="${escape(home.title)}, ${escape(day.date)}, ${escape(day.status)}"><span class="cell-date">${Number(day.date.slice(-2))}</span><span class="cell-bar"><span></span></span></button>`).join('')}</div>`).join('');
  }
  root.addEventListener('pointerover', event => {
    const cell = event.target.closest('[data-day]');
    if (!cell) return;
    const key = cell.dataset.slug+':'+cell.dataset.day;
    if (current === key) return;
    current = key;
    const home = calendar.listings.find(home => home.slug === cell.dataset.slug);
    inspector.textContent = `${home.title} · ${cell.dataset.day} · ${cell.dataset.status}`;
    render(key);
  });
  root.addEventListener('focusin', event => {
    const cell = event.target.closest('[data-day]');
    if (!cell) return;
    const home = calendar.listings.find(home => home.slug === cell.dataset.slug);
    inspector.textContent = `${home.title} · ${cell.dataset.day} · ${cell.dataset.status}`;
  });
  root.addEventListener('click', event => {
    const cell = event.target.closest('[data-day]');
    if (!cell) return;
    const form = document.getElementById('block-form');
    if (cell.dataset.status !== 'available') {
      inspector.textContent = `This date is ${cell.dataset.status}. Manage existing reservations from the Reservations page.`;
      return;
    }
    form.elements.slug.value = cell.dataset.slug;
    form.elements.from.value = cell.dataset.day;
    const end = new Date(cell.dataset.day+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+1);
    form.elements.to.value = end.toISOString().slice(0,10);
    form.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    form.elements.reason.focus({preventScroll:true});
  });
}
