### Bill Tracker

Track project bills (RA/PA) with sanction orders

Built for Frappe / ERPNext v16 (Jain Engineering Works, `jewipl`).

**What is inside**

- **Project Bill** DocType (module *Bill Tracker*): Project, Bill Type (RA - Running Account / PA - Part Account),
  Bill No, Bill Date, Bill Amount, Sanction No / Amount and the Sanction Order file (PDF or image, mandatory).
  Numbered `PB-.YYYY.-.####`, track changes on. A Project + Bill Type + Bill No combination can only be entered once;
  Bill Amount must be above zero and Sanction Amount cannot be negative.
  System Manager has full access; Projects Manager and Accounts User can read, write and create.
- **Bill Tracker** page (`/desk/bill-tracker`): filters (Project, Bill Type, Bill Date range), summary cards
  (total bills, total bill amount, total sanction amount), the bills table with a sanction order download link,
  a *New Bill* dialog with file upload, and row click to open the Project Bill.
- A **Bill Tracker** workspace (with sidebar and desktop icon) that opens the page.

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
