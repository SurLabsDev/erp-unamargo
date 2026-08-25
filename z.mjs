import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL,{prepare:false,max:1,connect_timeout:20});
const a = await sql`select state, wait_event,
    round(extract(epoch from now()-coalesce(xact_start,query_start)))::int seg
  from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid()
    and backend_type='client backend'`;
const z=a.filter(r=>r.state==='active'&&r.wait_event==='ClientRead'&&r.seg>90);
console.log(`  sesiones: ${a.length} | zombis (>90s): ${z.length} ${z.map(x=>x.seg+'s').join(' ')}`);
// se cortan los que quedaron de antes del cambio
const [k] = await sql`select count(*)::int n from (
  select pg_terminate_backend(pid) from pg_stat_activity
  where datname='postgres' and pid<>pg_backend_pid() and backend_type='client backend'
    and state='active' and wait_event='ClientRead'
    and coalesce(xact_start,query_start) < now() - interval '90 seconds') t`;
console.log('  zombis viejos cortados:', k.n);
await sql.end({timeout:3});
