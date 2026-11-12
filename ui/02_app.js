
// ---------------------------------------------------------------- the app
class App {
	constructor(container, opts) {
		this.opts = opts || {};
		this.mode = this.opts.mode === 'mobile' ? 'mobile' : 'desk';
		this.host = document.createElement('div');
		container.appendChild(this.host);
		this.root = this.host.attachShadow({ mode: 'open' });
		this.root.innerHTML = `<style>${CSS}</style>${this.shellHTML()}`;
		this.$ = (sel) => this.root.querySelector(sel);
		this.$view = this.$('[data-el=view]');
		this.st = {
			ctx: null,
			view: 'boot',
			list: { rows: [], totals: null, has_more: false, loaded: false, loading: false, error: '', open: false,
				f: { search: '', project: '', project_name: '', bill_type: '', authority: '', from: '', to: '' } },
			detail: { name: '', data: null, error: '', preview: false },
			form: null,
			calc: null,
			section: 'bills', // 'bills' | 'letters' (the Fund transfer letters screen of the jv_escrow app, when installed)
		};
		this.letters = null;
		this.stack = ['list'];
		this.reqs = { list: 0, detail: 0, calc: 0, pick: 0 };
		this.loadListSoon = debounce(() => this.loadList(true), 320);
		this.bind();
		this.syncTheme();
		this.boot();
	}

	// ---- shell -----------------------------------------------------------------
	shellHTML() {
		return `<div class="shell" data-mode="${this.mode}"><div class="wrap">
			<header class="hero">
				<div class="mark"><img class="m-light" src="${IMG.mark}" alt=""><img class="m-dark" src="${IMG.markW}" alt=""></div>
				<div class="hero-text">
					<div class="eyebrow">Project bills</div>
					<h1>Bill <em>tracker</em></h1>
					<p class="lede">RA / PA bills with their sanction orders and the payment calculation, in one place.</p>
				</div>
				<div class="hero-acts" data-el="acts"></div>
			</header>
			<div class="sections" data-el="sections" hidden></div>
			<div class="tabs-wrap" data-el="tabs" hidden></div>
			<div data-el="alert"></div>
			<div data-el="view"><div class="loading"><span class="spin"></span> Loading...</div></div>
			<div data-el="letters" hidden></div>
		</div>
		<div class="toast" data-el="toast"></div>
		<div data-el="overlay"></div></div>`;
	}

	syncTheme() {
		const apply = () => {
			const dm = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
			let dark = dm;
			if (this.mode === 'desk') {
				const t = document.documentElement.getAttribute('data-theme');
				dark = t === 'dark' || (t === 'automatic' && dm) || (!t && dm);
			}
			this.host.setAttribute('data-theme', dark ? 'dark' : 'light');
			const meta = document.querySelector('meta[name=theme-color]');
			if (meta && this.mode === 'mobile') meta.setAttribute('content', dark ? '#0A0D13' : '#F3F4F7');
		};
		apply();
		if (window.matchMedia) {
			const mq = matchMedia('(prefers-color-scheme: dark)');
			(mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(apply);
		}
		if (this.mode === 'desk') {
			new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		}
	}

	toast(msg, kind) {
		const el = this.$('[data-el=toast]');
		el.className = 'toast on' + (kind === 'err' ? ' err' : '');
		el.innerHTML = `${ic(kind === 'err' ? 'alert' : 'check', 16)} <span>${esc(msg)}</span>`;
		clearTimeout(this._toast);
		this._toast = setTimeout(() => el.classList.remove('on'), kind === 'err' ? 5200 : 2800);
	}

	showAlert(msg, kind) {
		const el = this.$('[data-el=alert]');
		if (!msg) { el.innerHTML = ''; return; }
		el.innerHTML = `<div class="alert ${kind || 'error'}">${ic('alert', 18)}<div>${esc(msg)}</div><button class="a-x" data-act="alert-x" aria-label="Close">${ic('x', 15)}</button></div>`;
	}

	confirmBox(title, text, ok, cancel) {
		return new Promise((resolve) => {
			const ov = this.$('[data-el=overlay]');
			ov.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">
				<h3>${esc(title)}</h3><p>${esc(text)}</p>
				<div class="m-acts"><button class="btn btn-secondary" data-m="no">${esc(cancel || 'Cancel')}</button><button class="btn btn-primary" data-m="yes" style="height:38px">${esc(ok || 'OK')}</button></div></div></div>`;
			const done = (v) => { ov.innerHTML = ''; resolve(v); };
			ov.querySelector('[data-m=yes]').onclick = () => done(true);
			ov.querySelector('[data-m=no]').onclick = () => done(false);
			ov.querySelector('.modal-back').onclick = (e) => { if (e.target.classList.contains('modal-back')) done(false); };
			ov.querySelector('[data-m=yes]').focus();
		});
	}

	// ---- start-up --------------------------------------------------------------
	async boot() {
		try {
			this.st.ctx = await post('get_context');
		} catch (e) {
			if (e.type === 'CSRFTokenError') return;
			if (this.mode === 'mobile' && (e.status === 401 || e.status === 403)) return this.checkLogin(e);
			this.$view.innerHTML = this.errorCard(e.message);
			return;
		}
		sessionStorage.removeItem('bt_csrf_retry');
		this.st.view = 'list';
		this.renderSections();
		this.loadList(true); // fills the "Saved bills" count while the form is shown
		// same pattern as the letters: opens on "New bill"; people who may not create bills land on the saved list
		if (this.st.ctx.can_create) this.openForm(null);
		else this.view('list');
		this.openRequestedSection();
	}

	// ---- tabs of the bills section: New bill | Saved bills -------------------------------
	isNewForm() {
		return this.st.view === 'form' && !!this.st.form && !this.st.form.name;
	}

	renderTabs() {
		const el = this.$('[data-el=tabs]');
		const ctx = this.st.ctx;
		if (!el) return;
		if (!ctx || this.st.section !== 'bills' || !ctx.can_create) { el.hidden = true; el.innerHTML = ''; return; }
		const isNew = this.isNewForm();
		const T = this.st.list.totals;
		el.hidden = false;
		el.innerHTML = `<nav class="tabs" role="tablist" aria-label="Sanction order bills">
			<button type="button" class="tab" role="tab" data-act="tab" data-tab="new" aria-selected="${isNew}">${ic('plus', 15)} New bill</button>
			<button type="button" class="tab" role="tab" data-act="tab" data-tab="saved" aria-selected="${!isNew}">${ic('receipt', 15)} Saved bills${T ? ` <span class="count">${fmt(T.total_bills)}</span>` : ''}</button></nav>`;
	}

	/** True when it is fine to leave the form (nothing typed, or the user chose to discard it). */
	async leaveForm() {
		const f = this.st.form;
		if (this.st.view === 'form' && f && f.dirty) {
			const ok = await this.confirmBox('Discard changes?', 'The details you entered on this bill are not saved yet.', 'Discard', 'Keep editing');
			if (!ok) return false;
			f.dirty = false;
		}
		return true;
	}

	async selectTab(tab) {
		if (tab === 'new') {
			if (this.isNewForm() || !this.st.ctx.can_create) return;
			if (!(await this.leaveForm())) return;
			this.stack = ['list'];
			this.openForm(null);
		} else {
			if (this.st.view === 'list') return;
			if (!(await this.leaveForm())) return;
			this.stack = ['list'];
			this.view('list');
			this.loadList(true);
		}
	}

	async clearForm() {
		const f = this.st.form;
		if (f && f.dirty) {
			const ok = await this.confirmBox('Clear the form?', 'Everything you entered on this bill will be removed.', 'Clear', 'Keep');
			if (!ok) return;
		}
		this.stack = ['list'];
		this.openForm(null);
	}

	// ---- sections: Sanction order bills | Fund transfer letters ------------------------
	renderSections() {
		const el = this.$('[data-el=sections]');
		const esc_ = this.st.ctx && this.st.ctx.escrow;
		if (!esc_) { el.hidden = true; el.innerHTML = ''; return; }
		const s = this.st.section;
		el.hidden = false;
		el.innerHTML = `<div class="seg" role="tablist" aria-label="Sections">
			<button type="button" role="tab" data-act="section" data-v="bills" aria-pressed="${s === 'bills'}">${ic('receipt', 15)} Sanction order bills</button>
			<button type="button" role="tab" data-act="section" data-v="letters" aria-pressed="${s === 'letters'}">${ic('file', 15)} ${esc(esc_.label || 'Fund transfer letters')}</button></div>`;
	}

	/** /desk/bill-tracker/letters opens the letters section straight away. */
	openRequestedSection() {
		const r = window.frappe && frappe.get_route && frappe.get_route();
		if (this.mode === 'desk' && r && r[1] === 'letters' && this.st.ctx.escrow) this.setSection('letters');
	}

	async setSection(name) {
		if (name === this.st.section) return;
		if (name === 'letters' && !(this.st.ctx && this.st.ctx.escrow)) return;
		if (this.st.view === 'form' && this.st.form && this.st.form.dirty) {
			const ok = await this.confirmBox('Leave this bill?', 'The details you entered on this bill are not saved yet.', 'Leave', 'Stay');
			if (!ok) return;
			this.st.form.dirty = false;
		}
		this.st.section = name;
		this.renderSections();
		this.renderTabs();
		this.$('[data-el=view]').hidden = name !== 'bills';
		this.$('[data-el=letters]').hidden = name !== 'letters';
		this.showAlert('');
		this.setActs();
		if (name === 'letters') this.showLetters();
		else if (this.st.view === 'list') this.loadList(true);
	}

	async showLetters() {
		const el = this.$('[data-el=letters]');
		if (this.letters) { this.letters.on_show(); return; }
		el.innerHTML = `<div class="loading"><span class="spin"></span> Loading the letters screen...</div>`;
		try {
			await loadScript(this.st.ctx.escrow.url, () => !!(window.jv_escrow && window.jv_escrow.EscrowTransfer));
			el.innerHTML = '';
			this.letters = new window.jv_escrow.EscrowTransfer(el, { embedded: true });
		} catch (e) {
			el.innerHTML = this.errorCard(e.message || 'Could not load the letters screen.', 'letters');
		}
	}

	async checkLogin(err) {
		let guest = err.status === 401;
		if (!guest) {
			const who = await fetch('/api/method/frappe.auth.get_logged_user', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
			guest = who.message === 'Guest' || !who.message;
		}
		if (guest) {
			this.$view.innerHTML = `<div class="card"><span class="accent"></span><div class="empty"><span class="e-ic">${ic('receipt', 22)}</span>
				<b>Sign in to continue</b>Please sign in with your ERP account to see the bills.
				<div style="margin-top:16px"><button class="btn btn-primary" data-act="login">Sign in</button></div></div></div>`;
		} else {
			this.$view.innerHTML = this.errorCard('Your account does not have access to Project Bills. Ask the administrator to give you the Accounts User or Projects Manager role.');
		}
	}

	errorCard(msg, retry) {
		const act = retry === 'letters' ? 'retry-letters' : 'retry';
		return `<div class="card"><span class="accent"></span><div class="empty"><span class="e-ic" style="background:var(--err-bg);color:var(--err)">${ic('alert', 22)}</span>
			<b>Could not open</b>${esc(msg)}${retry ? `<div style="margin-top:14px"><button class="btn btn-secondary" data-act="${act}">${ic('refresh', 15)} Try again</button></div>` : ''}</div></div>`;
	}

	setActs() {
		const c = this.st.ctx || {};
		const el = this.$('[data-el=acts]');
		if (this.st.view !== 'list' || this.st.section !== 'bills') { el.innerHTML = ''; return; }
		el.innerHTML = `<button class="btn btn-ghost" data-act="refresh" title="Refresh">${ic('refresh', 16)}</button>`;
	}

	// ---- navigation ------------------------------------------------------------
	push(view) {
		this.stack.push(view);
		if (this.mode === 'mobile') history.pushState({ bt: view }, '');
	}

	view(name) {
		this.st.view = name;
		this.showAlert('');
		this.setActs();
		this.renderTabs();
		if (name === 'list') this.renderList();
		else if (name === 'detail') this.renderDetail();
		else if (name === 'form') this.renderForm();
		window.scrollTo && this.mode === 'mobile' && window.scrollTo(0, 0);
		this.host.scrollIntoView && this.mode === 'desk' && this.host.scrollIntoView({ block: 'start' });
	}

	async goBack() {
		if (this.st.view === 'form' && this.st.form && this.st.form.dirty) {
			const ok = await this.confirmBox('Discard changes?', 'The details you entered on this bill will be lost.', 'Discard', 'Keep editing');
			if (!ok) return;
			this.st.form.dirty = false;
		}
		if (this.mode === 'mobile' && history.state && history.state.bt) history.back();
		else this.popView();
	}

	popView() {
		if (this.stack.length > 1) this.stack.pop();
		const prev = this.stack[this.stack.length - 1];
		this.view(prev);
		if (prev === 'list' && !this.st.list.loaded) this.loadList(true);
	}

	async onPop() {
		if (this.stack.length <= 1) return;
		if (this.st.view === 'form' && this.st.form && this.st.form.dirty) {
			history.pushState({ bt: 'form' }, ''); // stay put until the user decides
			const ok = await this.confirmBox('Discard changes?', 'The details you entered on this bill will be lost.', 'Discard', 'Keep editing');
			if (!ok) return;
			this.st.form.dirty = false;
			history.back();
			return;
		}
		this.popView();
	}

	on_show() {
		if (!this.st.ctx) return;
		const r = window.frappe && frappe.get_route && frappe.get_route();
		if (this.mode === 'desk' && r && r[1] === 'letters' && this.st.ctx.escrow && this.st.section !== 'letters') { this.setSection('letters'); return; }
		if (this.st.section === 'letters') { if (this.letters) this.letters.on_show(); return; }
		if (this.st.view === 'list') this.loadList(true);
	}

	// ---- list ------------------------------------------------------------------
	hasFilters() {
		const f = this.st.list.f;
		return !!(f.search || f.project || f.bill_type || f.authority || f.from || f.to);
	}

	filterCount() {
		const f = this.st.list.f;
		return [f.project, f.bill_type, f.authority, f.from, f.to].filter(Boolean).length;
	}

	renderList() {
		const f = this.st.list.f;
		const ctx = this.st.ctx || {};
		const auths = (ctx.authorities || []).map((a) => `<option value="${esc(a)}"${f.authority === a ? ' selected' : ''}>${esc(a)}</option>`).join('');
		const types = [['', 'All'], ['RA', 'RA'], ['PA', 'PA']]
			.map(([v, l]) => `<button type="button" data-act="ftype" data-v="${v}" aria-pressed="${f.bill_type === v}">${l}</button>`).join('');
		this.$view.innerHTML = `
			<div class="stats" data-el="stats"></div>
			<div class="card"><span class="accent"></span>
				<div class="filters${this.st.list.open ? ' open' : ''}" data-el="filters">
					<div class="input search"><span class="ico">${ic('search', 16)}</span>
						<input data-flt="search" placeholder="Search project, bill no, sanction no, package" value="${esc(f.search)}" autocomplete="off" enterkeyhint="search"></div>
					<button class="btn btn-secondary btn-sm f-toggle" type="button" data-act="toggle-filters">${ic('filter', 14)} Filters<span data-el="fcount"></span></button>
					<div class="f-more">
						<div class="seg" role="group" aria-label="Bill type">${types}</div>
						<div class="input sm"><select data-flt="authority" aria-label="Department"><option value="">All departments</option>${auths}</select></div>
						<div class="pick" data-pick="filter"><div class="input sm"><input data-el="pick-q" placeholder="Any project" value="${esc(f.project_name)}" autocomplete="off" aria-label="Project">
							${f.project ? `<button type="button" class="tr-x" style="width:22px;height:22px" data-act="pick-clear" aria-label="Clear project">${ic('x', 13)}</button>` : ''}</div><div class="pick-list" hidden></div></div>
						<div class="input sm"><input type="date" data-flt="from" value="${esc(f.from)}" aria-label="From date"></div>
						<div class="input sm"><input type="date" data-flt="to" value="${esc(f.to)}" aria-label="To date"></div>
						<span data-el="fclear"></span>
					</div>
				</div>
				<div data-el="rows"></div>
			</div>`;
		this.renderFilterBits();
		this.renderStats();
		this.renderRows();
	}

	renderFilterBits() {
		const n = this.filterCount();
		const fc = this.$('[data-el=fcount]');
		if (fc) fc.innerHTML = n ? ` <span class="pill iris">${n}</span>` : '';
		const cl = this.$('[data-el=fclear]');
		if (cl) cl.innerHTML = this.hasFilters() ? `<button type="button" class="btn btn-ghost btn-sm" data-act="clear">${ic('x', 13)} Clear</button>` : '';
	}

	renderStats() {
		const T = this.st.list.totals;
		const stat = (k, v, cy) => `<div class="card stat"><span class="accent"></span><div class="k">${k}</div><div class="v${cy ? ' cy' : ''}">${v}</div></div>`;
		this.$('[data-el=stats]').innerHTML =
			stat('Bills', T ? fmt(T.total_bills) : '-') +
			stat('Bill amount', T ? rs(T.total_bill_amount) : '-') +
			stat('Sanction amount', T ? rs(T.total_sanction_amount) : '-') +
			stat('Net payable', T ? rs(T.total_net_payable) : '-', true);
	}

	async loadList(reset) {
		const L = this.st.list;
		const req = ++this.reqs.list;
		L.loading = true;
		L.error = '';
		if (reset) { L.loaded = L.loaded && L.rows.length > 0 ? true : false; }
		this.renderRows();
		const f = L.f;
		try {
			const r = await post('list_bills', {
				search: f.search, project: f.project, bill_type: f.bill_type, authority: f.authority,
				from_date: f.from, to_date: f.to, start: reset ? 0 : L.rows.length, page_length: 30,
			});
			if (req !== this.reqs.list) return;
			L.rows = reset ? r.rows : L.rows.concat(r.rows);
			L.totals = r.totals;
			L.has_more = r.has_more;
			L.loaded = true;
		} catch (e) {
			if (req !== this.reqs.list) return;
			L.error = e.message;
			L.loaded = true;
		}
		L.loading = false;
		this.renderTabs(); // the "Saved bills" count
		if (this.st.view === 'list') { this.renderStats(); this.renderRows(); }
	}

	renderRows() {
		const el = this.$('[data-el=rows]');
		if (!el) return;
		const L = this.st.list;
		const ctx = this.st.ctx || {};
		if (!L.loaded && L.loading) { el.innerHTML = `<div class="loading"><span class="spin"></span> Loading bills...</div>`; return; }
		if (L.error) { el.innerHTML = this.errorCard(L.error, true); return; }
		if (!L.rows.length) {
			el.innerHTML = this.hasFilters()
				? `<div class="empty"><span class="e-ic">${ic('search', 22)}</span><b>No bills match</b>Try a different search or clear the filters.</div>`
				: `<div class="empty"><span class="e-ic">${ic('receipt', 22)}</span><b>No bills yet</b>Add the first RA / PA bill with its sanction order.${ctx.can_create ? `<div style="margin-top:14px"><button class="btn btn-primary" data-act="new">${ic('plus', 16)} New bill</button></div>` : ''}</div>`;
			return;
		}
		const authPill = (r) => (r.sanction_authority ? `<span class="pill cyan">${esc(r.sanction_authority)}</span>` : '');
		const fileIc = (r) => `<span class="file-ic${r.sanction_order ? '' : ' none'}" title="${r.sanction_order ? 'Sanction order attached' : 'No sanction order'}">${ic('file', 15)}</span>`;
		const trs = L.rows.map((r) => `<tr class="clickable" data-act="open" data-name="${esc(r.name)}">
			<td><span class="main">${esc(r.project_name)}</span><span class="sub mono">${esc(r.project)} · ${esc(r.name)}</span></td>
			<td class="nowrap"><span class="pill iris">${esc(r.bill_type_code)}</span> <b>${esc(r.bill_no)}</b><span class="sub">${esc(dmy(r.bill_date))}</span></td>
			<td>${authPill(r)} <span class="mono">${esc(r.sanction_no || '')}</span><span class="sub">${esc([dmy(r.sanction_date), r.package_no && 'Pkg ' + r.package_no].filter(Boolean).join(' · '))}</span></td>
			<td class="amt">${rs(r.bill_amount)}</td>
			<td class="amt col-hide-md">${r.sanction_amount ? rs(r.sanction_amount) : '<span class="sub">-</span>'}</td>
			<td class="amt cy">${r.net_payable ? rs(r.net_payable) : '<span class="sub">-</span>'}</td>
			<td>${fileIc(r)}</td></tr>`).join('');
		const cards = L.rows.map((r) => `<div class="bcard" data-act="open" data-name="${esc(r.name)}">
			<div class="top"><div><div class="nm">${esc(r.project_name)}</div><div class="id">${esc(r.name)}</div></div>${fileIc(r)}</div>
			<div class="pills"><span class="pill iris">${esc(r.bill_type_code)} ${esc(r.bill_no)}</span>${authPill(r)}<span class="pill">${esc(dmy(r.bill_date))}</span></div>
			<div class="amts"><div><div class="k">Bill amount</div><div class="v">${rs(r.bill_amount)}</div></div><div style="text-align:right"><div class="k">Net payable</div><div class="v cy">${r.net_payable ? rs(r.net_payable) : '-'}</div></div></div></div>`).join('');
		const T = L.totals || {};
		el.innerHTML = `<div class="tbl-wrap-list table-wrap"><table class="tbl"><thead><tr>
				<th>Project</th><th>Bill</th><th>Sanction order</th><th class="r">Bill amount</th><th class="r col-hide-md">Sanction amount</th><th class="r">Net payable</th><th></th>
			</tr></thead><tbody>${trs}</tbody></table></div>
			<div class="cards">${cards}</div>
			<div class="list-foot"><span>Showing ${fmt(L.rows.length)} of ${fmt(T.total_bills || 0)} bills</span>${L.has_more ? `<button class="btn btn-secondary btn-sm" data-act="more">${L.loading ? '<span class="spin"></span>' : ''} Load more</button>` : ''}</div>`;
	}

	// ---- detail ----------------------------------------------------------------
	openDetail(name) {
		this.st.detail = { name, data: null, error: '', preview: false };
		this.push('detail');
		this.view('detail');
		this.loadDetail();
	}

	async loadDetail() {
		const d = this.st.detail;
		const req = ++this.reqs.detail;
		try {
			const data = await post('get_bill', { name: d.name });
			if (req !== this.reqs.detail) return;
			d.data = data;
		} catch (e) {
			if (req !== this.reqs.detail) return;
			d.error = e.message;
		}
		if (this.st.view === 'detail') this.renderDetail();
	}

	renderDetail() {
		const d = this.st.detail;
		const back = `<button class="btn btn-ghost back" data-act="back">${ic('chevL', 16)} Saved bills</button>`;
		if (d.error) { this.$view.innerHTML = back + this.errorCard(d.error); return; }
		if (!d.data) { this.$view.innerHTML = back + `<div class="loading"><span class="spin"></span> Opening the bill...</div>`; return; }
		const b = d.data;
		const code = String(b.bill_type || '').split(' - ')[0];
		const kv = (k, v, cls) => `<div><dt>${k}</dt><dd class="${cls || ''}${v ? '' : ' muted'}">${v ? v : '-'}</dd></div>`;
		const file = b.file;
		let fileCard = `<div class="empty" style="padding:18px">No sanction order attached.</div>`;
		if (file) {
			const prev = file.is_image
				? `<div class="file-prev"><img src="${esc(file.url)}" alt="Sanction order" data-act="lightbox"></div>`
				: file.is_pdf && this.mode === 'desk' && d.preview
					? `<div class="file-prev"><iframe src="${esc(file.url)}" title="Sanction order"></iframe></div>` : '';
			fileCard = `<div class="file-card"><div class="file-row"><span class="fi">${ic(file.is_image ? 'image' : 'file', 20)}</span>
				<div class="fn"><b>${esc(file.name)}</b><span>${esc([file.ext.replace('.', '').toUpperCase(), fileSize(file.size)].filter(Boolean).join(' · '))}</span></div>
				${file.is_pdf && this.mode === 'desk' ? `<button class="btn btn-ghost btn-sm" data-act="preview-toggle">${d.preview ? 'Hide preview' : 'Preview'}</button>` : ''}
				<button class="btn btn-secondary btn-sm" data-act="file-open">${ic('download', 14)} Open</button></div>${prev}</div>`;
		}
		const lines = (b.work_lines || []).length
			? `<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Work-wise breakup</h2><div class="sub">ULB / particular as written in the order</div></div></div>
				<div class="table-wrap"><table class="tbl"><thead><tr><th>ULB / Particular</th><th class="r">Contract amount</th><th class="r">Bill amount</th></tr></thead><tbody>
				${b.work_lines.map((r) => `<tr><td>${esc(r.particular)}</td><td class="amt">${r.contract_amount ? rs(r.contract_amount) : '-'}</td><td class="amt">${rs(r.amount)}</td></tr>`).join('')}
				</tbody><tfoot><tr><td><b>Total</b></td><td class="amt">${rs(b.work_lines.reduce((s, r) => s + (r.contract_amount || 0), 0))}</td><td class="amt cy">${rs(b.work_lines.reduce((s, r) => s + (r.amount || 0), 0))}</td></tr></tfoot></table></div></div>` : '';
		const progress = b.contract_value || b.work_done_till_date || b.previous_payments
			? `<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Contract &amp; progress</h2></div></div><div class="card-body"><dl class="kv">
				${kv('Contract value', b.contract_value ? rs(b.contract_value) : '', 'mono')}${kv('Work done till date', b.work_done_till_date ? rs(b.work_done_till_date) : '', 'mono')}
				${kv('Previous bill payments', b.previous_payments ? rs(b.previous_payments) : '', 'mono')}${kv('Claimed under this bill', b.claimed_this_bill ? rs(b.claimed_this_bill) : '', 'mono')}
				${kv('Balance work', b.balance_work ? rs(b.balance_work) : '', 'mono')}</dl></div></div>` : '';
		const remarks = b.remarks ? `<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Remarks</h2></div></div><div class="card-body" style="white-space:pre-wrap">${esc(b.remarks)}</div></div>` : '';
		const edited = b.modified && b.modified.slice(0, 16) !== b.creation.slice(0, 16)
			? ` · last edited ${esc(dmyTime(b.modified))} by ${esc(b.modified_by_name)}` : '';
		this.$view.innerHTML = `${back}
			<div class="card"><span class="accent"></span><div class="d-head">
				<div><div class="eyebrow">${esc(b.name)}</div><h2>${esc(code)} ${esc(b.bill_no)} · ${esc(b.project_name)}</h2>
					<div class="by">Added by ${esc(b.owner_name)} on ${esc(dmyTime(b.creation))}${edited}</div>
					<div class="pills"><span class="pill iris">${esc(b.bill_type)}</span>${b.sanction_authority ? `<span class="pill cyan">${esc(b.sanction_authority)}</span>` : ''}
						${b.net_difference && b.net_as_per_order ? `<span class="pill err">Differs from order</span>` : b.net_as_per_order ? `<span class="pill ok"><span class="dot"></span>Matches order</span>` : ''}</div></div>
				<div class="d-acts">${file ? `<button class="btn btn-secondary" data-act="file-open">${ic('eye', 16)}<span class="btn-label">Open sanction order</span></button>` : ''}
					${b.can_write ? `<button class="btn btn-primary" data-act="edit" style="height:38px">${ic('pencil', 15)}<span class="btn-label">Edit</span></button>` : ''}</div>
			</div></div>
			<div class="d-grid"><div class="d-col">
				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Bill</h2></div></div><div class="card-body"><dl class="kv">
					${kv('Project', esc(b.project_name) + ` <span class="pill">${esc(b.project)}</span>`)}${kv('Bill type', esc(b.bill_type))}
					${kv('Bill no', esc(b.bill_no), 'mono')}${kv('Bill date', esc(dmy(b.bill_date)), 'mono')}${kv('Bill amount', rs(b.bill_amount), 'mono')}</dl></div></div>
				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Sanction order</h2></div></div><div class="card-body" style="display:flex;flex-direction:column;gap:18px"><dl class="kv">
					${kv('Department', esc(b.sanction_authority))}${kv('Order no', esc(b.sanction_no), 'mono')}${kv('Order date', esc(dmy(b.sanction_date)), 'mono')}
					${kv('Package / agreement', esc(b.package_no), 'mono')}${kv('Sanction amount', b.sanction_amount ? rs(b.sanction_amount) : '', 'mono')}</dl>${fileCard}</div></div>
				${lines}${progress}${remarks}
			</div><div class="d-col"><div class="card"><span class="accent"></span><div class="card-head"><div><h2>Payment calculation</h2><div class="sub">As worked out from the order</div></div></div>
				${this.summaryHTML(b, true)}${this.checkHTML(b)}</div></div></div>`;
	}

	/** Work value -> GST -> additions -> deductions -> net payable. `lines` lists every addition / deduction. */
	summaryHTML(c, lines) {
		const hasGst = (c.sgst_amount || 0) + (c.cgst_amount || 0) > 0;
		const half = c.gst_rate > 0 ? ` <small>@ ${rate(c.gst_rate / 2)}%</small>` : '';
		const row = (l, a, cls) => `<div class="row ${cls || ''}"><div class="l">${l}</div><div class="a">${a}</div></div>`;
		let h = `<div class="sum">`;
		h += row('Work value <small>before GST</small>', rs(c.base_amount));
		if (hasGst) {
			h += row('SGST' + half, rs(c.sgst_amount), 'sub plus');
			h += row('CGST' + half, rs(c.cgst_amount), 'sub plus');
		}
		h += row('Bill total <small>incl. GST</small>', rs(c.bill_total), 'strong line');
		if (c.additions_total || (c.additions || []).length) {
			h += row('Additions', '+ ' + rs(c.additions_total), 'plus');
			if (lines) h += (c.additions || []).map((r) => row(esc(r.particular) + (r.rate ? ` <small>${rate(r.rate)}%</small>` : ''), rs(r.amount), 'sub plus')).join('');
		}
		h += row('Gross total', rs(c.gross_total), 'strong line');
		if (c.deductions_total || (c.deductions || []).length) {
			h += row('Deductions', '− ' + rs(c.deductions_total), 'minus');
			if (lines) h += (c.deductions || []).map((r) => row(esc(r.particular) + (r.rate ? ` <small>${rate(r.rate)}%</small>` : ''), rs(r.amount), 'sub minus')).join('');
		}
		h += `</div><div class="net"><div class="k">Net payable</div><div class="v">${rs(c.net_payable)}</div>${c.net_payable_words ? `<div class="w">${esc(c.net_payable_words)}</div>` : ''}</div>`;
		return h;
	}

	checkHTML(c) {
		if (!c.net_as_per_order) return '';
		const ok = !c.net_difference;
		return `<div class="check"><div class="k">Cross-check with the order</div><div class="msg ${ok ? 'ok' : 'bad'}">${ic(ok ? 'check' : 'alert', 15)}
			${ok ? `Matches the net amount printed on the order (${rs(c.net_as_per_order)}).` : `Differs from the order by ${rs(Math.abs(c.net_difference))} — the order shows ${rs(c.net_as_per_order)}.`}</div></div>`;
	}

	// ---- events ----------------------------------------------------------------
	bind() {
		const root = this.root;
		root.addEventListener('click', (e) => {
			const t = e.target.closest('[data-act]');
			if (!t || !root.contains(t)) { this.closePicks(e); return; }
			this.act(t.dataset.act, t, e);
		});
		root.addEventListener('input', (e) => this.onInput(e));
		root.addEventListener('change', (e) => this.onChange(e));
		root.addEventListener('focusin', (e) => this.onFocusIn(e));
		root.addEventListener('focusout', (e) => this.onFocusOut(e));
		root.addEventListener('keydown', (e) => this.onKey(e));
		root.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('.drop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
		root.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('.drop'); if (z) z.classList.remove('over'); });
		root.addEventListener('drop', (e) => {
			const z = e.target.closest && e.target.closest('.drop');
			if (!z) return;
			e.preventDefault();
			z.classList.remove('over');
			const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
			if (file) this.chooseFile(file);
		});
		if (this.mode === 'mobile') window.addEventListener('popstate', () => this.onPop());
		document.addEventListener('click', (e) => { if (!e.composedPath().includes(this.host)) this.closePicks(); });
	}

	act(a, t, e) {
		const d = this.st.detail;
		switch (a) {
			case 'login': location.href = '/login?redirect-to=' + encodeURIComponent(location.pathname); break;
			case 'alert-x': this.showAlert(''); break;
			case 'retry': this.loadList(true); break;
			case 'retry-letters': this.showLetters(); break;
			case 'section': this.setSection(t.dataset.v); break;
			case 'refresh': this.loadList(true); break;
			case 'more': this.loadList(false); break;
			case 'new': this.selectTab('new'); break;
			case 'tab': this.selectTab(t.dataset.tab); break;
			case 'clear-form': this.clearForm(); break;
			case 'open': this.openDetail(t.dataset.name); break;
			case 'back': this.goBack(); break;
			case 'edit': this.openForm(d.name); break;
			case 'toggle-filters': this.st.list.open = !this.st.list.open; this.$('[data-el=filters]').classList.toggle('open', this.st.list.open); break;
			case 'ftype': this.st.list.f.bill_type = t.dataset.v; this.root.querySelectorAll('[data-act=ftype]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === t.dataset.v))); this.renderFilterBits(); this.loadList(true); break;
			case 'clear': this.clearFilters(); break;
			case 'file-open': { const f = (this.st.view === 'form' && this.st.form && this.st.form.file) || (d.data && d.data.file); if (f) openFile(f.url, f.name); break; }
			case 'lightbox': this.lightbox(d.data && d.data.file && d.data.file.url); break;
			case 'preview-toggle': d.preview = !d.preview; this.renderDetail(); break;
			default: this.formAct(a, t, e);
		}
	}

	clearFilters() {
		const f = this.st.list.f;
		Object.keys(f).forEach((k) => { f[k] = ''; });
		this.renderList();
		this.loadList(true);
	}

	lightbox(url) {
		if (!url) return;
		const ov = this.$('[data-el=overlay]');
		ov.innerHTML = `<div class="lightbox"><button class="btn btn-secondary lb-x" aria-label="Close">${ic('x', 16)}</button><img src="${esc(url)}" alt="Sanction order"></div>`;
		ov.querySelector('.lightbox').onclick = () => { ov.innerHTML = ''; };
	}

	onKey(e) {
		if (e.key === 'Escape') { this.closePicks(); const ov = this.$('[data-el=overlay]'); if (ov && ov.querySelector('.lightbox')) ov.innerHTML = ''; }
		this.pickKey(e);
	}
}
