### Bill Tracker

Track project bills (RA/PA) with sanction orders

Built for Frappe / ERPNext v16 (Jain Engineering Works, `jewipl`).

**What is inside**

- **Project Bill** DocType (module *Bill Tracker*): Project, Bill Type (RA - Running Account / PA - Part Account),
  Bill No, Bill Date, Bill Amount and the Sanction Order file (PDF or image, mandatory).
  Numbered `PB-.YYYY.-.####`, track changes on. A Project + Bill Type + Bill No combination can only be entered once.
  System Manager has full access; Projects Manager and Accounts User can read, write and create.
- **Sanction order details and payment calculation** (MPUDCL "Sanction Order" and Jal Nigam "Summary of RA" style):
  sanctioning department, order no / date, package / agreement no, sanction amount, an optional ULB-wise breakup
  (child table *Project Bill Work Line*), GST, additions (e.g. release of withheld amount) and deductions
  (child table *Project Bill Adjustment*: Labour Cess, Retention, TDS ...), the net payable (also in words) and a cross-check
  against the net amount printed on the order. Optional contract / progress figures (contract value, work done till date,
  previous payments -> claimed under this bill, balance work).
  The rule is the same for every GST / addition / deduction line: give a **Rate %** and the amount is worked out on the
  work value (whole rupee, half up, like the orders); leave the rate empty and type the amount. The maths lives in
  `bill_tracker/calc.py` and is shared by the document (every save) and the page (live preview). Standard deductions per
  department are in `calc.PRESETS`. Both sample orders reproduce to the rupee.
- **Bill Tracker** page (`/desk/bill-tracker`): one DUX Digitech design-system screen - summary cards (bills, bill amount,
  sanction amount, net payable), search and filters, bill detail (sanction order preview, calculation as on the order),
  and the new / edit form with file upload and live calculation. The Frappe form stays available for back-office use.
  API: `bill_tracker/api.py` (`get_context`, `projects`, `list_bills`, `get_bill`, `calculate`, `save_bill`).
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
