# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

"""API of the Bill Tracker page (/desk/bill-tracker) and of the mobile app (/bill-tracker/m).

Every read goes through frappe.get_list / document permission checks, so role permissions and user
permissions always apply. The payment maths lives in calc.py and is shared with the document itself.
"""

import json
import os

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, get_fullname, today

from bill_tracker.bill_tracker import calc, invoice
from bill_tracker.bill_tracker.doctype.project_bill.project_bill import ALLOWED_SANCTION_ORDER_EXTENSIONS

DOCTYPE = "Project Bill"
PROJECT_DOCTYPE = "Bill Project"
SETTINGS_DOCTYPE = invoice.SETTINGS
BILL_TYPES = ("RA - Running Account", "PA - Part Account")
MAX_PAGE_LENGTH = 200

LIST_FIELDS = [
	"name",
	"project",
	"bill_type",
	"bill_no",
	"bill_date",
	"bill_amount",
	"sanction_authority",
	"sanction_no",
	"sanction_date",
	"sanction_amount",
	"package_no",
	"net_payable",
	"sanction_order",
	"modified",
]

# fields the page / app may set; every computed total is recalculated by the document itself
SCALAR_FIELDS = (
	"project",
	"bill_type",
	"bill_no",
	"bill_date",
	"bill_amount",
	"sanction_authority",
	"sanction_no",
	"sanction_date",
	"package_no",
	"sanction_amount",
	"contractor",
	"particular",
	"sanction_order",
	"base_amount",
	"base_manual",
	"gst_rate",
	"sgst_amount",
	"cgst_amount",
	"gst_manual",
	"net_as_per_order",
	"contract_value",
	"work_done_till_date",
	"previous_payments",
	"remarks",
)
DATE_FIELDS = ("bill_date", "sanction_date")
TEXT_FIELDS = (
	"project",
	"bill_type",
	"bill_no",
	"sanction_authority",
	"sanction_no",
	"package_no",
	"contractor",
	"particular",
	"sanction_order",
	"remarks",
)
TABLE_FIELDS = {
	"work_lines": ("particular", "contract_amount", "amount"),
	"additions": ("particular", "rate", "amount", "amount_manual"),
	"deductions": ("particular", "rate", "amount", "amount_manual"),
}
CHECK_FIELDS = ("base_manual", "gst_manual", "amount_manual")  # tick boxes: 0 / 1


def _parse(data):
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except ValueError:
			frappe.throw(_("Invalid data."))
	if not isinstance(data, dict):
		frappe.throw(_("Invalid data."))
	return data


def _bill_type(value):
	"""Accept the short codes too ("RA" / "PA")."""
	value = cstr(value).strip()
	if not value:
		return ""
	found = next((b for b in BILL_TYPES if b == value or b.split(" - ")[0] == value), None)
	if not found:
		frappe.throw(_("Invalid Bill Type"))
	return found


def _escrow_context():
	"""The "Fund transfer letters" section (jv_escrow app) - only when that app is installed on this site
	and the user may read its letters; otherwise the page simply has no such section."""
	try:
		if "jv_escrow" not in frappe.get_installed_apps():
			return None
		if not frappe.has_permission("Escrow Fund Transfer", "read"):
			return None
		path = frappe.get_app_path("jv_escrow", "public", "js", "escrow_transfer_ui.js")
		if not os.path.exists(path):
			return None
		return {
			"label": "Fund transfer letters",
			"url": f"/assets/jv_escrow/js/escrow_transfer_ui.js?v={int(os.path.getmtime(path))}",
		}
	except Exception:  # noqa: BLE001 - a missing / broken optional app must never break the Bill Tracker page
		return None


@frappe.whitelist()
def get_context():
	"""What the page needs to know before it can draw anything."""
	frappe.has_permission(DOCTYPE, "read", throw=True)
	return {
		"escrow": _escrow_context(),
		"user": frappe.session.user,
		"full_name": get_fullname(frappe.session.user),
		"can_create": bool(frappe.has_permission(DOCTYPE, "create")),
		"can_write": bool(frappe.has_permission(DOCTYPE, "write")),
		"can_create_project": bool(frappe.has_permission(PROJECT_DOCTYPE, "create")),
		"can_write_project": bool(frappe.has_permission(PROJECT_DOCTYPE, "write")),
		"can_edit_settings": bool(frappe.has_permission(SETTINGS_DOCTYPE, "write")),
		"default_authority": calc.DEFAULT_AUTHORITY,
		"today": today(),
		"bill_types": list(BILL_TYPES),
		"authorities": list(calc.AUTHORITIES),
		"presets": calc.PRESETS,
		"default_gst_rate": calc.DEFAULT_GST_RATE,
		"file_types": list(ALLOWED_SANCTION_ORDER_EXTENSIONS),
		"max_file_mb": min(cint((frappe.conf.get("max_file_size") or 25 * 1024 * 1024) / 1048576), 25),
	}


@frappe.whitelist()
def get_dashboard(from_date=None, to_date=None):
	"""Numbers for the dashboard: sanction order bills and (if jv_escrow is installed) fund transfer letters."""
	from bill_tracker.bill_tracker import dashboard

	frappe.has_permission(DOCTYPE, "read", throw=True)
	return dashboard.build(from_date or None, to_date or None, with_letters=bool(_escrow_context()))


def _get_list(doctype, **kwargs):
	"""frappe.get_list, but a user who may create bills still gets to see the masters the form needs
	(projects, customers, cost centers) even when their roles have no read right on them."""
	try:
		return frappe.get_list(doctype, **kwargs)
	except frappe.PermissionError:
		if not frappe.has_permission(DOCTYPE, "create"):
			raise
		return frappe.get_all(doctype, **kwargs)


@frappe.whitelist()
def projects(txt=None):
	"""The Bill Tracker's own projects to pick from (enabled ones only)."""
	txt = cstr(txt).strip()
	rows = _get_list(
		PROJECT_DOCTYPE,
		fields=["name", "project_name", "default_department", "customer"],
		filters={"disabled": 0},
		or_filters=[["name", "like", f"%{txt}%"]] if txt else None,
		order_by="project_name asc",
		limit_page_length=30,
	)
	out = [dict(r) for r in rows]
	# every bill of a project has the same contractor: the form starts a new bill with the latest one written
	last = {}
	if out:
		for b in frappe.get_list(
			DOCTYPE,
			filters={"project": ["in", [r["name"] for r in out]], "contractor": ["!=", ""]},
			fields=["project", "contractor"],
			order_by="bill_date desc, creation desc",
			limit_page_length=0,
		):
			last.setdefault(b.project, b.contractor)
	for r in out:
		r["last_contractor"] = last.get(r["name"], "")
	return out


def _project_names(project_ids):
	"""id -> display name. A Bill Project's id is its name, so nothing needs to be looked up."""
	return {p: p for p in project_ids or [] if p}


PROJECT_EXTRA_FIELDS = ("default_department", "customer", "cost_center")


def _project_dict(doc):
	out = {f: doc.get(f) for f in ("project_name", *PROJECT_EXTRA_FIELDS)}
	out["name"] = doc.name
	out["disabled"] = cint(doc.disabled)
	out["bills"] = cint(frappe.db.count(DOCTYPE, {"project": doc.name}))
	return out


@frappe.whitelist()
def list_projects(search=None):
	"""Every project (also the disabled ones) with its number of bills - the Settings tab."""
	frappe.has_permission(PROJECT_DOCTYPE, "read", throw=True)
	search = cstr(search).strip()
	rows = frappe.get_list(
		PROJECT_DOCTYPE,
		fields=["name", "project_name", "default_department", "customer", "cost_center", "disabled"],
		or_filters=[["name", "like", f"%{search}%"], ["customer", "like", f"%{search}%"]] if search else None,
		order_by="disabled asc, project_name asc",
		limit_page_length=500,
	)
	counts = {
		r.project: cint(r.n)
		for r in frappe.get_all(DOCTYPE, fields=["project", {"COUNT": "*", "as": "n"}], group_by="project")
	}
	out = []
	for r in rows:
		row = dict(r)
		row["disabled"] = cint(r.disabled)
		row["bills"] = counts.get(r.name, 0)
		out.append(row)
	return {"rows": out}


@frappe.whitelist(methods=["POST"])
def save_project(data):
	"""Add a project (no name) or change one (name). Projects are never deleted here - disable them instead."""
	data = _parse(data)
	name = cstr(data.get("name")).strip()
	if name:
		doc = frappe.get_doc(PROJECT_DOCTYPE, name)
		doc.check_permission("write")
	else:
		frappe.has_permission(PROJECT_DOCTYPE, "create", throw=True)
		doc = frappe.new_doc(PROJECT_DOCTYPE)
		doc.project_name = cstr(data.get("project_name")).strip()
		doc.disabled = 0
	for field in PROJECT_EXTRA_FIELDS:
		if field in data:
			doc.set(field, cstr(data.get(field)).strip() or None)
	if name and "disabled" in data:
		doc.disabled = cint(data.get("disabled"))
	doc.save()
	return _project_dict(doc)


@frappe.whitelist()
def lookup(kind, txt=None):
	"""Typeahead of the project form: customers and cost centres."""
	txt = cstr(txt).strip()
	if kind == "customer":
		rows = _get_list(
			"Customer",
			fields=["name", "customer_name"],
			filters={"disabled": 0},
			or_filters=[["name", "like", f"%{txt}%"], ["customer_name", "like", f"%{txt}%"]] if txt else None,
			order_by="customer_name asc",
			limit_page_length=20,
		)
		return [{"name": r.name, "label": r.customer_name or r.name} for r in rows]
	if kind == "cost_center":
		company = invoice.get_settings().company
		rows = _get_list(
			"Cost Center",
			fields=["name"],
			filters={"is_group": 0, **({"company": company} if company else {})},
			or_filters=[["name", "like", f"%{txt}%"]] if txt else None,
			order_by="name asc",
			limit_page_length=20,
		)
		return [{"name": r.name, "label": r.name} for r in rows]
	frappe.throw(_("Unknown lookup."))


SETTINGS_FIELDS = (
	"auto_create_invoice",
	"company",
	"item_code",
	"taxes_in_state",
	"taxes_out_state",
	"cost_center",
	"posting_days_before",
	"holiday_direction",
	"holiday_list",
)
HOLIDAY_DIRECTIONS = ("Previous working day", "Next working day")


@frappe.whitelist()
def get_settings():
	"""The draft Sales Invoice defaults + the choices for them."""
	frappe.has_permission(SETTINGS_DOCTYPE, "read", throw=True)
	cfg = invoice.get_settings()
	out = {f: cfg.get(f) or "" for f in SETTINGS_FIELDS}
	out["auto_create_invoice"] = cint(cfg.auto_create_invoice)
	out["posting_days_before"] = invoice.posting_days_before(cfg)
	out["holiday_direction"] = cfg.holiday_direction if cfg.holiday_direction in HOLIDAY_DIRECTIONS else HOLIDAY_DIRECTIONS[0]
	company = cfg.company
	company_filter = {"company": company} if company else {}
	out["options"] = {
		"companies": frappe.get_all("Company", pluck="name", order_by="name asc"),
		"items": frappe.get_all(
			"Item",
			filters={"disabled": 0, "is_stock_item": 0, "is_sales_item": 1},
			fields=["name", "item_name"],
			order_by="name asc",
			limit_page_length=200,
		),
		"templates": frappe.get_all(
			"Sales Taxes and Charges Template",
			filters={"disabled": 0, **company_filter},
			pluck="name",
			order_by="name asc",
		),
		"cost_centers": frappe.get_all(
			"Cost Center",
			filters={"is_group": 0, **company_filter},
			pluck="name",
			order_by="name asc",
			limit_page_length=300,
		),
		"holiday_lists": frappe.get_all("Holiday List", pluck="name", order_by="name desc"),
		"holiday_directions": list(HOLIDAY_DIRECTIONS),
	}
	out["can_edit"] = bool(frappe.has_permission(SETTINGS_DOCTYPE, "write"))
	return out


@frappe.whitelist(methods=["POST"])
def save_settings(data):
	data = _parse(data)
	frappe.has_permission(SETTINGS_DOCTYPE, "write", throw=True)
	cfg = frappe.get_doc(SETTINGS_DOCTYPE)
	for field in SETTINGS_FIELDS:
		if field not in data:
			continue
		if field == "auto_create_invoice":
			cfg.set(field, cint(data.get(field)))
		elif field == "posting_days_before":
			days = cint(data.get(field))
			if not 0 <= days <= 60:
				frappe.throw(_("Days before the bill date must be between 0 and 60."))
			cfg.set(field, days)
		elif field == "holiday_direction":
			value = cstr(data.get(field)).strip()
			cfg.set(field, value if value in HOLIDAY_DIRECTIONS else HOLIDAY_DIRECTIONS[0])
		else:
			cfg.set(field, cstr(data.get(field)).strip() or None)
	cfg.save()
	return get_settings()


@frappe.whitelist()
def list_bills(
	search=None,
	project=None,
	bill_type=None,
	authority=None,
	from_date=None,
	to_date=None,
	start=0,
	page_length=30,
):
	"""One page of bills + totals for the whole filtered set."""
	frappe.has_permission(DOCTYPE, "read", throw=True)

	filters = []
	if project:
		filters.append([DOCTYPE, "project", "=", project])
	if bill_type:
		filters.append([DOCTYPE, "bill_type", "=", _bill_type(bill_type)])
	if authority:
		filters.append([DOCTYPE, "sanction_authority", "=", cstr(authority)])
	if from_date:
		filters.append([DOCTYPE, "bill_date", ">=", from_date])
	if to_date:
		filters.append([DOCTYPE, "bill_date", "<=", to_date])

	or_filters = None
	search = cstr(search).strip()
	if search:
		like = f"%{search}%"
		or_filters = [
			[DOCTYPE, "bill_no", "like", like],
			[DOCTYPE, "sanction_no", "like", like],
			[DOCTYPE, "package_no", "like", like],
			[DOCTYPE, "contractor", "like", like],
			[DOCTYPE, "particular", "like", like],
			[DOCTYPE, "project", "like", like],
			[DOCTYPE, "name", "like", like],
		]

	start = max(cint(start), 0)
	page_length = min(max(cint(page_length), 1), MAX_PAGE_LENGTH)

	rows = frappe.get_list(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=LIST_FIELDS,
		order_by="bill_date desc, creation desc",
		limit_start=start,
		limit_page_length=page_length,
	)
	totals = frappe.get_list(
		DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		# v16 query engine: aggregates must use dict syntax
		fields=[
			{"COUNT": "*", "as": "total_bills"},
			{"SUM": "bill_amount", "as": "total_bill_amount"},
			{"SUM": "sanction_amount", "as": "total_sanction_amount"},
			{"SUM": "net_payable", "as": "total_net_payable"},
		],
	)
	totals = totals[0] if totals else {}
	total_bills = cint(totals.get("total_bills"))

	names = _project_names(list({r.project for r in rows if r.project}))
	for r in rows:
		r["project_name"] = names.get(r.project) or r.project
		r["bill_type_code"] = cstr(r.bill_type).split(" - ")[0]

	return {
		"rows": rows,
		"totals": {
			"total_bills": total_bills,
			"total_bill_amount": flt(totals.get("total_bill_amount")),
			"total_sanction_amount": flt(totals.get("total_sanction_amount")),
			"total_net_payable": flt(totals.get("total_net_payable")),
		},
		"start": start,
		"has_more": start + len(rows) < total_bills,
	}


def _file_info(file_url):
	if not file_url:
		return None
	row = frappe.db.get_value(
		"File", {"file_url": file_url}, ["file_name", "file_size", "is_private"], as_dict=True
	)
	name = (row and row.file_name) or os.path.basename(cstr(file_url).split("?")[0])
	ext = os.path.splitext(name)[1].lower()
	return {
		"url": file_url,
		"name": name,
		"ext": ext,
		"size": cint(row.file_size) if row else 0,
		"is_pdf": ext == ".pdf",
		"is_image": ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif"),
	}


def _bill_dict(doc):
	"""Everything the detail view and the edit form need."""
	out = {f: doc.get(f) for f in SCALAR_FIELDS}
	for f in (
		"bill_total",
		"additions_total",
		"gross_total",
		"deductions_total",
		"net_payable",
		"net_payable_words",
		"net_difference",
		"claimed_this_bill",
		"balance_work",
	):
		out[f] = doc.get(f)
	for table, keys in TABLE_FIELDS.items():
		out[table] = [{k: row.get(k) for k in keys} for row in doc.get(table) or []]
	out["name"] = doc.name
	out["project_name"] = _project_names([doc.project]).get(doc.project) or doc.project
	out["file"] = _file_info(doc.sanction_order)
	out["owner"] = doc.owner
	out["owner_name"] = get_fullname(doc.owner)
	out["creation"] = cstr(doc.creation)
	out["modified"] = cstr(doc.modified)
	out["modified_by_name"] = get_fullname(doc.modified_by)
	out["can_write"] = bool(doc.has_permission("write"))
	out["invoice"] = invoice.info(doc)
	result = doc.flags.get("invoice_result")
	if result:
		out["invoice_result"] = result
	return out


@frappe.whitelist()
def get_bill(name):
	doc = frappe.get_doc(DOCTYPE, name)
	doc.check_permission("read")
	return _bill_dict(doc)


@frappe.whitelist()
def calculate(data):
	"""Live preview while the form is being filled: the same maths the document applies on save."""
	frappe.has_permission(DOCTYPE, "read", throw=True)
	return calc.compute(_parse(data))


@frappe.whitelist(methods=["POST"])
def create_invoice(name):
	"""The "Create draft Sales Invoice" button: makes the draft when there is none (or refreshes the draft)."""
	doc = frappe.get_doc(DOCTYPE, name)
	doc.check_permission("write")
	doc.flags.invoice_result = invoice.sync_for_bill(doc, force=True)
	return _bill_dict(doc)


def _clean_rows(rows, keys):
	out = []
	for row in rows or []:
		if not isinstance(row, dict):
			continue
		clean = {}
		for k in keys:
			value = row.get(k)
			clean[k] = cstr(value).strip() if k == "particular" else cint(value) if k in CHECK_FIELDS else flt(value)
		out.append(clean)
	return out


@frappe.whitelist(methods=["POST"])
def save_bill(data):
	"""Create (no name) or update (name) a Project Bill. All totals are recalculated by the document."""
	data = _parse(data)
	name = cstr(data.get("name")).strip()

	if name:
		doc = frappe.get_doc(DOCTYPE, name)
		doc.check_permission("write")
	else:
		frappe.has_permission(DOCTYPE, "create", throw=True)
		doc = frappe.new_doc(DOCTYPE)

	for field in SCALAR_FIELDS:
		if field not in data:
			continue
		value = data.get(field)
		if field in DATE_FIELDS:
			doc.set(field, cstr(value).strip() or None)
		elif field == "bill_type":
			doc.set(field, _bill_type(value))
		elif field in TEXT_FIELDS:
			doc.set(field, cstr(value).strip())
		elif field in CHECK_FIELDS:
			doc.set(field, cint(value))
		else:
			doc.set(field, flt(value))

	for table, keys in TABLE_FIELDS.items():
		if table in data:
			doc.set(table, [])
			for row in _clean_rows(data.get(table), keys):
				doc.append(table, row)

	doc.save()
	return _bill_dict(doc)
