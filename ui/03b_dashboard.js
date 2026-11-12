
// ---------------------------------------------------------------- dashboard: sanction order bills + fund transfer letters
// Chart rules (dataviz): one hue per series (bills = slot 1, letters = slot 2), thin bars <= 24px with a 4px rounded data end,
// hairline grid, a tooltip on every mark (also on keyboard focus), a table twin for every chart, one filter row on top.
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mLabel = (ym, withYear) => MONTH_NAMES[+ym.slice(5, 7) - 1] + (withYear ? " '" + ym.slice(2, 4) : '');
const mFull = (ym) => MONTH_NAMES[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4);
const trimNum = (x) => {
	const a = Math.abs(x);
	const s = a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(2);
	return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s;
};
/** ₹1.47 Cr / ₹12.3 L / ₹4,500 - the Indian way of reading big amounts. */
function compactInr(n) {
	n = Number(n) || 0;
	const a = Math.abs(n);
	if (a >= 1e7) return '₹' + trimNum(n / 1e7) + ' Cr';
	if (a >= 1e5) return '₹' + trimNum(n / 1e5) + ' L';
	return '₹' + fmt(n);
}
function niceTicks(max) {
	if (!(max > 0)) return { ticks: [0, 1], unit: 1, suffix: '' };
	const raw = max / 4;
	const mag = Math.pow(10, Math.floor(Math.log10(raw)));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => raw <= s);
	const top = Math.ceil(max / step) * step;
	const ticks = [];
	for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
	return max >= 1e7 ? { ticks, unit: 1e7, suffix: ' Cr' } : max >= 1e5 ? { ticks, unit: 1e5, suffix: ' L' } : { ticks, unit: 1, suffix: '' };
}
const tickLabel = (v, t) => (t.unit === 1 ? fmt(v) : trimNum(v / t.unit) + t.suffix);

const DASH_PERIODS = [['all', 'All time'], ['fy', 'This financial year'], ['12m', 'Last 12 months'], ['3m', 'Last 3 months'], ['custom', 'Custom']];
const ymd = (y, m, d) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

Object.assign(App.prototype, {
	// ---- start-up of the hover layer + resize watching ---------------------------------
	initDash() {
		this.tip = this.$('[data-el=tip]');
		const hit = (e) => (e.target && e.target.closest ? e.target.closest('[data-tip-l]') : null);
		this.root.addEventListener('pointerover', (e) => { const t = hit(e); if (t) { this._tipBy = 'pointer'; this.tipShow(t, e.clientX, e.clientY); } else this.tipHide(); });
		this.root.addEventListener('pointermove', (e) => { const t = hit(e); if (t) { this._tipBy = 'pointer'; this.tipShow(t, e.clientX, e.clientY); } });
		this.root.addEventListener('pointerout', (e) => { if (!e.relatedTarget || !hit({ target: e.relatedTarget })) this.tipHide(); });
		this.root.addEventListener('focusin', (e) => { const t = hit(e); if (t) { this._tipBy = 'focus'; const r = t.getBoundingClientRect(); this.tipShow(t, r.left + r.width / 2, r.top); } });
		this.root.addEventListener('focusout', () => this.tipHide());
		window.addEventListener('scroll', () => { if (this._tipBy === 'pointer') this.tipHide(); }, true); // a keyboard-focus tip stays while the browser scrolls the mark into view
		if (window.ResizeObserver) {
			this._dashW = 0;
			new ResizeObserver(debounce(() => {
				const w = this.host.clientWidth;
				if (this.st.section === 'dashboard' && this.st.dash.data && Math.abs(w - this._dashW) > 8) this.paintCharts();
			}, 140)).observe(this.host);
		}
	},

	tipShow(t, x, y) {
		const tip = this.tip;
		tip.querySelector('[data-t=v]').textContent = t.dataset.tipV || '';
		tip.querySelector('[data-t=l]').textContent = t.dataset.tipL || '';
		tip.querySelector('[data-t=s]').textContent = t.dataset.tipS || '';
		tip.hidden = false;
		const w = tip.offsetWidth, h = tip.offsetHeight;
		let left = x + 14, top = y - h - 12;
		if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 14);
		if (top < 8) top = y + 18;
		tip.style.left = left + 'px';
		tip.style.top = top + 'px';
	},

	tipHide() { if (this.tip) this.tip.hidden = true; },

	// ---- period / frame ----------------------------------------------------------------
	periodRange() {
		const D = this.st.dash;
		const t = this.st.ctx.today; // yyyy-mm-dd
		const y = +t.slice(0, 4), m = +t.slice(5, 7);
		if (D.period === 'fy') return { from: ymd(m >= 4 ? y : y - 1, 4, 1), to: t };
		if (D.period === '12m') { const idx = y * 12 + (m - 1) - 11; return { from: ymd(Math.floor(idx / 12), (idx % 12) + 1, 1), to: t }; }
		if (D.period === '3m') { const idx = y * 12 + (m - 1) - 2; return { from: ymd(Math.floor(idx / 12), (idx % 12) + 1, 1), to: t }; }
		if (D.period === 'custom') return { from: D.from || '', to: D.to || '' };
		return { from: '', to: '' };
	},

	async showDashboard() {
		if (!this.dashReady) { this.renderDashFrame(); this.dashReady = true; }
		this.loadDashboard();
	},

	renderDashFrame() {
		const D = this.st.dash;
		const ctx = this.st.ctx;
		const presets = DASH_PERIODS.map(([v, l]) => `<button type="button" data-act="dash-period" data-v="${v}" aria-pressed="${D.period === v}">${l}</button>`).join('');
		this.$('[data-el=dash]').innerHTML = `
			<div class="dash-filters">
				<div class="seg" role="group" aria-label="Period">${presets}</div>
				<div class="dash-custom" data-el="dashcustom"${D.period === 'custom' ? '' : ' hidden'}>
					<div class="input sm"><input type="date" data-dash="from" value="${esc(D.from)}" aria-label="From date"></div>
					<span class="sub-dash">to</span>
					<div class="input sm"><input type="date" data-dash="to" value="${esc(D.to)}" aria-label="To date"></div>
				</div>
				<span class="spacer"></span>
				${ctx.can_create ? `<button type="button" class="btn btn-secondary btn-sm" data-act="dash-new-bill">${ic('plus', 14)} New bill</button>` : ''}
				${ctx.escrow ? `<button type="button" class="btn btn-secondary btn-sm" data-act="dash-new-letter">${ic('plus', 14)} New letter</button>` : ''}
			</div>
			<div class="dash-body" data-el="dashbody"><div class="loading"><span class="spin"></span> Loading the dashboard...</div></div>`;
	},

	async loadDashboard() {
		const D = this.st.dash;
		const req = ++this.reqs.dash;
		const body = this.$('[data-el=dashbody]');
		D.loading = true;
		if (body && D.data) body.classList.add('busy'); // hold the previous render while refetching - no skeleton flash
		const r = this.periodRange();
		try {
			const data = await post('get_dashboard', { from_date: r.from, to_date: r.to });
			if (req !== this.reqs.dash) return;
			D.data = data;
			D.error = '';
		} catch (e) {
			if (req !== this.reqs.dash) return;
			D.error = e.message;
		}
		D.loading = false;
		this.renderDashBody();
	},

	renderDashBody() {
		const D = this.st.dash;
		const el = this.$('[data-el=dashbody]');
		if (!el) return;
		el.classList.remove('busy');
		if (D.error) { el.innerHTML = this.errorCard(D.error, 'dash'); return; }
		if (!D.data) return;
		const d = D.data;
		el.innerHTML = this.dashBillsHTML(d.bills) + (d.letters ? this.dashLettersHTML(d.letters) : '');
		this.paintCharts();
	},

	// ---- section markup ------------------------------------------------------------------
	tile(label, value, sub, full) {
		return `<div class="card tile"><span class="accent"></span><div class="k">${esc(label)}</div><div class="v" title="${esc(full || '')}">${value}</div><div class="s">${sub || '&nbsp;'}</div></div>`;
	},

	card(id, title, sub, toggle) {
		const v = this.st.dash.views[id] || 'chart';
		const seg = toggle ? `<div class="seg sm" role="group" aria-label="View"><button type="button" data-act="dash-view" data-chart="${id}" data-v="chart" aria-pressed="${v === 'chart'}">Chart</button><button type="button" data-act="dash-view" data-chart="${id}" data-v="table" aria-pressed="${v === 'table'}">Table</button></div>` : '';
		return `<div class="card chartcard"><span class="accent"></span><div class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>${seg}</div><div class="cbody" data-body="${id}"></div></div>`;
	},

	dashBillsHTML(B) {
		const head = `<div class="dsec-h"><i style="background:var(--viz-1)"></i><h2>Sanction order bills</h2><button type="button" class="btn btn-ghost btn-sm go" data-act="dash-go-bills">Open saved bills ${ic('chevR', 14)}</button></div>`;
		const tiles = `<div class="tiles">
			${this.tile('Bills', fmt(B.count), `RA ${fmt(B.ra)} · PA ${fmt(B.pa)}`)}
			${this.tile('Bill amount', compactInr(B.bill_amount), `Sanctioned ${compactInr(B.sanction_amount)}`, rs(B.bill_amount).replace(/<[^>]*>/g, ''))}
			${this.tile('Net payable', compactInr(B.net_payable), `incl. GST ${compactInr(B.gst)}`, rs(B.net_payable).replace(/<[^>]*>/g, ''))}
			${this.tile('Deductions', compactInr(B.deductions), B.additions ? `+ ${compactInr(B.additions)} additions` : 'TDS, cess, retention ...', rs(B.deductions).replace(/<[^>]*>/g, ''))}
		</div>`;
		const warn = B.differs ? `<div class="alert warn" style="margin-top:14px">${ic('alert', 18)}<div><b>${fmt(B.differs)} bill${B.differs > 1 ? 's' : ''} differ${B.differs > 1 ? '' : 's'}</b> from the net amount printed on the order. <button type="button" class="lnk" data-act="dash-go-bills">Review in Saved bills</button></div></div>` : '';
		if (!B.count) {
			return `<section class="dsec">${head}${tiles}<div class="card" style="margin-top:16px"><span class="accent"></span><div class="empty"><span class="e-ic">${ic('receipt', 22)}</span><b>No bills in this period</b>Pick another period, or add a bill.${this.st.ctx.can_create ? `<div style="margin-top:14px"><button type="button" class="btn btn-primary" data-act="dash-new-bill">${ic('plus', 16)} New bill</button></div>` : ''}</div></div></section>`;
		}
		return `<section class="dsec">${head}${tiles}${warn}<div class="dgrid">
			${this.card('bm', 'Net payable by month', 'Last 12 months with bills, by bill date', true)}
			${this.card('ba', 'By department', 'Net payable and number of bills', true)}
			${this.card('bp', 'Top projects', 'Net payable, largest first', true)}
			${this.card('br', 'Latest bills', 'Open one to see its calculation')}
		</div></section>`;
	},

	dashLettersHTML(L) {
		const head = `<div class="dsec-h"><i style="background:var(--viz-2)"></i><h2>Fund transfer letters</h2><button type="button" class="btn btn-ghost btn-sm go" data-act="dash-go-letters">Open letters ${ic('chevR', 14)}</button></div>`;
		const share = (v) => (L.credit ? ` · ${trimNum((v / L.credit) * 100)}% of credit` : '');
		const tiles = `<div class="tiles">
			${this.tile('Letters', fmt(L.count), `${fmt(L.breakup_count)} with a breakup letter`)}
			${this.tile('Credit received', compactInr(L.credit), 'in the TPPL-JEW-JV escrow', rs(L.credit).replace(/<[^>]*>/g, ''))}
			${this.tile('To JEW account', compactInr(L.jew), 'letter 1' + share(L.jew), rs(L.jew).replace(/<[^>]*>/g, ''))}
			${this.tile('To TPPL escrow', compactInr(L.tppl), 'letter 1' + share(L.tppl), rs(L.tppl).replace(/<[^>]*>/g, ''))}
		</div>`;
		if (!L.count) {
			return `<section class="dsec">${head}${tiles}<div class="card" style="margin-top:16px"><span class="accent"></span><div class="empty"><span class="e-ic">${ic('file', 22)}</span><b>No letters in this period</b>Letters you save appear here.<div style="margin-top:14px"><button type="button" class="btn btn-primary" data-act="dash-new-letter">${ic('plus', 16)} New letter</button></div></div></div></section>`;
		}
		return `<section class="dsec">${head}${tiles}<div class="dgrid">
			${this.card('lm', 'Credit received by month', 'Last 12 months with letters, by letter date', true)}
			${this.card('ls', 'Where the credit went', 'Letter 1 split of the credit, and the breakup letters', true)}
			${this.card('lr', 'Latest letters', 'Open one to view or download its PDF')}
		</div></section>`;
	},

	// ---- painting the cards (needs the real width, so it runs after the markup is in) -----
	paintCharts() {
		this._dashW = this.host.clientWidth;
		this.qa('[data-body]').forEach((b) => this.paintCard(b.dataset.body));
	},

	qa(sel) { return [...this.root.querySelectorAll(sel)]; },

	paintCard(id) {
		const body = this.$(`[data-body="${id}"]`);
		if (!body) return;
		const d = this.st.dash.data;
		const table = (this.st.dash.views[id] || 'chart') === 'table';
		const w = Math.max(240, body.clientWidth - 36);
		let html = '';
		if (id === 'bm') html = table ? this.tblMonths(d.bills.by_month, 'net_payable', 'Net payable') : this.columnChart(d.bills.by_month, 'net_payable', 'var(--viz-1)', 'bill', w);
		else if (id === 'ba') html = table ? this.tblRank(d.bills.by_authority, 'Department') : this.rankBars(d.bills.by_authority, 'authority');
		else if (id === 'bp') html = table ? this.tblRank(d.bills.by_project, 'Project') : this.rankBars(d.bills.by_project, 'project');
		else if (id === 'br') html = this.recentBills(d.bills.recent);
		else if (id === 'lm') html = table ? this.tblMonths(d.letters.by_month, 'credit', 'Credit received') : this.columnChart(d.letters.by_month, 'credit', 'var(--viz-2)', 'letter', w);
		else if (id === 'ls') html = this.letterSplit(d.letters, table, w);
		else if (id === 'lr') html = this.recentLetters(d.letters.recent);
		body.innerHTML = html;
	},

	// column chart of one series over months
	columnChart(rows, key, color, noun, w) {
		if (!rows.length) return `<div class="empty-chart">No data in this period.</div>`;
		const H = 224, top = 22, bottom = 28;
		const max = Math.max(...rows.map((r) => r[key]), 0);
		const t = niceTicks(max);
		const ymax = t.ticks[t.ticks.length - 1] || 1;
		const left = Math.max(...t.ticks.map((v) => tickLabel(v, t).length)) * 6.4 + 12;
		const plotW = Math.max(120, w - left - 4), plotH = H - top - bottom;
		const slot = plotW / rows.length, bw = Math.min(24, slot * 0.62);
		const yOf = (v) => top + plotH - (v / ymax) * plotH;
		const everyOther = slot < 34;
		let g = '';
		t.ticks.forEach((v) => {
			const y = yOf(v);
			g += `<line x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}" class="${v === 0 ? 'base' : 'grid'}"/><text x="${left - 8}" y="${y + 3.5}" text-anchor="end" class="ax">${esc(tickLabel(v, t))}</text>`;
		});
		const maxIdx = rows.findIndex((r) => r[key] === max && max > 0);
		rows.forEach((r, i) => {
			const cx = left + slot * i + slot / 2, x = cx - bw / 2, v = r[key], h = (v / ymax) * plotH, y = top + plotH - h;
			const yr = (i === 0 || r.month.slice(5) === '01');
			const cnt = r.count || 0;
			let bar = '';
			if (v > 0) {
				const rad = Math.min(4, h);
				bar = `<path class="bar" fill="${color}" d="M${x},${top + plotH} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + bw - rad} Q${x + bw},${y} ${x + bw},${y + rad} V${top + plotH} Z"/>`;
			}
			const lab = i === maxIdx ? `<text x="${cx}" y="${y - 6}" text-anchor="middle" class="dl">${esc(compactInr(v))}</text>` : '';
			const xl = !everyOther || i % 2 === 0 ? `<text x="${cx}" y="${H - 9}" text-anchor="middle" class="ax">${esc(mLabel(r.month, yr))}</text>` : '';
			g += `<g class="col" tabindex="0" role="img" aria-label="${esc(mFull(r.month) + ': ' + compactInr(v) + ', ' + cnt + ' ' + noun + (cnt === 1 ? '' : 's'))}" data-tip-v="${esc(rs(v).replace(/<[^>]*>/g, ''))}" data-tip-l="${esc(mFull(r.month))}" data-tip-s="${cnt} ${noun}${cnt === 1 ? '' : 's'}">${bar}<rect class="hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH + bottom}"/>${lab}${xl}</g>`;
		});
		return `<svg class="chart" viewBox="0 0 ${w} ${H}" width="100%" height="${H}" role="group" aria-label="Column chart by month">${g}</svg>`;
	},

	// ranked horizontal bars (one hue; click a row to open the saved bills filtered to it)
	rankBars(rows, kind) {
		const max = Math.max(...rows.map((r) => r.net_payable), 0) || 1;
		return `<div class="rank">${rows.map((r) => {
			const other = /^Other \(/.test(r.label) || r.label === 'Not set';
			const pct = Math.max(r.net_payable > 0 ? 1.5 : 0, (r.net_payable / max) * 100);
			const act = other ? '' : ` data-act="dash-filter" data-kind="${kind}" data-v="${esc(r.label)}"`;
			return `<div class="rank-row" tabindex="0"${act} data-tip-v="${esc(rs(r.net_payable).replace(/<[^>]*>/g, ''))}" data-tip-l="${esc(r.label)}" data-tip-s="${r.count} bill${r.count === 1 ? '' : 's'}">
				<div class="rk-label" title="${esc(r.label)}">${esc(r.label)}</div>
				<div class="rk-track"><div class="rk-bar${other ? ' muted' : ''}" style="width:${pct}%"></div></div>
				<div class="rk-val">${esc(compactInr(r.net_payable))}<small>${r.count} bill${r.count === 1 ? '' : 's'}</small></div></div>`;
		}).join('')}</div>`;
	},

	// the credit of the letters: one whole split in three (tall segmented bar) + the breakup letters as rows
	letterSplit(L, table, w) {
		const parts = [
			{ label: 'To JEW account (letter 1)', value: L.jew, color: 'var(--viz-1)', cls: '' },
			{ label: 'To TPPL escrow (letter 1)', value: L.tppl, color: 'var(--viz-2)', cls: '' },
			{ label: 'Not moved by the letters', value: L.unallocated, color: 'var(--viz-3)', cls: 'dk' },
		];
		const total = L.credit || 1;
		const pctText = (v) => trimNum((v / total) * 100) + '%';
		const breakup = L.breakup_count
			? `<div class="kvl"><div class="row"><b>Breakup letters (${fmt(L.breakup_count)})</b><span></span></div>
				<div class="row"><span>To JEW account</span><b>${esc(compactInr(L.breakup_jew))}</b></div>
				<div class="row"><span>To TPPL by NEFT</span><b>${esc(compactInr(L.breakup_neft))}</b></div></div>` : '';
		if (table) {
			return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Part</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>${parts.map((p) => `<tr><td>${esc(p.label)}</td><td class="amt">${rs(p.value)}</td><td class="amt">${pctText(p.value)}</td></tr>`).join('')}</tbody></table></div>${breakup}`;
		}
		const blocks = parts.filter((p) => p.value > 0).map((p) => {
			const share = p.value / total;
			const text = share * w >= 64 ? pctText(p.value) : '';
			return `<div class="blk ${p.cls}" style="flex:${p.value} 1 0;background:${p.color}" tabindex="0" data-tip-v="${esc(rs(p.value).replace(/<[^>]*>/g, ''))}" data-tip-l="${esc(p.label)}" data-tip-s="${pctText(p.value)} of the credit">${text}</div>`;
		}).join('');
		return `<div class="tall" role="img" aria-label="Credit split: ${esc(parts.map((p) => p.label + ' ' + pctText(p.value)).join(', '))}">${blocks}</div>
			<ul class="legend">${parts.filter((p) => p.value > 0).map((p) => `<li><i style="background:${p.color}"></i>${esc(p.label)}</li>`).join('')}</ul>${breakup}`;
	},

	tblMonths(rows, key, label) {
		if (!rows.length) return `<div class="empty-chart">No data in this period.</div>`;
		return `<div class="table-wrap"><table class="tbl"><thead><tr><th>Month</th><th class="r">Count</th><th class="r">${esc(label)}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(mFull(r.month))}</td><td class="amt">${fmt(r.count)}</td><td class="amt">${rs(r[key])}</td></tr>`).join('')}</tbody></table></div>`;
	},

	tblRank(rows, label) {
		return `<div class="table-wrap"><table class="tbl"><thead><tr><th>${esc(label)}</th><th class="r">Bills</th><th class="r">Net payable</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="amt">${fmt(r.count)}</td><td class="amt">${rs(r.net_payable)}</td></tr>`).join('')}</tbody></table></div>`;
	},

	recentBills(rows) {
		if (!rows.length) return `<div class="empty-chart">No bills yet.</div>`;
		return `<div class="table-wrap"><table class="tbl"><tbody>${rows.map((r) => `<tr class="clickable" data-act="dash-open-bill" data-name="${esc(r.name)}">
			<td><span class="main">${esc(r.project)}</span><span class="sub">${esc(r.bill_type_code)} ${esc(r.bill_no)} · ${esc(dmy(r.bill_date))}${r.sanction_authority ? ' · ' + esc(r.sanction_authority) : ''}</span></td>
			<td class="amt">${rs(r.net_payable)}</td></tr>`).join('')}</tbody></table></div>`;
	},

	recentLetters(rows) {
		if (!rows.length) return `<div class="empty-chart">No letters yet.</div>`;
		return `<div class="table-wrap"><table class="tbl"><tbody>${rows.map((r) => `<tr class="clickable" data-act="dash-open-letter" data-name="${esc(r.name)}">
			<td><span class="main mono">${esc(r.name)}</span><span class="sub">${esc(dmy(r.transfer_date))} · ${r.include_breakup ? '2 letters' : 'Letter 1 only'} · ${esc(r.owner_name)}</span></td>
			<td class="amt">${rs(r.credit_amount)}</td></tr>`).join('')}</tbody></table></div>`;
	},

	// ---- actions -------------------------------------------------------------------------
	dashDate(el) {
		const D = this.st.dash;
		D[el.dataset.dash] = el.value;
		if (D.from && D.to && D.from > D.to) { this.toast('The From date is after the To date.', 'err'); return; }
		this.loadDashboard();
	},

	async dashAct(a, t) {
		const D = this.st.dash;
		switch (a) {
			case 'dash-retry': this.loadDashboard(); break;
			case 'dash-period': {
				D.period = t.dataset.v;
				this.qa('[data-act=dash-period]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === D.period)));
				this.$('[data-el=dashcustom]').hidden = D.period !== 'custom';
				if (D.period === 'custom' && !(D.from && D.to)) break; // wait for both dates
				this.loadDashboard();
				break;
			}
			case 'dash-view': D.views[t.dataset.chart] = t.dataset.v; this.qa(`[data-act=dash-view][data-chart="${t.dataset.chart}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === t.dataset.v))); this.paintCard(t.dataset.chart); break;
			case 'dash-new-bill': await this.setSection('bills'); this.selectTab('new'); break;
			case 'dash-go-bills': await this.setSection('bills'); this.selectTab('saved'); break;
			case 'dash-new-letter': await this.setSection('letters'); if (this.letters && this.letters.switch_tab) this.letters.switch_tab('new'); break;
			case 'dash-go-letters': await this.setSection('letters'); if (this.letters && this.letters.switch_tab) this.letters.switch_tab('saved'); break;
			case 'dash-open-bill': await this.setSection('bills'); this.stack = ['list']; this.openDetail(t.dataset.name); break;
			case 'dash-open-letter': await this.setSection('letters'); if (this.letters && this.letters.open_detail) this.letters.open_detail(t.dataset.name); break;
			case 'dash-filter': {
				const f = this.st.list.f;
				Object.keys(f).forEach((k) => { f[k] = ''; });
				if (t.dataset.kind === 'authority') f.authority = t.dataset.v;
				else { f.project = t.dataset.v; f.project_name = t.dataset.v; }
				await this.setSection('bills');
				this.stack = ['list'];
				this.view('list');
				this.loadList(true);
				break;
			}
			default: break;
		}
	},
});
