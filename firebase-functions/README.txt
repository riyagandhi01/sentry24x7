Sentry24x7 Account Deletion Cloud Function

IMPORTANT: The website calls the callable function deleteSentryAccount.
Deploy this folder using Firebase CLI after linking it to project agcs-8edd6.

Suggested commands (run from a Firebase project root):
1. firebase login
2. firebase use agcs-8edd6
3. Copy index.js/package.json into your Firebase functions directory OR configure this folder as functions source.
4. npm install
5. firebase deploy --only functions:deleteSentryAccount

The function requires an authenticated Firebase user. It validates that the authenticated user exists under the selected society/role before deleting data. It does not store passwords.

Because the supplied website does not expose every Android-side database/storage path, the function safely deletes user records that can be identified by exact email/UID and selected role/path. Secretary details in AGCS/{society}/Profile are scrubbed rather than deleting the entire society. Storage cleanup deletes only files explicitly associated with UID/email metadata or users/{uid}/ paths.
