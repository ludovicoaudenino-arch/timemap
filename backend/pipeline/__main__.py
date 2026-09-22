"""
Interfaccia a riga di comando della pipeline.

    # importazione (o aggiornamento) del dataset
    python -m backend.pipeline --logs ../data/cowrie

    # riscrittura completa, ignorando il manifesto
    python -m backend.pipeline --logs ../data/cowrie --full

    # risolvendo con ip-api.com gli indirizzi non ancora in cache
    python -m backend.pipeline --logs ../data/cowrie --geo ip-api

    # oppure con un database GeoLite2 locale, senza uscire dalla macchina
    python -m backend.pipeline --logs ../data/cowrie --geo maxmind \\
        --mmdb ~/GeoLite2-City.mmdb

    # riempimento della cache da un dataset gia' geolocalizzato
    python -m backend.pipeline --bootstrap-geo backend/data/sessions.parquet
"""

import argparse
import os

from .run import bootstrap_geo, run

DEFAULT_DATA = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
DEFAULT_LOGS = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data", "cowrie")
)


def main():
    parser = argparse.ArgumentParser(
        description="Importa i log di Cowrie nei Parquet letti dal backend."
    )
    parser.add_argument(
        "--logs", default=DEFAULT_LOGS,
        help="cartella con i cowrie.json giornalieri (default: %(default)s)",
    )
    parser.add_argument(
        "--data", default=DEFAULT_DATA,
        help="cartella di destinazione dei Parquet (default: %(default)s)",
    )
    parser.add_argument(
        "--geo", default="cache", choices=("cache", "ip-api", "maxmind"),
        help="come risolvere gli indirizzi non ancora in cache (default: cache, "
             "nessuna richiesta di rete)",
    )
    parser.add_argument("--mmdb", default=None, help="database GeoLite2 per --geo maxmind")
    parser.add_argument(
        "--full", action="store_true",
        help="rilegge tutti i log invece dei soli file nuovi",
    )
    parser.add_argument("--batch-size", type=int, default=50000)
    parser.add_argument(
        "--bootstrap-geo", metavar="SESSIONS_PARQUET", default=None,
        help="riempie la cache degli IP da un dataset gia' geolocalizzato ed esce",
    )
    args = parser.parse_args()

    if args.bootstrap_geo:
        bootstrap_geo(args.data, args.bootstrap_geo)
        return

    run(
        log_dir=args.logs,
        data_dir=args.data,
        geo_mode=args.geo,
        mmdb_path=args.mmdb,
        full=args.full,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()
