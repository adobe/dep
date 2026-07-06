# DEP CLI

A command-line tool for deploying Adobe Experience Platform (AEP) and Adobe Journey Optimizer (AJO) lab environments. It automates the creation of schemas, datasets, data flows, identity configurations, and sample data into any sandbox -- replacing hundreds of manual API calls with simple menu selections.

Built as part of the **Developer Enablement Program (DEP)**, which aims to up-level the technical knowledge of the products built on top of Adobe Experience Platform by explaining the "why behind the how" of the underlying system architecture.

***

### Table of Contents

- [CLI Menus](#cli-menus)
- [Lab Packs](#lab-packs)
- [Sample Data](#sample-data)
- [Feedback](#feedback)

<br>

## CLI Menus

```text
Main Menu
  1) AEP foundations
  2) AJO arch foundations
  3) Sandbox management
  4) Exit
```

For installation, environment setup, step-by-step instructions, deployment timelines, and troubleshooting, see the **[wiki](https://github.com/adobe/dep-cli/wiki)**:

- **[Installation](https://github.com/adobe/dep-cli/wiki/Installation)** -- clone, install dependencies, and start the CLI (includes updating an existing install)
- **[Environment Setup](https://github.com/adobe/dep-cli/wiki/Environment-Setup)** -- create and configure your environment file
- **[Node.js Setup](https://github.com/adobe/dep-cli/wiki/Nodejs-Setup-Windows)** -- install Node.js on Windows (nvm-windows) or macOS (nvm)
- **[AEP Foundations Menu](https://github.com/adobe/dep-cli/wiki/AEP-Foundations-Menu)** -- creates the profile base, loads profile data, and validates via health check (~2h 33min end-to-end)
- **[AJO Architectural Foundations Menu](https://github.com/adobe/dep-cli/wiki/AJO-Architectural-Foundations-Menu)** -- covers both the profile and relational tracks (~3h 30min end-to-end)
- **[Sandbox Management Menu](https://github.com/adobe/dep-cli/wiki/Sandbox-Management-Menu)** -- resets a sandbox (destructive; requires explicit confirmation of the target sandbox name)

<br>

---

## Lab Packs

### [AEP Foundations](/industry/telecom/lab-packs/aep-foundations/)

A complete set of hands-on exercises that you can complete at your own pace, teaching the foundational building blocks of Adobe Experience Platform.

### [AJO Architectural Foundations](/industry/telecom/lab-packs/ajo-foundations/)

A simplified set of schemas, datasets, and data that can be easily deployed to a sandbox to jump-start your learning. Works in conjunction with the AEP Foundations lab pack.

<br>

---

## Sample Data

[View here](/industry/telecom/)

The baseline data model used for creating any of the lab packs, inclusive of sample data you can use for your own creations if desired. Sample data lives under an industry vertical (currently `telecom`) and is split into two stores:

**[standard/sample-data/](/industry/telecom/standard/sample-data/)** -- data for the AEP profile store

- **depeche-mode-profile** -- a single profile and its associated data used to demo profile assembly
- **stranger-things-profiles** -- a richer set of profiles used in AEP Foundations exercises
- **decisioning-profiles** -- profiles wired up for decisioning scenarios
- **plan_lookup.json / product_lookup.json / store_lookup.json** -- reference lookup records used by the profile-store schemas

**[relational/sample-data/](/industry/telecom/relational/sample-data/)** -- data for the AJO relational store

- **customer_account / customer_address / customer_line** -- customer-side relational records
- **order / order_product** -- order and order-line records
- **billing_statement / billing_detail** -- billing records
- **plan_lookup / product_lookup / product_type_lookup / store_lookup** -- reference lookup tables shared across relational datasets

<br>

---

## Feedback

Find an issue or want an enhancement? File an issue [here](https://github.com/adobe/dep-cli/issues).
