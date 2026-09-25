# Who can do what

Every capability in this system is its own permission, and a role is simply the set of permissions it holds. Nothing is gated on a role's *name* — change the permissions and the behaviour changes with them.

> **This file is generated.** Run `npx tsx prisma/generate-permissions-doc.ts` after changing any role, and it will be rewritten from the database. Editing it by hand will be overwritten.

_Last generated from the database. 10 roles, 113 permissions._

## Contents

- [The roles](#the-roles)
  - [Super Admin](#super-admin)
  - [Admin](#admin)
  - [Department Manager](#department-manager)
  - [Builder](#builder)
  - [Auditor](#auditor)
  - [Buyer](#buyer)
  - [Stock Approver](#stock-approver)
  - [Stock Entry Operator](#stock-entry-operator)
  - [Dispatch Operator](#dispatch-operator)
  - [Engineer](#engineer)
- [The people](#the-people)
  - [Ashish](#ashish)
  - [Deepanjona](#deepanjona)
  - [Kirubakaran](#kirubakaran)
  - [Manohar](#manohar)
  - [Nagarajan](#nagarajan)
  - [Phani Raj](#phani-raj)
  - [Raghava](#raghava)
  - [Shravani](#shravani)
  - [Spandana](#spandana)
  - [Uday Kherkatary](#uday-kherkatary)
- [Every permission, and who holds it](#every-permission-and-who-holds-it)
  - [Activity log](#activity-log)
  - [Assets](#assets)
  - [Bills of materials](#bills-of-materials)
  - [Clients](#clients)
  - [Configuration](#configuration)
  - [Departments](#departments)
  - [Dispatch](#dispatch)
  - [Fulfilment](#fulfilment)
  - [Procurement](#procurement)
  - [Product catalog](#product-catalog)
  - [Recycle bin](#recycle-bin)
  - [Reports](#reports)
  - [Roles & permissions](#roles--permissions)
  - [Settings](#settings)
  - [Stock](#stock)
  - [Team members](#team-members)
  - [Vendors](#vendors)

---

## The roles

### Super Admin

Everything, everywhere. The account of last resort.

**113 permissions · 1 person · protected system role**

Who: Phani Raj

- **Activity log** — Activity: Buying, Activity: Catalog, Activity: Everyone's Actions, Activity: Making, Activity: Own Actions Only, Activity: Own Department, Activity: People, Activity: Security & Settings, Activity: Stock In, Activity: Stock Movement, Open the Activity Log
- **Assets** — Answer a Transfer Request, Ask For a Transfer, Create Assets, View Assets
- **Bills of materials** — Approve a Bill of Materials, Build From a Bill of Materials, Correct the Active Bill of Materials, Delete a Bill of Materials, Finish a Build, Publish Without Approval, Undo a Build, View Bills of Materials, Write a Bill of Materials
- **Clients** — Add Clients, Delete Clients, Edit Clients, Export the Client List, View Clients
- **Configuration** — Configure the BOM Approval Flow, Configure the Catalog Rules, Configure the Procurement Flow
- **Departments** — Create Departments, Delete Departments, Edit Departments, View Departments
- **Dispatch** — Accept Dispatches, Confirm Delivery, Export Dispatch Report, Raise Dispatches, View Dispatches
- **Fulfilment** — Answer a Site Request, Request Stock From Another Site, View Fulfilment
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — Add Categories, Add a Procured Item, Add a Product We Make, Answer a Category Request, Answer a Product Request, Ask For a Category, Ask For a Product, Delete Categories, Delete Products, Edit Categories, Edit Code Prefixes, Edit Products, Override Product Codes, View Products
- **Recycle bin** — Empty the Recycle Bin, Restore Deleted Records, See Everyone's Deletions, See Own Deletions, View the Recycle Bin
- **Reports** — Export Reports, View Reports
- **Roles & permissions** — Create Roles, Delete Roles, Edit Roles, View Roles
- **Settings** — Edit Settings, View Settings
- **Stock** — Approve Stock Entries, Approve Write-Offs, Configure Approval Flows, Configure Attachment Types, Configure Entry Fields, Create Stock Entries, Edit Stock Entries, Move Stock, Record Warranty Details, Reverse Write-Offs, See All Stock, See Department Stock, See Location Stock, See Low-Stock Alerts, See Own Entries Only, Set Batch Number, Set Stock Minimums and Lead Times, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs, Write Off Department Stock, Write Off Stock
- **Team members** — Change Passwords, Create Users, Delete Users, Edit Users, Grant Extra Permissions, View Passwords, View Users
- **Vendors** — Add Vendors, Delete Vendors, Edit Vendors, Export the Vendor List, View Vendors

### Admin

Runs the organisation: people, roles, departments, the catalog, vendors, clients and buying. No stock, no reports.

**61 permissions · 1 person · protected system role**

Who: Shravani

- **Activity log** — Activity: Buying, Activity: Catalog, Activity: Everyone's Actions, Activity: People, Open the Activity Log
- **Assets** — View Assets
- **Clients** — Add Clients, Delete Clients, Edit Clients, Export the Client List, View Clients
- **Configuration** — Configure the Catalog Rules, Configure the Procurement Flow
- **Departments** — Create Departments, Delete Departments, Edit Departments, View Departments
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — Add Categories, Add a Procured Item, Add a Product We Make, Answer a Category Request, Answer a Product Request, Ask For a Category, Ask For a Product, Delete Categories, Delete Products, Edit Categories, Edit Code Prefixes, Edit Products, Override Product Codes, View Products
- **Recycle bin** — Empty the Recycle Bin, Restore Deleted Records, See Everyone's Deletions, View the Recycle Bin
- **Roles & permissions** — Create Roles, Delete Roles, Edit Roles, View Roles
- **Settings** — Edit Settings, View Settings
- **Stock** — See All Stock
- **Team members** — Change Passwords, Create Users, Delete Users, Edit Users, Grant Extra Permissions, View Passwords, View Users
- **Vendors** — Add Vendors, Delete Vendors, Edit Vendors, Export the Vendor List, View Vendors

### Department Manager

Runs a department: its stock, its assets, its people's transfer requests and its bills of materials.

**33 permissions · 2 people**

Who: Kirubakaran, Manohar

- **Activity log** — Activity: Making, Activity: Own Department, Activity: People, Activity: Stock In, Activity: Stock Movement, Open the Activity Log
- **Assets** — Answer a Transfer Request, Ask For a Transfer, Create Assets, View Assets
- **Bills of materials** — Approve a Bill of Materials, Correct the Active Bill of Materials, Publish Without Approval, View Bills of Materials, Write a Bill of Materials
- **Departments** — View Departments
- **Fulfilment** — Request Stock From Another Site, View Fulfilment
- **Procurement** — State a Need, View Purchase Orders, View Stated Needs
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — Approve Write-Offs, Move Stock, See Department Stock, View Stock Entries, View Warranty Details, View Write-Offs, Write Off Department Stock, Write Off Stock
- **Team members** — View Users

### Builder

Held on top of another role. Runs builds: takes components out of central stock and books the finished product in.

**6 permissions · 1 person**

- **Bills of materials** — Build From a Bill of Materials, Finish a Build, Undo a Build, View Bills of Materials
- **Stock** — See Location Stock, View Stock Entries

### Auditor

Read-only oversight of every site including value, plus the catalog, the masters and the asset register.

**35 permissions · 1 person**

Who: Nagarajan

- **Assets** — Create Assets, View Assets
- **Bills of materials** — View Bills of Materials
- **Clients** — Add Clients, Edit Clients, Export the Client List, View Clients
- **Departments** — View Departments
- **Dispatch** — Export Dispatch Report, View Dispatches
- **Fulfilment** — View Fulfilment
- **Product catalog** — Add Categories, Add a Procured Item, Add a Product We Make, Answer a Category Request, Answer a Product Request, Edit Categories, Edit Products, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Reports** — Export Reports, View Reports
- **Stock** — Move Stock, See All Stock, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs
- **Team members** — View Users
- **Vendors** — Add Vendors, Edit Vendors, Export the Vendor List, View Vendors

### Buyer

Held on top of another role. Verifies what is needed and turns it into orders.

**11 permissions · 2 people**

- **Activity log** — Activity: Buying, Open the Activity Log
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — View Products
- **Vendors** — View Vendors

### Stock Approver

Held on top of another role. Approves goods arriving at their own site.

**6 permissions · 1 person**

- **Stock** — Approve Stock Entries, Approve Write-Offs, See Location Stock, View Stock Entries, View Warranty Details, View Write-Offs

### Stock Entry Operator

Books goods in: fresh stock or a delivery against an order, submitted for approval.

**21 permissions · 2 people**

Who: Spandana, Uday Kherkatary

- **Bills of materials** — View Bills of Materials, Write a Bill of Materials
- **Procurement** — State a Need, View Purchase Orders, View Stated Needs
- **Product catalog** — Ask For a Category, Ask For a Product, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — Create Stock Entries, Edit Stock Entries, Record Warranty Details, See Own Entries Only, Set Batch Number, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs, Write Off Stock

### Dispatch Operator

Moves goods out: consignments to other sites and to clients, and answering other sites' requests.

**16 permissions · 2 people**

Who: Ashish

- **Bills of materials** — View Bills of Materials
- **Dispatch** — Accept Dispatches, Confirm Delivery, Export Dispatch Report, Raise Dispatches, View Dispatches
- **Fulfilment** — Answer a Site Request, Request Stock From Another Site, View Fulfilment
- **Product catalog** — View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — See Location Stock, View Stock Entries, View Warranty Details

### Engineer

Works in a department: finds stock, asks for it, states what is needed, and writes bills of materials.

**18 permissions · 2 people**

Who: Deepanjona, Raghava

- **Assets** — Ask For a Transfer, View Assets
- **Bills of materials** — View Bills of Materials, Write a Bill of Materials
- **Fulfilment** — Request Stock From Another Site, View Fulfilment
- **Procurement** — State a Need, View Stated Needs
- **Product catalog** — Ask For a Category, Ask For a Product, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — See Department Stock, View Stock Entries, View Write-Offs, Write Off Department Stock

---

## The people

What each person can do is the **sum** of every role they hold plus anything granted to them individually. Nothing is ever subtracted, so holding a second role can only widen what someone may do.

### Ashish

`ashish@straightdrivesport.com` · Dispatch Operator · Dispatch Hyd, Hyderabad

**16 permissions in total.**

Sees **everything at Hyderabad** — every department there, plus that site's central stock.

Cannot open the activity log at all.

- **Can:** send stock out.
- **Cannot:** book goods in; approve goods arriving; move stock into a department; see what stock cost — quantities only, never prices; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Bills of materials** — View Bills of Materials
- **Dispatch** — Accept Dispatches, Confirm Delivery, Export Dispatch Report, Raise Dispatches, View Dispatches
- **Fulfilment** — Answer a Site Request, Request Stock From Another Site, View Fulfilment
- **Product catalog** — View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — See Location Stock, View Stock Entries, View Warranty Details

</details>

### Deepanjona

`deepanjona@straightdrivesport.com` · Engineer · Production, Bengaluru

**18 permissions in total.**

Sees **their own department's stock**, plus the central stock of their own site that is still worth acting on.

Cannot open the activity log at all.

- **Cannot:** book goods in; approve goods arriving; move stock into a department; see what stock cost — quantities only, never prices; send stock out; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Assets** — Ask For a Transfer, View Assets
- **Bills of materials** — View Bills of Materials, Write a Bill of Materials
- **Fulfilment** — Request Stock From Another Site, View Fulfilment
- **Procurement** — State a Need, View Stated Needs
- **Product catalog** — Ask For a Category, Ask For a Product, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — See Department Stock, View Stock Entries, View Write-Offs, Write Off Department Stock

</details>

### Kirubakaran

`kiruba@straightdrivesport.com` · Department Manager + Buyer + Stock Approver + Builder · Production, Bengaluru

**47 permissions in total.**

Sees **everything at Bengaluru** — every department there, plus that site's central stock.

On the activity log, sees **their own department's** actions, and actions done to its members.

- **Can:** approve goods arriving; move approved stock into a department; run builds; place purchase orders.
- **Cannot:** book goods in; see what stock cost — quantities only, never prices; send stock out; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Activity log** — Activity: Buying, Activity: Making, Activity: Own Department, Activity: People, Activity: Stock In, Activity: Stock Movement, Open the Activity Log
- **Assets** — Answer a Transfer Request, Ask For a Transfer, Create Assets, View Assets
- **Bills of materials** — Approve a Bill of Materials, Build From a Bill of Materials, Correct the Active Bill of Materials, Finish a Build, Publish Without Approval, Undo a Build, View Bills of Materials, Write a Bill of Materials
- **Departments** — View Departments
- **Fulfilment** — Request Stock From Another Site, View Fulfilment
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — Approve Stock Entries, Approve Write-Offs, Move Stock, See Department Stock, See Location Stock, See Low-Stock Alerts, Set Stock Minimums and Lead Times, View Stock Entries, View Warranty Details, View Write-Offs, Write Off Department Stock, Write Off Stock
- **Team members** — View Users
- **Vendors** — View Vendors

</details>

Granted individually, on top of their roles: See Low-Stock Alerts, Set Stock Minimums and Lead Times.

### Manohar

`manu@straightdrivesport.com` · Department Manager · R&D, Bengaluru

**33 permissions in total.**

Sees **their own department's stock**, plus the central stock of their own site that is still worth acting on.

On the activity log, sees **their own department's** actions, and actions done to its members.

- **Can:** move approved stock into a department.
- **Cannot:** book goods in; approve goods arriving; see what stock cost — quantities only, never prices; send stock out; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Activity log** — Activity: Making, Activity: Own Department, Activity: People, Activity: Stock In, Activity: Stock Movement, Open the Activity Log
- **Assets** — Answer a Transfer Request, Ask For a Transfer, Create Assets, View Assets
- **Bills of materials** — Approve a Bill of Materials, Correct the Active Bill of Materials, Publish Without Approval, View Bills of Materials, Write a Bill of Materials
- **Departments** — View Departments
- **Fulfilment** — Request Stock From Another Site, View Fulfilment
- **Procurement** — State a Need, View Purchase Orders, View Stated Needs
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — Approve Write-Offs, Move Stock, See Department Stock, View Stock Entries, View Warranty Details, View Write-Offs, Write Off Department Stock, Write Off Stock
- **Team members** — View Users

</details>

### Nagarajan

`nagarajan@straightdrivesport.com` · Auditor + Buyer · Accounts, Bengaluru

**44 permissions in total.**

Sees **every stock entry in the company**, at every site.

On the activity log, sees **only their own** actions.

- **Can:** move approved stock into a department; see what stock cost; place purchase orders; read the reports.
- **Cannot:** book goods in; approve goods arriving; send stock out; run builds; add team members; change what any role may do; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Activity log** — Activity: Buying, Open the Activity Log
- **Assets** — Create Assets, View Assets
- **Bills of materials** — View Bills of Materials
- **Clients** — Add Clients, Edit Clients, Export the Client List, View Clients
- **Departments** — View Departments
- **Dispatch** — Export Dispatch Report, View Dispatches
- **Fulfilment** — View Fulfilment
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — Add Categories, Add a Procured Item, Add a Product We Make, Answer a Category Request, Answer a Product Request, Edit Categories, Edit Products, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Reports** — Export Reports, View Reports
- **Stock** — Move Stock, See All Stock, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs
- **Team members** — View Users
- **Vendors** — Add Vendors, Edit Vendors, Export the Vendor List, View Vendors

</details>

### Phani Raj

`superadmin@straightdrivesport.com` · Super Admin · no department — not narrowed by site

**113 permissions in total.**

Sees **every stock entry in the company**, at every site.

On the activity log, sees **everyone's** actions.

- **Can:** book goods in; approve goods arriving; move approved stock into a department; see what stock cost; send stock out; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Activity log** — Activity: Buying, Activity: Catalog, Activity: Everyone's Actions, Activity: Making, Activity: Own Actions Only, Activity: Own Department, Activity: People, Activity: Security & Settings, Activity: Stock In, Activity: Stock Movement, Open the Activity Log
- **Assets** — Answer a Transfer Request, Ask For a Transfer, Create Assets, View Assets
- **Bills of materials** — Approve a Bill of Materials, Build From a Bill of Materials, Correct the Active Bill of Materials, Delete a Bill of Materials, Finish a Build, Publish Without Approval, Undo a Build, View Bills of Materials, Write a Bill of Materials
- **Clients** — Add Clients, Delete Clients, Edit Clients, Export the Client List, View Clients
- **Configuration** — Configure the BOM Approval Flow, Configure the Catalog Rules, Configure the Procurement Flow
- **Departments** — Create Departments, Delete Departments, Edit Departments, View Departments
- **Dispatch** — Accept Dispatches, Confirm Delivery, Export Dispatch Report, Raise Dispatches, View Dispatches
- **Fulfilment** — Answer a Site Request, Request Stock From Another Site, View Fulfilment
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — Add Categories, Add a Procured Item, Add a Product We Make, Answer a Category Request, Answer a Product Request, Ask For a Category, Ask For a Product, Delete Categories, Delete Products, Edit Categories, Edit Code Prefixes, Edit Products, Override Product Codes, View Products
- **Recycle bin** — Empty the Recycle Bin, Restore Deleted Records, See Everyone's Deletions, See Own Deletions, View the Recycle Bin
- **Reports** — Export Reports, View Reports
- **Roles & permissions** — Create Roles, Delete Roles, Edit Roles, View Roles
- **Settings** — Edit Settings, View Settings
- **Stock** — Approve Stock Entries, Approve Write-Offs, Configure Approval Flows, Configure Attachment Types, Configure Entry Fields, Create Stock Entries, Edit Stock Entries, Move Stock, Record Warranty Details, Reverse Write-Offs, See All Stock, See Department Stock, See Location Stock, See Low-Stock Alerts, See Own Entries Only, Set Batch Number, Set Stock Minimums and Lead Times, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs, Write Off Department Stock, Write Off Stock
- **Team members** — Change Passwords, Create Users, Delete Users, Edit Users, Grant Extra Permissions, View Passwords, View Users
- **Vendors** — Add Vendors, Delete Vendors, Edit Vendors, Export the Vendor List, View Vendors

</details>

### Raghava

`raghava@straightdrivesport.com` · Engineer · R&D, Bengaluru

**18 permissions in total.**

Sees **their own department's stock**, plus the central stock of their own site that is still worth acting on.

Cannot open the activity log at all.

- **Cannot:** book goods in; approve goods arriving; move stock into a department; see what stock cost — quantities only, never prices; send stock out; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Assets** — Ask For a Transfer, View Assets
- **Bills of materials** — View Bills of Materials, Write a Bill of Materials
- **Fulfilment** — Request Stock From Another Site, View Fulfilment
- **Procurement** — State a Need, View Stated Needs
- **Product catalog** — Ask For a Category, Ask For a Product, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — See Department Stock, View Stock Entries, View Write-Offs, Write Off Department Stock

</details>

### Shravani

`shravani@straightdrivesport.com` · Admin · no department — not narrowed by site

**61 permissions in total.**

Sees **every stock entry in the company**, at every site.

On the activity log, sees **everyone's** actions.

- **Can:** place purchase orders; add team members; change what any role may do.
- **Cannot:** book goods in; approve goods arriving; move stock into a department; see what stock cost — quantities only, never prices; send stock out; run builds; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Activity log** — Activity: Buying, Activity: Catalog, Activity: Everyone's Actions, Activity: People, Open the Activity Log
- **Assets** — View Assets
- **Clients** — Add Clients, Delete Clients, Edit Clients, Export the Client List, View Clients
- **Configuration** — Configure the Catalog Rules, Configure the Procurement Flow
- **Departments** — Create Departments, Delete Departments, Edit Departments, View Departments
- **Procurement** — Close a Purchase Order, Place a Purchase Order, State a Need, Verify a Need, View Order Values, View Purchase Orders, View Stated Needs
- **Product catalog** — Add Categories, Add a Procured Item, Add a Product We Make, Answer a Category Request, Answer a Product Request, Ask For a Category, Ask For a Product, Delete Categories, Delete Products, Edit Categories, Edit Code Prefixes, Edit Products, Override Product Codes, View Products
- **Recycle bin** — Empty the Recycle Bin, Restore Deleted Records, See Everyone's Deletions, View the Recycle Bin
- **Roles & permissions** — Create Roles, Delete Roles, Edit Roles, View Roles
- **Settings** — Edit Settings, View Settings
- **Stock** — See All Stock
- **Team members** — Change Passwords, Create Users, Delete Users, Edit Users, Grant Extra Permissions, View Passwords, View Users
- **Vendors** — Add Vendors, Delete Vendors, Edit Vendors, Export the Vendor List, View Vendors

</details>

### Spandana

`spandana@straightdrivesport.com` · Stock Entry Operator · Central Stock — Bengaluru, Bengaluru

**21 permissions in total.**

Sees **only the entries they created themselves**.

Cannot open the activity log at all.

- **Can:** book goods in; see what stock cost.
- **Cannot:** approve goods arriving; move stock into a department; send stock out; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Bills of materials** — View Bills of Materials, Write a Bill of Materials
- **Procurement** — State a Need, View Purchase Orders, View Stated Needs
- **Product catalog** — Ask For a Category, Ask For a Product, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — Create Stock Entries, Edit Stock Entries, Record Warranty Details, See Own Entries Only, Set Batch Number, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs, Write Off Stock

</details>

### Uday Kherkatary

`uday@straightdrivesport.com` · Stock Entry Operator + Dispatch Operator · Central Stock — Bengaluru, Bengaluru

**30 permissions in total.**

Sees **everything at Bengaluru** — every department there, plus that site's central stock.

Cannot open the activity log at all.

- **Can:** book goods in; see what stock cost; send stock out.
- **Cannot:** approve goods arriving; move stock into a department; run builds; place purchase orders; add team members; change what any role may do; read the reports; read the security log.

<details><summary>Everything they hold, by area</summary>

- **Bills of materials** — View Bills of Materials, Write a Bill of Materials
- **Dispatch** — Accept Dispatches, Confirm Delivery, Export Dispatch Report, Raise Dispatches, View Dispatches
- **Fulfilment** — Answer a Site Request, Request Stock From Another Site, View Fulfilment
- **Procurement** — State a Need, View Purchase Orders, View Stated Needs
- **Product catalog** — Ask For a Category, Ask For a Product, View Products
- **Recycle bin** — Restore Deleted Records, See Own Deletions, View the Recycle Bin
- **Stock** — Create Stock Entries, Edit Stock Entries, Record Warranty Details, See Location Stock, See Own Entries Only, Set Batch Number, View Stock Entries, View Stock Value, View Warranty Details, View Write-Offs, Write Off Stock

</details>

---

## Every permission, and who holds it

The same information the other way round — useful when you want to know who could possibly have done something.


### Activity log

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Activity: Everyone's Actions | `activity.scope.all` | Visibility scope: every action by every person | Super Admin, Admin | Phani Raj, Shravani |
| Activity: Own Department | `activity.scope.department` | Visibility scope: actions by their department's members, and actions done to them | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Activity: Own Actions Only | `activity.scope.own` | Visibility scope: only what this person did themselves | Super Admin | Phani Raj |
| Open the Activity Log | `activity.view` | Can open the activity log. What is visible on it depends on the activity.view.* permissions | Super Admin, Admin, Department Manager, Buyer | Kirubakaran, Manohar, Nagarajan, Phani Raj, Shravani |
| Activity: Catalog | `activity.view.catalog` | Can read log entries about products, categories, vendors and clients | Super Admin, Admin | Phani Raj, Shravani |
| Activity: Making | `activity.view.making` | Can read log entries about bills of materials and builds | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Activity: Stock Movement | `activity.view.movement` | Can read log entries about issues, transfers and dispatches | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Activity: People | `activity.view.people` | Can read log entries about team members, roles, departments and sites | Super Admin, Admin, Department Manager | Kirubakaran, Manohar, Phani Raj, Shravani |
| Activity: Buying | `activity.view.procurement` | Can read log entries about stated needs and purchase orders | Super Admin, Admin, Buyer | Kirubakaran, Nagarajan, Phani Raj, Shravani |
| Activity: Security & Settings | `activity.view.security` | Can read password reveals, permission grants, deletions and configuration changes — the most sensitive part of the log | Super Admin | Phani Raj |
| Activity: Stock In | `activity.view.stock` | Can read log entries about stock entries, their documents and approvals | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |

### Assets

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Create Assets | `assets.create` | Can add new assets | Super Admin, Department Manager, Auditor | Kirubakaran, Manohar, Nagarajan, Phani Raj |
| Answer a Transfer Request | `assets.transfer.approve` | Can agree to or decline transfers into their own department. Agreeing IS the movement | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Ask For a Transfer | `assets.transfer.request` | Can ask for central stock to be moved into a department. Their department's manager decides | Super Admin, Department Manager, Engineer | Deepanjona, Kirubakaran, Manohar, Phani Raj, Raghava |
| View Assets | `assets.view` | Can view assets | Super Admin, Admin, Department Manager, Auditor, Engineer | Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Shravani |

### Bills of materials

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Approve a Bill of Materials | `bom.approve` | Can approve a submitted bill of materials, which publishes it and retires whatever was in force. Approving your own work is refused | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Build From a Bill of Materials | `bom.build` | Can consume components out of central stock and book the assembled product in, so it can be dispatched as a whole | Super Admin, Builder | Kirubakaran, Phani Raj |
| Finish a Build | `bom.build.finish` | Can book finished work into stock, in whole or in part, and close a run that will not be completed | Super Admin, Builder | Kirubakaran, Phani Raj |
| Write a Bill of Materials | `bom.create` | Can write a bill of materials and submit it. It is published when someone with bom.approve approves it, unless the author also holds bom.publish | Super Admin, Department Manager, Stock Entry Operator, Engineer | Deepanjona, Kirubakaran, Manohar, Phani Raj, Raghava, Spandana, Uday Kherkatary |
| Delete a Bill of Materials | `bom.delete` | Can permanently remove a version. Refused for any version something was built to | Super Admin | Phani Raj |
| Correct the Active Bill of Materials | `bom.edit` | Can change the version currently in force, and put an older published version back in force | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Publish Without Approval | `bom.publish` | Can publish a bill of materials straight away instead of sending it for approval | Super Admin, Department Manager | Kirubakaran, Manohar, Phani Raj |
| Undo a Build | `bom.unbuild` | Can reverse a build and return its components, while nothing has been moved or dispatched from what it produced | Super Admin, Builder | Kirubakaran, Phani Raj |
| View Bills of Materials | `bom.view` | Can see what a product is made of — its components, quantities and versions | Super Admin, Department Manager, Builder, Auditor, Stock Entry Operator, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Spandana, Uday Kherkatary |

### Clients

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Add Clients | `clients.create` | Can add new clients | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Delete Clients | `clients.delete` | Can permanently remove a client record | Super Admin, Admin | Phani Raj, Shravani |
| Edit Clients | `clients.edit` | Can edit client details and activate/deactivate clients | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Export the Client List | `clients.export` | Can download the client list, with GST numbers and addresses, as a CSV | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| View Clients | `clients.view` | Can see the client list and a client's GST number and address on outgoing stock | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |

### Configuration

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Configure the Catalog Rules | `config.catalog` | Can decide whether a product must be filed under a subcategory, whether a subcategory must carry a code, and whether a product must have a description | Super Admin, Admin | Phani Raj, Shravani |
| Configure the BOM Approval Flow | `config.flows.bom` | Can set who approves a bill of materials before it counts. One rule for the whole company | Super Admin | Phani Raj |
| Configure the Procurement Flow | `config.flows.procurement` | Can decide whether a stated need must be verified before it can be ordered | Super Admin, Admin | Phani Raj, Shravani |

### Departments

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Create Departments | `departments.create` | Can create departments | Super Admin, Admin | Phani Raj, Shravani |
| Delete Departments | `departments.delete` | Can delete departments | Super Admin, Admin | Phani Raj, Shravani |
| Edit Departments | `departments.edit` | Can edit departments | Super Admin, Admin | Phani Raj, Shravani |
| View Departments | `departments.view` | Can view departments | Super Admin, Admin, Department Manager, Auditor | Kirubakaran, Manohar, Nagarajan, Phani Raj, Shravani |

### Dispatch

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Accept Dispatches | `dispatch.accept` | Can accept or reject a consignment arriving at their location | Super Admin, Dispatch Operator | Ashish, Phani Raj, Uday Kherkatary |
| Raise Dispatches | `dispatch.create` | Can send central stock from their location to another location or to a client | Super Admin, Dispatch Operator | Ashish, Phani Raj, Uday Kherkatary |
| Export Dispatch Report | `dispatch.export` | Can download the dispatch report as a CSV | Super Admin, Auditor, Dispatch Operator | Ashish, Nagarajan, Phani Raj, Uday Kherkatary |
| Confirm Delivery | `dispatch.receive` | Can mark a consignment in transit as received, which books it into central stock at the destination | Super Admin, Dispatch Operator | Ashish, Phani Raj, Uday Kherkatary |
| View Dispatches | `dispatch.view` | Can see outgoing consignments for their location, both leaving and arriving, and trace batch numbers | Super Admin, Auditor, Dispatch Operator | Ashish, Nagarajan, Phani Raj, Uday Kherkatary |

### Fulfilment

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Answer a Site Request | `fulfilment.approve` | Can agree to or decline another site's request. Agreeing raises a dispatch from this site | Super Admin, Dispatch Operator | Ashish, Phani Raj, Uday Kherkatary |
| Request Stock From Another Site | `fulfilment.request` | Can ask a site that is holding stock to send some of it here | Super Admin, Department Manager, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Phani Raj, Raghava, Uday Kherkatary |
| View Fulfilment | `fulfilment.view` | Can check whether an order can be met, which sites hold the stock, and what could be built | Super Admin, Department Manager, Auditor, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Uday Kherkatary |

### Procurement

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Verify a Need | `procurement.intent.approve` | Can verify or decline a stated need, deciding what is worth ordering | Super Admin, Admin, Buyer | Kirubakaran, Nagarajan, Phani Raj, Shravani |
| State a Need | `procurement.intent.create` | Can ask for something to be bought in, and withdraw a request they raised | Super Admin, Admin, Department Manager, Buyer, Stock Entry Operator, Engineer | Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |
| View Stated Needs | `procurement.intent.view` | Can see what has been asked for, and what happened to each request | Super Admin, Admin, Department Manager, Buyer, Stock Entry Operator, Engineer | Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |
| Close a Purchase Order | `procurement.po.close` | Can close an order short when the rest will never arrive, and cancel one nothing has arrived against | Super Admin, Admin, Buyer | Kirubakaran, Nagarajan, Phani Raj, Shravani |
| Place a Purchase Order | `procurement.po.create` | Can raise an order with a vendor, setting quantities and agreed prices | Super Admin, Admin, Buyer | Kirubakaran, Nagarajan, Phani Raj, Shravani |
| View Purchase Orders | `procurement.po.view` | Can see orders placed with vendors and how much of each is still owed | Super Admin, Admin, Department Manager, Buyer, Stock Entry Operator | Kirubakaran, Manohar, Nagarajan, Phani Raj, Shravani, Spandana, Uday Kherkatary |
| View Order Values | `procurement.value.view` | Can see unit prices and totals on purchase orders. Without it an order shows quantities only | Super Admin, Admin, Buyer | Kirubakaran, Nagarajan, Phani Raj, Shravani |

### Product catalog

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Add Categories | `categories.create` | Can add new product categories | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Delete Categories | `categories.delete` | Can permanently remove a category, as opposed to deactivating it | Super Admin, Admin | Phani Raj, Shravani |
| Edit Categories | `categories.edit` | Can rename product categories | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Edit Code Prefixes | `categories.prefix.edit` | Can change the fixed 4-digit code prefix a category assigns to its products (e.g. 1001) | Super Admin, Admin | Phani Raj, Shravani |
| Answer a Category Request | `categories.request.approve` | Can approve or decline a category request. Approving creates the category | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Ask For a Category | `categories.request.create` | Can ask for a new product category | Super Admin, Admin, Stock Entry Operator, Engineer | Deepanjona, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |
| Override Product Codes | `products.code.override` | Can type a product code by hand instead of using the one generated from the category prefix | Super Admin, Admin | Phani Raj, Shravani |
| Add a Procured Item | `products.create` | Can add something we buy: a raw material that is used up making things, or ready goods (a TV) used or sold as they are. Adding a product we make is products.create.made | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Add a Product We Make | `products.create.made` | Can add a finished product — something we make, which gets a bill of materials. Adding something we buy (a raw material, or ready goods such as a TV) is products.create | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Delete Products | `products.delete` | Can permanently remove a product, as opposed to deactivating it | Super Admin, Admin | Phani Raj, Shravani |
| Edit Products | `products.edit` | Can edit product codes and names, and activate/deactivate products | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Answer a Product Request | `products.request.approve` | Can approve or decline a product request. Approving creates the product | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Ask For a Product | `products.request.create` | Can ask for a product to be added to the catalog | Super Admin, Admin, Stock Entry Operator, Engineer | Deepanjona, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |
| View Products | `products.view` | Can view and search the product code catalog | Super Admin, Admin, Auditor, Buyer, Stock Entry Operator, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Nagarajan, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |

### Recycle bin

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Empty the Recycle Bin | `recyclebin.purge` | Can remove an entry from the recycle bin for good, before it ages out on its own | Super Admin, Admin | Phani Raj, Shravani |
| Restore Deleted Records | `recyclebin.restore` | Can put a deleted record back, along with whatever was unlinked when it went | Super Admin, Admin, Department Manager, Auditor, Stock Entry Operator, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |
| See Everyone's Deletions | `recyclebin.scope.all` | Visibility scope: everything anyone deleted, not just their own | Super Admin, Admin | Phani Raj, Shravani |
| See Own Deletions | `recyclebin.scope.own` | Visibility scope: only what this person deleted themselves | Super Admin, Department Manager, Auditor, Stock Entry Operator, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Spandana, Uday Kherkatary |
| View the Recycle Bin | `recyclebin.view` | Can see what has been deleted recently and who deleted it | Super Admin, Admin, Department Manager, Auditor, Stock Entry Operator, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Shravani, Spandana, Uday Kherkatary |

### Reports

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Export Reports | `reports.export` | Can export stock reports to CSV | Super Admin, Auditor | Nagarajan, Phani Raj |
| View Reports | `reports.view` | Can view stock reports | Super Admin, Auditor | Nagarajan, Phani Raj |

### Roles & permissions

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Create Roles | `roles.create` | Can create new roles | Super Admin, Admin | Phani Raj, Shravani |
| Delete Roles | `roles.delete` | Can delete roles | Super Admin, Admin | Phani Raj, Shravani |
| Edit Roles | `roles.edit` | Can edit role permissions | Super Admin, Admin | Phani Raj, Shravani |
| View Roles | `roles.view` | Can view roles | Super Admin, Admin | Phani Raj, Shravani |

### Settings

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Edit Settings | `settings.edit` | Can edit settings | Super Admin, Admin | Phani Raj, Shravani |
| View Settings | `settings.view` | Can view settings | Super Admin, Admin | Phani Raj, Shravani |

### Stock

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Approve Stock Entries | `stock.approve` | Can approve or reject stock entries | Super Admin, Stock Approver | Kirubakaran, Phani Raj |
| Set Batch Number | `stock.batch.edit` | Can set the batch a stock entry belongs to. Dispatch inherits the batch, so this is the only place it is typed | Super Admin, Stock Entry Operator | Phani Raj, Spandana, Uday Kherkatary |
| Configure Attachment Types | `stock.config.attachments` | Can configure attachment/document types for stock entries | Super Admin | Phani Raj |
| Configure Entry Fields | `stock.config.fields` | Can configure custom stock entry fields | Super Admin | Phani Raj |
| Configure Approval Flows | `stock.config.flows` | Can configure stock approval workflows | Super Admin | Phani Raj |
| Create Stock Entries | `stock.create` | Can create stock entries | Super Admin, Stock Entry Operator | Phani Raj, Spandana, Uday Kherkatary |
| Edit Stock Entries | `stock.edit` | Can edit stock entries | Super Admin, Stock Entry Operator | Phani Raj, Spandana, Uday Kherkatary |
| Set Stock Minimums and Lead Times | `stock.lowstock.manage` | Can choose which products are watched at each site and their minimum, and record which vendors supply a product and how many days they take | Super Admin | Kirubakaran, Phani Raj |
| See Low-Stock Alerts | `stock.lowstock.view` | Is told when a watched product falls to its reorder point at a site — how much is left, how fast it is being used, how long the vendor takes, and when to order — and can raise needs for it in one go | Super Admin | Kirubakaran, Phani Raj |
| Move Stock | `stock.move` | Can move approved stock directly into a department (without a transfer request) | Super Admin, Department Manager, Auditor | Kirubakaran, Manohar, Nagarajan, Phani Raj |
| See All Stock | `stock.scope.all` | Visibility scope: every stock entry across the organisation | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| See Department Stock | `stock.scope.department` | Visibility scope: own department's stock plus central stock | Super Admin, Department Manager, Engineer | Deepanjona, Kirubakaran, Manohar, Phani Raj, Raghava |
| See Location Stock | `stock.scope.location` | Visibility scope: every department's stock plus central stock, within the user's own location | Super Admin, Builder, Stock Approver, Dispatch Operator | Ashish, Kirubakaran, Phani Raj, Uday Kherkatary |
| See Own Entries Only | `stock.scope.own` | Visibility scope: only stock entries the user created | Super Admin, Stock Entry Operator | Phani Raj, Spandana, Uday Kherkatary |
| View Stock Value | `stock.value.view` | Can see prices and monetary values of stock | Super Admin, Auditor, Stock Entry Operator | Nagarajan, Phani Raj, Spandana, Uday Kherkatary |
| View Stock Entries | `stock.view` | Can view stock entries | Super Admin, Department Manager, Builder, Auditor, Stock Approver, Stock Entry Operator, Dispatch Operator, Engineer | Ashish, Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Spandana, Uday Kherkatary |
| Record Warranty Details | `stock.warranty.edit` | Can add or change the warranty and registration details of a stock entry | Super Admin, Stock Entry Operator | Phani Raj, Spandana, Uday Kherkatary |
| View Warranty Details | `stock.warranty.view` | Can see warranty and registration details on a stock entry — purchase date, model and serial number, warranty expiry | Super Admin, Department Manager, Auditor, Stock Approver, Stock Entry Operator, Dispatch Operator | Ashish, Kirubakaran, Manohar, Nagarajan, Phani Raj, Spandana, Uday Kherkatary |
| Approve Write-Offs | `stock.writeoff.approve` | Can approve or decline a write-off. Approving is what actually removes the stock | Super Admin, Department Manager, Stock Approver | Kirubakaran, Manohar, Phani Raj |
| Write Off Stock | `stock.writeoff.create` | Can mark central stock as damaged, lost or otherwise unusable. A manager still has to approve it | Super Admin, Department Manager, Stock Entry Operator | Kirubakaran, Manohar, Phani Raj, Spandana, Uday Kherkatary |
| Write Off Department Stock | `stock.writeoff.department` | Can mark stock or assets already held by a department as unusable. A manager still has to approve it | Super Admin, Department Manager, Engineer | Deepanjona, Kirubakaran, Manohar, Phani Raj, Raghava |
| Reverse Write-Offs | `stock.writeoff.reverse` | Can undo an approved write-off and put the stock back, with a reason | Super Admin | Phani Raj |
| View Write-Offs | `stock.writeoff.view` | Can see stock that has been written off and the wastage report | Super Admin, Department Manager, Auditor, Stock Approver, Stock Entry Operator, Engineer | Deepanjona, Kirubakaran, Manohar, Nagarajan, Phani Raj, Raghava, Spandana, Uday Kherkatary |

### Team members

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Create Users | `users.create` | Can add new team members | Super Admin, Admin | Phani Raj, Shravani |
| Delete Users | `users.delete` | Can deactivate user accounts | Super Admin, Admin | Phani Raj, Shravani |
| Edit Users | `users.edit` | Can edit user details | Super Admin, Admin | Phani Raj, Shravani |
| Change Passwords | `users.password.edit` | Can set a new password for a user from their profile | Super Admin, Admin | Phani Raj, Shravani |
| View Passwords | `users.password.view` | Can reveal a user's password on their profile (only passwords set through the app can be revealed) | Super Admin, Admin | Phani Raj, Shravani |
| Grant Extra Permissions | `users.permissions.grant` | Can give one person a permission their role does not carry. Grants only, never to yourself, and never a permission you do not hold | Super Admin, Admin | Phani Raj, Shravani |
| View Users | `users.view` | Can view user list and profiles | Super Admin, Admin, Department Manager, Auditor | Kirubakaran, Manohar, Nagarajan, Phani Raj, Shravani |

### Vendors

| Permission | Key | What it allows | Roles | People |
|---|---|---|---|---|
| Add Vendors | `vendors.create` | Can add new vendors | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Delete Vendors | `vendors.delete` | Can permanently remove a vendor record | Super Admin, Admin | Phani Raj, Shravani |
| Edit Vendors | `vendors.edit` | Can edit vendor details and activate/deactivate vendors | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| Export the Vendor List | `vendors.export` | Can download the vendor list, with GST numbers and addresses, as a CSV | Super Admin, Admin, Auditor | Nagarajan, Phani Raj, Shravani |
| View Vendors | `vendors.view` | Can see the vendor list with GST numbers and addresses | Super Admin, Admin, Auditor, Buyer | Kirubakaran, Nagarajan, Phani Raj, Shravani |

---

## Rules that hold everywhere

- **No permission, no button.** A capability someone lacks is not rendered at all — never greyed out, never failing on click.
- **Location narrows, it never grants.** A person's site comes from their department. Someone with no department (Super Admin, Admin) is not restricted by location.
- **Money is separate.** `stock.value.view` gates every price and total. A role can see all the stock in the company and none of its value.
- **Scope is a permission too.** `stock.scope.all` / `.location` / `.department` / `.own` decide how much a role sees; the widest one held wins.
- **A permission nobody holds is a job nobody can do.** Read the *People* column above: where it says **nobody**, that step of the flow has no owner and whatever needs it will sit and wait. The same applies per site — someone has to hold the permission *and* be posted where the work is.

Tested by `docs/test-cases-permissions.md`, which walks every key in this file through the screen it governs.
