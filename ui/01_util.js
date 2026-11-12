/* =====================================================================
   Bill Tracker UI - shared by the desk page (/desk/bill-tracker) and the mobile app (/bill-tracker/m).
   Built from ui/*.js + ui/bt_ui.css by ui/build.js - edit the sources, not the generated files.
   ===================================================================== */
(function () {
'use strict';

const CSS = /*__CSS__*/'';
const IMG = /*__IMG__*/{};
const API = 'bill_tracker.bill_tracker.api.';

// DUX Digitech design system: thin-stroke 24px icons (1.7 stroke, round caps)
const ICONS = {
	plus: '<path d="M12 5v14M5 12h14"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
	file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
	upload: '<path d="M12 16V5"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
	camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
	chevL: '<path d="m15 18-6-6 6-6"/>',
	chevR: '<path d="m9 18 6-6-6-6"/>',
	x: '<path d="M6 6l12 12M18 6 6 18"/>',
	filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
	check: '<path d="M4 12.5 9 17.5 20 6.5"/>',
	alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/>',
	download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
	eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
	refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
	image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
	receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
};
const ic = (name, size) =>
	`<svg class="ic" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------- small helpers
const esc = (s) =>
	String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const num = (v) => {
	const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
	return isFinite(n) ? n : 0;
};
const debounce = (fn, ms) => {
	let t;
	return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Indian digit grouping (12,34,567.89); decimals only when there are paise. */
function fmt(n, forceDec) {
	n = Math.round((Number(n) || 0) * 100) / 100;
	const neg = n < 0;
	n = Math.abs(n);
	const parts = n.toFixed(2).split('.');
	const i = parts[0];
	const g = i.length > 3 ? i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + i.slice(-3) : i;
	return (neg ? '-' : '') + g + (parts[1] !== '00' || forceDec ? '.' + parts[1] : '');
}
const rs = (n, dec) => `<span class="rs">₹</span>${fmt(n, dec)}`;
const rate = (r) => String(+(Number(r) || 0).toFixed(2));
function dmy(s) {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
	return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function dmyTime(s) {
	const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
	return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : dmy(s);
}
function fileSize(b) {
	b = Number(b) || 0;
	if (!b) return '';
	return b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
}
const money0 = (v) => (num(v) ? fmt(num(v)) : '');

// ---------------------------------------------------------------- server calls
class ApiError extends Error {
	constructor(message, status, type) {
		super(message);
		this.status = status || 0;
		this.type = type || '';
	}
}
const csrf = () => (window.frappe && window.frappe.csrf_token) || '';

function serverMessage(j) {
	try {
		if (j && j._server_messages) {
			const list = JSON.parse(j._server_messages).map((m) => {
				try { return JSON.parse(m).message; } catch (e) { return m; }
			});
			const text = list.map(strip).filter(Boolean).join(' ');
			if (text) return text;
		}
	} catch (e) { /* fall through */ }
	if (j && j.exception) {
		const t = String(j.exception).split(':').slice(1).join(':').trim();
		if (t) return strip(t);
	}
	return '';
}

async function post(method, args) {
	let r;
	try {
		r = await fetch('/api/method/' + API + method, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Frappe-CSRF-Token': csrf() },
			body: JSON.stringify(args || {}),
		});
	} catch (e) {
		throw new ApiError('No connection. Check the internet and try again.', 0, 'Network');
	}
	let j = {};
	try { j = await r.json(); } catch (e) { /* not json */ }
	if (r.ok) return j.message;
	const type = j.exc_type || '';
	if (type === 'CSRFTokenError' && !sessionStorage.getItem('bt_csrf_retry')) {
		sessionStorage.setItem('bt_csrf_retry', '1');
		location.reload(); // the page was opened with an old token; one reload gets a fresh one
		throw new ApiError('Refreshing...', r.status, type);
	}
	throw new ApiError(
		serverMessage(j) || (r.status === 403 ? 'You do not have permission for this.' : 'Something went wrong. Please try again.'),
		r.status,
		type
	);
}

async function uploadFile(file) {
	const fd = new FormData();
	fd.append('file', file, file.name);
	fd.append('is_private', '1');
	fd.append('folder', 'Home/Attachments');
	let r;
	try {
		r = await fetch('/api/method/upload_file', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'X-Frappe-CSRF-Token': csrf(), Accept: 'application/json' },
			body: fd,
		});
	} catch (e) {
		throw new ApiError('No connection. Check the internet and try again.', 0, 'Network');
	}
	const j = await r.json().catch(() => ({}));
	if (!r.ok || !j.message) throw new ApiError(serverMessage(j) || 'The file could not be uploaded. Please try again.', r.status, '');
	return j.message;
}

/** Phone photos are 4-8 MB: shrink to a readable 2400 px JPEG before uploading. */
async function prepareImage(file) {
	if (!/^image\//.test(file.type) || /gif/.test(file.type) || file.size < 1.5 * 1048576) return file;
	try {
		const bmp = await createImageBitmap(file);
		const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
		const c = document.createElement('canvas');
		c.width = Math.round(bmp.width * scale);
		c.height = Math.round(bmp.height * scale);
		c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
		const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
		if (!blob || blob.size >= file.size) return file;
		return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
	} catch (e) {
		return file;
	}
}

/** Open a sanction order. In the Android app there is no PDF viewer inside the WebView, so hand the file to the share sheet. */
async function openFile(url, name) {
	const cap = window.Capacitor;
	const P = cap && cap.Plugins;
	if (cap && cap.isNativePlatform && cap.isNativePlatform() && P && P.Filesystem && P.Share) {
		try {
			const resp = await fetch(url, { credentials: 'same-origin' });
			if (!resp.ok) throw new Error('download');
			const blob = await resp.blob();
			const data = await new Promise((res, rej) => {
				const fr = new FileReader();
				fr.onload = () => res(String(fr.result).split(',')[1]);
				fr.onerror = rej;
				fr.readAsDataURL(blob);
			});
			const w = await P.Filesystem.writeFile({ path: name || 'sanction-order', data, directory: 'CACHE' });
			await P.Share.share({ title: name || 'Sanction order', dialogTitle: 'Open or share', url: w.uri });
			return;
		} catch (e) {
			if (e && /cancel/i.test(String(e.message || e))) return;
		}
	}
	window.open(url, '_blank', 'noopener');
}
