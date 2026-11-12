# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

"""Numbers of the Bill Tracker dashboard: the sanction order bills and (when the jv_escrow app is on the
site) the fund transfer letters, for one period.

Everything is read through ``frappe.get_list`` so role / user permissions apply to every figure. The
volumes are small (hundreds of documents), so the rows are fetched once and added up here.
"""

import frappe
from frappe.utils import cstr, flt

BILLS = "Project Bill"
LETTERS = "Escrow Fund Transfer"
MAX_ROWS = 50000
MAX_MONTHS = 12
TOP_PROJECTS = 8

BILL_FIELDS = [
	"name",
	"project",
	"bill_type",
	"bill_no",
	"bill_date",
	"creation",
	"bill_amount",
	"sanction_authority",
	"sanction_amount",
	"base_amount",
	"bill_total",
	"additions_total",
	"deductions_total",
	"net_payable",
	"net_as_per_order",
	"net_difference",
]
LETTER_FIELDS = [
	"name",
	"transfer_date",
	"creation",
	"owner",
	"credit_amount",
	"include_breakup",
	"jew_amount",
	"tppl_amount",
	"unallocated_amount",
	"breakup_jew_amount",
	"neft_amount",
]


def _month(value):
	return cstr(value)[:7]


def _add_months(ym, n):
	year, month = int(ym[:4]), int(ym[5:7])
	idx = year * 12 + (month - 1) + n
	return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def month_series(buckets, blank):
	"""Consecutive months (at most the last 12) ending at the latest month that has data; empty months are zero."""
	if not buckets:
		return []
	keys = sorted(buckets)
	last = keys[-1]
	first = max(keys[0], _add_months(last, -(MAX_MONTHS - 1)))
	out, ym = [], first
	while ym <= last:
		row = dict(blank)
		row.update(buckets.get(ym, {}))
		row["month"] = ym
		out.append(row)
		ym = _add_months(ym, 1)
	return out


def _ranked(groups, top=None):
	"""[{"label", "count", "net_payable"}] largest first; with ``top`` the tail is folded into one "Other" row."""
	rows = sorted(
		({"label": k, "count": v["count"], "net_payable": v["net_payable"]} for k, v in groups.items()),
		key=lambda r: (-r["net_payable"], r["label"]),
	)
	if top and len(rows) > top:
		tail = rows[top:]
		rows = rows[:top] + [
			{
				"label": f"Other ({len(tail)} projects)",
				"count": sum(r["count"] for r in tail),
				"net_payable": sum(r["net_payable"] for r in tail),
			}
		]
	return rows


def bills_block(from_date=None, to_date=None):
	filters = []
	if from_date:
		filters.append([BILLS, "bill_date", ">=", from_date])
	if to_date:
		filters.append([BILLS, "bill_date", "<=", to_date])
	rows = frappe.get_list(
		BILLS,
		filters=filters,
		fields=BILL_FIELDS,
		order_by="bill_date desc, creation desc",
		limit_page_length=MAX_ROWS,
	)

	k = {"bill_amount": 0.0, "sanction_amount": 0.0, "net_payable": 0.0, "deductions": 0.0, "gst": 0.0, "additions": 0.0}
	ra = pa = differs = 0
	months, authorities, projects = {}, {}, {}
	for r in rows:
		k["bill_amount"] += flt(r.bill_amount)
		k["sanction_amount"] += flt(r.sanction_amount)
		k["net_payable"] += flt(r.net_payable)
		k["deductions"] += flt(r.deductions_total)
		k["additions"] += flt(r.additions_total)
		k["gst"] += flt(r.bill_total) - flt(r.base_amount)
		if cstr(r.bill_type).startswith("RA"):
			ra += 1
		elif cstr(r.bill_type).startswith("PA"):
			pa += 1
		if flt(r.net_as_per_order) > 0 and abs(flt(r.net_difference)) >= 0.5:
			differs += 1
		m = months.setdefault(_month(r.bill_date or r.creation), {"count": 0, "net_payable": 0.0, "bill_amount": 0.0})
		m["count"] += 1
		m["net_payable"] += flt(r.net_payable)
		m["bill_amount"] += flt(r.bill_amount)
		for groups, key in ((authorities, r.sanction_authority or "Not set"), (projects, r.project or "Not set")):
			g = groups.setdefault(key, {"count": 0, "net_payable": 0.0})
			g["count"] += 1
			g["net_payable"] += flt(r.net_payable)

	return {
		"count": len(rows),
		**k,
		"ra": ra,
		"pa": pa,
		"differs": differs,
		"by_month": month_series(months, {"count": 0, "net_payable": 0.0, "bill_amount": 0.0}),
		"by_authority": _ranked(authorities),
		"by_project": _ranked(projects, TOP_PROJECTS),
		"recent": [
			{
				"name": r.name,
				"project": r.project,
				"bill_type_code": cstr(r.bill_type).split(" - ")[0],
				"bill_no": r.bill_no,
				"bill_date": cstr(r.bill_date),
				"sanction_authority": r.sanction_authority,
				"net_payable": flt(r.net_payable),
			}
			for r in rows[:6]
		],
	}


def letters_block(from_date=None, to_date=None):
	filters = []
	if from_date:
		filters.append([LETTERS, "transfer_date", ">=", from_date])
	if to_date:
		filters.append([LETTERS, "transfer_date", "<=", to_date])
	rows = frappe.get_list(
		LETTERS,
		filters=filters,
		fields=LETTER_FIELDS,
		order_by="transfer_date desc, creation desc",
		limit_page_length=MAX_ROWS,
	)
	k = {"credit": 0.0, "jew": 0.0, "tppl": 0.0, "unallocated": 0.0, "breakup_jew": 0.0, "breakup_neft": 0.0}
	breakup = 0
	months = {}
	for r in rows:
		k["credit"] += flt(r.credit_amount)
		k["jew"] += flt(r.jew_amount)
		k["tppl"] += flt(r.tppl_amount)
		k["unallocated"] += flt(r.unallocated_amount)
		if r.include_breakup:
			breakup += 1
			k["breakup_jew"] += flt(r.breakup_jew_amount)
			k["breakup_neft"] += flt(r.neft_amount)
		m = months.setdefault(_month(r.transfer_date or r.creation), {"count": 0, "credit": 0.0})
		m["count"] += 1
		m["credit"] += flt(r.credit_amount)
	return {
		"count": len(rows),
		**k,
		"breakup_count": breakup,
		"by_month": month_series(months, {"count": 0, "credit": 0.0}),
		"recent": [
			{
				"name": r.name,
				"transfer_date": cstr(r.transfer_date),
				"credit_amount": flt(r.credit_amount),
				"include_breakup": 1 if r.include_breakup else 0,
				"owner_name": frappe.utils.get_fullname(r.owner),
			}
			for r in rows[:6]
		],
	}


def build(from_date=None, to_date=None, with_letters=False):
	return {
		"period": {"from": from_date or None, "to": to_date or None},
		"bills": bills_block(from_date, to_date),
		"letters": letters_block(from_date, to_date) if with_letters else None,
	}
