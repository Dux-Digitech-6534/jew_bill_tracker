# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

import frappe

ROLE = "Bill Tracker User"


def execute():
	"""The role that carries every right of the Bill Tracker (bills, projects, settings, page). Safe to run again."""
	if frappe.db.exists("Role", ROLE):
		return
	frappe.get_doc({"doctype": "Role", "role_name": ROLE, "desk_access": 1}).insert(ignore_permissions=True)
