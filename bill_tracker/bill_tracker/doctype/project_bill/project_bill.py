# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, flt, fmt_money

from bill_tracker.bill_tracker import calc

# Sanction orders are scanned copies: PDF or an image.
ALLOWED_SANCTION_ORDER_EXTENSIONS = (
	".pdf",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".bmp",
	".tif",
	".tiff",
	".heic",
	".heif",
)


class ProjectBill(Document):
	def validate(self):
		self.bill_no = cstr(self.bill_no).strip()
		self.sanction_no = cstr(self.sanction_no).strip()
		self.package_no = cstr(self.package_no).strip()

		self.validate_project()
		self.validate_amounts()
		self.validate_calculation_inputs()
		self.calculate()
		self.validate_net_payable()
		self.validate_sanction_order()
		self.validate_duplicate()

	def on_update(self):
		# the draft Sales Invoice that goes with the bill (see invoice.py); never blocks the save
		from bill_tracker.bill_tracker import invoice

		invoice.on_bill_saved(self)

	def validate_project(self):
		"""New bills (or a changed project) need an enabled Bill Project; old bills of a disabled one stay editable."""
		if not self.project or not (self.is_new() or self.has_value_changed("project")):
			return
		if frappe.db.get_value("Bill Project", self.project, "disabled"):
			frappe.throw(
				_("Project {0} is disabled. Enable it in the Settings tab to add bills to it.").format(
					frappe.bold(self.project)
				),
				title=_("Disabled Project"),
			)

	def validate_amounts(self):
		if flt(self.bill_amount) <= 0:
			frappe.throw(_("Bill Amount must be greater than zero."), title=_("Invalid Amount"))

		if flt(self.sanction_amount) < 0:
			frappe.throw(_("Sanction Amount cannot be negative."), title=_("Invalid Amount"))

	def validate_calculation_inputs(self):
		"""Amounts and rates entered for the payment calculation must make sense."""
		title = _("Invalid Amount")

		for field in (
			"base_amount",
			"sgst_amount",
			"cgst_amount",
			"net_as_per_order",
			"contract_value",
			"work_done_till_date",
			"previous_payments",
		):
			if flt(self.get(field)) < 0:
				frappe.throw(_("{0} cannot be negative.").format(_(self.meta.get_label(field))), title=title)

		if not 0 <= flt(self.gst_rate) <= 100:
			frappe.throw(_("GST Rate must be between 0 and 100."), title=title)

		for table, label in (("work_lines", _("Work Line")), ("additions", _("Addition")), ("deductions", _("Deduction"))):
			for row in self.get(table) or []:
				if flt(row.get("amount")) < 0 or flt(row.get("contract_amount")) < 0:
					frappe.throw(_("{0} row {1}: amounts cannot be negative.").format(label, row.idx), title=title)
				if not 0 <= flt(row.get("rate")) <= 100:
					frappe.throw(_("{0} row {1}: Rate must be between 0 and 100.").format(label, row.idx), title=title)
				if not cstr(row.get("particular")).strip() and (
					flt(row.get("amount")) or flt(row.get("rate")) or flt(row.get("contract_amount"))
				):
					frappe.throw(_("{0} row {1}: enter the particular.").format(label, row.idx), title=title)

		if flt(self.work_done_till_date) and flt(self.previous_payments) > flt(self.work_done_till_date):
			frappe.throw(
				_("Previous Bill Payments cannot be more than Work Done till Date."), title=_("Invalid Amount")
			)

	def calculate(self):
		"""Work out every total from the entered figures (see calc.py for the rules)."""
		calc.apply_to_doc(self)

	def validate_net_payable(self):
		if flt(self.net_payable) < 0:
			frappe.throw(
				_("Deductions ({0}) are more than the Gross Total ({1}), so the Net Payable would be negative.").format(
					frappe.bold(fmt_money(self.deductions_total, currency="INR")),
					frappe.bold(fmt_money(self.gross_total, currency="INR")),
				),
				title=_("Invalid Amount"),
			)

	def validate_sanction_order(self):
		if not self.sanction_order:
			return  # the mandatory check reports a missing file

		if not (self.is_new() or self.has_value_changed("sanction_order")):
			return  # do not re-validate old attachments on unrelated edits

		extension = os.path.splitext(cstr(self.sanction_order).split("?")[0])[1].lower()
		if extension not in ALLOWED_SANCTION_ORDER_EXTENSIONS:
			frappe.throw(
				_("Sanction Order must be a PDF or an image file (allowed: {0}).").format(
					", ".join(ALLOWED_SANCTION_ORDER_EXTENSIONS)
				),
				title=_("Invalid File Type"),
			)

	def validate_duplicate(self):
		"""One bill per Project + Bill Type + Bill No."""
		if not (self.project and self.bill_type and self.bill_no):
			return  # the mandatory check reports the missing fields

		filters = {
			"project": self.project,
			"bill_type": self.bill_type,
			"bill_no": self.bill_no,
		}
		if not self.is_new():
			filters["name"] = ("!=", self.name)

		existing = frappe.db.get_value("Project Bill", filters, "name")
		if existing:
			frappe.throw(
				_("Project Bill {0} already exists for Project {1}, Bill Type {2}, Bill No {3}.").format(
					frappe.bold(existing),
					frappe.bold(self.project),
					frappe.bold(self.bill_type),
					frappe.bold(self.bill_no),
				),
				title=_("Duplicate Bill"),
			)
