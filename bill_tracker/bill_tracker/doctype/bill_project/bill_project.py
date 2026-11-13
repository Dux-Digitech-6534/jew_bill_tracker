# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr


class BillProject(Document):
	"""A project the Bill Tracker raises bills for. Its name IS the id (autoname: field:project_name)."""

	def before_naming(self):
		# the id comes from the name, so tidy it before it is used (runs before validate)
		self.project_name = " ".join(cstr(self.project_name).split())

	def validate(self):
		self.project_name = " ".join(cstr(self.project_name).split())
		if not self.project_name:
			frappe.throw(_("Enter the project name."), title=_("Project Name"))

		# the database matches names without regard to case, so "abc" and "ABC" are one project - keep one
		if self.is_new():
			existing = frappe.db.get_value("Bill Project", self.project_name, "name")
			if existing:
				frappe.throw(
					_("Project {0} already exists.").format(frappe.bold(existing)), title=_("Duplicate Project")
				)
