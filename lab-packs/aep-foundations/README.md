# AEP Foundations Bootcamp Lab Pack

## Description

This lab pack contains all the necessary postman collections, sample data and lab-guide assets to run and operate the AEP Foundations Bootcamp. All assets are deployed with a default pre-fix of `dep:<space>`. This pre-fix can be configured during deployment but all lab guides will always reference the default prefix .Example using a schema name: `dep: Customer Account`

<br>

### Dependencies

- Postman account or license
- Admininstrative privilages for an IMS Org
  - Entitlements for Real-Time CDP
- Developer Console project with access to Adobe Experience Platform APIs
- Sandbox in Adobe Experience Platform
  - should be empty and of type `dev`
- Adobe Experience Platform role with all permissions grantedf for the given sandbox

<br>

### Directory & File Details

- `lab-assets` --> all of the assets that are referenced within the public facing lab guide located at [dep-labs.com](www.dep-labs.com)
- `deploy.json` --> postman collection for deploying lab assets
- `env.json` --> postman environment file
- `health.json` --> postman collection for validating asset deployment was successful

<br>

## Lab Guide

[https://www.dep-labs.com/aep-foundations-bootcamp](https://www.dep-labs.com/aep-foundations-bootcamp)

<br>


## How to Deploy Lab Assets

### Pre-requisites

- [Node.js](https://nodejs.org/en/download/package-manager/)
- [Postman Newman](https://learning.postman.com/docs/collections/using-newman-cli/installing-running-newman/)

<br>

### Steps

1. Install Newman
2. Download the following files from the repository:
    - env-manual-deploy.json --> postman environment file
    - deploy.json --> postman deployment collection
    - health-manual.json --> postman health collection
3. Configure you env.json file with the appropriate Developer Console Project credentials and save it. Use the correct env file based on Stage or Prod Environment. Some preconfigured files are already available and only IMS Org specific information you need to enter. Please use env-stage.json file for deploying on Stage and env-prod.json file for deploying on Prod.
4. Execute the deployment collection in newman using the following command:

    ```
    newman run deploy.json -e env-manual-deploy.json --delay-request 750 --bail failure --timeout-script 3600000
    ```

5. When it completes wait 15mins and then execute the `health.json` collection

    ```
    newman run health-manual.json -e env-manual-deploy.json --delay-request 750 --bail failure
    ```

<br>

>[!Note]
> The deployment takes roughly 1 hour and 15mins to complete.  Why? Once objects are deployed there needs to be a 1 hour delay until data is introduced to ensure the control plane has had enough time to finish its updates.

> [!TIP]
> A successful health check run will result in a `totalFound` count matching the `totalExpected` count.  This should be 137.

<br>

## Assets Deployed

Listed below are all the assets that are deployed as part of the *deploy.json* package.

- Identity Namespaces (4)
- Schema Registry
  - Classes (1)
  - Field Groups (13)
  - Schemas (10)
    - Identity Descriptors (12)
    - Relationship/Reference Descriptors (6)
    - Friendly Name Descriptors (3)
- Catalog Datasets (10)
- Flow Service
  - Source --> HTTP API (1)
    - Dataflows (10) --> all using mapping sets
- Profile Store (depeche.mode@dep.com)
  - 3 contributing trait-based datasets (3 records)
  - 7 contributing event-based datasets (43 events)
  - 4 lookup datasets | 22 records
- Profile Merge Policies (2)
  - default merge policy --> system generated
  - dep: No Stitch
- Audiences (1)
  - Any Event Streaming (within the hour)

<br>

> [!NOTE]
> Event data can span up to 6 months in arrears based on the date of the deployment. All dates is dynamically generated as part of the deployment scripts