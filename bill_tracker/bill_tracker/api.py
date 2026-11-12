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

from bill_tracker.bill_tracker import calc
from bill_tracker.bill_tracker.doctype.project_bill.project_bill import ALLOWED_SANCTION_ORDER_EXTENSIONS

DOCTYPE = "Project Bill"
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
	"sanction_order",
	"base_amount",
	"gst_rate",
	"sgst_amount",
	"cgst_amount",
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
	"sanction_order",
	"remarks",
)
TABLE_FIELDS = {
	"work_lines": ("particular", "contract_amount", "amount"),
	"additions": ("particular", "rate", "amount"),
	"deductions": ("particular", "rate", "amount"),
}


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


@frappe.whitelist()
def get_context():
	"""What the page needs to know before it can draw anything."""
	frappe.has_permission(DOCTYPE, "read", throw=True)
	return {
		"user": frappe.session.user,
		"full_name": get_fullname(frappe.session.user),
		"can_create": bool(frappe.has_permission(DOCTYPE, "create")),
		"can_write": bool(frappe.has_permission(DOCTYPE, "write")),
		"today": today(),
		"bill_types": list(BILL_TYPES),
		"authorities": list(calc.AUTHORITIES),
		"presets": calc.PRESETS,
		"default_gst_rate": calc.DEFAULT_GST_RATE,
		"file_types": list(ALLOWED_SANCTION_ORDER_EXTENSIONS),
		"max_file_mb": min(cint((frappe.conf.get("max_file_size") or 25 * 1024 * 1024) / 1048576), 25),
	}


@frappe.whitelist()
def projects(txt=None):
	"""Projects to pick from (Project ID + name)."""
	txt = cstr(txt).strip()
	filters = {}
	or_filters = None
	if txt:
		like = f"%{txt}%"
		or_filters = [["name", "like", like], ["project_name", "like", like]]
	kwargs = dict(
		fields=["name", "project_name"],
		filters=filters,
		or_filters=or_filters,
		order_by="modified desc",
		limit_page_length=20,
	)
	try:
		rows = frappe.get_list("Project", **kwargs)
	except frappe.PermissionError:
		# a user who may create bills must still be able to name the project of the bill
		if not frappe.has_permission(DOCTYPE, "create"):
			raise
		rows = frappe.get_all("Project", **kwargs)
	return [{"name": r.name, "project_name": r.project_name or r.name} for r in rows]


def _project_names(project_ids):
	if not project_ids:
		return {}
	try:
		pairs = frappe.get_all(
			"Project", filters={"name": ["in", project_ids]}, fields=["name", "project_name"], as_list=True
		)
	except frappe.PermissionError:
		return {}
	return dict(pairs)


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
			[DOCTYPE, "project", "like", like],
			[DOCTYPE, "name", "like", like],
		]
		try:
			ids = frappe.get_all("Project", filters=[["project_name", "like", like]], pluck="name", limit_page_length=50)
		except frappe.PermissionError:
			ids = []
		if ids:
			or_filters.append([DOCTYPE, "project", "in", ids])

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


def _clean_rows(rows, keys):
	out = []
	for row in rows or []:
		if not isinstance(row, dict):
			continue
		clean = {}
		for k in keys:
			value = row.get(k)
			clean[k] = cstr(value).strip() if k == "particular" else flt(value)
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
		else:
			doc.set(field, flt(value))

	for table, keys in TABLE_FIELDS.items():
		if table in data:
			doc.set(table, [])
			for row in _clean_rows(data.get(table), keys):
				doc.append(table, row)

	doc.save()
	return _bill_dict(doc)
