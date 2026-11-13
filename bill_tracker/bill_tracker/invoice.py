# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

"""The DRAFT Sales Invoice that goes with a Project Bill.

When a sanction order bill is saved, a Sales Invoice is made for it, modelled on the invoices the accounts
team makes by hand (one "Works Contract Receipt" item line per ULB of the order - the breakup - CGST + SGST
on the net total, in the company's books). It is only ever a DRAFT: the Bill Tracker never submits it, the
accounts team checks it and submits it themselves. While it is still a draft it follows the bill when the bill
is edited; once it is submitted (or cancelled) it is left alone.

Whatever goes wrong here never loses the bill: the problem is reported back and the bill stays saved.
"""

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, flt, getdate, strip_html, today

SETTINGS = "Bill Tracker Settings"
SALES_INVOICE = "Sales Invoice"

DRAFT, SUBMITTED, CANCELLED = 0, 1, 2
STATUS_LABEL = {DRAFT: "Draft", SUBMITTED: "Submitted", CANCELLED: "Cancelled"}


class _full_rights:
	"""Make / refresh the draft invoice with full rights, whoever saves the bill.

	The person saving a bill (e.g. a "Bill Tracker User") needs no right on Sales Invoice, Customer, Item, Address
	or the tax masters - the invoice is the Bill Tracker's own doing. The invoice is attributed to that person afterwards.
	"""

	def __enter__(self):
		self.user = frappe.session.user
		if self.user != "Administrator":
			frappe.set_user("Administrator")
		return self

	def __exit__(self, *exc):
		if frappe.session.user != self.user:
			frappe.set_user(self.user)
		return False


# ------------------------------------------------------------------ what is linked
def linked(bill):
	"""The Sales Invoice linked to a bill: {name, docstatus, grand_total, posting_date} or None (none / deleted)."""
	name = cstr(bill.get("sales_invoice")).strip()
	if not name:
		return None
	row = frappe.db.get_value(
		SALES_INVOICE, name, ["name", "docstatus", "grand_total", "rounded_total", "posting_date"], as_dict=True
	)
	if not row:
		return None
	row["status"] = STATUS_LABEL.get(row.docstatus, "")
	row["total"] = flt(row.rounded_total) or flt(row.grand_total)
	return row


def info(bill):
	"""What the page shows about the bill's invoice."""
	name = cstr(bill.get("sales_invoice")).strip()
	row = linked(bill)
	if not name:
		return None
	if not row:
		return {"name": name, "docstatus": None, "status": "Missing"}
	return {
		"name": row.name,
		"docstatus": row.docstatus,
		"status": row.status,
		"total": row.total,
		"posting_date": cstr(row.posting_date),
	}


# ------------------------------------------------------------------ settings
def get_settings():
	return frappe.get_single(SETTINGS)


def _settings_for(bill):
	cfg = get_settings()
	company = cfg.company or frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw(_("Set the Company in the Settings tab of the Bill Tracker."))
	if not cfg.item_code:
		frappe.throw(_("Set the Invoice Item in the Settings tab of the Bill Tracker."))
	return cfg, company


# ------------------------------------------------------------------ the invoice lines (the breakup)
def _ref(bill):
	code = cstr(bill.bill_type).split(" - ")[0] or "Bill"
	text = f"{code}-{bill.bill_no}"
	if cstr(bill.package_no).strip():
		text += f" (Pkg {cstr(bill.package_no).strip()})"
	return text


def lines_of(bill):
	"""[(description, amount)]: one per ULB with an amount, else a single line for the whole work value."""
	ref = _ref(bill)
	project = cstr(bill.project)
	lines = [
		(f"Works contract - {cstr(r.particular).strip()} - {ref} - {project}", flt(r.amount))
		for r in bill.get("work_lines") or []
		if flt(r.amount) > 0
	]
	if lines and not (cint(bill.get("base_manual")) and abs(sum(a for _d, a in lines) - flt(bill.base_amount)) > 0.005):
		return lines
	if flt(bill.base_amount) > 0:
		return [(f"Works contract for {project} - {ref}", flt(bill.base_amount))]
	return []


def _remarks(bill, customer):
	text = f"Being amount debited to {customer} against {bill.project} - {_ref(bill)}"
	if cstr(bill.sanction_no).strip():
		text += f" as per sanction order {cstr(bill.sanction_no).strip()}"
		if bill.sanction_date:
			text += f" dt {getdate(bill.sanction_date).strftime('%d/%m/%Y')}"
	return f"{text}. Bill Tracker: {bill.name}"


# ------------------------------------------------------------------ posting date
def posting_days_before(cfg):
	days = cfg.get("posting_days_before")
	return 2 if days in (None, "") else max(cint(days), 0)


def _is_off(day, holiday_list):
	"""Sunday, or a day of the holiday list."""
	if day.weekday() == 6:
		return True
	if holiday_list:
		from erpnext.setup.doctype.holiday_list.holiday_list import is_holiday

		return bool(is_holiday(holiday_list, day))
	return False


def posting_date_for(bill, cfg, company):
	"""The draft is posted 2 days (setting) before the bill date. A Sunday / holiday is skipped: the previous working
	day by default, or the next one (never later than the day before the bill date)."""
	bill_date = getdate(bill.bill_date or today())
	target = add_days(bill_date, -posting_days_before(cfg))
	holiday_list = cfg.get("holiday_list") or frappe.db.get_value("Company", company, "default_holiday_list")
	if not _is_off(target, holiday_list):
		return target

	def walk(step, limit):
		day = target
		for _i in range(limit):
			day = add_days(day, step)
			if not _is_off(day, holiday_list):
				return day
		return None

	if cfg.get("holiday_direction") == "Next working day":
		day = walk(1, 14)
		if day and day < bill_date:
			return day
	return walk(-1, 30) or target


# ------------------------------------------------------------------ build / sync
def _set_items(si, bill, cfg, cost_center):
	si.set("items", [])
	for description, amount in lines_of(bill):
		si.append(
			"items",
			{
				"item_code": cfg.item_code,
				"qty": 1,
				"rate": amount,
				"description": description,
				"cost_center": cost_center or None,
			},
		)


def _set_taxes(si, cfg):
	"""Same-state or other-state GST template, by the supply's place against the company's state."""
	in_state = True
	pos = cstr(si.get("place_of_supply"))[:2]
	gstin = cstr(si.get("company_gstin"))[:2]
	if pos and gstin and pos != gstin:
		in_state = False
	template = (cfg.taxes_in_state if in_state else cfg.taxes_out_state) or cfg.taxes_in_state
	if not template:
		return
	from erpnext.controllers.accounts_controller import get_taxes_and_charges

	si.taxes_and_charges = template
	si.set("taxes", [])
	for row in get_taxes_and_charges("Sales Taxes and Charges Template", template):
		si.append("taxes", row)


def _header(si, bill, customer, cost_center, cfg, company):
	si.posting_date = posting_date_for(bill, cfg, company)
	si.set_posting_time = 1
	si.due_date = si.posting_date
	si.po_no = _ref(bill)[:140]
	si.remarks = _remarks(bill, customer)
	if cost_center:
		si.cost_center = cost_center


def _build(bill):
	"""A new draft Sales Invoice for the bill (inserted, never submitted)."""
	cfg, company = _settings_for(bill)
	project = frappe.db.get_value("Bill Project", bill.project, ["customer", "cost_center"], as_dict=True) or {}
	customer = project.get("customer")
	if not customer:
		frappe.throw(
			_("Project {0} has no Customer. Add it in the Settings tab (Projects), then use \"Create draft Sales Invoice\" on this bill.").format(
				frappe.bold(bill.project)
			)
		)
	if not lines_of(bill):
		frappe.throw(_("The work value of this bill is zero, so there is nothing to invoice."))
	cost_center = project.get("cost_center") or cfg.cost_center

	si = frappe.new_doc(SALES_INVOICE)
	si.company = company
	si.customer = customer
	_header(si, bill, customer, cost_center, cfg, company)
	_set_items(si, bill, cfg, cost_center)
	si.run_method("set_missing_values")
	_set_taxes(si, cfg)
	si.run_method("calculate_taxes_and_totals")
	si.insert(ignore_permissions=True)
	return si


def _sync(si, bill):
	"""Bring a still-draft invoice in line with the (edited) bill: its lines, date, PO ref and remarks."""
	cfg, company = _settings_for(bill)
	project = frappe.db.get_value("Bill Project", bill.project, ["customer", "cost_center"], as_dict=True) or {}
	cost_center = project.get("cost_center") or cfg.cost_center or si.get("cost_center")
	if not lines_of(bill):
		frappe.throw(_("The work value of this bill is zero, so there is nothing to invoice."))
	_header(si, bill, si.customer, cost_center, cfg, company)
	si.set("payment_schedule", [])  # rebuilt from the new dates and total on save
	_set_items(si, bill, cfg, cost_center)
	si.run_method("set_missing_values")
	if not si.get("taxes"):
		_set_taxes(si, cfg)
	si.run_method("calculate_taxes_and_totals")
	si.save(ignore_permissions=True)
	return si


def sync_for_bill(bill, force=False):
	"""Create or refresh the bill's draft Sales Invoice.

	``force`` is the explicit "Create draft Sales Invoice" button: it works even when automatic creation is
	switched off, and makes a new invoice when the old one was cancelled or deleted. Returns
	{"name", "action", "message"}; with ``force`` a problem is raised, otherwise it is returned as the message.
	"""
	result = {"name": cstr(bill.get("sales_invoice")), "action": "none", "message": ""}
	existing = linked(bill)

	if existing and existing.docstatus == SUBMITTED:
		result["message"] = _("Sales Invoice {0} is already submitted - it was not changed.").format(existing.name)
		return result
	if existing and existing.docstatus == CANCELLED and not force:
		return result  # a cancelled invoice is not quietly brought back
	if not existing and not force and not get_settings().auto_create_invoice:
		return result
	if not existing and not force and cstr(bill.get("sales_invoice")).strip():
		return result  # linked invoice was deleted on purpose: no surprise re-creation, the button is there

	logs = len(frappe.local.message_log or [])
	user = frappe.session.user
	frappe.db.savepoint("bt_invoice")
	try:
		with _full_rights():
			if existing and existing.docstatus == DRAFT:
				si = _sync(frappe.get_doc(SALES_INVOICE, existing.name), bill)
				result["action"] = "synced"
			else:
				si = _build(bill)
				result["action"] = "created"
		if user != "Administrator":  # the invoice is the bill-saver's: owner on creation, "modified by" always
			values = {"modified_by": user} if result["action"] == "synced" else {"owner": user, "modified_by": user}
			frappe.db.set_value(SALES_INVOICE, si.name, values, update_modified=False)
		bill.db_set("sales_invoice", si.name, update_modified=False)
		result["name"] = si.name
	except Exception as e:  # noqa: BLE001 - the bill must stay saved whatever the invoice does
		frappe.db.rollback(save_point="bt_invoice")
		del frappe.local.message_log[logs:]  # the page shows the reason itself, not as a popup
		reason = strip_html(cstr(e)).strip() or e.__class__.__name__
		if force:
			frappe.throw(reason, title=_("Sales Invoice"))
		frappe.log_error(title="Bill Tracker: draft Sales Invoice not made", message=frappe.get_traceback())
		result["action"] = "failed"
		result["message"] = reason
	return result


def on_bill_saved(bill):
	"""Called by the Project Bill after every save; the outcome is left on ``bill.flags.invoice_result``."""
	if frappe.flags.in_import or frappe.flags.in_migrate or frappe.flags.in_install:
		return
	bill.flags.invoice_result = sync_for_bill(bill)

