# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

"""Server side of the Bill Tracker page (/app/bill-tracker).

All reads go through ``frappe.get_list`` so user permissions (role permissions,
user permissions, permission query conditions) are always respected.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

DOCTYPE = "Project Bill"
BILL_TYPES = ("RA - Running Account", "PA - Part Account")
MAX_PAGE_LENGTH = 500


def _build_filters(project=None, bill_type=None, from_date=None, to_date=None):
	filters = []

	if project:
		filters.append([DOCTYPE, "project", "=", project])

	if bill_type:
		# accept the short codes too ("RA" / "PA")
		bill_type = next((b for b in BILL_TYPES if b == bill_type or b.split(" - ")[0] == bill_type), None)
		if not bill_type:
			frappe.throw(_("Invalid Bill Type"))
		filters.append([DOCTYPE, "bill_type", "=", bill_type])

	if from_date:
		filters.append([DOCTYPE, "bill_date", ">=", from_date])
	if to_date:
		filters.append([DOCTYPE, "bill_date", "<=", to_date])

	return filters


@frappe.whitelist()
def get_bills(project=None, bill_type=None, from_date=None, to_date=None, start=0, page_length=50):
	"""Return one page of bills plus totals for the whole filtered set.

	Totals (count, bill amount, sanction amount) cover every bill the user may
	read that matches the filters, not just the rows of the current page.
	"""
	frappe.has_permission(DOCTYPE, "read", throw=True)

	filters = _build_filters(project, bill_type, from_date, to_date)
	start = max(cint(start), 0)
	page_length = min(max(cint(page_length), 1), MAX_PAGE_LENGTH)

	rows = frappe.get_list(
		DOCTYPE,
		filters=filters,
		fields=[
			"name",
			"project",
			"bill_type",
			"bill_no",
			"bill_date",
			"bill_amount",
			"sanction_no",
			"sanction_amount",
			"sanction_order",
		],
		order_by="bill_date desc, creation desc",
		limit_start=start,
		limit_page_length=page_length,
	)

	totals = frappe.get_list(
		DOCTYPE,
		filters=filters,
		# v16 query engine: aggregates must use dict syntax, not "sum(x) as y" strings
		fields=[
			{"COUNT": "*", "as": "total_bills"},
			{"SUM": "bill_amount", "as": "total_bill_amount"},
			{"SUM": "sanction_amount", "as": "total_sanction_amount"},
		],
	)
	totals = totals[0] if totals else {}
	total_bills = cint(totals.get("total_bills"))

	# Show readable project names next to the Project ID.
	project_ids = list({r.project for r in rows if r.project})
	project_names = {}
	if project_ids:
		project_names = dict(
			frappe.get_all(
				"Project",
				filters={"name": ["in", project_ids]},
				fields=["name", "project_name"],
				as_list=True,
			)
		)
	for r in rows:
		r["project_name"] = project_names.get(r.project) or r.project

	return {
		"rows": rows,
		"totals": {
			"total_bills": total_bills,
			"total_bill_amount": flt(totals.get("total_bill_amount")),
			"total_sanction_amount": flt(totals.get("total_sanction_amount")),
		},
		"start": start,
		"has_more": start + len(rows) < total_bills,
		"can_create": bool(frappe.has_permission(DOCTYPE, "create")),
	}
