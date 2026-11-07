# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, flt

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

		self.validate_amounts()
		self.validate_sanction_order()
		self.validate_duplicate()

	def validate_amounts(self):
		if flt(self.bill_amount) <= 0:
			frappe.throw(_("Bill Amount must be greater than zero."), title=_("Invalid Amount"))

		if flt(self.sanction_amount) < 0:
			frappe.throw(_("Sanction Amount cannot be negative."), title=_("Invalid Amount"))

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
