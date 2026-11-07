frappe.provide("bill_tracker");

// kept on the namespace (not top-level const) so re-evaluating this script is harmless
bill_tracker.config = {
	api: "bill_tracker.bill_tracker.page.bill_tracker.bill_tracker.get_bills",
	bill_types: ["RA - Running Account", "PA - Part Account"],
	sanction_order_types: [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"],
	page_length: 50,
};

frappe.pages["bill-tracker"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Bill Tracker"),
		single_column: true,
	});
	wrapper.bill_tracker = new bill_tracker.BillTracker(wrapper, page);
};

frappe.pages["bill-tracker"].on_page_show = function (wrapper) {
	// pick up bills created / edited on the form while the page was in the background
	if (wrapper.bill_tracker) wrapper.bill_tracker.refresh();
};

bill_tracker.BillTracker = class BillTracker {
	constructor(wrapper, page) {
		this.wrapper = wrapper;
		this.page = page;
		this.rows = [];
		this.request_id = 0;
		this.can_create = true;

		this.make_filters();
		this.make_actions();
		this.make_body();
		this.refresh();
	}

	// ---- layout -------------------------------------------------------------

	make_filters() {
		const on_change = frappe.utils.debounce(() => this.refresh(), 300);
		this.fields = {};

		this.fields.project = this.page.add_field({
			fieldname: "project",
			label: __("Project"),
			fieldtype: "Link",
			options: "Project",
			change: on_change,
		});
		this.fields.bill_type = this.page.add_field({
			fieldname: "bill_type",
			label: __("Bill Type"),
			fieldtype: "Select",
			options: ["", ...bill_tracker.config.bill_types].join("\n"),
			change: on_change,
		});
		this.fields.date_range = this.page.add_field({
			fieldname: "date_range",
			label: __("Bill Date"),
			fieldtype: "DateRange",
			change: on_change,
		});
	}

	make_actions() {
		this.page.set_primary_action(__("New Bill"), () => this.new_bill(), "add");
		this.page.add_menu_item(__("Refresh"), () => this.refresh());
		this.page.add_menu_item(__("Clear Filters"), () => this.clear_filters());
		this.page.add_menu_item(__("Open Project Bill List"), () => frappe.set_route("List", "Project Bill"));
	}

	make_body() {
		this.$root = $(`
			<div class="bill-tracker-root">
				<div class="bt-cards">
					<div class="bt-card">
						<div class="bt-card-label">${__("Total Bills")}</div>
						<div class="bt-card-value" data-card="total_bills">-</div>
					</div>
					<div class="bt-card">
						<div class="bt-card-label">${__("Total Bill Amount")}</div>
						<div class="bt-card-value" data-card="total_bill_amount">-</div>
					</div>
					<div class="bt-card">
						<div class="bt-card-label">${__("Total Sanction Amount")}</div>
						<div class="bt-card-value" data-card="total_sanction_amount">-</div>
					</div>
				</div>
				<div class="bt-table-wrap">
					<table class="bt-table">
						<thead>
							<tr>
								<th>${__("Project")}</th>
								<th>${__("Bill Type")}</th>
								<th>${__("Bill No")}</th>
								<th>${__("Bill Date")}</th>
								<th class="bt-num">${__("Bill Amount")}</th>
								<th>${__("Sanction No")}</th>
								<th class="bt-num">${__("Sanction Amount")}</th>
								<th>${__("Sanction Order")}</th>
							</tr>
						</thead>
						<tbody></tbody>
					</table>
				</div>
				<div class="bt-footer"></div>
			</div>
		`).appendTo(this.page.main);

		this.$tbody = this.$root.find("tbody");
		this.$footer = this.$root.find(".bt-footer");

		// open the Project Bill form on row click (but not when the file link was clicked)
		this.$tbody.on("click", "tr[data-name]", (e) => {
			if ($(e.target).closest("a").length) return;
			frappe.set_route("Form", "Project Bill", $(e.currentTarget).attr("data-name"));
		});
		this.$footer.on("click", ".bt-load-more", () => this.load_more());
	}

	// ---- data ---------------------------------------------------------------

	get_filters() {
		const value = this.fields.date_range.get_value();
		const range = Array.isArray(value) ? value : []; // "" / undefined until both dates are picked
		return {
			project: this.fields.project.get_value() || null,
			bill_type: this.fields.bill_type.get_value() || null,
			from_date: range[0] || null,
			to_date: range[1] || null,
		};
	}

	clear_filters() {
		this.fields.project.set_value("");
		this.fields.bill_type.set_value("");
		this.fields.date_range.set_value("");
		this.refresh();
	}

	refresh() {
		return this.fetch(0).then((r) => {
			if (!r) return;
			this.rows = r.rows;
			this.render_cards(r.totals);
			this.render_rows();
			this.render_footer(r);
		});
	}

	load_more() {
		return this.fetch(this.rows.length).then((r) => {
			if (!r) return;
			this.rows = this.rows.concat(r.rows);
			this.render_rows();
			this.render_footer(r);
		});
	}

	fetch(start) {
		const config = bill_tracker.config;
		const request_id = ++this.request_id;
		const done = () => {
			if (request_id === this.request_id) this.$root.removeClass("bt-loading");
		};
		this.$root.addClass("bt-loading");
		return frappe
			.call({
				method: config.api,
				args: { ...this.get_filters(), start: start, page_length: config.page_length },
			})
			.then(
				(r) => {
					done();
					if (request_id !== this.request_id) return null; // a newer request superseded this one
					this.can_create = !!r.message.can_create;
					this.page.btn_primary.toggle(this.can_create);
					return r.message;
				},
				() => {
					done();
					return null; // the server error is already shown by frappe
				}
			);
	}

	// ---- rendering ----------------------------------------------------------

	format_money(value) {
		const currency = frappe.boot.sysdefaults && frappe.boot.sysdefaults.currency;
		return format_currency(value || 0, currency);
	}

	render_cards(totals) {
		const set = (key, text) => this.$root.find(`[data-card="${key}"]`).text(text);
		set("total_bills", format_number(totals.total_bills, null, 0));
		set("total_bill_amount", this.format_money(totals.total_bill_amount));
		set("total_sanction_amount", this.format_money(totals.total_sanction_amount));
	}

	render_rows() {
		const esc = frappe.utils.escape_html;

		if (!this.rows.length) {
			this.$tbody.html(
				`<tr class="bt-empty"><td colspan="8">${__("No bills found for the selected filters.")}</td></tr>`
			);
			return;
		}

		this.$tbody.html(
			this.rows
				.map((row) => {
					const type_code = esc((row.bill_type || "").split(" - ")[0]);
					const project_label =
						row.project_name && row.project_name !== row.project
							? `<div class="bt-main">${esc(row.project_name)}</div><div class="bt-sub">${esc(row.project)}</div>`
							: `<div class="bt-main">${esc(row.project || "")}</div>`;
					const file = row.sanction_order
						? `<a class="bt-file" href="${encodeURI(row.sanction_order)}" target="_blank" rel="noopener" download
								title="${esc(row.sanction_order.split("/").pop())}">${frappe.utils.icon("es-line-download", "sm")} ${__("Download")}</a>`
						: `<span class="text-muted">-</span>`;
					return `
						<tr data-name="${esc(row.name)}" title="${esc(row.name)}">
							<td>${project_label}</td>
							<td><span class="bt-badge bt-badge-${type_code.toLowerCase()}" title="${esc(row.bill_type)}">${type_code}</span></td>
							<td>${esc(row.bill_no || "")}</td>
							<td>${row.bill_date ? esc(frappe.datetime.str_to_user(row.bill_date)) : ""}</td>
							<td class="bt-num">${this.format_money(row.bill_amount)}</td>
							<td>${esc(row.sanction_no || "")}</td>
							<td class="bt-num">${row.sanction_amount ? this.format_money(row.sanction_amount) : "-"}</td>
							<td>${file}</td>
						</tr>`;
				})
				.join("")
		);
	}

	render_footer(r) {
		const total = r.totals.total_bills;
		if (!total) {
			this.$footer.empty();
			return;
		}
		const more = r.has_more
			? `<button class="btn btn-default btn-xs bt-load-more">${__("Load more")}</button>`
			: "";
		this.$footer.html(`<span class="text-muted">${__("Showing {0} of {1} bills", [this.rows.length, total])}</span> ${more}`);
	}

	// ---- new bill dialog ----------------------------------------------------

	new_bill() {
		const dialog = new frappe.ui.Dialog({
			title: __("New Project Bill"),
			size: "large",
			fields: [
				{
					fieldname: "project",
					label: __("Project"),
					fieldtype: "Link",
					options: "Project",
					reqd: 1,
					default: this.fields.project.get_value() || undefined,
				},
				{
					fieldname: "bill_type",
					label: __("Bill Type"),
					fieldtype: "Select",
					options: ["", ...bill_tracker.config.bill_types].join("\n"),
					reqd: 1,
					default: this.fields.bill_type.get_value() || undefined,
				},
				{ fieldname: "bill_no", label: __("Bill No"), fieldtype: "Data", reqd: 1 },
				{ fieldtype: "Column Break" },
				{
					fieldname: "bill_date",
					label: __("Bill Date"),
					fieldtype: "Date",
					default: frappe.datetime.get_today(),
				},
				{ fieldname: "bill_amount", label: __("Bill Amount"), fieldtype: "Currency", reqd: 1 },
				{ fieldtype: "Section Break", label: __("Sanction Details") },
				{ fieldname: "sanction_no", label: __("Sanction No"), fieldtype: "Data" },
				{ fieldname: "sanction_amount", label: __("Sanction Amount"), fieldtype: "Currency" },
				{ fieldtype: "Column Break" },
				{
					fieldname: "sanction_order",
					label: __("Sanction Order"),
					fieldtype: "Attach",
					reqd: 1,
					description: __("PDF or image"),
					options: { restrictions: { allowed_file_types: bill_tracker.config.sanction_order_types } },
				},
				{ fieldtype: "Section Break" },
				{ fieldname: "remarks", label: __("Remarks"), fieldtype: "Small Text" },
			],
			primary_action_label: __("Save"),
			primary_action: (values) => {
				dialog.disable_primary_action();
				frappe.db.insert({ doctype: "Project Bill", ...values }).then(
					(doc) => {
						dialog.hide();
						frappe.show_alert({
							message: __("Project Bill {0} created", [
								`<a href="/app/project-bill/${encodeURIComponent(doc.name)}">${frappe.utils.escape_html(doc.name)}</a>`,
							]),
							indicator: "green",
						});
						this.refresh();
					},
					() => {
						// the server message (e.g. duplicate bill) is already shown; keep the dialog open for correction
						dialog.enable_primary_action();
					}
				);
			},
		});
		dialog.show();
	}
};
