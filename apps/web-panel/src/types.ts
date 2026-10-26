/** CYBRIX web panel worker env — no secrets, only the shared D1 binding + version. */
export interface Env {
  DB: D1Database;
  VERSION: string;
}
