
// ---------------------------------------------------------------- Settings: projects + the draft Sales Invoice defaults
const DEPARTMENTS = ['MPUDCL', 'Jal Nigam', 'Other'];

Object.assign(App.prototype, {
	showSettings() {
		if (this.st.settings.loaded) this.renderSettings();
		this.loadSettings();
	},

	async loadSettings() {
		const S = this.st.settings;
		const el = this.$('[data-el=settings]');
		if (!S.loaded) el.innerHTML = `<div class="loading"><span class="spin"></span> Loading the settings...</div>`;
		S.loading = true;
		const req = ++this.reqs.settings;
		try {
			const pr = await post('list_projects', { search: '' });
			if (req !== this.reqs.settings) return;
			S.projects = pr.rows || [];
			S.cfgError = '';
			try { S.cfg = await post('get_settings'); } catch (e) { S.cfg = null; S.cfgError = e.message; }
			S.loaded = true;
			S.error = '';
		} catch (e) {
			if (req !== this.reqs.settings) return;
			S.error = e.message;
		}
		S.loading = false;
		if (this.st.section === 'settings') this.renderSettings();
	},

	renderSettings() {
		const S = this.st.settings;
		const el = this.$('[data-el=settings]');
		if (!el) return;
		if (S.error && !S.loaded) { el.innerHTML = this.errorCard(S.error, 'settings'); return; }
		const ctx = this.st.ctx || {};
		const canAdd = !!ctx.can_create_project;
		el.innerHTML = `<div class="settings-in">
			<div class="card"><span class="accent"></span>
				<div class="card-head"><div><h2>Projects</h2><div class="sub">The projects you raise bills for. The customer is who each project's draft Sales Invoice is made out to.</div></div>
					${canAdd ? `<button type="button" class="btn btn-primary" data-act="st-add" style="height:38px">${ic('plus', 16)} Add project</button>` : ''}</div>
				<div class="filters"><div class="input search"><span class="ico">${ic('search', 16)}</span>
					<input data-sf="search" placeholder="Search project or customer" value="${esc(S.search)}" autocomplete="off"></div></div>
				<div data-el="st-rows"></div></div>
			<div data-el="st-cfg"></div></div>`;
		this.renderProjectRows();
		this.renderCfg();
	},

	renderProjectRows() {
		const S = this.st.settings;
		const el = this.$('[data-el=st-rows]');
		if (!el) return;
		const q = normName(S.search);
		const rows = S.projects.filter((p) => !q || normName(p.project_name).includes(q) || normName(p.customer).includes(q));
		if (!S.projects.length) {
			el.innerHTML = `<div class="empty"><span class="e-ic">${ic('sliders', 22)}</span><b>No projects yet</b>Add the first project — you can also add one straight from the Project field of a new bill.</div>`;
			return;
		}
		if (!rows.length) { el.innerHTML = `<div class="empty"><span class="e-ic">${ic('search', 22)}</span><b>No project matches</b>Try a different search.</div>`; return; }
		const canEdit = !!(this.st.ctx && this.st.ctx.can_write_project);
		const trs = rows.map((p) => `<tr class="${canEdit ? 'clickable' : ''}" ${canEdit ? `data-act="st-edit" data-name="${esc(p.name)}"` : ''}>
			<td><span class="main">${esc(p.project_name)}</span>${p.disabled ? ' <span class="pill">Disabled</span>' : ''}</td>
			<td>${p.default_department ? `<span class="pill cyan">${esc(p.default_department)}</span>` : '<span class="sub">-</span>'}</td>
			<td>${p.customer ? esc(p.customer) : '<span class="pill warn">No customer</span>'}${p.cost_center ? `<span class="sub">${esc(p.cost_center)}</span>` : ''}</td>
			<td class="amt">${fmt(p.bills || 0)}</td>
			<td>${canEdit ? `<span class="file-ic">${ic('pencil', 14)}</span>` : ''}</td></tr>`).join('');
		el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Project</th><th>Department</th><th>Customer</th><th class="r">Bills</th><th></th></tr></thead><tbody>${trs}</tbody></table></div>
			<div class="list-foot"><span>${fmt(rows.length)} of ${fmt(S.projects.length)} project${S.projects.length === 1 ? '' : 's'}</span></div>`;
	},

	renderCfg() {
		const S = this.st.settings;
		const el = this.$('[data-el=st-cfg]');
		if (!el) return;
		const c = S.cfg;
		if (!c) {
			el.innerHTML = `<div class="card"><span class="accent"></span><div class="card-head"><div><h2>Draft Sales Invoice</h2></div></div><div class="card-body"><div class="alert warn">${ic('alert', 16)}<div>${esc(S.cfgError || 'These settings could not be loaded.')}</div></div></div></div>`;
			return;
		}
		const o = c.options || {};
		const dis = c.can_edit ? '' : ' disabled';
		const sel = (key, list, label, noBlank) => `<div class="input"><select data-sf="${key}"${dis}>${noBlank ? '' : '<option value="">—</option>'}${list.map((v) => {
			const val = typeof v === 'string' ? v : v.name;
			return `<option value="${esc(val)}"${c[key] === val ? ' selected' : ''}>${esc(label ? label(v) : val)}</option>`;
		}).join('')}</select></div>`;
		const field = (l, inner, hint) => `<div class="field"><label class="lbl"><span>${l}</span></label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
		el.innerHTML = `<div class="card"><span class="accent"></span>
			<div class="card-head"><div><h2>Draft Sales Invoice</h2><div class="sub">When a bill is saved, a Sales Invoice is made for it — one line per ULB, GST added. Only ever a draft: check it and submit it from the Sales Invoice screen.</div></div></div>
			<div class="card-body"><div class="cols2">
				${field('Make a draft when a bill is saved', `<div class="seg full" role="group">
					<button type="button" data-act="st-auto" data-v="1" aria-pressed="${!!c.auto_create_invoice}"${dis}>On</button>
					<button type="button" data-act="st-auto" data-v="0" aria-pressed="${!c.auto_create_invoice}"${dis}>Off</button></div>`, 'Off: no invoice is made on its own; each bill still has a "Create draft Sales Invoice" button.')}
				${field('Company', sel('company', o.companies || []))}
				${field('Invoice item', sel('item_code', o.items || [], (it) => (it.item_name && it.item_name !== it.name ? `${it.name} — ${it.item_name}` : it.name)), 'The service item every invoice line uses.')}
				${field('GST template — customer in the same state', sel('taxes_in_state', o.templates || []))}
				${field('GST template — customer in another state', sel('taxes_out_state', o.templates || []))}
				${field('Default cost center', sel('cost_center', o.cost_centers || []), 'Used when a project has no cost center of its own.')}
				${field('Post the draft this many days before the bill date', `<div class="input mono-in"><input data-sf="posting_days_before" inputmode="numeric" class="mono right" value="${esc(c.posting_days_before)}"${dis} autocomplete="off"></div>`, 'Bill date 16/10 and 2 days: the draft is posted on 14/10.')}
				${field('If that day is a Sunday or a holiday, use the', sel('holiday_direction', o.holiday_directions || [], null, true), 'Skips every Sunday / holiday in a row. "Next" never goes past the day before the bill date.')}
				${field('Holiday list', sel('holiday_list', o.holiday_lists || []), 'Empty = the default holiday list of the company. Sundays always count as holidays.')}
			</div>
			${c.can_edit ? `<div class="f-actions" style="margin-top:18px"><button type="button" class="btn btn-primary" data-act="st-save" data-el="st-save">Save settings</button></div>`
				: `<div class="hint" style="margin-top:14px">Only an Accounts Manager can change these settings.</div>`}</div></div>`;
	},

	onSettingsInput(el) {
		const S = this.st.settings;
		const k = el.dataset.sf;
		if (k === 'search') { S.search = el.value; this.renderProjectRows(); return; }
		if (S.cfg) S.cfg[k] = el.value;
	},

	settingsAct(a, t) {
		const S = this.st.settings;
		switch (a) {
			case 'st-reload': S.loaded = false; this.loadSettings(); break;
			case 'st-add': this.projectModal({ default_department: this.st.ctx.default_authority || '' }, () => this.afterProjectSaved()); break;
			case 'st-edit': { const p = S.projects.find((x) => x.name === t.dataset.name); if (p) this.projectModal(p, () => this.afterProjectSaved()); break; }
			case 'st-auto': {
				if (!S.cfg || !S.cfg.can_edit) break;
				S.cfg.auto_create_invoice = +t.dataset.v;
				this.root.querySelectorAll('[data-act=st-auto]').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === S.cfg.auto_create_invoice)));
				break;
			}
			case 'st-save': this.saveCfg(); break;
			default: break;
		}
	},

	afterProjectSaved() {
		this.st.settings.loaded = false;
		if (this.st.section === 'settings') this.loadSettings();
	},

	async saveCfg() {
		const S = this.st.settings;
		const btn = this.$('[data-el=st-save]');
		if (!S.cfg || (btn && btn.disabled)) return;
		if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Saving...'; }
		try {
			const keys = ['auto_create_invoice', 'company', 'item_code', 'taxes_in_state', 'taxes_out_state', 'cost_center', 'posting_days_before', 'holiday_direction', 'holiday_list'];
			const data = {};
			keys.forEach((k) => { data[k] = S.cfg[k]; });
			S.cfg = await post('save_settings', { data });
			this.toast('Settings saved');
		} catch (e) {
			this.toast(e.message, 'err');
		}
		this.renderCfg();
	},

	// ---- the small project form (Settings tab and "Add project" next to the Project field) -------------
	projectModal(init, done) {
		init = init || {};
		const editing = !!init.name;
		const m = {
			name: init.name || '', project_name: init.project_name || '', default_department: init.default_department || '',
			customer: init.customer || '', cost_center: init.cost_center || '', disabled: init.disabled ? 1 : 0, busy: false, rows: {},
		};
		const ov = this.$('[data-el=overlay]');
		const dept = () => DEPARTMENTS.map((d) => `<button type="button" data-md="${esc(d)}" aria-pressed="${m.default_department === d}">${esc(d)}</button>`).join('');
		const pick = (kind, label, ph, hint) => `<div class="field"><label class="lbl"><span>${label}</span></label>
			<div class="pick" data-mpick="${kind}"><div class="input"><input data-mq="${kind}" placeholder="${ph}" value="${esc(m[kind])}" data-label="${esc(m[kind])}" autocomplete="off"></div><div class="pick-list" hidden></div></div>
			${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
		ov.innerHTML = `<div class="modal-back"><div class="modal wide" role="dialog" aria-modal="true" aria-label="Project">
			<h3>${editing ? 'Edit project' : 'Add project'}</h3>
			<p>The name is what you pick on a bill. The customer is who this project's draft Sales Invoices are made out to.</p>
			<div data-m="err"></div>
			<div class="m-form">
				<div class="field"><label class="lbl"><span>Project name<span class="req">*</span></span></label>
					<div class="input${editing ? ' ro' : ''}"><input data-m="project_name" value="${esc(m.project_name)}" placeholder="e.g. Ujjain Sewerage Package 6-J" autocomplete="off"${editing ? ' readonly' : ''}></div>
					${editing ? '<div class="hint">The name cannot be changed once the project exists.</div>' : ''}</div>
				<div class="field"><label class="lbl"><span>Default sanctioning department</span></label><div class="seg full" data-m="dept" role="group">${dept()}</div>
					<div class="hint">A new bill of this project starts with that department's standard lines.</div></div>
				${pick('customer', 'Customer (for the draft Sales Invoice)', 'Search the customer', 'Without a customer no draft invoice can be made for this project.')}
				${pick('cost_center', 'Cost center (optional)', 'Search the cost center', '')}
				${editing ? `<label class="chk"><input type="checkbox" data-m="disabled"${m.disabled ? ' checked' : ''}> <span>Disabled — not offered for new bills (old bills stay as they are)</span></label>` : ''}
			</div>
			<div class="m-acts"><button type="button" class="btn btn-secondary" data-m="cancel">Cancel</button><button type="button" class="btn btn-primary" data-m="save" style="height:38px">${editing ? 'Save project' : 'Add project'}</button></div></div></div>`;

		const back = ov.querySelector('.modal-back');
		const q = (sel) => back.querySelector(sel);
		const err = (msg) => { q('[data-m=err]').innerHTML = msg ? `<div class="alert error" style="margin-bottom:12px">${ic('alert', 16)}<div>${esc(msg)}</div></div>` : ''; };
		const close = () => { ov.innerHTML = ''; };
		const lookups = {};

		const showList = async (kind, txt) => {
			const wrap = q(`[data-mpick=${kind}]`);
			const list = wrap.querySelector('.pick-list');
			const req = (lookups[kind] = (lookups[kind] || 0) + 1);
			list.hidden = false;
			list.innerHTML = '<div class="none">Searching...</div>';
			try {
				const rows = await post('lookup', { kind, txt: txt || '' });
				if (req !== lookups[kind]) return;
				m.rows[kind] = rows;
				list.innerHTML = rows.length
					? rows.map((r, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-mid="${esc(r.name)}" data-mlabel="${esc(r.label)}"><b>${esc(r.label)}</b>${r.label !== r.name ? `<span>${esc(r.name)}</span>` : ''}</button>`).join('')
					: '<div class="none">Nothing found.</div>';
			} catch (e) {
				if (req === lookups[kind]) list.innerHTML = `<div class="none">${esc(e.message)}</div>`;
			}
		};
		const choose = (kind, id, label) => {
			m[kind] = id;
			const inp = q(`[data-mq=${kind}]`);
			inp.value = label || id;
			inp.dataset.label = inp.value;
			q(`[data-mpick=${kind}] .pick-list`).hidden = true;
		};
		const typing = {};
		back.addEventListener('input', (e) => {
			const el = e.target; // keep the element: inside a shadow root event.target is cleared once the event has been handled
			const kind = el.dataset && el.dataset.mq;
			if (!kind) return;
			if (el.value.trim() === '' || el.value !== el.dataset.label) m[kind] = '';
			clearTimeout(typing[kind]);
			typing[kind] = setTimeout(() => showList(kind, el.value), 220);
		});
		back.addEventListener('focusin', (e) => {
			const kind = e.target.dataset && e.target.dataset.mq;
			if (kind) showList(kind, m[kind] ? '' : e.target.value);
		});
		back.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') { close(); return; }
			const kind = e.target.dataset && e.target.dataset.mq;
			if (kind && e.key === 'Enter') {
				e.preventDefault();
				const first = q(`[data-mpick=${kind}] .pick-list button`);
				if (first) choose(kind, first.dataset.mid, first.dataset.mlabel);
			} else if (e.key === 'Enter' && e.target.dataset && e.target.dataset.m === 'project_name') {
				e.preventDefault();
				save();
			}
		});
		back.addEventListener('click', (e) => {
			const t = e.target;
			if (t === back) { close(); return; }
			const pickBtn = t.closest('[data-mid]');
			if (pickBtn) { choose(pickBtn.closest('[data-mpick]').dataset.mpick, pickBtn.dataset.mid, pickBtn.dataset.mlabel); return; }
			const d = t.closest('[data-md]');
			if (d) {
				m.default_department = m.default_department === d.dataset.md ? '' : d.dataset.md;
				back.querySelectorAll('[data-md]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.md === m.default_department)));
				return;
			}
			const mb = t.closest('[data-m]');
			if (mb && mb.dataset.m === 'cancel') close();
			else if (mb && mb.dataset.m === 'save') save();
			else if (!t.closest('.pick')) back.querySelectorAll('.pick-list').forEach((l) => { l.hidden = true; });
		});

		// a typed customer / cost center that was not clicked still counts when it is exactly one of the results
		const resolve = (kind, label) => {
			const typed = q(`[data-mq=${kind}]`).value.trim();
			if (!typed) return '';
			if (m[kind]) return m[kind];
			const hit = (m.rows[kind] || []).find((r) => normName(r.label) === normName(typed) || normName(r.name) === normName(typed));
			if (hit) return hit.name;
			throw new Error(`Pick the ${label} from the list.`);
		};
		const save = async () => {
			if (m.busy) return;
			err('');
			const btn = q('[data-m=save]');
			let data;
			try {
				const name = q('[data-m=project_name]').value.trim().replace(/\s+/g, ' ');
				if (!name) throw new Error('Enter the project name.');
				data = {
					project_name: name, default_department: m.default_department,
					customer: resolve('customer', 'customer'), cost_center: resolve('cost_center', 'cost center'),
				};
				if (editing) { data.name = m.name; data.disabled = q('[data-m=disabled]').checked ? 1 : 0; }
			} catch (e) { err(e.message); return; }
			m.busy = true;
			btn.disabled = true;
			btn.innerHTML = '<span class="spin"></span> Saving...';
			try {
				const p = await post('save_project', { data });
				close();
				this.toast(editing ? `${p.project_name} saved` : `Project ${p.project_name} added`);
				if (done) done(p);
			} catch (e) {
				m.busy = false;
				btn.disabled = false;
				btn.textContent = editing ? 'Save project' : 'Add project';
				err(e.message);
			}
		};
		const first = q(editing ? '[data-mq=customer]' : '[data-m=project_name]');
		if (first) first.focus();
	},
});
