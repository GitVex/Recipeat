# Migrations

Plain SQL, applied once each, in filename order, by `server/database/migrate.ts`
at app startup. What has been applied is recorded in `schema_migrations`; a
restart with nothing new to do writes nothing.

Name a file `NNN_name.sql` — three digits at least, zero-padded, then lowercase
and underscores. The runner refuses anything else rather than guessing, and
refuses two files sharing a number, which is what two branches each adding "the
next" migration looks like.

A file is applied inside a transaction together with its own
`schema_migrations` row, so a failure leaves neither. It must therefore not
open a transaction of its own, and cannot contain a statement Postgres refuses
to run inside one — `CREATE INDEX CONCURRENTLY` is the one that will come up.

Nothing edits a file that has been applied anywhere. The ledger keys on the
filename, so a changed file is a file that has already run.
