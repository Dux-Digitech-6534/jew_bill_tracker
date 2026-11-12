
// ---------------------------------------------------------------- the bill form (new + edit)
const CALC_FIELDS = new Set(['base_amount', 'gst_rate', 'sgst_amount', 'cgst_amount', 'net_as_per_order', 'contract_value', 'work_done_till_date', 'previous_payments']);
const TABLES = {
	work_lines: { title: 'ULB / Particular', cols: ['particular', 'contract_amount', 'amount'], add: 'Add ULB / work line', ph: 'e.g. Satai' },
	additions: { title: 'Particular', cols: ['particular', 'rate', 'amount'], add: 'Add addition', ph: 'e.g. Release of withheld amount' },
	deductions: { title: 'Particular', cols: ['particular', 'rate', 'amount'], add: 'Add deduction', ph: 'e.g. Labour Cess' },
};
const rowBlank = (r) => !String(r.particular || '').trim() && !num(r.rate) && !num(r.amount) && !num(r.contract_amount);
const newRow = () => ({ particular: '', rate: '', amount: '', contract_amount: '', auto: false });

Object.assign(App.prototype, {
	blankData() {
		const ctx = this.st.ctx;
		return {
			name: null, project: '', project_name: '', bill_type: '', bill_no: '', bill_date: ctx.today, bill_amount: '',
			sanction_authority: '', sanction_no: '', sanction_date: '', package_no: '', sanction_amount: '', sanction_order: '',
			base_amount: '', gst_rate: String(ctx.default_gst_rate || 18), sgst_amount: '', cgst_amount: '',
			work_lines: [], additions: [], deductions: [], net_as_per_order: '', contract_value: '', work_done_till_date: '', previous_payments: '', remarks: '',
		};
	},

	dataFromBill(b) {
		const rows = (list, withRate) => (list || []).map((r) => ({
			particular: r.particular || '', rate: r.rate ? rate(r.rate) : '', amount: money0(r.amount), contract_amount: money0(r.contract_amount), auto: !!(withRate && r.rate),
		}));
		return {
			name: b.name, project: b.project, project_name: b.project_name, bill_type: b.bill_type, bill_no: b.bill_no || '', bill_date: b.bill_date || '',
			bill_amount: money0(b.bill_amount), sanction_authority: b.sanction_authority || '', sanction_no: b.sanction_no || '', sanction_date: b.sanction_date || '',
			package_no: b.package_no || '', sanction_amount: money0(b.sanction_amount), sanction_order: b.sanction_order || '',
			base_amount: money0(b.base_amount), gst_rate: b.gst_rate ? rate(b.gst_rate) : '', sgst_amount: money0(b.sgst_amount), cgst_amount: money0(b.cgst_amount),
			work_lines: rows(b.work_lines), additions: rows(b.additions, true), deductions: rows(b.deductions, true),
			net_as_per_order: money0(b.net_as_per_order), contract_value: money0(b.contract_value), work_done_till_date: money0(b.work_done_till_date),
			previous_payments: money0(b.previous_payments), remarks: b.remarks || '',
		};
	},

	async openForm(name) {
		this.st.calc = null;
		this.st.form = { name: name || null, d: this.blankData(), file: null, uploading: false, busy: false, dirty: false, errors: {}, loading: !!name };
		this.push('form');
		this.view('form');
		if (!name) return;
		try {
			const b = await post('get_bill', { name });
			this.st.form.d = this.dataFromBill(b);
			this.st.form.file = b.file ? { url: b.file.url, name: b.file.name, size: b.file.size, is_image: b.file.is_image, is_pdf: b.file.is_pdf } : null;
			this.st.form.loading = false;
			this.renderForm();
		} catch (e) {
			this.st.form.loading = false;
			this.$view.innerHTML = `<button class="btn btn-ghost back" data-act="back">${ic('chevL', 16)} Back</button>` + this.errorCard(e.message);
		}
	},

	// ---- markup ------------------------------------------------------------------
	renderForm() {
		const f = this.st.form;
		const ctx = this.st.ctx;
		// a NEW bill is the "New bill" tab (no back link, no title); an EDIT opens under "Saved bills"
		const back = f.name ? `<button class="btn btn-ghost back" data-act="back">${ic('chevL', 16)} Back to bill</button>` : '';
		if (f.loading) { this.$view.innerHTML = back + `<div class="loading"><span class="spin"></span> Opening the bill...</div>`; return; }
		const d = f.d;
		const input = (field, o) => {
			o = o || {};
			return `<div class="input${o.money ? ' mono-in' : ''}" data-err="${field}">${o.pre ? `<span class="pre">${o.pre}</span>` : ''}<input data-f="${field}" ${o.money ? 'data-money inputmode="decimal" class="mono right"' : ''} ${o.type ? `type="${o.type}"` : 'type="text"'} ${o.attrs || ''} placeholder="${esc(o.ph || '')}" value="${esc(d[field])}" autocomplete="off">${o.post ? `<span class="pre">${o.post}</span>` : ''}</div><div class="hint" data-hint="${field}"></div>`;
		};
		const field = (label, inner, o) => `<div class="field${o && o.span ? ' span2' : ''}"><label class="lbl"><span>${label}${o && o.req ? '<span class="req">*</span>' : ''}</span>${(o && o.link) || ''}</label>${inner}</div>`;
		const accept = (ctx.file_types || []).join(',') + ',image/*,application/pdf';
		const seg = (fname, opts) => `<div class="seg ${fname === 'bill_type' ? 'full' : ''}" data-err="${fname}" role="group">${opts.map(([v, l]) => `<button type="button" data-act="set" data-f="${fname}" data-v="${esc(v)}" aria-pressed="${d[fname] === v}">${esc(l)}</button>`).join('')}</div><div class="hint" data-hint="${fname}"></div>`;
		const hasProgress = num(d.contract_value) || num(d.work_done_till_date) || num(d.previous_payments);

		this.$view.innerHTML = `${back}
			${f.name ? `<div class="f-title"><h2>Edit bill</h2><span class="pill">${esc(f.name)}</span></div>` : ''}
			<div data-el="ferr"></div>
			<div class="f-grid"><div class="f-main" data-el="fmain">
				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Bill</h2><div class="sub">Which project, and which running / part bill</div></div></div><div class="card-body"><div class="cols2">
					${field('Project', `<div class="pick" data-pick="form"><div class="input" data-err="project"><input data-el="pick-q" placeholder="Search the project" value="${esc(d.project_name || '')}" autocomplete="off"></div><div class="pick-list" hidden></div></div><div class="hint" data-hint="project"></div>`, { req: 1, span: 1 })}
					${field('Bill type', seg('bill_type', [['RA - Running Account', 'RA · Running'], ['PA - Part Account', 'PA · Part']]), { req: 1 })}
					${field('Bill no', input('bill_no', { ph: 'e.g. 11' }), { req: 1 })}
					${field('Bill date', input('bill_date', { type: 'date' }))}
					${field('Bill amount', input('bill_amount', { money: 1, pre: '₹', ph: '0' }), { req: 1 })}
				</div></div></div>

				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Sanction order</h2><div class="sub">Upload the order and note its details</div></div></div><div class="card-body"><div class="cols2">
					<div class="field span2"><label class="lbl"><span>Sanction order file<span class="req">*</span></span></label><div data-el="filezone"></div><div class="hint" data-hint="file"></div></div>
					${field('Sanctioning department', seg('sanction_authority', (ctx.authorities || []).map((a) => [a, a])), { span: 1 })}
					${field('Package / agreement no', input('package_no', { ph: 'e.g. 6-J' }))}
					${field('Sanction order no', input('sanction_no', { ph: 'e.g. PMU/F&A/1492' }))}
					${field('Sanction order date', input('sanction_date', { type: 'date' }))}
					${field('Sanction amount', input('sanction_amount', { money: 1, pre: '₹', ph: '0' }), { link: '<button type="button" class="lnk" data-act="use-total">Use bill total</button>' })}
				</div></div></div>

				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Work-wise breakup</h2><div class="sub">Optional — ULB / particulars with their amounts. The work value is their total.</div></div></div>
					<div class="card-body"><div data-el="tbl-work_lines"></div></div></div>

				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Payment calculation</h2><div class="sub">Give a rate (%) and the amount is worked out; leave the rate empty to type the amount.</div></div></div><div class="card-body">
					<div class="cols2">
						${field('Work value (before GST)', input('base_amount', { money: 1, pre: '₹', ph: '0' }).replace('class="mono right"', 'class="mono right" data-el="base"') , { link: '<span data-el="base-tag"></span>' })}
						${field('GST rate', input('gst_rate', { post: '%', ph: '18', attrs: 'inputmode="decimal"' }).replace('<div class="hint" data-hint="gst_rate"></div>', '<div class="hint">Empty it to type SGST / CGST yourself.</div>'))}
						${field('SGST', input('sgst_amount', { money: 1, pre: '₹', ph: '0' }))}
						${field('CGST', input('cgst_amount', { money: 1, pre: '₹', ph: '0' }))}
					</div>
					<div class="sub-h"><h3>Additions</h3></div><div data-el="tbl-additions"></div>
					<div class="sub-h"><h3>Deductions</h3><button type="button" class="btn btn-secondary btn-sm" data-act="preset-ded" data-el="preset-btn"></button></div><div data-el="tbl-deductions"></div>
				</div></div>

				<details class="card collapse"${hasProgress ? ' open' : ''}><summary><div><h2>Contract &amp; progress</h2><div class="sub">Optional — for orders that carry the contract summary (Jal Nigam)</div></div><span class="chev">${ic('chevR', 18)}</span></summary>
					<div class="card-body"><div class="cols2">
						${field('Contract value (after variation)', input('contract_value', { money: 1, pre: '₹', ph: '0' }))}
						${field('Work done till date', input('work_done_till_date', { money: 1, pre: '₹', ph: '0' }))}
						${field('Previous bill payments', input('previous_payments', { money: 1, pre: '₹', ph: '0' }))}
						<div class="field"><label class="lbl"><span>Worked out</span></label><div class="hint" data-el="progress-out" style="margin-top:2px"></div></div>
					</div></div></details>

				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Remarks</h2></div></div><div class="card-body">
					<div class="input area"><textarea data-f="remarks" rows="3" placeholder="Anything to remember about this bill">${esc(d.remarks)}</textarea></div></div></div>
			</div>
			<div class="f-side">
				<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Net payable</h2><div class="sub">Updates as you type</div></div></div>
					<div data-el="summary"></div>
					<div class="check"><div class="k">Cross-check with the order</div>
						<div class="input mono-in" data-err="net_as_per_order"><span class="pre">₹</span><input data-f="net_as_per_order" data-money inputmode="decimal" class="mono right" placeholder="Net amount printed on the order" value="${esc(d.net_as_per_order)}"></div>
						<div class="msg idle" data-el="check-msg"></div></div></div>
				<div class="f-actions"><button type="button" class="btn btn-secondary" data-act="${f.name ? 'back' : 'clear-form'}">${f.name ? 'Cancel' : 'Clear form'}</button><button type="button" class="btn btn-primary" data-act="save" data-el="save">${f.name ? 'Save changes' : 'Save bill'}</button></div>
			</div></div>
			<div class="f-bar"><div class="nb"><div class="k">Net payable</div><div class="v" data-el="bar-net">₹ 0</div></div><button type="button" class="btn btn-primary" data-act="save" data-el="save">${f.name ? 'Save changes' : 'Save bill'}</button></div>
			<input type="file" hidden data-el="fileinput" accept="${esc(accept)}"><input type="file" hidden data-el="camerainput" accept="image/*" capture="environment">`;
		this.renderFileZone();
		this.renderTables();
		this.renderSummary();
		this.renderSancHint();
		this.scheduleCalc(0);
	},

	renderFileZone() {
		const z = this.$('[data-el=filezone]');
		if (!z) return;
		const f = this.st.form;
		const camera = this.mode === 'mobile' || (window.matchMedia && matchMedia('(pointer: coarse)').matches);
		if (f.uploading) {
			z.innerHTML = `<div class="drop has"><div class="file-row"><span class="fi"><span class="spin" style="border-color:var(--iris-tint);border-top-color:var(--iris)"></span></span><div class="fn"><b>Uploading...</b><span>${esc(f.uploadName || '')}</span></div></div><div class="prog"><i></i></div></div>`;
		} else if (f.file) {
			z.innerHTML = `<div class="drop has" data-err="file"><div class="file-row"><span class="fi">${ic(f.file.is_image ? 'image' : 'file', 20)}</span>
				<div class="fn"><b>${esc(f.file.name)}</b><span>${esc([(f.file.name.split('.').pop() || '').toUpperCase(), fileSize(f.file.size)].filter(Boolean).join(' · '))}</span></div>
				<button type="button" class="btn btn-ghost btn-sm" data-act="file-open">${ic('eye', 14)} View</button>
				<button type="button" class="btn btn-secondary btn-sm" data-act="pick-file">Replace</button></div></div>`;
		} else {
			z.innerHTML = `<div class="drop" data-err="file"><span class="d-ic">${ic('upload', 22)}</span><b>Upload the sanction order</b>
				<p>PDF or a clear photo · up to ${esc(this.st.ctx.max_file_mb)} MB${this.mode === 'desk' ? ' · you can drop the file here' : ''}</p>
				<div class="btns"><button type="button" class="btn btn-secondary" data-act="pick-file">${ic('file', 15)} Choose file</button>${camera ? `<button type="button" class="btn btn-secondary" data-act="pick-cam">${ic('camera', 15)} Take photo</button>` : ''}</div></div>`;
		}
	},

	renderTables() {
		['work_lines', 'additions', 'deductions'].forEach((k) => this.renderTable(k));
		this.renderPresetUi();
	},

	renderTable(kind) {
		const el = this.$(`[data-el=tbl-${kind}]`);
		if (!el) return;
		const cfg = TABLES[kind];
		const rows = this.st.form.d[kind];
		const isWork = kind === 'work_lines';
		const heads = isWork ? ['ULB / Particular', 'Contract amount', 'Bill amount'] : ['Particular', 'Rate %', 'Amount'];
		const cell = (r, i, k, o) => {
			const ro = k === 'amount' && r.auto;
			const isMoney = k !== 'particular' && k !== 'rate';
			return `<div class="input${isMoney ? ' mono-in' : ''}${ro ? ' ro' : ''}"><input data-t="${kind}" data-i="${i}" data-k="${k}" ${isMoney ? 'data-money class="mono right"' : k === 'rate' ? 'class="mono right"' : ''}
				${isMoney || k === 'rate' ? 'inputmode="decimal"' : ''} ${ro ? 'readonly' : ''} placeholder="${esc(o || '')}" value="${esc(r[k])}" autocomplete="off" aria-label="${esc(k)}"></div>`;
		};
		const html = rows.map((r, i) => `<div class="trow ${isWork ? 'k-work' : 'k-adj'}">
			<div class="c-part"><div class="cell-l">${heads[0]}</div>${cell(r, i, 'particular', cfg.ph)}</div>
			<div class="c-rate"><div class="cell-l">${heads[1]}</div>${isWork ? cell(r, i, 'contract_amount', '0') : cell(r, i, 'rate', '%')}</div>
			<div class="c-amt"><div class="cell-l">${heads[2]}</div>${cell(r, i, 'amount', '0')}</div>
			<div class="c-x"><button type="button" class="tr-x" data-act="del-row" data-t="${kind}" data-i="${i}" aria-label="Remove line">${ic('x', 15)}</button></div></div>`).join('');
		const head = rows.length ? `<div class="trow-h ${isWork ? 'k-work' : 'k-adj'}"><span>${heads[0]}</span><span class="r">${heads[1]}</span><span class="r">${heads[2]}</span><span></span></div>` : '';
		const empty = rows.length ? '' : `<div class="t-empty">${isWork ? 'No lines yet — add the ULBs / particulars shown in the order, or just type the work value below.' : kind === 'additions' ? 'None.' : 'None yet — add the standard deductions or your own lines.'}</div>`;
		el.innerHTML = `<div class="trows">${head}${html}${empty}</div><div class="t-foot" data-el="foot-${kind}"></div>`;
		this.renderFoot(kind);
	},

	renderFoot(kind) {
		const el = this.$(`[data-el=foot-${kind}]`);
		if (!el) return;
		const p = this.presets();
		const have = new Set(this.st.form.d[kind].map((r) => String(r.particular || '').trim().toLowerCase()));
		let chips = '';
		if (kind === 'deductions') chips = (p.manual_deductions || []).filter((n) => !have.has(n.toLowerCase())).map((n) => `<button type="button" class="chip" data-act="chip-add" data-t="${kind}" data-p="${esc(n)}">${ic('plus', 12)} ${esc(n)}</button>`).join('');
		if (kind === 'additions') chips = (p.manual_additions || []).filter((n) => !have.has(n.toLowerCase())).map((n) => `<button type="button" class="chip" data-act="chip-add" data-t="${kind}" data-p="${esc(n)}">${ic('plus', 12)} ${esc(n)}</button>`).join('');
		const addBtn = `<button type="button" class="chip" data-act="add-row" data-t="${kind}">${ic('plus', 12)} ${TABLES[kind].add}</button>`;
		el.innerHTML = `<div class="chips">${chips}${addBtn}</div>${kind === 'work_lines' ? '<span class="tot" data-el="work-total"></span>' : ''}`;
		if (kind === 'work_lines') this.renderWorkTotal();
	},

	renderPresetUi() {
		const btn = this.$('[data-el=preset-btn]');
		if (!btn) return;
		const a = this.st.form.d.sanction_authority;
		btn.textContent = a && a !== 'Other' ? `Add standard ${a} deductions` : 'Add standard deductions';
		btn.hidden = !((this.presets().deductions || []).length);
	},

	presets() {
		const all = (this.st.ctx && this.st.ctx.presets) || {};
		return all[this.st.form.d.sanction_authority || 'Other'] || all.Other || {};
	},

	renderWorkTotal() {
		const el = this.$('[data-el=work-total]');
		if (!el) return;
		const rows = this.st.form.d.work_lines.filter((r) => !rowBlank(r));
		el.innerHTML = rows.length ? `${rows.length} line${rows.length > 1 ? 's' : ''} · total <b>${rs(rows.reduce((s, r) => s + num(r.amount), 0))}</b>` : '';
	},

	renderSancHint() {
		const el = this.$('[data-hint=sanction_amount]');
		if (!el) return;
		const c = this.st.calc;
		const s = num(this.st.form.d.sanction_amount);
		el.innerHTML = c && c.bill_total && s && Math.abs(c.bill_total - s) >= 1 ? `Bill total works out to ${rs(c.bill_total)}` : '';
	},

	renderSummary() {
		const f = this.st.form;
		if (!f) return;
		const c = this.st.calc || { base_amount: 0, sgst_amount: 0, cgst_amount: 0, bill_total: 0, additions_total: 0, gross_total: 0, deductions_total: 0, net_payable: 0, additions: [], deductions: [], gst_rate: 0 };
		const el = this.$('[data-el=summary]');
		if (el) el.innerHTML = this.summaryHTML(c, false);
		const bar = this.$('[data-el=bar-net]');
		if (bar) bar.innerHTML = rs(c.net_payable);
		const msg = this.$('[data-el=check-msg]');
		if (msg) {
			const printed = num(f.d.net_as_per_order);
			if (!printed) { msg.className = 'msg idle'; msg.innerHTML = 'Type the net amount printed on the order to double-check this calculation.'; }
			else if (Math.abs(c.net_payable - printed) < 0.5) { msg.className = 'msg ok'; msg.innerHTML = `${ic('check', 15)} Matches the order.`; }
			else { msg.className = 'msg bad'; msg.innerHTML = `${ic('alert', 15)} Differs from the order by ${rs(Math.abs(c.net_payable - printed))}.`; }
		}
		const po = this.$('[data-el=progress-out]');
		if (po) {
			const till = num(f.d.work_done_till_date), prev = num(f.d.previous_payments), cv = num(f.d.contract_value);
			const out = [];
			if (till) out.push(`Claimed under this bill: <b>${rs(till - prev)}</b>`);
			if (cv && till) out.push(`Balance work: <b>${rs(cv - till)}</b>`);
			po.innerHTML = out.join('<br>') || 'Claimed amount and balance work appear here.';
		}
	},

	// ---- live calculation ----------------------------------------------------------
	payload() {
		const d = this.st.form.d;
		const rows = (kind) => d[kind].filter((r) => !rowBlank(r)).map((r) => (kind === 'work_lines'
			? { particular: r.particular.trim(), contract_amount: num(r.contract_amount), amount: num(r.amount) }
			: { particular: r.particular.trim(), rate: num(r.rate), amount: num(r.amount) }));
		return {
			name: d.name || undefined, project: d.project, bill_type: d.bill_type, bill_no: d.bill_no.trim(), bill_date: d.bill_date, bill_amount: num(d.bill_amount),
			sanction_authority: d.sanction_authority, sanction_no: d.sanction_no.trim(), sanction_date: d.sanction_date, package_no: d.package_no.trim(),
			sanction_amount: num(d.sanction_amount), sanction_order: d.sanction_order,
			base_amount: num(d.base_amount), gst_rate: num(d.gst_rate), sgst_amount: num(d.sgst_amount), cgst_amount: num(d.cgst_amount),
			work_lines: rows('work_lines'), additions: rows('additions'), deductions: rows('deductions'),
			net_as_per_order: num(d.net_as_per_order), contract_value: num(d.contract_value), work_done_till_date: num(d.work_done_till_date),
			previous_payments: num(d.previous_payments), remarks: d.remarks,
		};
	},

	scheduleCalc(ms) {
		clearTimeout(this._ct);
		this._ct = setTimeout(() => this.runCalc(), ms == null ? 280 : ms);
	},

	async runCalc() {
		if (this.st.view !== 'form' || !this.st.form || this.st.form.loading) return;
		const req = ++this.reqs.calc;
		try {
			const c = await post('calculate', { data: this.payload() });
			if (req !== this.reqs.calc || this.st.view !== 'form') return;
			this.st.calc = c;
			this.applyCalc(c);
		} catch (e) {
			if (req !== this.reqs.calc) return;
			const msg = this.$('[data-el=check-msg]');
			if (msg) { msg.className = 'msg bad'; msg.innerHTML = `${ic('alert', 15)} ${esc(e.message)}`; }
		}
	},

	applyCalc(c) {
		const d = this.st.form.d;
		const lock = (el, on) => { if (!el) return; el.readOnly = on; const box = el.closest('.input'); if (box) box.classList.toggle('ro', on); };
		const base = this.$('[data-f=base_amount]');
		lock(base, c.base_from_lines);
		if (c.base_from_lines && base) { base.value = fmt(c.base_amount); d.base_amount = String(c.base_amount); }
		const tag = this.$('[data-el=base-tag]');
		if (tag) tag.innerHTML = c.base_from_lines ? '<span class="auto-tag">from the ULB lines</span>' : '';
		['sgst_amount', 'cgst_amount'].forEach((k) => {
			const el = this.$(`[data-f=${k}]`);
			lock(el, c.gst_auto);
			if (c.gst_auto && el) { el.value = fmt(c[k]); d[k] = String(c[k]); }
		});
		['additions', 'deductions'].forEach((kind) => {
			const live = d[kind].map((r, i) => [r, i]).filter(([r]) => !rowBlank(r));
			live.forEach(([r, i], j) => {
				const s = c[kind][j];
				if (!s) return;
				r.auto = !!s.auto;
				const inp = this.$(`[data-t=${kind}][data-i="${i}"][data-k=amount]`);
				lock(inp, r.auto);
				if (r.auto && inp) { inp.value = fmt(s.amount); r.amount = String(s.amount); }
			});
		});
		this.renderWorkTotal();
		this.renderSummary();
		this.renderSancHint();
	},

	// ---- input handling ------------------------------------------------------------
	markDirty() { if (this.st.form) this.st.form.dirty = true; },

	clearErr(key) {
		const box = this.root.querySelector(`[data-err="${key}"]`);
		if (box) box.classList.remove('bad');
		const h = this.root.querySelector(`[data-hint="${key}"]`);
		if (h) { h.textContent = ''; h.classList.remove('bad'); }
	},

	onInput(e) {
		const el = e.target;
		if (!el.dataset) return;
		if (el.dataset.flt === 'search') {
			this.st.list.f.search = el.value;
			this.renderFilterBits();
			this.loadListSoon();
			return;
		}
		const f = this.st.form;
		if (this.st.view !== 'form' || !f) return;
		if (el.dataset.f) {
			f.d[el.dataset.f] = el.value;
			this.markDirty();
			this.clearErr(el.dataset.f);
			if (CALC_FIELDS.has(el.dataset.f)) this.scheduleCalc();
			if (el.dataset.f === 'sanction_amount') this.renderSancHint();
			if (el.dataset.f === 'work_done_till_date' || el.dataset.f === 'previous_payments' || el.dataset.f === 'contract_value') this.renderSummary();
		} else if (el.dataset.t) {
			const row = f.d[el.dataset.t][+el.dataset.i];
			if (!row) return;
			row[el.dataset.k] = el.value;
			this.markDirty();
			if (el.dataset.k === 'rate') {
				const on = num(el.value) > 0;
				row.auto = on;
				const amt = this.$(`[data-t=${el.dataset.t}][data-i="${el.dataset.i}"][data-k=amount]`);
				if (amt) { amt.readOnly = on; amt.closest('.input').classList.toggle('ro', on); }
			}
			this.clearErr('rows');
			this.scheduleCalc();
			if (el.dataset.t === 'work_lines') this.renderWorkTotal();
		} else if (el.dataset.el === 'pick-q') {
			this.pickTyped(el);
		}
	},

	onChange(e) {
		const el = e.target;
		if (!el.dataset) return;
		if (el.dataset.el === 'fileinput' || el.dataset.el === 'camerainput') {
			const file = el.files && el.files[0];
			el.value = '';
			if (file) this.chooseFile(file);
			return;
		}
		if (el.dataset.flt && el.dataset.flt !== 'search') {
			this.st.list.f[el.dataset.flt] = el.value;
			this.renderFilterBits();
			this.loadList(true);
		}
	},

	onFocusIn(e) {
		const el = e.target;
		if (!el.dataset) return;
		if ('money' in el.dataset && !el.readOnly) {
			el.value = el.value.replace(/,/g, '');
			if (el.select && this.mode === 'desk') el.select();
		}
		if (el.dataset.el === 'pick-q') this.pickOpen(el);
	},

	onFocusOut(e) {
		const el = e.target;
		if (!el.dataset) return;
		if ('money' in el.dataset && !el.readOnly) {
			const v = el.value.trim();
			if (v !== '') el.value = fmt(num(v));
			const f = this.st.form;
			if (f && el.dataset.f) f.d[el.dataset.f] = el.value;
			else if (f && el.dataset.t) f.d[el.dataset.t][+el.dataset.i][el.dataset.k] = el.value;
		}
		if (el.dataset.el === 'pick-q') setTimeout(() => this.pickBlur(el), 200);
	},

	// ---- project picker (form + list filter) ---------------------------------------
	pickWrap(el) { return el.closest('[data-pick]'); },

	pickOpen(el) {
		const wrap = this.pickWrap(el);
		if (!wrap) return;
		this.pickFetch(wrap, wrap.dataset.pick === 'form' && this.st.form && this.st.form.d.project ? '' : el.value);
	},

	pickTyped(el) {
		const wrap = this.pickWrap(el);
		if (!wrap) return;
		if (wrap.dataset.pick === 'form') {
			const d = this.st.form.d;
			d.project = '';
			d.project_name = '';
			this.clearErr('project');
			this.markDirty();
		}
		clearTimeout(this._pt);
		this._pt = setTimeout(() => this.pickFetch(wrap, el.value), 220);
	},

	async pickFetch(wrap, txt) {
		const list = wrap.querySelector('.pick-list');
		const req = ++this.reqs.pick;
		list.hidden = false;
		list.innerHTML = '<div class="none">Searching...</div>';
		try {
			const rows = await post('projects', { txt: txt || '' });
			if (req !== this.reqs.pick) return;
			this._pickRows = rows;
			list.innerHTML = rows.length
				? rows.map((r, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-act="pick" data-id="${esc(r.name)}" data-name="${esc(r.project_name)}"><b>${esc(r.project_name)}</b><span>${esc(r.name)}</span></button>`).join('')
				: '<div class="none">No project found.</div>';
		} catch (e) {
			if (req === this.reqs.pick) list.innerHTML = `<div class="none">${esc(e.message)}</div>`;
		}
	},

	pickBlur(el) {
		const wrap = this.pickWrap(el);
		if (!wrap) return;
		const list = wrap.querySelector('.pick-list');
		if (wrap.dataset.pick === 'form' && this.st.form && !this.st.form.d.project && el.value.trim() && this._pickRows && this._pickRows.length === 1 && !list.hidden) {
			this.pickSelect(wrap, this._pickRows[0].name, this._pickRows[0].project_name); // one match: take it
		}
		if (this.root.activeElement !== el) list.hidden = true;
	},

	pickSelect(wrap, id, name) {
		const kind = wrap.dataset.pick;
		const list = wrap.querySelector('.pick-list');
		if (list) list.hidden = true;
		if (kind === 'form') {
			const d = this.st.form.d;
			d.project = id;
			d.project_name = name;
			const q = wrap.querySelector('[data-el=pick-q]');
			if (q) q.value = name;
			this.clearErr('project');
			this.markDirty();
		} else {
			const f = this.st.list.f;
			f.project = id;
			f.project_name = name;
			this.renderList();
			this.loadList(true);
		}
	},

	pickKey(e) {
		const el = e.target;
		if (!el || !el.dataset || el.dataset.el !== 'pick-q') return;
		const wrap = this.pickWrap(el);
		const list = wrap.querySelector('.pick-list');
		const items = [...list.querySelectorAll('button')];
		if (!items.length || list.hidden) return;
		let i = items.findIndex((b) => b.classList.contains('on'));
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			items.forEach((b) => b.classList.remove('on'));
			i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
			items[i].classList.add('on');
			items[i].scrollIntoView({ block: 'nearest' });
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const b = items[Math.max(i, 0)];
			this.pickSelect(wrap, b.dataset.id, b.dataset.name);
		}
	},

	closePicks(e) {
		this.root.querySelectorAll('.pick-list').forEach((l) => {
			if (e && e.target && l.parentElement.contains(e.target)) return;
			l.hidden = true;
		});
	},

	// ---- actions ------------------------------------------------------------------
	formAct(a, t) {
		const f = this.st.form;
		switch (a) {
			case 'pick': this.pickSelect(t.closest('[data-pick]'), t.dataset.id, t.dataset.name); break;
			case 'pick-clear': { const lf = this.st.list.f; lf.project = ''; lf.project_name = ''; this.renderList(); this.loadList(true); break; }
			case 'set': this.setChoice(t.dataset.f, t.dataset.v); break;
			case 'add-row': this.addRow(t.dataset.t); break;
			case 'chip-add': this.addRow(t.dataset.t, { particular: t.dataset.p }); break;
			case 'del-row': f.d[t.dataset.t].splice(+t.dataset.i, 1); this.markDirty(); this.renderTable(t.dataset.t); this.scheduleCalc(0); break;
			case 'preset-ded': this.addStandardDeductions(false); break;
			case 'pick-file': this.$('[data-el=fileinput]').click(); break;
			case 'pick-cam': this.$('[data-el=camerainput]').click(); break;
			case 'use-total': {
				const c = this.st.calc;
				if (c && c.bill_total) {
					f.d.sanction_amount = String(c.bill_total);
					const el = this.$('[data-f=sanction_amount]');
					if (el) el.value = fmt(c.bill_total);
					this.markDirty();
					this.renderSancHint();
				}
				break;
			}
			case 'save': this.save(); break;
			default: break;
		}
	},

	setChoice(field, value) {
		const f = this.st.form;
		const was = f.d[field];
		f.d[field] = field === 'sanction_authority' && was === value ? '' : value; // tap the chosen department again to clear it
		this.root.querySelectorAll(`[data-act=set][data-f=${field}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === f.d[field])));
		this.markDirty();
		this.clearErr(field);
		if (field === 'sanction_authority') {
			if (!f.name && f.d[field] && !f.d.deductions.filter((r) => !rowBlank(r)).length) this.addStandardDeductions(true);
			this.renderPresetUi();
			this.renderFoot('deductions');
			this.renderFoot('additions');
		}
	},

	addRow(kind, init) {
		const f = this.st.form;
		f.d[kind].push(Object.assign(newRow(), init || {}));
		this.markDirty();
		this.renderTable(kind);
		const i = f.d[kind].length - 1;
		const target = this.$(`[data-t=${kind}][data-i="${i}"][data-k=${init && init.particular ? 'amount' : 'particular'}]`);
		if (target && !target.readOnly) target.focus();
	},

	addStandardDeductions(quiet) {
		const f = this.st.form;
		const p = this.presets();
		const have = new Set(f.d.deductions.map((r) => String(r.particular || '').trim().toLowerCase()));
		let n = 0;
		(p.deductions || []).forEach((r) => {
			if (have.has(r.particular.toLowerCase())) return;
			f.d.deductions.push(Object.assign(newRow(), { particular: r.particular, rate: rate(r.rate), auto: true }));
			n += 1;
		});
		if (!n) { if (!quiet) this.toast('Those deductions are already in the list.'); return; }
		this.markDirty();
		this.renderTable('deductions');
		this.scheduleCalc(0);
		this.toast(`Standard ${f.d.sanction_authority || ''} deductions added — change them if this order differs.`.replace('  ', ' '));
	},

	// ---- file upload ---------------------------------------------------------------
	async chooseFile(file) {
		const f = this.st.form;
		if (!f || f.uploading) return;
		const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
		const okExt = (this.st.ctx.file_types || []).includes(ext) || (!ext && /^image\//.test(file.type));
		if (!okExt) { this.toast('Choose a PDF or an image file.', 'err'); return; }
		f.uploading = true;
		f.uploadName = file.name;
		this.renderFileZone();
		try {
			const prepared = await prepareImage(file);
			if (prepared.size > this.st.ctx.max_file_mb * 1048576) throw new ApiError(`The file is larger than ${this.st.ctx.max_file_mb} MB.`);
			const r = await uploadFile(prepared);
			const name = r.file_name || prepared.name;
			const e2 = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
			f.d.sanction_order = r.file_url;
			f.file = { url: r.file_url, name, size: prepared.size, is_image: /^image\//.test(prepared.type) || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif'].includes(e2), is_pdf: e2 === '.pdf' };
			this.clearErr('file');
			this.markDirty();
		} catch (e) {
			this.toast(e.message, 'err');
		}
		f.uploading = false;
		this.renderFileZone();
	},

	// ---- save ----------------------------------------------------------------------
	validate() {
		const d = this.st.form.d;
		const errs = {};
		if (!d.project) errs.project = 'Pick the project from the list.';
		if (!d.bill_type) errs.bill_type = 'Choose RA or PA.';
		if (!d.bill_no.trim()) errs.bill_no = 'Enter the bill number.';
		if (!(num(d.bill_amount) > 0)) errs.bill_amount = 'Enter the bill amount.';
		if (!d.sanction_order) errs.file = 'Upload the sanction order (PDF or photo).';
		const lonely = ['work_lines', 'additions', 'deductions'].some((k) => d[k].some((r) => !String(r.particular || '').trim() && (num(r.rate) || num(r.amount) || num(r.contract_amount))));
		if (lonely) errs.rows = 'Write the particular on every line that has an amount.';
		return errs;
	},

	showErrors(errs) {
		this.root.querySelectorAll('[data-err].bad').forEach((b) => b.classList.remove('bad'));
		this.root.querySelectorAll('.hint.bad').forEach((h) => { h.textContent = ''; h.classList.remove('bad'); });
		let first = null;
		Object.keys(errs).forEach((k) => {
			const box = this.root.querySelector(`[data-err="${k}"]`);
			if (box) { box.classList.add('bad'); first = first || box; }
			const h = this.root.querySelector(`[data-hint="${k}"]`);
			if (h) { h.textContent = errs[k]; h.classList.add('bad'); }
		});
		const el = this.$('[data-el=ferr]');
		el.innerHTML = `<div class="alert error">${ic('alert', 18)}<div>${esc(errs.rows || 'Please fix the highlighted fields.')}</div></div>`;
		if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
	},

	setBusy(on) {
		const main = this.$('[data-el=fmain]');
		if (main) main.classList.toggle('busy', on);
		this.root.querySelectorAll('[data-el=save]').forEach((b) => {
			b.disabled = on;
			b.innerHTML = on ? '<span class="spin"></span> Saving...' : (this.st.form.name ? 'Save changes' : 'Save bill');
		});
	},

	async save() {
		const f = this.st.form;
		if (!f || f.busy) return;
		if (f.uploading) { this.toast('Wait for the file to finish uploading.', 'err'); return; }
		this.$('[data-el=ferr]').innerHTML = '';
		const errs = this.validate();
		if (Object.keys(errs).length) { this.showErrors(errs); return; }
		f.busy = true;
		this.setBusy(true);
		try {
			const b = await post('save_bill', { data: this.payload() });
			f.dirty = false;
			this.st.list.loaded = false;
			this.toast(f.name ? `${b.name} saved` : `${b.name} added`);
			this.afterSave(b);
		} catch (e) {
			f.busy = false;
			this.setBusy(false);
			const el = this.$('[data-el=ferr]');
			if (el) {
				el.innerHTML = `<div class="alert error">${ic('alert', 18)}<div>${esc(e.message)}</div></div>`;
				el.scrollIntoView && el.scrollIntoView({ block: 'center', behavior: 'smooth' });
			}
			return;
		}
		f.busy = false;
	},

	afterSave(b) {
		this.st.detail = { name: b.name, data: b, error: '', preview: false };
		this.loadList(true); // keeps the "Saved bills" count and list current
		const wasEdit = this.stack[this.stack.length - 2] === 'detail';
		if (wasEdit) {
			if (this.mode === 'mobile' && history.state && history.state.bt) history.back();
			else this.popView();
		} else {
			this.stack[this.stack.length - 1] = 'detail';
			if (this.mode === 'mobile') history.replaceState({ bt: 'detail' }, '');
			this.view('detail');
		}
	},
});
