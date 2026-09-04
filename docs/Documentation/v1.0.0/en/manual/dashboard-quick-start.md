---
title: Quick Start
description: Prepare a certificate, create an application, and create an update plan from the dashboard quick start entry
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/dashboard/DashboardView.vue
  - web/src/views/application-onboarding/ApplicationOnboardingView.vue
  - web/src/views/application-onboarding/ApplicationOnboardingModal.vue
  - web/src/i18n/en-US.ts
  - web/src/views/settings/LicensingView.vue
  - web/src/api/modules/licensing.api.ts
  - backend/src/modules/application-onboarding/application/application-onboarding.service.ts
  - backend/src/modules/application-onboarding/application/onboarding-commit.service.ts
testRefs: []
lastVerified: 2026-09-04
---

# Quick Start

> **Important task after initialization: import the product license.** If the banner **No valid product license was detected. Open the Product Licensing page to configure one.** appears at the top of the console, complete [License Request and Import](./license-request-and-import.md) before configuring certificates and applications.

![image-20260904T142318.webp](../../manual/img/image-20260904T142318.webp)

The dashboard's **Get started here** area is the recommended entry point for your first certificate deployment. The minimum configuration has two actions: prepare a certificate, then create an application and an update plan.

## Step 1: Import or Create a Certificate

On the dashboard, select **Import or request a new certificate**, then choose the path that matches your certificate materials.

### You Already Have an Issued Certificate: Import It

1. Select **Import an existing certificate**.
2. For PEM files or text, provide the server certificate, the complete intermediate certificate chain, and the matching private key separately.
3. For a PFX/PKCS#12 file, upload the `.pfx` or `.p12` file and enter its password.
4. Follow the page validation and confirm that the domains cover the actual access domain, the certificate has not expired, and the private key matches.

### You Do Not Have a Certificate: Request One Through ACME

1. Select the ACME issuance method.
2. Select a configured ACME account and request profile, then enter the domain and validation method.
3. Follow the page instructions to complete domain validation and wait for issuance.
4. Open the certificate version details and confirm that the new version is available.

### Confirm the Certificate Is Ready

Whichever path you choose, confirm that the new version appears in the **Certificate** selector in the application wizard before continuing to Step 2. This confirms that the certificate is ready.

## Step 2: Create the Application and Update Plan

Return to the dashboard and select **Deploy to a website or application**, then complete the selections in the wizard.

This wizard always creates an application. When you select an existing certificate version, it also creates an update plan.

### Select the Business Platform

Select the platform where the website, gateway, or service actually runs. If the platform is not listed, open the Plugin Center and confirm that the required platform support is installed and enabled.

### Select an Existing Asset

If the target device or service is already connected to the platform:

1. Select **Use existing device** or an existing service asset.
2. Select it, choose **Continue**, and wait for the connection test and site discovery to finish.
3. Select the site that you want to update from the discovery results.

### Add a New Device or Service

If the target has not been connected to the platform:

1. Select **Add device**.
2. Complete the unified device onboarding wizard for registration or connection.
3. Return to the application onboarding wizard and continue with the connection test, site discovery, and target selection.

### Enter the Site Information

After selecting a site, enter the DNS domain that users use to access it and the verification URL. Both addresses should use the same business domain. If the target platform asks for a certificate format, credential, or deployment parameter, provide it as instructed on the page.

### Use the Certificate Prepared in Step 1

To deploy the certificate prepared in Step 1:

1. Select **Select certificate manually**.
2. Select the certificate inventory item imported or requested in Step 1.
3. Select the certificate version to deploy. Select a specific version for a one-time update; select **Always use latest** when future updates should follow new versions.

### Request a Dedicated ACME Certificate for the Application

If each application needs its own certificate:

1. Select **Use dedicated certificate**.
2. Select **ACME** as the issuance method.
3. Follow the page instructions to select the ACME account, request profile, and domain validation method.
4. Provide the issuance parameters requested on the page. This path is suitable when the application needs independent renewal; for a first-time update only, prefer **Select certificate manually** above.

### Choose How Future Updates Should Run

#### Update Only Once

Select **Do not configure now**. After the application is created, run the update plan manually when an update is needed.

#### Update When a New Certificate Version Is Created

Select **Update when a new certificate version is created**.

- Select **Run immediately** to create an update task as soon as a new version is created.
- Select **Run at a specified time** and enter the time to run each day.

#### Update on a Fixed Schedule

Select **Update on a fixed schedule**, then choose one frequency:

- Daily: enter the time each day.
- Weekly: select the weekday and enter the time.
- Monthly: select the day of the month.

### Confirm Creation

On the completion page, review the platform, asset, site, and certificate details, then select **Confirm and create**. With **Select certificate manually**, the system creates the application and update plan together. With **Use dedicated certificate**, it first creates the application and saves the certificate request configuration.

**Confirm and create** only saves the application and plan configuration; it does not change the target service immediately. To actually update the certificate, submit and execute the plan, and confirm the target read-back in the execution record.

## Run the Update After Creation

After the application and plan are created, open **Certificate Deployment** or the plan entry in the application details:

1. Review the connection, credential, certificate-format, and target configuration shown by the page, and complete any missing information it identifies.
2. Submit and execute the plan. In a tenant with approvals enabled, wait for approval first.
3. Open the execution record and confirm that installation, service refresh, and target read-back all succeeded. Check that the read-back fingerprint matches the certificate version selected in Step 2.

## An Entry Is Unavailable or There Is No Target

- **No Import or request a new certificate entry:** Check whether the current tenant allows certificate creation, or contact an administrator.
- **No Deploy to a website or application entry:** Ask an administrator to confirm that your account has application-management permission, then complete Step 1 certificate preparation.
- **The asset or site list is empty:** Open **Asset Center**, confirm that the device or service is online, run the connection test and discovery, then return to the wizard.
- **No matching certificate version:** Confirm that the certificate domains cover the application's access domain, or return to Step 1 and prepare the correct version.
- **Submission or execution fails:** Open the page message and execution record, correct the connection, credential, certificate-format, or target configuration it identifies, then submit again.
