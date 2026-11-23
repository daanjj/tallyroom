# Rules checklist

`tests/rules.test.js` tries `database.rules.json` against every row of the rights table (backlog H4), but with a stand-in for Firebase. After publishing the rules, try the cases below on the real database, in **Realtime Database → Rules → Rules Playground** or from the browser console of the page, and note the date and outcome here.

Needed: an admin, two users (A and B), an account without a `users` record, and a phone. A owns one private set shared with B, and one public set.

| # | Who | Tries | Must be |
|---|---|---|---|
| 1 | Not signed in | read `sets/{id}`; write anything | refused |
| 2 | Phone (anonymous) | read `sets/{id}`, `polls/{id}/config`; write its own vote | allowed |
| 3 | Phone | read `sets`, `users`, `polls/{id}/votes`; write `polls/{id}/session` | refused |
| 4 | Account without record | sign in | "This account has no access" |
| 5 | User B | overview query on own sets and on public sets | allowed, and the queries need no index warning in the console |
| 6 | User B | read `sets` without a query | refused |
| 7 | User B, on A's private shared set | edit a question, run a session, read the answers | allowed |
| 8 | User B, on that set | delete, change link, switch to public, share with someone | refused |
| 9 | User B, on A's public set | read `polls/{id}/config` | allowed |
| 10 | User B, on A's public set | read `polls/{id}/votes`; write `polls/{id}/config` | refused |
| 11 | User A | create, duplicate, change link and delete an own set | allowed, and after delete `polls/{id}` is gone too |
| 12 | User A | write `sets/{own id}/owner` with B's uid; write `users/{own uid}/role` | refused |
| 13 | Admin | all of 7, 8 and 12 on A's sets | allowed |
| 14 | Three phones | a full session in a consent set | no refused write in the console |
| 15 | User A | share the private set with a third user from **Share…**; B chooses **Leave** on it | allowed, and the set appears in and disappears from their My sets without reload |
| 16 | Admin | **Assign to…** A's set to B; change B's name and role on **Users** | allowed; the set moves from A's My sets to B's |
| 17 | Admin | **Remove access** of a user who owns no sets, while that user has the overview open | allowed; that user gets "This account has no access" within a few seconds |
| 18 | Admin | write `users/{own uid}/role` with `user`; remove `users/{own uid}` | refused |

## Log

| Date | Rules of commit | Outcome |
|---|---|---|
| | | not tried yet |
