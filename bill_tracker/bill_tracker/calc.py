# Copyright (c) 2026, DUX Digitech and contributors
# For license information, please see license.txt

"""Payment calculation of a sanction order.

One place for the maths, used by the Project Bill document (on every save), by the Bill Tracker
page and by the mobile app (live preview) - so all of them always agree.

The shape follows the sanction orders we receive (MPUDCL "Sanction Order", Jal Nigam "Summary of RA"):

    Work value (before GST)               <- sum of the work-wise breakup lines, or typed in
  + SGST + CGST                           <- GST rate on the work value, or typed in
  = Bill total (incl. GST)
  + Additions   (e.g. release of withheld amount of earlier RA bills)
  = Gross total
  - Deductions  (Labour Cess, Retention, TDS ... )
  = Net payable

Rule for every GST / addition / deduction line: a Rate (%) makes the amount automatic
(work value x rate, rounded to the whole rupee, exactly like the orders do); leave the rate empty and
type the amount yourself. So anything on an order that does not follow a rate can still be entered.

Every calculated figure can also be typed over (the order's own figure wins): an amount of a line that has a rate
("amount_manual"), the work value when ULB lines exist ("base_manual"), SGST / CGST ("gst_manual"). A typed figure stays
as typed; the rest of the bill is worked out from it.
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from frappe.utils import cint, cstr

ZERO = Decimal("0")

# Sanctioning departments we get orders from. "Other" keeps the form usable for new ones.
AUTHORITIES = ("MPUDCL", "Jal Nigam", "Other")

# The standard lines of each department's order, in the order the order prints them. A new bill starts with
# these already on the form (so the accounts team does not retype them for every bill):
#   - a line with a "rate" is calculated automatically (work value x rate);
#   - a line without a rate is an amount that differs bill to bill - typed in, and dropped on save when left empty.
# "optional_*" lines are not shown by default, they are one click away.
RELEASE_WITHHELD = "Release withheld amount in RA Bill No. … & Kayakalp Work"
WITHHELD_OPTIONAL = [
	{"particular": "Amount Withheld for SIP"},
	{"particular": "Amount Withheld for Labour License"},
	{"particular": "Amount Withheld for PF"},
	{"particular": "Amount Withheld for Royalty"},
]
PRESETS = {
	"MPUDCL": {
		"deductions": [
			{"particular": "Labour Cess", "rate": 1},
			{"particular": "Retention Money", "rate": 5},
			{"particular": "TDS on SGST", "rate": 1},
			{"particular": "TDS on CGST", "rate": 1},
			{"particular": "Amount Withheld for Workman Compensation Policy"},
			{"particular": "Amount Withheld for Liquidity Damages"},  # spelt as the order prints it
			{"particular": "Amount Withheld for SIP"},
			{"particular": "Amount Withheld for Labour License"},
			{"particular": "Amount Withheld for PF"},
			{"particular": "Amount Withheld for Royalty"},
			{"particular": "TDS", "rate": 2},
		],
		"additions": [{"particular": RELEASE_WITHHELD}],
		"optional_deductions": [],
		"optional_additions": [],
	},
	"Jal Nigam": {
		"deductions": [
			{"particular": "GST TDS", "rate": 2},
			{"particular": "TDS", "rate": 2},
			{"particular": "Labour Welfare Cess", "rate": 1},
			{"particular": "Performance Security Deposit"},
		],
		"additions": [],
		"optional_deductions": list(WITHHELD_OPTIONAL),
		"optional_additions": [{"particular": "Release of withheld amount (earlier RA bills)"}],
	},
	"Other": {
		"deductions": [],
		"additions": [],
		"optional_deductions": [
			{"particular": "Retention Money"},
			{"particular": "TDS"},
			{"particular": "Labour Cess"},
			*WITHHELD_OPTIONAL,
		],
		"optional_additions": [{"particular": "Release of withheld amount (earlier RA bills)"}],
	},
}

# the department a new bill starts with (its standard lines are on the form straight away)
DEFAULT_AUTHORITY = "MPUDCL"

DEFAULT_GST_RATE = 18


def D(value):
	"""Tolerant Decimal: blank / junk / commas never raise (the form validates separately)."""
	if value is None or value == "":
		return ZERO
	if isinstance(value, Decimal):
		return value
	try:
		return Decimal(cstr(value).replace(",", "").replace("₹", "").strip() or "0")
	except InvalidOperation:
		return ZERO


def paise(value):
	return D(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def rupee(value):
	"""Whole rupee, half up - how the orders round every calculated line."""
	return D(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def num(value):
	"""Decimal -> float for JSON / document fields (all values here are 2-decimal money)."""
	return float(value)


def amount_in_words(amount):
	"""'Rupees One Crore Forty Eight Lac ... Only' - the wording printed at the foot of the orders."""
	from frappe.utils import money_in_words

	if not amount:
		return ""
	text = money_in_words(float(amount), "INR").replace(",", "").strip()
	text = text.replace("Lakh", "Lac").replace(" And ", " ")  # as the order prints it: "... Nine Hundred Seventeen Only"
	if text.startswith("INR "):
		text = "Rupees " + text[4:]
	text = text.rstrip(".")
	if text.lower().endswith(" only"):
		text = text[:-5]
	return text + " Only"


def _rows(items, base, with_rate):
	"""Normalise a list of line dicts: drop empty rows, apply the rate rule."""
	out = []
	for item in items or []:
		particular = cstr(item.get("particular")).strip()
		rate = D(item.get("rate")) if with_rate else ZERO
		amount = paise(item.get("amount"))
		contract = paise(item.get("contract_amount")) if not with_rate else ZERO
		if not (particular or rate or amount or contract):
			continue  # a blank row the user never filled
		auto = False
		manual = with_rate and rate > 0 and bool(cint(item.get("amount_manual")))  # typed over the calculated amount
		if with_rate and rate > 0 and not manual:
			amount = rupee(base * rate / 100)
			auto = True
		if with_rate and not rate and not amount:
			continue  # a standard line left empty (e.g. "Amount Withheld ...") is simply not part of this bill
		row = {"particular": particular, "amount": num(amount)}
		if with_rate:
			row["rate"] = num(rate)
			row["auto"] = auto
			row["amount_manual"] = 1 if manual else 0
		else:
			row["contract_amount"] = num(contract)
		out.append(row)
	return out


def compute(data):
	"""Work out every figure of the order from the entered ones. ``data`` is a plain dict."""
	g = data.get

	# ---- work value ---------------------------------------------------------------------------
	work_lines = _rows(g("work_lines"), ZERO, with_rate=False)
	work_total = sum((D(r["amount"]) for r in work_lines), ZERO)
	base_manual = work_total > 0 and bool(cint(g("base_manual")))  # work value typed over the ULB total
	base_from_lines = work_total > 0 and not base_manual
	base = work_total if base_from_lines else paise(g("base_amount"))

	# ---- GST ----------------------------------------------------------------------------------
	gst_rate = D(g("gst_rate"))
	gst_manual = gst_rate > 0 and bool(cint(g("gst_manual")))  # SGST / CGST typed over the calculated ones
	gst_auto = gst_rate > 0 and not gst_manual
	if gst_auto:
		sgst = cgst = rupee(base * gst_rate / 200)  # half each, like the orders (9% + 9%)
	else:
		sgst, cgst = paise(g("sgst_amount")), paise(g("cgst_amount"))
	bill_total = base + sgst + cgst

	# ---- additions, deductions, net -----------------------------------------------------------
	additions = _rows(g("additions"), base, with_rate=True)
	deductions = _rows(g("deductions"), base, with_rate=True)
	additions_total = sum((D(r["amount"]) for r in additions), ZERO)
	deductions_total = sum((D(r["amount"]) for r in deductions), ZERO)
	gross_total = bill_total + additions_total
	net = gross_total - deductions_total

	# ---- cross-check with the figure printed on the order ------------------------------------
	printed = paise(g("net_as_per_order"))
	net_difference = (net - printed) if printed > 0 else ZERO

	# ---- contract and progress (optional, Jal Nigam style summary) ----------------------------
	contract_value = paise(g("contract_value"))
	till_date = paise(g("work_done_till_date"))
	previous = paise(g("previous_payments"))
	claimed = (till_date - previous) if till_date > 0 else ZERO
	balance = (contract_value - till_date) if (contract_value > 0 and till_date > 0) else ZERO

	return {
		"work_lines": work_lines,
		"work_total": num(work_total),
		"base_from_lines": base_from_lines,
		"base_manual": 1 if base_manual else 0,
		"base_amount": num(base),
		"gst_rate": num(gst_rate),
		"gst_auto": gst_auto,
		"gst_manual": 1 if gst_manual else 0,
		"sgst_amount": num(sgst),
		"cgst_amount": num(cgst),
		"gst_total": num(sgst + cgst),
		"bill_total": num(bill_total),
		"additions": additions,
		"additions_total": num(additions_total),
		"gross_total": num(gross_total),
		"deductions": deductions,
		"deductions_total": num(deductions_total),
		"net_payable": num(net),
		"net_payable_words": amount_in_words(net) if net > 0 else "",
		"net_as_per_order": num(printed),
		"net_difference": num(net_difference),
		"contract_value": num(contract_value),
		"work_done_till_date": num(till_date),
		"previous_payments": num(previous),
		"claimed_this_bill": num(claimed),
		"balance_work": num(balance),
	}


# fields of the Project Bill document that feed / receive the calculation
INPUT_FIELDS = (
	"base_amount",
	"base_manual",
	"gst_manual",
	"gst_rate",
	"sgst_amount",
	"cgst_amount",
	"net_as_per_order",
	"contract_value",
	"work_done_till_date",
	"previous_payments",
)
OUTPUT_FIELDS = (
	"base_amount",
	"base_manual",
	"gst_manual",
	"gst_rate",
	"sgst_amount",
	"cgst_amount",
	"bill_total",
	"additions_total",
	"gross_total",
	"deductions_total",
	"net_payable",
	"net_payable_words",
	"net_as_per_order",
	"net_difference",
	"contract_value",
	"work_done_till_date",
	"previous_payments",
	"claimed_this_bill",
	"balance_work",
)
TABLES = {
	"work_lines": ("particular", "contract_amount", "amount"),
	"additions": ("particular", "rate", "amount", "amount_manual"),
	"deductions": ("particular", "rate", "amount", "amount_manual"),
}


def doc_to_input(doc):
	"""Collect the calculation inputs from a Project Bill document."""
	data = {f: doc.get(f) for f in INPUT_FIELDS}
	for table, keys in TABLES.items():
		data[table] = [{k: row.get(k) for k in keys} for row in (doc.get(table) or [])]
	return data


def apply_to_doc(doc, result=None):
	"""Write the calculated figures and normalised lines back onto the document."""
	result = result or compute(doc_to_input(doc))
	for field in OUTPUT_FIELDS:
		doc.set(field, result[field])

	for table, keys in TABLES.items():
		rows = result[table]
		existing = list(doc.get(table) or [])
		for i, row in enumerate(rows):
			values = {k: row.get(k) for k in keys}
			if i < len(existing):
				existing[i].update(values)  # keep the child row (and its name) on re-save
			else:
				doc.append(table, values)
		for extra in existing[len(rows) :]:
			doc.remove(extra)
		for idx, row in enumerate(doc.get(table) or [], start=1):
			row.idx = idx
	return result
