// Advisory-lock keys (pg_advisory_xact_lock). Single registry so no two
// features accidentally share a key. All check-then-write invariants
// (contractual limits, last-admin rule, balance cut-date) serialize on these.
export const PRODUCT_LIMIT_LOCK = 834001; // 150 active SKUs
export const USER_LIMIT_LOCK = 834002; // 5 active users + last-admin rule
export const BALANCE_LOCK = 834003; // initial_balance_date vs cash movements
