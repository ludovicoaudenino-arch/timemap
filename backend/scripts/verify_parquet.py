import duckdb

con = duckdb.connect()
query = """
SELECT 
    stage, 
    COUNT(*) AS num_sessioni, 
    ROUND(AVG(duration_sec), 2) AS durata_media_sec,
    ROUND(MIN(duration_sec), 2) AS min_sec,
    ROUND(MAX(duration_sec), 2) AS max_sec
FROM 'data/parquet_sample/sessions.parquet'
GROUP BY stage
ORDER BY num_sessioni DESC
"""

rows = con.sql(query).fetchall()
print("=" * 80)
print(" VERIFICA ANALITICA PARQUET GENERATO (DuckDB SQL) ")
print("=" * 80)
print(f"{'Stage derivato':<32} | {'Sessioni':<9} | {'Avg (s)':<9} | {'Min (s)':<8} | {'Max (s)'}")
print("-" * 80)
for stage, count, avg_s, min_s, max_s in rows:
    print(f"{stage:<32} | {count:<9} | {avg_s:<9} | {min_s:<8} | {max_s}")
print("=" * 80)
