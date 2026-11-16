---
name: store-submission
description: >-
  Prepares a store submission so it passes review the first time: the release build, the listing text and assets, the
  privacy and permission disclosures and the store's policy checklist, handed to the person who submits. Use before
  publishing to the App Store, Google Play, the Chrome Web Store, Firefox Add-ons or a desktop store such as the
  Microsoft Store, the Mac App Store or Steam.
worklings:
  kind: workflow
  department: ops
---
# Prepare a store submission

The person signs in, uploads and submits. You prepare everything so their part takes minutes and review passes the
first time.

1. Name the store and the track (TestFlight or App Review, a Play testing track or production, Chrome Web Store,
   Firefox Add-ons, Microsoft Store, Mac App Store, Steam). Read that store's current policies and listing
   requirements, because they change often, and note the date you checked.
2. The build: version and build number bumped, built with the project's own release command, signed as the store
   requires, free of debug flags, test endpoints and verbose logging, and tried on a real device or browser.
3. The listing, drafted in a file in the repo (for example `store/<store>.md`): name, short and full description,
   keywords where the store has them, category, what's new, support and privacy policy URLs. Check every field
   against the store's character limits.
4. The assets: icon, screenshots in every required size, promo or feature graphics, a preview video if used. List
   what exists and what's missing; screenshots show the real product.
5. The policy checklist, answered from the code, not from memory:
   - Data: what is collected, why, and whether it's shared or linked to the user. The store's privacy form (App
     Privacy, Data safety, the Chrome data-use disclosures) and the privacy policy match what the code does.
   - Permissions: each one needed, requested in context and justified in plain words; an extension states one
     clear single purpose.
   - Accounts: if people can create an account, they can delete it from inside the product.
   - Payments: digital goods and subscriptions follow the store's billing and external-link rules.
   - Code: no remote code where the store forbids it (Chrome MV3), no private or deprecated platform APIs.
   - Content: the age-rating questionnaire, the ads declaration, moderation for user-generated content if there is
     any.
   - Rights: no third-party names, logos or screenshots without permission; say "not affiliated" where other brands
     are mentioned.
   - Extras: export compliance (encryption) for Apple, trader status for EU listings, any other store-specific form.
6. Write the reviewer notes: how to reach every feature, which settings or flags matter, and where test account
   details go. The person fills those in.
7. Bring in the studio for what it does best: listing copy, privacy answers, a last test pass. The team:

{{team}}

8. Hand over a checklist: what's ready (with file paths), what only the person can do (sign in, pay fees, upload,
   enter account details, press submit), and the likely rejection risks with how each was addressed. Never sign in,
   upload or submit yourself.
