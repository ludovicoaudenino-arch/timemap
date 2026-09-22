"""
Pipeline ETL del backend: dai log grezzi di Cowrie ai Parquet interrogati da
DuckDB.

Prima questo lavoro era sparso fra quattro script e due repository, e il
backend partiva da un file gia' lavorato a mano. Qui i passi sono tutti dentro
al backend e ne resta uno solo da eseguire:

    python -m backend.pipeline --logs ../data/cowrie

Vedi `run.py` per l'orchestrazione e `__main__.py` per le opzioni.
"""

from .run import bootstrap_geo, run

__all__ = ["run", "bootstrap_geo"]
