### Bill Tracker

Track project bills (RA/PA) with sanction orders

Built for Frappe / ERPNext v16 (Jain Engineering Works, `jewipl`).

**What is inside**

- **Project Bill** DocType (module *Bill Tracker*): Project, Bill Type (RA - Running Account / PA - Part Account),
  Bill No, Bill Date, Bill Amount and the Sanction Order file (PDF or image, mandatory).
  The **Project** is a *Bill Project* - the Bill Tracker's own list (name = project name, optional default department, the
  customer the draft Sales Invoice is made out to, cost center, disabled flag). Projects are added from the Settings tab or
  straight from the Project field of a bill; they are never deleted from the page, only disabled. Numbered `PB-.YYYY.-.####`, track changes on. A Project + Bill Type + Bill No combination can only be entered once.
  System Manager has full access; Projects Manager and Accounts User can read, write and create.
- **Sanction order details and payment calculation** (MPUDCL "Sanction Order" and Jal Nigam "Summary of RA" style):
  sanctioning department, order no / date, package no, sanction amount, an optional ULB-wise breakup
  (child table *Project Bill Work Line*: ULB name, **Design Build Amount** = full value of the ULB as printed in the order,
  **Amount** = what this bill claims for it, **Difference** = Design Build Amount - Amount, still left), GST, additions (e.g. release of withheld amount) and deductions
  (child table *Project Bill Adjustment*: Labour Cess, Retention, TDS ...), the net payable (also in words) and a cross-check
  against the net amount printed on the order. Optional contract / progress figures (contract value, work done till date,
  previous payments -> claimed under this bill, balance work).
  The rule is the same for every GST / addition / deduction line: give a **Rate %** and the amount is worked out on the
  work value (whole rupee, half up, like the orders); leave the rate empty and type the amount. The maths lives in
  `bill_tracker/calc.py` and is shared by the document (every save) and the page (live preview). A new bill starts as MPUDCL
  with that order's lines already on the form, in the order's sequence (Labour Cess 1%, Retention 5%, TDS on SGST 1%, TDS on
  CGST 1%, Workman Compensation, Liquidity Damages, SIP, Labour License, PF, Royalty (all "Amount Withheld for ...", typed), TDS 2%, and the "Release withheld amount ... Kayakalp Work" addition);
  lines left without a rate or amount are dropped on save ("Liquidity Damages" is spelt as the order prints it).
  **Every calculated figure can be typed over** (the order's own figure wins): the amount of a line that has a rate
  (`amount_manual`), the work value when ULB lines exist (`base_manual`), SGST / CGST (`gst_manual`); the box is outlined
  and a ↺ button brings the calculated figure back. The payment panel is laid out like the order: Total / Add: / Gross Total /
  Less: (every line) / Total deductions / Net Amount Payable and the amount in words ("Rupees … Lac … Only"). Changing the department swaps the lines nobody has touched
  (`calc.PRESETS`; a project's default department does the same). Both sample orders reproduce to the rupee.
- **Draft Sales Invoice** (`invoice.py`, called from the Project Bill after every save): the bill's invoice is made as a
  DRAFT modelled on the invoices the accounts team makes by hand - customer from the project, one *Works Contract Receipt*
  line per ULB (the breakup; one line for the work value when there are no ULBs), CGST + SGST on the net total (same-state /
  other-state template), PO ref and remarks carry the bill. **Posting date = bill date minus 2 days**; if that day is a
  Sunday or a day of the holiday list (company default or the one in Settings) the previous working day is used (or the
  next one, never later than the day before the bill date - Settings: days, direction, holiday list). With a typed-over
  work value the invoice has one line equal to it. It is **never submitted** by the
  Bill Tracker. While it is a draft it follows edits of the bill; a submitted / cancelled invoice is left alone; there is
  never a second invoice for a bill. A problem (e.g. the project has no customer) never loses the bill - the page shows
  the reason and a *Create draft Sales Invoice* button. The link is stored in `Project Bill.sales_invoice` (a Data field,
  so the draft can still be deleted). Company, item, GST templates, default cost center and an on/off switch live in the
  single doctype *Bill Tracker Settings* (Settings tab).
- **Bill Tracker** page (`/desk/bill-tracker`): one DUX Digitech design-system screen - summary cards (bills, bill amount,
  sanction amount, net payable), search and filters, bill detail (sanction order preview, calculation as on the order),
  and the new / edit form with file upload and live calculation. The Frappe form stays available for back-office use.
  API: `bill_tracker/api.py` (`get_context`, `projects`, `list_bills`, `get_bill`, `calculate`, `save_bill`, `create_invoice`,
  `list_projects`, `save_project`, `lookup`, `get_settings`, `save_settings`).
- **Settings** section of the page (`/desk/bill-tracker/settings`): the projects (add / edit / disable, with department,
  customer, cost center, number of bills) and the draft Sales Invoice defaults.
- **Dashboard** (first section of the page, opens by default): one period filter (All time / This financial year / Last 12
  months / Last 3 months / Custom) scopes everything below it. *Sanction order bills*: bills, bill amount, net payable,
  deductions, a warning when bills differ from the net printed on the order, net payable by month, by department, top
  projects, latest bills. *Fund transfer letters* (when `jv_escrow` is installed): letters, credit received, to JEW / TPPL,
  credit by month, where the credit went (letter 1 split + breakup letters), latest letters. Every chart has a Table view and
  tooltips; rows open the bill / letter or the saved list filtered to that department / project. Numbers come from
  `api.get_dashboard` -> `dashboard.py` and respect the user's permissions. `/desk/bill-tracker/bills` and `/letters` open
  those sections directly.
- **Fund transfer letters section** inside the Bill Tracker page: when the `jv_escrow` app is installed on the site (and the
  user may read *Escrow Fund Transfer*), the page shows a switch *Sanction order bills | Fund transfer letters*. The second
  section is the TPPL-JEW-JV escrow letters screen (credit amount -> both letters, Generate PDF, Save record, Saved
  letters), loaded from `jv_escrow/public/js/escrow_transfer_ui.js`; `/desk/bill-tracker/letters` opens it directly.
  Without `jv_escrow` the switch simply does not appear (`api._escrow_context`).
- A **Bill Tracker Home** workspace (with sidebar and desktop icon) that links to the page and the Project Bill list.

**Editing the page**: the page script is generated from `ui/` (`node ui/build.js`); change `ui/*.js` / `ui/bt_ui.css`,
rebuild and commit the generated `bill_tracker/bill_tracker/page/bill_tracker/bill_tracker.js`.

**Upgrading a site that has the first version**: run `bench --site $SITE migrate`. If that site still has a workspace
named *Bill Tracker*, rename it to *Bill Tracker Home* (or remove it) - a workspace with the same slug as the page makes
`/desk/bill-tracker` open the workspace instead of the page.

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/Dux-Digitech-6534/jew_bill_tracker.git --branch development-07-11-26
bench --site $SITE install-app bill_tracker
```

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/bill_tracker
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
