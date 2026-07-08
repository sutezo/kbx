// Drawer behavior for the user manual: the hamburger itself is a pure-CSS
// checkbox toggle; this script only adds close-on-link-tap, Escape, and
// keyboard/ARIA support. The manual stays fully readable without it.
// (External file because the CSP forbids inline scripts: script-src 'self'.)
(() => {
	const toggle = document.getElementById('menu-toggle');
	const button = document.querySelector('.menu-button');
	if (!(toggle instanceof HTMLInputElement) || !(button instanceof HTMLElement)) {
		return;
	}

	const sync = () => button.setAttribute('aria-expanded', String(toggle.checked));
	toggle.addEventListener('change', sync);
	sync();

	// The <label> is focusable via tabindex but has no native key handling.
	button.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			toggle.checked = !toggle.checked;
			sync();
		}
	});

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && toggle.checked) {
			toggle.checked = false;
			sync();
		}
	});

	// Without this, the drawer would stay open after jumping to a section.
	for (const link of document.querySelectorAll('.drawer a')) {
		link.addEventListener('click', () => {
			toggle.checked = false;
			sync();
		});
	}
})();
