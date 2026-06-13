"""
Datos de los 48 equipos clasificados para el Mundial 2026.
Fuentes: FIFA Ranking, ELO Club World Ranking, estadísticas históricas.
"""

import pandas as pd
import numpy as np

# Formato: (pais, confederacion, ranking_fifa, elo_rating,
#           media_goles_a_favor, media_goles_en_contra,
#           tasa_victorias_20partidos, copas_del_mundo_ganadas,
#           partidos_wc_historicos)
TEAMS_RAW = [
    # CONMEBOL (6)
    ("Argentina",    "CONMEBOL", 1,  2079, 2.1, 0.7, 0.75, 3, 81),
    ("Brazil",       "CONMEBOL", 5,  1967, 1.8, 0.8, 0.68, 5, 114),
    ("Colombia",     "CONMEBOL", 12, 1872, 1.6, 0.9, 0.58, 0, 28),
    ("Uruguay",      "CONMEBOL", 17, 1824, 1.4, 1.0, 0.52, 2, 56),
    ("Ecuador",      "CONMEBOL", 30, 1751, 1.3, 1.1, 0.45, 0, 12),
    ("Venezuela",    "CONMEBOL", 48, 1641, 1.1, 1.3, 0.38, 0, 0),

    # UEFA (16)
    ("Spain",        "UEFA",     2,  1994, 1.9, 0.6, 0.72, 1, 66),
    ("France",       "UEFA",     3,  1987, 1.8, 0.7, 0.70, 2, 66),
    ("England",      "UEFA",     4,  1976, 1.7, 0.8, 0.68, 1, 70),
    ("Portugal",     "UEFA",     6,  1948, 1.7, 0.8, 0.65, 0, 35),
    ("Netherlands",  "UEFA",     8,  1921, 1.6, 0.9, 0.62, 0, 45),
    ("Belgium",      "UEFA",     10, 1902, 1.5, 0.9, 0.60, 0, 45),
    ("Germany",      "UEFA",     14, 1862, 1.6, 1.0, 0.57, 4, 106),
    ("Italy",        "UEFA",     9,  1914, 1.4, 0.8, 0.58, 4, 83),
    ("Croatia",      "UEFA",     11, 1887, 1.3, 0.9, 0.55, 0, 22),
    ("Switzerland",  "UEFA",     13, 1867, 1.3, 1.0, 0.53, 0, 36),
    ("Denmark",      "UEFA",     15, 1857, 1.4, 0.9, 0.54, 0, 22),
    ("Austria",      "UEFA",     20, 1812, 1.3, 1.0, 0.50, 0, 29),
    ("Ukraine",      "UEFA",     22, 1803, 1.2, 1.0, 0.48, 0, 9),
    ("Poland",       "UEFA",     25, 1781, 1.2, 1.1, 0.46, 0, 22),
    ("Serbia",       "UEFA",     27, 1762, 1.2, 1.1, 0.45, 0, 15),
    ("Scotland",     "UEFA",     35, 1723, 1.1, 1.1, 0.42, 0, 23),

    # CONCACAF (6 incluyendo anfitriones USA, Mexico, Canada)
    ("USA",          "CONCACAF", 16, 1849, 1.5, 1.0, 0.54, 0, 35),
    ("Mexico",       "CONCACAF", 18, 1838, 1.5, 1.0, 0.53, 0, 57),
    ("Canada",       "CONCACAF", 40, 1702, 1.3, 1.1, 0.45, 0, 4),
    ("Panama",       "CONCACAF", 71, 1621, 1.0, 1.3, 0.32, 0, 4),
    ("Jamaica",      "CONCACAF", 58, 1653, 1.0, 1.2, 0.35, 0, 4),
    ("Honduras",     "CONCACAF", 79, 1601, 0.9, 1.3, 0.30, 0, 12),

    # CAF (9)
    ("Morocco",      "CAF",      13, 1869, 1.4, 0.8, 0.58, 0, 22),
    ("Senegal",      "CAF",      19, 1823, 1.3, 1.0, 0.53, 0, 14),
    ("Nigeria",      "CAF",      33, 1733, 1.3, 1.1, 0.47, 0, 20),
    ("Egypt",        "CAF",      38, 1712, 1.2, 1.0, 0.45, 0, 12),
    ("Ivory Coast",  "CAF",      42, 1697, 1.2, 1.1, 0.44, 0, 8),
    ("Cameroon",     "CAF",      47, 1688, 1.1, 1.2, 0.40, 0, 22),
    ("Ghana",        "CAF",      52, 1677, 1.1, 1.2, 0.38, 0, 16),
    ("Tunisia",      "CAF",      45, 1691, 1.1, 1.1, 0.40, 0, 14),
    ("South Africa", "CAF",      56, 1673, 1.0, 1.2, 0.37, 0, 9),

    # AFC (8)
    ("Japan",        "AFC",      24, 1793, 1.5, 0.9, 0.55, 0, 26),
    ("South Korea",  "AFC",      23, 1791, 1.4, 1.0, 0.52, 0, 37),
    ("Iran",         "AFC",      26, 1773, 1.3, 1.0, 0.49, 0, 18),
    ("Australia",    "AFC",      28, 1757, 1.2, 1.1, 0.46, 0, 18),
    ("Saudi Arabia", "AFC",      57, 1669, 1.1, 1.2, 0.37, 0, 13),
    ("Iraq",         "AFC",      63, 1643, 1.0, 1.2, 0.35, 0, 5),
    ("Jordan",       "AFC",      68, 1627, 1.0, 1.3, 0.33, 0, 0),
    ("Uzbekistan",   "AFC",      72, 1612, 0.9, 1.2, 0.32, 0, 0),

    # OFC (1)
    ("New Zealand",  "OFC",      95, 1552, 0.9, 1.4, 0.28, 0, 4),

    # Clasificados playoff
    ("Costa Rica",   "CONCACAF", 49, 1684, 1.0, 1.1, 0.38, 0, 17),
    ("Bolivia",      "CONMEBOL", 83, 1593, 0.9, 1.4, 0.27, 0, 7),
    ("Algeria",      "CAF",      36, 1718, 1.2, 1.0, 0.47, 0, 12),
    ("Turkey",       "UEFA",     29, 1754, 1.2, 1.1, 0.47, 0, 13),
]

COLUMNS = [
    "pais", "confederacion", "ranking_fifa", "elo_rating",
    "media_goles_favor", "media_goles_contra",
    "tasa_victorias", "copas_ganadas", "partidos_wc"
]


def get_teams_df() -> pd.DataFrame:
    df = pd.DataFrame(TEAMS_RAW, columns=COLUMNS)

    # ELO normalizado (0-1) — útil para modelos de ML
    elo_min, elo_max = df["elo_rating"].min(), df["elo_rating"].max()
    df["elo_norm"] = (df["elo_rating"] - elo_min) / (elo_max - elo_min)

    # Ranking inverso normalizado (el nº1 debe ser el mayor valor)
    df["ranking_inv_norm"] = (df["ranking_fifa"].max() - df["ranking_fifa"]) / \
                             (df["ranking_fifa"].max() - df["ranking_fifa"].min())

    # One-hot encoding de confederaciones
    df = pd.get_dummies(df, columns=["confederacion"], prefix="conf")

    return df


if __name__ == "__main__":
    df = get_teams_df()
    print(df[["pais", "ranking_fifa", "elo_rating", "tasa_victorias"]].to_string(index=False))
